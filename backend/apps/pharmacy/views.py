import hmac
import hashlib
import io
from datetime import date, datetime

from django.conf import settings
from django.db import transaction
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response

from apps.auth_app.permissions import IsPharmacist
from utils import log_audit, send_notification, broadcast_medicine_update, broadcast_pharmacy_update
from .models import PharmacistRegistration, MedicineOrder, PharmacyInventory
from .serializers import (
    PharmacistProfileSerializer,
    MedicineOrderSerializer,
    UpdateOrderStatusSerializer,
    VerifyPaymentSerializer,
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


def get_pharmacist(request):
    try:
        return PharmacistRegistration.objects.get(login_id=request.user)
    except PharmacistRegistration.DoesNotExist:
        return None


def generate_invoice_pdf(order, pharmacist):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.units import cm

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph('FederCare — Medicine Invoice', styles['Title']))
    elements.append(Spacer(1, 0.3*cm))

    invoice_no = str(order.med_order_id)[:8].upper()
    elements.append(Paragraph(f'<b>Invoice No:</b> INV-{invoice_no}', styles['Normal']))
    elements.append(Paragraph(f'<b>Date:</b> {order.ordered_at.strftime("%d %b %Y")}', styles['Normal']))
    elements.append(Spacer(1, 0.4*cm))

    elements.append(Paragraph(f'<b>Pharmacy:</b> {pharmacist.pharmacy_name}', styles['Normal']))
    elements.append(Paragraph(f'<b>Pharmacist:</b> {pharmacist.full_name}', styles['Normal']))
    if pharmacist.address:
        elements.append(Paragraph(f'<b>Address:</b> {pharmacist.address}', styles['Normal']))
    elements.append(Spacer(1, 0.4*cm))

    elements.append(Paragraph(f'<b>Patient:</b> {order.patient_id.full_name}', styles['Normal']))
    if order.delivery_address:
        elements.append(Paragraph(f'<b>Delivery Address:</b> {order.delivery_address}', styles['Normal']))
    elements.append(Spacer(1, 0.4*cm))

    elements.append(Paragraph('<b>Medicines:</b>', styles['Normal']))
    elements.append(Spacer(1, 0.2*cm))

    med_data = [['Medicine', 'Qty', 'Unit Price (Rs.)', 'Amount (Rs.)']]
    for med in order.medicines:
        name = med.get('name', '')
        qty = med.get('qty', 1)
        price = float(med.get('price', 0))
        amount = qty * price
        med_data.append([name, str(qty), f'{price:.2f}', f'{amount:.2f}'])

    table = Table(med_data, colWidths=[7*cm, 2.5*cm, 4*cm, 3.5*cm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1A3C6E')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F0F4FF')]),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
    ]))
    elements.append(table)
    elements.append(Spacer(1, 0.4*cm))

    elements.append(Paragraph(
        f'<b>Total Amount: Rs. {float(order.total_amount):.2f}</b>',
        styles['Normal'],
    ))
    elements.append(Paragraph(
        f'<b>Payment Status:</b> {order.payment_status.capitalize()}',
        styles['Normal'],
    ))
    elements.append(Spacer(1, 1*cm))
    elements.append(Paragraph('Thank you for choosing FederCare Pharmacy.', styles['Normal']))

    doc.build(elements)
    buffer.seek(0)
    return buffer


def save_invoice_pdf(buffer, filename, request=None):
    """Save a generated invoice PDF to local media storage. Returns URL."""
    try:
        from utils import save_bytes_locally
        return save_bytes_locally(buffer, f'{filename}.pdf', subdir='invoices', request=request)
    except Exception:
        return ''


# ─── Views ────────────────────────────────────────────────────────────────────

class PharmacistDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        orders = MedicineOrder.objects.filter(pharmacist_id=pharmacist)
        today = date.today()
        today_orders = orders.filter(ordered_at__date=today).select_related('patient_id')

        rx_pending = orders.filter(
            requires_prescription=True, prescription_verified=False,
        ).exclude(prescription_url='').exclude(order_status='cancelled').count()

        return ok('Pharmacist dashboard loaded.', {
            'pharmacy_name': pharmacist.pharmacy_name,
            'total_orders': orders.count(),
            # "Orders to dispatch" = paid orders the pharmacist still has to send
            # out (confirmed but not yet dispatched).
            'pending_orders': orders.filter(payment_status='paid', order_status='confirmed').count(),
            'confirmed_orders': orders.filter(order_status='confirmed').count(),
            'dispatched_orders': orders.filter(order_status='dispatched').count(),
            'delivered_orders': orders.filter(order_status='delivered').count(),
            'delivered_today': orders.filter(order_status='delivered', updated_at__date=today).count(),
            'rx_pending_verification': rx_pending,
            'todays_orders': MedicineOrderSerializer(
                today_orders, many=True, context={'request': request}).data,
            'low_stock_alert': [],
        })


class PendingOrderCountView(APIView):
    """Lightweight count for the sidebar badge / polling — orders that still
    need the pharmacist's attention."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        orders = MedicineOrder.objects.filter(pharmacist_id=pharmacist)
        prescription_pending = orders.filter(
            requires_prescription=True,
            prescription_verified=False,
            order_status='prescription_uploaded',
        ).count()
        ready_to_dispatch = orders.filter(
            order_status='confirmed', payment_status='paid',
        ).count()

        return ok('Pending count.', {
            'count': prescription_pending + ready_to_dispatch,
            'prescription_pending': prescription_pending,
            'ready_to_dispatch': ready_to_dispatch,
        })


class ListOrdersView(APIView):
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        qs = MedicineOrder.objects.filter(pharmacist_id=pharmacist).select_related('patient_id')

        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(order_status=status_filter)

        # Pending orders first, then by most recent
        qs = qs.order_by(
            '-ordered_at'
        ).order_by(
            'order_status' if not status_filter else '-ordered_at',
            '-ordered_at',
        )

        # Simple pending-first sort without complex ORM
        from django.db.models import Case, When, IntegerField
        qs = MedicineOrder.objects.filter(pharmacist_id=pharmacist).select_related('patient_id')
        if status_filter:
            qs = qs.filter(order_status=status_filter)
        qs = qs.annotate(
            priority=Case(
                When(order_status='pending', then=0),
                When(order_status='confirmed', then=1),
                When(order_status='dispatched', then=2),
                When(order_status='delivered', then=3),
                default=4,
                output_field=IntegerField(),
            )
        ).order_by('priority', '-ordered_at')

        return ok('Orders retrieved.', MedicineOrderSerializer(
            qs, many=True, context={'request': request}).data)


class GetOrderDetailView(APIView):
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request, order_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        try:
            order = MedicineOrder.objects.select_related(
                'patient_id', 'pharmacist_id', 'prescription_id',
                'prescription_id__doctor_id',
            ).get(med_order_id=order_id, pharmacist_id=pharmacist)
        except MedicineOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        data = MedicineOrderSerializer(order, context={'request': request}).data
        if order.prescription_id:
            rx = order.prescription_id
            data['prescription'] = {
                'prescription_id': str(rx.prescription_id),
                'doctor_name': rx.doctor_id.full_name,
                'diagnosis': rx.diagnosis,
                'instructions': rx.instructions,
                'valid_until': rx.valid_until.isoformat() if rx.valid_until else None,
                'is_verified': rx.is_verified,
                'pdf_url': rx.pdf_url,
            }

        return ok('Order details retrieved.', data)


class UpdateOrderStatusView(APIView):
    permission_classes = [IsAuthenticated, IsPharmacist]

    def put(self, request, order_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        try:
            order = MedicineOrder.objects.select_related('patient_id').get(
                med_order_id=order_id, pharmacist_id=pharmacist
            )
        except MedicineOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        ser = UpdateOrderStatusSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        d = ser.validated_data
        order.order_status = d['order_status']
        if d.get('tracking_info'):
            order.tracking_info = d['tracking_info']
        order.save(update_fields=['order_status', 'tracking_info', 'updated_at'])

        status_messages = {
            'confirmed': 'Your medicine order has been confirmed and is being prepared.',
            'dispatched': 'Your medicine order has been dispatched and is on the way.',
            'delivered': 'Your medicine order has been delivered successfully.',
        }
        send_notification(
            login_id=order.patient_id.login_id,
            title=f'Order {d["order_status"].capitalize()}',
            message=status_messages.get(d['order_status'], 'Your order status has been updated.'),
            notif_type='info',
            related_id=str(order_id),
        )

        log_audit(
            login_id=request.user,
            action=f'Order status updated to {d["order_status"]}',
            module='pharmacy',
            entity_type='MedicineOrder',
            entity_id=str(order_id),
        )
        return ok('Order status updated.', MedicineOrderSerializer(
            order, context={'request': request}).data)


class VerifyPrescriptionView(APIView):
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request, prescription_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        from apps.doctor.models import Prescription
        try:
            rx = Prescription.objects.select_related(
                'patient_id', 'doctor_id'
            ).get(prescription_id=prescription_id)
        except Prescription.DoesNotExist:
            return err('Prescription not found.', status_code=404)

        is_expired = False
        if rx.valid_until and rx.valid_until < date.today():
            is_expired = True

        return ok('Prescription details retrieved.', {
            'prescription_id': str(rx.prescription_id),
            'patient_name': rx.patient_id.full_name,
            'doctor_name': rx.doctor_id.full_name,
            'medicines': rx.medicines,
            'diagnosis': rx.diagnosis,
            'valid_until': rx.valid_until.isoformat() if rx.valid_until else None,
            'is_verified': rx.is_verified,
            'is_expired': is_expired,
        })


class MarkPrescriptionVerifiedView(APIView):
    permission_classes = [IsAuthenticated, IsPharmacist]

    def put(self, request, prescription_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        from apps.doctor.models import Prescription
        try:
            rx = Prescription.objects.get(prescription_id=prescription_id)
        except Prescription.DoesNotExist:
            return err('Prescription not found.', status_code=404)

        if rx.valid_until and rx.valid_until < date.today():
            return err('Cannot verify an expired prescription.')

        rx.is_verified = True
        rx.save(update_fields=['is_verified'])

        log_audit(
            login_id=request.user,
            action='Pharmacist marked prescription verified',
            module='pharmacy',
            entity_type='Prescription',
            entity_id=str(prescription_id),
        )
        return ok('Prescription marked as verified.')


class VerifyPaymentView(APIView):
    permission_classes = [IsAuthenticated, IsPharmacist]

    def post(self, request):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        ser = VerifyPaymentSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        d = ser.validated_data
        razorpay_order_id = d['razorpay_order_id']
        razorpay_payment_id = d['razorpay_payment_id']
        razorpay_signature = d['razorpay_signature']

        try:
            order = MedicineOrder.objects.select_related('patient_id').get(
                razorpay_order_id=razorpay_order_id,
                pharmacist_id=pharmacist,
            )
        except MedicineOrder.DoesNotExist:
            return err('Order not found for this Razorpay order ID.', status_code=404)

        expected_sig = hmac.new(
            settings.RAZORPAY_KEY_SECRET.encode(),
            f'{razorpay_order_id}|{razorpay_payment_id}'.encode(),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(expected_sig, razorpay_signature):
            order.payment_status = 'failed'
            order.save(update_fields=['payment_status'])
            return err('Payment signature verification failed.', status_code=400)

        order.razorpay_payment_id = razorpay_payment_id
        order.razorpay_signature = razorpay_signature
        order.payment_status = 'paid'
        order.order_status = 'confirmed'
        order.save(update_fields=[
            'razorpay_payment_id', 'razorpay_signature',
            'payment_status', 'order_status',
        ])

        # Payment confirmed → commit the reservation: deduct real stock and
        # clear the reserved units that were held since the order was placed.
        try:
            finalize_stock(pharmacist, order.medicines)
        except Exception as exc:
            print(f'Stock finalize error: {exc}')

        send_notification(
            login_id=order.patient_id.login_id,
            title='Payment Confirmed',
            message=f'Payment for your medicine order has been confirmed. {pharmacist.pharmacy_name} will prepare your order.',
            notif_type='success',
            related_id=str(order.med_order_id),
        )

        log_audit(
            login_id=request.user,
            action='Medicine order payment verified',
            module='pharmacy',
            entity_type='MedicineOrder',
            entity_id=str(order.med_order_id),
        )
        return ok('Payment verified successfully.', {
            'med_order_id': str(order.med_order_id),
            'payment_status': order.payment_status,
            'order_status': order.order_status,
        })


class GenerateInvoiceView(APIView):
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request, order_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        try:
            order = MedicineOrder.objects.select_related('patient_id').get(
                med_order_id=order_id, pharmacist_id=pharmacist
            )
        except MedicineOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        pdf_buffer = generate_invoice_pdf(order, pharmacist)
        filename = f'inv_{order.med_order_id}'
        pdf_url = save_invoice_pdf(pdf_buffer, filename, request=request)

        log_audit(
            login_id=request.user,
            action='Invoice generated for medicine order',
            module='pharmacy',
            entity_type='MedicineOrder',
            entity_id=str(order_id),
        )
        return ok('Invoice generated.', {'pdf_url': pdf_url})


# ════════════════════════════════════════════════════════════════════════════
#  Medicine order — prescription verification + dispatch + OTP
# ════════════════════════════════════════════════════════════════════════════

def _generate_otp():
    import random
    import string
    return ''.join(random.choices(string.digits, k=6))


def _push_history(order, status, note):
    from django.utils import timezone
    history = list(order.status_history or [])
    history.append({
        'status': status,
        'timestamp': str(timezone.now()),
        'note': note,
    })
    order.status_history = history


class VerifyMedicinePrescriptionView(APIView):
    """Pharmacist approves/rejects an uploaded prescription on a medicine order."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def post(self, request, order_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        try:
            order = MedicineOrder.objects.select_related('patient_id').get(
                med_order_id=order_id, pharmacist_id=pharmacist
            )
        except MedicineOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        action = request.data.get('action')

        if action == 'approve':
            order.prescription_verified = True
            order.payment_enabled = True
            order.order_status = 'prescription_approved'
            _push_history(order, 'prescription_approved', 'Prescription approved by pharmacist')

            # Create the Razorpay order now so the patient can pay.
            from payment_utils import create_razorpay_order
            razorpay_data = create_razorpay_order(
                amount=float(order.total_amount),
                receipt=str(order.med_order_id),
                notes={'pharmacy': pharmacist.pharmacy_name},
            )
            if razorpay_data.get('success'):
                order.razorpay_order_id = razorpay_data['order_id']

            order.save(update_fields=[
                'prescription_verified', 'payment_enabled', 'order_status',
                'razorpay_order_id', 'status_history', 'updated_at',
            ])

            send_notification(
                login_id=order.patient_id.login_id,
                title='✅ Prescription Approved!',
                message=f'Your prescription was approved by {pharmacist.pharmacy_name}. '
                        f'Please complete payment to confirm your order.',
                notif_type='success',
                related_id=str(order.med_order_id),
            )

            try:
                from email_utils import send_approval_email
                send_approval_email(
                    to_email=order.patient_id.login_id.email,
                    full_name=order.patient_id.full_name,
                    entity_type='prescription',
                    status='approved',
                )
            except Exception as e:
                print(f'Approval email error: {e}')

            broadcast_medicine_update(
                str(order.patient_id.login_id.login_id),
                'prescription_approved',
                {
                    'order_id': str(order.med_order_id),
                    'pharmacy_name': pharmacist.pharmacy_name,
                    'razorpay_order_id': razorpay_data.get('order_id', ''),
                    'amount': razorpay_data.get('amount', 0),
                    'key_id': razorpay_data.get('key_id', ''),
                    'message': 'Prescription approved! Please pay now.',
                },
            )

            log_audit(
                login_id=request.user,
                action='Prescription approved for medicine order',
                module='pharmacy',
                entity_type='MedicineOrder',
                entity_id=str(order_id),
            )
            return ok('Prescription approved. Patient notified to pay.', {
                'order_id': str(order.med_order_id),
                'status': order.order_status,
                'razorpay_order_id': razorpay_data.get('order_id', ''),
                'amount': razorpay_data.get('amount', 0),
                'key_id': razorpay_data.get('key_id', ''),
            })

        elif action == 'reject':
            reason = request.data.get('reason', '')
            order.prescription_verified = False
            order.prescription_rejection_reason = reason
            order.order_status = 'cancelled'
            _push_history(order, 'cancelled', f'Prescription rejected: {reason}')
            order.save(update_fields=[
                'prescription_verified', 'prescription_rejection_reason',
                'order_status', 'status_history', 'updated_at',
            ])

            # Order won't proceed — return the reserved units to availability.
            try:
                release_stock(order.medicines)
            except Exception as exc:
                print(f'Stock release error: {exc}')
            send_notification(
                login_id=order.patient_id.login_id,
                title='❌ Prescription Rejected',
                message=f'Your prescription was rejected by {pharmacist.pharmacy_name}. '
                        f'Reason: {reason}',
                notif_type='alert',
                related_id=str(order.med_order_id),
            )
            broadcast_medicine_update(
                str(order.patient_id.login_id.login_id),
                'prescription_rejected',
                {
                    'order_id': str(order.med_order_id),
                    'reason': reason,
                    'message': f'Prescription rejected: {reason}',
                },
            )

            log_audit(
                login_id=request.user,
                action='Prescription rejected for medicine order',
                module='pharmacy',
                entity_type='MedicineOrder',
                entity_id=str(order_id),
            )
            return ok('Prescription rejected.', {
                'order_id': str(order.med_order_id),
                'status': order.order_status,
            })

        return err('action must be "approve" or "reject".')


class DispatchMedicineOrderView(APIView):
    """Pharmacist dispatches a medicine order — generates a delivery OTP."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def put(self, request, order_id):
        from datetime import timedelta
        from django.utils import timezone

        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        try:
            order = MedicineOrder.objects.select_related('patient_id').get(
                med_order_id=order_id, pharmacist_id=pharmacist
            )
        except MedicineOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        if order.payment_status != 'paid':
            return err('Patient has not paid for this order yet.', status_code=400)

        estimated_days = int(request.data.get('estimated_delivery_days', 2))
        driver_id = request.data.get('driver_id')
        
        driver = None
        if driver_id:
            try:
                from .models import PharmacyDriver
                driver = PharmacyDriver.objects.get(driver_id=driver_id, pharmacist=pharmacist, is_active=True)
            except PharmacyDriver.DoesNotExist:
                return err('Selected driver not found or inactive.', status_code=400)
        else:
            return err('Driver selection is required for dispatch.', status_code=400)

        otp = _generate_otp()
        otp_expiry = timezone.now() + timedelta(days=estimated_days)

        order.order_status = 'dispatched'
        order.delivery_otp = otp
        order.otp_expiry = otp_expiry
        order.otp_verified = False
        order.estimated_delivery_days = estimated_days
        order.dispatched_at = timezone.now()
        order.driver = driver
        order.driver_name = driver.name
        order.driver_phone = driver.phone
        _push_history(order, 'dispatched', f'Dispatched. Driver: {driver.name} ({driver.phone}). ETA: {estimated_days} days')
        order.save(update_fields=[
            'order_status', 'delivery_otp', 'otp_expiry', 'otp_verified',
            'estimated_delivery_days', 'dispatched_at', 'driver', 'driver_name', 'driver_phone',
            'status_history', 'updated_at',
        ])

        patient = order.patient_id
        try:
            from email_utils import send_dispatch_email
            send_dispatch_email(
                to_email=patient.login_id.email,
                hospital_name=patient.full_name,
                product_name='Medicine Order',
                quantity=len(order.medicines),
                vendor_name=pharmacist.pharmacy_name,
                otp=otp,
                estimated_days=estimated_days,
                otp_expiry_str=otp_expiry.strftime('%d %b %Y %I:%M %p'),
            )
        except Exception as e:
            print(f'Dispatch email error: {e}')

        send_notification(
            login_id=patient.login_id,
            title='Medicine Dispatched!',
            message=f'Your medicine order is on the way! ETA: {estimated_days} days. '
                    f'Check email for delivery OTP.',
            notif_type='order',
            related_id=str(order.med_order_id),
        )
        broadcast_medicine_update(
            str(patient.login_id.login_id),
            'order_dispatched',
            {
                'order_id': str(order.med_order_id),
                'estimated_days': estimated_days,
                'message': f'Order dispatched! ETA: {estimated_days} days. '
                           f'Check email for OTP.',
            },
        )

        log_audit(
            login_id=request.user,
            action=f'Dispatched medicine order {order_id}',
            module='pharmacy',
            entity_type='MedicineOrder',
            entity_id=str(order_id),
        )
        return ok('Order dispatched. OTP sent to patient.', {
            'order_id': str(order.med_order_id),
            'order_status': order.order_status,
            'otp_expiry': otp_expiry.isoformat(),
            'estimated_delivery_days': estimated_days,
        })


class ResendMedicineOTPView(APIView):
    """Regenerate and re-send the delivery OTP for a dispatched medicine order."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def post(self, request, order_id):
        from datetime import timedelta
        from django.utils import timezone

        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        try:
            order = MedicineOrder.objects.select_related('patient_id').get(
                med_order_id=order_id, pharmacist_id=pharmacist, order_status='dispatched'
            )
        except MedicineOrder.DoesNotExist:
            return err('Dispatched order not found.', status_code=404)

        new_days = int(request.data.get('estimated_delivery_days',
                                        order.estimated_delivery_days or 2))
        new_otp = _generate_otp()
        new_expiry = timezone.now() + timedelta(days=new_days)

        order.delivery_otp = new_otp
        order.otp_expiry = new_expiry
        order.estimated_delivery_days = new_days
        _push_history(order, 'otp_resent', f'OTP resent. New ETA: {new_days} days')
        order.save(update_fields=[
            'delivery_otp', 'otp_expiry', 'estimated_delivery_days',
            'status_history', 'updated_at',
        ])

        patient = order.patient_id
        try:
            from email_utils import send_otp_resend_email
            send_otp_resend_email(
                to_email=patient.login_id.email,
                hospital_name=patient.full_name,
                product_name='Medicine Order',
                otp=new_otp,
                otp_expiry_str=new_expiry.strftime('%d %b %Y %I:%M %p'),
            )
        except Exception as e:
            print(f'OTP resend email error: {e}')

        send_notification(
            login_id=patient.login_id,
            title='New Delivery OTP',
            message='A new delivery OTP has been generated for your medicine order. '
                    'Check your email.',
            notif_type='order',
            related_id=str(order.med_order_id),
        )

        return ok('New OTP sent to patient.', {
            'order_id': str(order.med_order_id),
            'otp_expiry': new_expiry.isoformat(),
            'estimated_delivery_days': new_days,
        })


class ReportWrongProductView(APIView):
    """Patient reports receiving the wrong product (before entering OTP)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, order_id):
        # We allow any authenticated user here, but we will ensure they are the patient.
        patient = getattr(request.user, 'patient_profile', None)
        if not patient:
            return err('Only patients can report wrong products.', status_code=403)

        try:
            order = MedicineOrder.objects.select_related('pharmacist_id').get(
                med_order_id=order_id, patient_id=patient
            )
        except MedicineOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        if order.order_status != 'dispatched':
            return err('Only dispatched orders can be reported.', status_code=400)

        issue_type = request.data.get('issue_type', 'wrong_medicine').strip()
        desired_resolution = request.data.get('desired_resolution', 'refund').strip()

        order.order_status = 'wrong_product'
        order.issue_reported = True
        order.issue_type = issue_type
        order.patient_desired_resolution = desired_resolution
        _push_history(order, 'wrong_product', f'Issue reported: {issue_type}. Desired: {desired_resolution}')
        order.save(update_fields=['order_status', 'issue_reported', 'issue_type', 'patient_desired_resolution', 'status_history', 'updated_at'])

        if order.pharmacist_id:
            send_notification(
                login_id=order.pharmacist_id.login_id,
                title='⚠️ Wrong Product Reported!',
                message=f'Patient {patient.full_name} reported an issue: {issue_type} for order {str(order_id)[:8]}. They requested: {desired_resolution}.',
                notif_type='alert',
                related_id=str(order.med_order_id),
            )

        log_audit(
            login_id=request.user,
            action=f'Reported wrong product for order {order_id}',
            module='pharmacy',
            entity_type='MedicineOrder',
            entity_id=str(order_id),
        )

        return ok('Issue reported successfully. The pharmacist will contact you soon.')


class ResolveOrderIssueView(APIView):
    """Pharmacist resolves a reported issue (e.g. redeliver or refund)."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def post(self, request, order_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        try:
            order = MedicineOrder.objects.select_related('patient_id').get(
                med_order_id=order_id, pharmacist_id=pharmacist
            )
        except MedicineOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        if order.order_status != 'wrong_product':
            return err('Order is not in wrong product state.', status_code=400)

        resolution = request.data.get('resolution', 'refunded').strip()

        if resolution == 'refunded':
            order.order_status = 'refunded'
            order.payment_status = 'refunded'
            order.final_resolution = 'refunded'
            _push_history(order, 'refunded', 'Issue resolved: Order refunded by pharmacist.')
            order.save(update_fields=['order_status', 'payment_status', 'final_resolution', 'status_history', 'updated_at'])

            send_notification(
                login_id=order.patient_id.login_id,
                title='✅ Order Refunded',
                message=f'Your issue for order {str(order_id)[:8]} has been resolved with a full refund.',
                notif_type='info',
                related_id=str(order.med_order_id),
            )
        elif resolution == 'redelivered':
            driver_id = request.data.get('driver_id')
            if not driver_id:
                return err('Driver selection is required for redelivery.', status_code=400)
            try:
                from .models import PharmacyDriver
                driver = PharmacyDriver.objects.get(driver_id=driver_id, pharmacist=pharmacist, is_active=True)
            except PharmacyDriver.DoesNotExist:
                return err('Selected driver not found or inactive.', status_code=400)

            from datetime import timedelta
            from django.utils import timezone
            otp = _generate_otp()
            otp_expiry = timezone.now() + timedelta(days=2)

            order.order_status = 'dispatched'
            order.final_resolution = 'redelivered'
            order.delivery_otp = otp
            order.otp_expiry = otp_expiry
            order.otp_verified = False
            order.driver = driver
            order.driver_name = driver.name
            order.driver_phone = driver.phone
            order.issue_reported = False # Reset to allow subsequent reports if needed
            
            _push_history(order, 'dispatched', f'Issue resolved: Redelivering. New driver: {driver.name}.')
            order.save(update_fields=[
                'order_status', 'final_resolution', 'delivery_otp', 'otp_expiry', 'otp_verified',
                'driver', 'driver_name', 'driver_phone', 'issue_reported', 'status_history', 'updated_at'
            ])

            send_notification(
                login_id=order.patient_id.login_id,
                title='🚚 Replacement Dispatched',
                message=f'A replacement for order {str(order_id)[:8]} is on the way! Check email for your new OTP.',
                notif_type='info',
                related_id=str(order.med_order_id),
            )
            # You would also email the OTP here normally
        else:
            return err('Invalid resolution type', status_code=400)

        log_audit(
            login_id=request.user,
            action=f'Resolved issue for order {order_id} via {resolution}',
            module='pharmacy',
            entity_type='MedicineOrder',
            entity_id=str(order_id),
        )

        return ok('Order issue marked as resolved.')



# ════════════════════════════════════════════════════════════════════════════
#  Pharmacy Inventory / Medicine Catalog
# ════════════════════════════════════════════════════════════════════════════

INVENTORY_FIELDS = [
    'medicine_name', 'generic_name', 'category', 'description',
    'price_per_unit', 'unit', 'stock_quantity', 'reorder_level',
    'requires_prescription', 'manufacturer', 'expiry_date', 'is_available',
]


def _parse_expiry(value):
    """Normalise an expiry value to a date (or None).

    Accepts a date/datetime, an ISO 'YYYY-MM-DD' string, or empty/None — so
    both freshly-assigned strings and DB-loaded dates are handled safely.
    """
    if not value:
        return None
    if hasattr(value, 'isoformat'):  # already a date/datetime
        return value.date() if isinstance(value, datetime) else value
    try:
        return datetime.strptime(str(value), '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def _inventory_dict(item):
    today = date.today()
    image_url = None
    if item.medicine_image:
        try:
            image_url = item.medicine_image.url
        except Exception:
            image_url = None
    exp = _parse_expiry(item.expiry_date)
    return {
        'inventory_id': str(item.inventory_id),
        'medicine_name': item.medicine_name,
        'generic_name': item.generic_name,
        'category': item.category,
        'description': item.description,
        'price_per_unit': float(item.price_per_unit),
        'unit': item.unit,
        'stock_quantity': item.stock_quantity,
        'reserved_quantity': item.reserved_quantity,
        # Only surfaced when there's a live (unpaid) reservation — the inventory
        # view sweeps expired holds first, so a paid/delivered/expired order
        # never leaves a stale "reserved" badge behind.
        'reserved_display': (
            f'{item.reserved_quantity} {item.unit or "unit"}(s) reserved (pending orders)'
            if item.reserved_quantity > 0 else None
        ),
        'available_quantity': item.available_quantity,
        'reorder_level': item.reorder_level,
        'requires_prescription': item.requires_prescription,
        'medicine_image': image_url,
        'manufacturer': item.manufacturer,
        'expiry_date': exp.isoformat() if exp else None,
        'is_expired': bool(exp and exp < today),
        'days_to_expiry': (exp - today).days if exp else None,
        'is_available': item.is_available,
    }


# ─── Stock reservation system ───────────────────────────────────────────────
# available = stock_quantity - reserved_quantity. Stock is RESERVED when the
# order is placed, RELEASED if it is rejected/cancelled, and FINALIZED (real
# stock deducted + reservation cleared) once the order is paid.

class InsufficientStock(Exception):
    """Raised when an order asks for more units than are available."""


def _locked_order_lines(medicines):
    """Yield (locked_inventory_item, qty) for medicines that map to a real
    inventory row. Rows are locked via select_for_update, so the caller MUST
    already be inside a transaction.atomic() block."""
    for medicine in medicines or []:
        inv_id = medicine.get('inventory_id')
        qty = int(medicine.get('quantity', medicine.get('qty', 1)) or 1)
        if not inv_id or qty <= 0:
            continue
        try:
            item = PharmacyInventory.objects.select_for_update().get(inventory_id=inv_id)
        except PharmacyInventory.DoesNotExist:
            continue
        yield item, qty


def reserve_stock(medicines):
    """Reserve stock for each medicine. Raises InsufficientStock if any line
    cannot be satisfied — the surrounding transaction then rolls back so no
    partial reservation is left behind. Caller must hold transaction.atomic()."""
    for item, qty in _locked_order_lines(medicines):
        available = item.available_quantity
        if available < qty:
            if available <= 0:
                raise InsufficientStock(f'{item.medicine_name} is out of stock.')
            raise InsufficientStock(
                f'Insufficient stock! Only {available} unit(s) of '
                f'{item.medicine_name} available.'
            )
        item.reserved_quantity += qty
        item.save(update_fields=['reserved_quantity', 'updated_at'])


def release_stock(medicines):
    """Release a reservation (order rejected/cancelled) — reserved goes back."""
    with transaction.atomic():
        for item, qty in _locked_order_lines(medicines):
            item.reserved_quantity = max(0, item.reserved_quantity - qty)
            item.save(update_fields=['reserved_quantity', 'updated_at'])


def release_expired_reservations():
    """Cancel UNPAID, non-prescription orders whose 10-minute reservation has
    lapsed and return their reserved stock. Prescription orders are EXEMPT —
    they legitimately stay unpaid while awaiting pharmacist approval.

    Called lazily on order/catalog reads and exposed as a management command.
    Returns the number of reservations released.
    """
    from django.utils import timezone as dj_timezone
    from utils import db_save_with_retry
    from .models import MedicineOrder

    now = dj_timezone.now()
    expired = MedicineOrder.objects.filter(
        stock_reserved=True,
        payment_status='pending',
        requires_prescription=False,
        order_status='payment_pending',
        reservation_expires_at__isnull=False,
        reservation_expires_at__lt=now,
    )

    released = 0
    for order in list(expired):
        try:
            release_stock(order.medicines)
            history = order.status_history or []
            history.append({
                'status': 'cancelled',
                'timestamp': str(now),
                'note': 'Reservation expired — stock released (payment not completed within 10 minutes)',
            })
            order.order_status = 'cancelled'
            order.stock_reserved = False
            order.status_history = history
            db_save_with_retry(order, update_fields=[
                'order_status', 'stock_reserved', 'status_history', 'updated_at',
            ])
            released += 1
        except Exception as e:
            print(f'[reservation] release error for {order.med_order_id}: {e}')
    return released


def check_and_notify_low_stock(inventory, pharmacist):
    """Notify the pharmacist (in-app + email) when an inventory row hits or
    falls below its reorder level. Best-effort — never raises."""
    try:
        reorder_level = getattr(inventory, 'reorder_level', 10) or 10
        if inventory.stock_quantity > reorder_level:
            return

        send_notification(
            login_id=pharmacist.login_id,
            title=f'⚠️ Low Stock Alert: {inventory.medicine_name}',
            message=(f'Stock for {inventory.medicine_name} is low! Only '
                     f'{inventory.stock_quantity} units remaining. Please reorder soon.'),
            notif_type='alert',
        )

        try:
            from email_utils import send_email
            html = f"""
            <div style="font-family:Arial;max-width:600px;margin:0 auto;">
              <div style="background:#F97316;padding:20px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;">⚠️ Low Stock Alert</h1>
              </div>
              <div style="background:#FAF7F2;padding:30px;border-radius:0 0 12px 12px;">
                <div style="background:#FFF7ED;border-left:4px solid #F97316;padding:16px;border-radius:8px;margin-bottom:20px;">
                  <p style="margin:0;font-size:18px;font-weight:bold;color:#F97316;">{inventory.medicine_name}</p>
                  <p style="margin:8px 0 0 0;color:#333;">Current Stock: <b>{inventory.stock_quantity} units</b></p>
                  <p style="margin:4px 0 0 0;color:#666;">Reorder Level: {reorder_level} units</p>
                </div>
                <p style="color:#333;">Please reorder <b>{inventory.medicine_name}</b> to avoid stockout.</p>
                <p style="color:#999;font-size:12px;margin-top:20px;">FederCare: AI Health Network</p>
              </div>
            </div>
            """
            send_email(
                to_email=pharmacist.login_id.email,
                subject=f'FederCare: Low Stock Alert — {inventory.medicine_name}',
                html_content=html,
            )
        except Exception as e:
            print(f'Low stock email error: {e}')

        print(f'[STOCK] Low stock alert sent for {inventory.medicine_name}: '
              f'{inventory.stock_quantity} units')
    except Exception as e:
        print(f'Low stock check error: {e}')


def finalize_stock(pharmacy, medicines):
    """Commit a paid order: deduct real stock and clear its reservation."""
    touched = []
    with transaction.atomic():
        for item, qty in _locked_order_lines(medicines):
            item.stock_quantity = max(0, item.stock_quantity - qty)
            item.reserved_quantity = max(0, item.reserved_quantity - qty)
            item.save(update_fields=['stock_quantity', 'reserved_quantity', 'updated_at'])
            touched.append(item)

    # Low-stock alerts after the transaction commits, so the pharmacist sees
    # the post-deduction numbers.
    for item in touched:
        try:
            pharmacist = PharmacistRegistration.objects.get(pharmacist_id=item.pharmacy_id_id)
            check_and_notify_low_stock(item, pharmacist)
        except Exception as e:
            print(f'Pharmacist lookup error: {e}')

        # Real-time: patients browsing this medicine see availability drop (or
        # the card flip to out-of-stock) the instant an order is paid.
        avail = item.available_quantity
        if avail <= 0:
            broadcast_pharmacy_update({
                'type': 'out_of_stock',
                'inventory_id': str(item.inventory_id),
                'medicine_name': item.medicine_name,
            })
        else:
            broadcast_pharmacy_update({
                'type': 'stock_updated',
                'inventory_id': str(item.inventory_id),
                'medicine_name': item.medicine_name,
                'available_quantity': avail,
                'quantity': avail,
            })


class PharmacyMonthlyReportView(APIView):
    """Monthly analytics for the logged-in pharmacist — order counts, revenue
    and a per-medicine breakdown (orders / strips sold / revenue) computed from
    the `medicines` JSON lines. Powers the Monthly Report page + CSV export."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request):
        import calendar
        from django.db.models import Sum
        from django.utils import timezone as dj_tz

        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        now = dj_tz.now()
        try:
            month = int(request.GET.get('month', now.month))
            year = int(request.GET.get('year', now.year))
        except (TypeError, ValueError):
            month, year = now.month, now.year

        orders = MedicineOrder.objects.filter(
            pharmacist_id=pharmacist,
            ordered_at__year=year, ordered_at__month=month,
        )

        total_orders = orders.count()
        delivered = orders.filter(order_status='delivered').count()
        cancelled = orders.filter(order_status='cancelled').count()
        pending = orders.exclude(order_status__in=['delivered', 'cancelled']).count()
        revenue = float(
            orders.filter(payment_status='paid')
            .aggregate(total=Sum('total_amount'))['total'] or 0
        )
        refunded_qs = orders.filter(payment_status='refunded')
        refunded_amount = float(refunded_qs.aggregate(total=Sum('total_amount'))['total'] or 0)

        med = {}  # name -> {orders, strips, revenue}
        for o in orders:
            paid = (o.payment_status == 'paid')
            for line in (o.medicines or []):
                name = line.get('name') or line.get('medicine_name') or 'Unknown'
                qty = int(line.get('quantity', line.get('qty', 1)) or 1)
                price = float(line.get('price', 0) or 0)
                entry = med.setdefault(name, {'orders': 0, 'strips': 0, 'revenue': 0.0})
                entry['orders'] += 1
                entry['strips'] += qty
                if paid:
                    entry['revenue'] += price * qty

        medicine_breakdown = sorted(
            [{'medicine_name': n, 'orders': v['orders'],
              'strips_sold': v['strips'], 'revenue': round(v['revenue'], 2)}
             for n, v in med.items()],
            key=lambda x: x['orders'], reverse=True,
        )

        return ok('Monthly report generated.', {
            'month': calendar.month_name[month],
            'year': year,
            'pharmacy': pharmacist.pharmacy_name,
            'summary': {
                'total_orders': total_orders,
                'delivered': delivered,
                'pending': pending,
                'cancelled': cancelled,
                'total_revenue': revenue,
                'refunded_amount': refunded_amount,
            },
            'medicine_breakdown': medicine_breakdown,
        })


class PharmacyInventoryView(APIView):
    """List the pharmacist's own inventory (GET) or add a medicine (POST)."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        # Release any lapsed reservations first so reserved_quantity (and the
        # "X reserved (pending orders)" badge) reflects only live, unpaid holds.
        release_expired_reservations()

        items = PharmacyInventory.objects.filter(pharmacy_id=pharmacist)
        today = date.today()
        low = sum(1 for i in items if 0 < i.stock_quantity <= i.reorder_level)
        out = sum(1 for i in items if i.stock_quantity <= 0)
        expired = sum(1 for i in items if i.expiry_date and i.expiry_date < today)

        return ok('Inventory retrieved.', {
            'stats': {
                'total': items.count(),
                'low_stock': low,
                'out_of_stock': out,
                'expired': expired,
            },
            'medicines': [_inventory_dict(i) for i in items],
        })

    def post(self, request):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        name = (request.data.get('medicine_name') or '').strip()
        if not name:
            return err('medicine_name is required.')

        data = {f: request.data.get(f) for f in INVENTORY_FIELDS if f in request.data}
        data['medicine_name'] = name
        data['expiry_date'] = _parse_expiry(data.get('expiry_date'))
        item = PharmacyInventory.objects.create(pharmacy_id=pharmacist, **data)

        log_audit(
            login_id=request.user, action='Added inventory medicine',
            module='pharmacy', entity_type='PharmacyInventory',
            entity_id=str(item.inventory_id),
        )
        return ok('Medicine added.', _inventory_dict(item), status_code=201)


class UpdateInventoryView(APIView):
    """Update (PUT) or remove (DELETE) an inventory item."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def put(self, request, item_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)
        try:
            item = PharmacyInventory.objects.get(inventory_id=item_id, pharmacy_id=pharmacist)
        except PharmacyInventory.DoesNotExist:
            return err('Medicine not found.', status_code=404)

        for f in INVENTORY_FIELDS:
            if f in request.data:
                value = request.data.get(f)
                if f == 'expiry_date':
                    value = _parse_expiry(value)
                setattr(item, f, value)
        item.save()

        # Real-time: tell every patient browsing medicines so their list updates
        # instantly (hide/show on visibility toggle, drop on out-of-stock).
        if 'is_available' in request.data:
            broadcast_pharmacy_update({
                'type': 'visibility_changed',
                'inventory_id': str(item.inventory_id),
                'is_listed': item.is_available,
                'medicine_name': item.medicine_name,
                'action': 'listed' if item.is_available else 'hidden',
            })
        if 'stock_quantity' in request.data and item.available_quantity <= 0:
            broadcast_pharmacy_update({
                'type': 'out_of_stock',
                'inventory_id': str(item.inventory_id),
                'medicine_name': item.medicine_name,
            })
        elif 'stock_quantity' in request.data:
            broadcast_pharmacy_update({
                'type': 'stock_updated',
                'inventory_id': str(item.inventory_id),
                'medicine_name': item.medicine_name,
                'available_quantity': item.available_quantity,
                'quantity': item.available_quantity,
            })

        return ok('Medicine updated.', _inventory_dict(item))

    def delete(self, request, item_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)
        try:
            item = PharmacyInventory.objects.get(inventory_id=item_id, pharmacy_id=pharmacist)
        except PharmacyInventory.DoesNotExist:
            return err('Medicine not found.', status_code=404)
        item.delete()
        return ok('Medicine removed.')


class UploadMedicineImageView(APIView):
    """Upload a medicine photo — saved to local media storage (no Cloudinary)."""
    permission_classes = [IsAuthenticated, IsPharmacist]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, item_id):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        try:
            item = PharmacyInventory.objects.get(
                inventory_id=item_id, pharmacy_id=pharmacist
            )
        except PharmacyInventory.DoesNotExist:
            return err('Medicine not found.', status_code=404)

        image = request.FILES.get('image')
        if not image:
            return err('No image provided.')

        ext = image.name.rsplit('.', 1)[-1].lower()
        if ext not in ('jpg', 'jpeg', 'png', 'webp'):
            return err('Only JPG, PNG or WEBP images are allowed.')

        import os
        import uuid
        from django.conf import settings

        filename = f'med_{uuid.uuid4().hex[:8]}.{ext}'
        save_dir = os.path.join(settings.MEDIA_ROOT, 'medicine_images')
        os.makedirs(save_dir, exist_ok=True)
        with open(os.path.join(save_dir, filename), 'wb+') as f:
            for chunk in image.chunks():
                f.write(chunk)

        # Store the path relative to MEDIA_ROOT so .url resolves to /media/...
        item.medicine_image.name = f'medicine_images/{filename}'
        item.save(update_fields=['medicine_image', 'updated_at'])

        log_audit(
            login_id=request.user, action='Uploaded medicine image',
            module='pharmacy', entity_type='PharmacyInventory',
            entity_id=str(item.inventory_id),
        )
        return ok('Medicine image uploaded.', {
            'image_url': request.build_absolute_uri(item.medicine_image.url),
        })


class PharmacyCatalogView(APIView):
    """Public — patients browse a single pharmacy's available medicines."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pharmacy_id):
        try:
            pharmacy = PharmacistRegistration.objects.get(pharmacist_id=pharmacy_id)
        except (PharmacistRegistration.DoesNotExist, Exception):
            return err('Pharmacy not found.', status_code=404)

        items = PharmacyInventory.objects.filter(
            pharmacy_id=pharmacy, is_available=True, stock_quantity__gt=0
        )
        return ok('Catalog retrieved.', {
            'pharmacy_id': str(pharmacy.pharmacist_id),
            'pharmacy_name': pharmacy.pharmacy_name,
            'address': pharmacy.address,
            'medicines': [_inventory_dict(i) for i in items],
        })


class AllPharmaciesCatalogView(APIView):
    """One flat list of every available medicine across ALL approved pharmacies.

    Supports ?search= ?category= ?pharmacy_id= ?rx_only=true filters and also
    returns the pharmacy list for a filter dropdown.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Free up stock from any reservations that lapsed before showing the
        # catalog, so availability numbers reflect released holds.
        release_expired_reservations()

        pharmacies = PharmacistRegistration.objects.filter(approval_status='approved')

        medicines = PharmacyInventory.objects.filter(
            pharmacy_id__in=pharmacies,
            is_available=True,
            stock_quantity__gt=0,
        ).select_related('pharmacy_id')

        search = request.GET.get('search', '').strip()
        if search:
            medicines = medicines.filter(
                medicine_name__icontains=search
            ) | medicines.filter(
                generic_name__icontains=search
            )

        category = request.GET.get('category', '').strip()
        if category:
            medicines = medicines.filter(category=category)

        pharmacy_id = request.GET.get('pharmacy_id', '').strip()
        if pharmacy_id:
            medicines = medicines.filter(pharmacy_id__pharmacist_id=pharmacy_id)

        if request.GET.get('rx_only', '') == 'true':
            medicines = medicines.filter(requires_prescription=True)

        today = date.today()
        data = []
        for med in medicines.order_by('medicine_name'):
            expiry_days = None
            if med.expiry_date:
                expiry_days = (med.expiry_date - today).days
                if expiry_days < 0:
                    continue  # skip expired medicines

            image_url = None
            if med.medicine_image:
                try:
                    image_url = request.build_absolute_uri(med.medicine_image.url)
                except Exception:
                    image_url = None

            data.append({
                'inventory_id': str(med.inventory_id),
                'medicine_name': med.medicine_name,
                'generic_name': med.generic_name,
                'category': med.category,
                'description': med.description,
                'price_per_unit': float(med.price_per_unit),
                'unit': med.unit,
                # Patients see AVAILABLE stock (total minus reserved), not the
                # raw total, so reserved units can't be double-ordered.
                'stock_quantity': med.available_quantity,
                'available_units': med.available_quantity,
                'in_stock': med.available_quantity > 0,
                'requires_prescription': med.requires_prescription,
                'manufacturer': med.manufacturer,
                'expiry_date': med.expiry_date.isoformat() if med.expiry_date else None,
                'days_to_expiry': expiry_days,
                'is_expired': False,
                'medicine_image': image_url,
                'pharmacy_id': str(med.pharmacy_id.pharmacist_id),
                'pharmacy_name': med.pharmacy_id.pharmacy_name,
                'pharmacy_address': med.pharmacy_id.address or '',
            })

        pharmacy_list = [
            {'pharmacy_id': str(p.pharmacist_id), 'pharmacy_name': p.pharmacy_name}
            for p in pharmacies
        ]

        return Response({
            'success': True,
            'message': 'All medicines retrieved.',
            'data': data,
            'total': len(data),
            'pharmacies': pharmacy_list,
        })


class StockAlertsView(APIView):
    """Feeds the pharmacist dashboard banner — counts + first few items for
    each alert bucket (expired, expiring 30/60/90 days, low stock, out of stock)."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request):
        from datetime import timedelta
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist profile not found.', status_code=404)

        today = date.today()
        warning_30 = today + timedelta(days=30)
        warning_60 = today + timedelta(days=60)
        warning_90 = today + timedelta(days=90)

        base = PharmacyInventory.objects.filter(pharmacy_id=pharmacist)

        expired = base.filter(expiry_date__lt=today, stock_quantity__gt=0)
        expiring_30 = base.filter(expiry_date__range=[today, warning_30])
        expiring_60 = base.filter(expiry_date__range=[warning_30, warning_60])
        expiring_90 = base.filter(expiry_date__range=[warning_60, warning_90])
        low_stock = base.filter(stock_quantity__lte=10, stock_quantity__gt=0)
        out_of_stock = base.filter(stock_quantity=0)

        return ok('Stock alerts retrieved.', {
            'expired': expired.count(),
            'expiring_30': expiring_30.count(),
            'expiring_60': expiring_60.count(),
            'expiring_90': expiring_90.count(),
            'low_stock': low_stock.count(),
            'out_of_stock': out_of_stock.count(),
            'expired_items': [
                {
                    'name': i.medicine_name,
                    'expiry': str(i.expiry_date),
                    'stock': i.stock_quantity,
                }
                for i in expired[:5]
            ],
            'expiring_items': [
                {
                    'name': i.medicine_name,
                    'expiry': str(i.expiry_date),
                    'stock': i.stock_quantity,
                    'days_left': (i.expiry_date - today).days,
                }
                for i in expiring_30[:5]
            ],
            'low_stock_items': [
                {
                    'name': i.medicine_name,
                    'stock': i.stock_quantity,
                    'reorder_level': getattr(i, 'reorder_level', 10),
                }
                for i in low_stock[:5]
            ],
        })


# ════════════════════════════════════════════════════════════════════════════
#  Drivers
# ════════════════════════════════════════════════════════════════════════════

class ListCreatePharmacyDriverView(APIView):
    """Manage delivery drivers for a pharmacy."""
    permission_classes = [IsAuthenticated, IsPharmacist]

    def get(self, request):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist not found.', status_code=404)

        from .models import PharmacyDriver
        from .serializers import PharmacyDriverSerializer
        drivers = PharmacyDriver.objects.filter(pharmacist=pharmacist, is_active=True)
        serializer = PharmacyDriverSerializer(drivers, many=True)
        data = serializer.data

        # Calculate availability
        for d in data:
            active_deliveries = MedicineOrder.objects.filter(
                driver_id=d['driver_id'],
                order_status__in=['dispatched', 'wrong_product']
            ).exists()
            d['is_available'] = not active_deliveries

        return ok('Drivers retrieved.', data)

    def post(self, request):
        pharmacist = get_pharmacist(request)
        if not pharmacist:
            return err('Pharmacist not found.', status_code=404)

        from .serializers import PharmacyDriverSerializer
        data = request.data.copy()
        data['pharmacist'] = pharmacist.pharmacist_id
        
        serializer = PharmacyDriverSerializer(data=data)
        if serializer.is_valid():
            serializer.save()
            return ok('Driver added successfully.', serializer.data)
        return err('Invalid data', errors=serializer.errors)
