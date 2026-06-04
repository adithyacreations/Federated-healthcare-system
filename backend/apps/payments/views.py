from django.conf import settings
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.auth_app.models import LoginCredentials
from utils import log_audit, send_notification
from payment_utils import (
    create_razorpay_order,
    verify_razorpay_payment,
    process_payment_success,
    attach_order_id_to_record,
    _fetch_record,
)
from .serializers import (
    CreateOrderSerializer,
    VerifyPaymentSerializer,
    RefundRequestSerializer,
)


def ok(message, data=None, status_code=200):
    return Response(
        {'success': True, 'message': message, 'data': data if data is not None else {}},
        status=status_code,
    )


def err(message, errors=None, status_code=400):
    return Response(
        {'success': False, 'message': message, 'errors': errors or {}},
        status=status_code,
    )


# ─── 1. Create Order ────────────────────────────────────────────────────────

class CreatePaymentOrderView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = CreateOrderSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', ser.errors)

        payment_type = ser.validated_data['payment_type']
        object_id = str(ser.validated_data['object_id'])
        amount = ser.validated_data['amount']

        # Make sure the underlying record exists before charging
        record = _fetch_record(payment_type, object_id)
        if record is None:
            return err(f'No {payment_type} record found for object_id {object_id}.', status_code=404)

        result = create_razorpay_order(
            amount=amount,
            currency='INR',
            receipt=f'{payment_type[:3]}_{str(object_id)[:30]}',
            notes={
                'payment_type': payment_type,
                'object_id': str(object_id),
                'login_id': str(request.user.login_id),
            },
        )
        if not result.get('success'):
            return err(f'Razorpay order creation failed: {result.get("error", "unknown")}', status_code=502)

        attach_order_id_to_record(payment_type, object_id, result['order_id'])

        log_audit(
            login_id=request.user,
            action='create_payment_order',
            module='payments',
            entity_type=payment_type,
            entity_id=str(object_id),
            new_value={'razorpay_order_id': result['order_id'], 'amount': str(amount)},
        )

        return ok('Payment order created.', {
            'success': True,
            'razorpay_order_id': result['order_id'],
            'amount': result['amount'],
            'currency': result['currency'],
            'key_id': result['key_id'],
            'payment_type': payment_type,
            'object_id': str(object_id),
        })


# ─── 2. Verify Payment ──────────────────────────────────────────────────────

class VerifyPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = VerifyPaymentSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', ser.errors)

        d = ser.validated_data
        verified = verify_razorpay_payment(
            d['razorpay_order_id'], d['razorpay_payment_id'], d['razorpay_signature']
        )
        if not verified:
            log_audit(
                login_id=request.user,
                action='payment_verification_failed',
                module='payments',
                entity_type=d['payment_type'],
                entity_id=str(d['object_id']),
                new_value={'razorpay_order_id': d['razorpay_order_id']},
            )
            return err('Payment verification failed', status_code=400)

        result = process_payment_success(
            payment_type=d['payment_type'],
            object_id=str(d['object_id']),
            razorpay_payment_id=d['razorpay_payment_id'],
            razorpay_signature=d['razorpay_signature'],
            razorpay_order_id=d['razorpay_order_id'],
            actor_login=request.user,
        )
        if not result.get('success'):
            return err(result.get('error', 'Failed to apply payment.'), status_code=500)

        return ok('Payment successful', {
            'success': True,
            'payment_type': d['payment_type'],
            'object_id': str(d['object_id']),
        })


# ─── 3. Payment History ─────────────────────────────────────────────────────

class PaymentHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.doctor.models import Consultation
        from apps.pharmacy.models import MedicineOrder
        from apps.lab.models import LabOrder
        from apps.vendor.models import EquipmentOrder

        login = request.user
        role = login.role

        consultations = []
        medicine = []
        lab = []
        equipment = []

        # Consultations: patient pays, doctor receives
        cq = Consultation.objects.filter(payment_status='paid')
        if role == 'patient':
            cq = cq.filter(patient_id__login_id=login)
        elif role == 'doctor':
            cq = cq.filter(doctor_id__login_id=login)
        elif role != 'super_admin':
            cq = cq.none()
        consultations = list(cq.values(
            'consultation_id', 'razorpay_order_id', 'razorpay_payment_id',
            'payment_status', 'created_at',
        ))

        # Medicine orders: patient pays, pharmacist fulfils
        mq = MedicineOrder.objects.filter(payment_status='paid')
        if role == 'patient':
            mq = mq.filter(patient_id__login_id=login)
        elif role == 'pharmacist':
            mq = mq.filter(pharmacist_id__login_id=login)
        elif role != 'super_admin':
            mq = mq.none()
        medicine = list(mq.values(
            'med_order_id', 'total_amount', 'razorpay_order_id', 'razorpay_payment_id',
            'payment_status', 'order_status', 'ordered_at',
        ))

        # Lab orders: patient pays, lab tech fulfils, doctor ordered
        lq = LabOrder.objects.filter(payment_status='paid')
        if role == 'patient':
            lq = lq.filter(patient_id__login_id=login)
        elif role == 'doctor':
            lq = lq.filter(doctor_id__login_id=login)
        elif role == 'lab_tech':
            lq = lq.filter(lab_tech_id__login_id=login)
        elif role != 'super_admin':
            lq = lq.none()
        lab = list(lq.values(
            'order_id', 'razorpay_order_id', 'razorpay_payment_id',
            'payment_status', 'status', 'ordered_at',
        ))

        # Equipment orders: hospital admin pays, vendor fulfils
        eq = EquipmentOrder.objects.filter(payment_status='paid')
        if role == 'hospital_admin':
            eq = eq.filter(hospital_id__login_id=login)
        elif role == 'vendor':
            eq = eq.filter(vendor_id__login_id=login)
        elif role != 'super_admin':
            eq = eq.none()
        equipment = list(eq.values(
            'eq_order_id', 'total_price', 'razorpay_order_id', 'razorpay_payment_id',
            'payment_status', 'order_status', 'ordered_at',
        ))

        return ok('Payment history retrieved.', {
            'consultations': consultations,
            'medicine_orders': medicine,
            'lab_orders': lab,
            'equipment_orders': equipment,
            'totals': {
                'consultations': len(consultations),
                'medicine_orders': len(medicine),
                'lab_orders': len(lab),
                'equipment_orders': len(equipment),
            },
        })


# ─── 4. Refund Request ──────────────────────────────────────────────────────

class RefundRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = RefundRequestSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', ser.errors)

        payment_type = ser.validated_data['payment_type']
        object_id = str(ser.validated_data['object_id'])
        reason = ser.validated_data.get('reason', '')

        record = _fetch_record(payment_type, object_id)
        if record is None:
            return err(f'No {payment_type} record found for object_id {object_id}.', status_code=404)

        if getattr(record, 'payment_status', '') != 'paid':
            return err('Refund can only be requested for paid orders.', status_code=400)

        # Note: existing PAYMENT_STATUS choices are pending/paid/failed only — we do not
        # mutate the field to an unsupported value. The refund-requested state is captured
        # via audit log + notification to admin, which the demo super-admin handles manually.
        log_audit(
            login_id=request.user,
            action='refund_requested',
            module='payments',
            entity_type=payment_type,
            entity_id=object_id,
            new_value={'reason': reason, 'razorpay_payment_id': getattr(record, 'razorpay_payment_id', '')},
        )

        for admin in LoginCredentials.objects.filter(role='super_admin', is_active=True):
            send_notification(
                admin,
                title=f'Refund requested — {payment_type}',
                message=f'A refund has been requested for {payment_type} {object_id}. Reason: {reason or "not provided"}',
                notif_type='alert',
                related_id=object_id,
            )

        return ok('Refund request submitted. The admin team will review it shortly.', {
            'payment_type': payment_type,
            'object_id': object_id,
            'status': 'refund_requested',
        }, status_code=201)
