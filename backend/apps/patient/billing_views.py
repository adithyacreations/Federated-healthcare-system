from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.auth_app.permissions import IsPatient
from billing_utils import (
    bill_pdf_response,
    billable_payment_status,
    decimal_value,
    format_date,
    format_datetime,
    format_time,
)


def err(message, errors=None, status=400):
    return Response(
        {'success': False, 'message': message, 'errors': errors if errors is not None else {}},
        status=status,
    )


def get_patient(request):
    return request.user.patient_profile


def patient_party(patient):
    return {
        'name': patient.full_name,
        'address': patient.address or '',
        'contact': patient.login_id.email if patient.login_id else '',
    }


def paid_bill_or_error(record):
    if billable_payment_status(record.payment_status):
        return None
    return err('Bill is available after payment.', status=400)


def medicine_rows(medicines, total_amount):
    rows = []
    for item in medicines or []:
        if isinstance(item, dict):
            name = item.get('name') or item.get('medicine_name') or 'Medicine'
            qty = int(item.get('quantity', item.get('qty', 1)) or 1)
            unit_price = decimal_value(item.get('price', item.get('unit_price', 0)))
        else:
            name, qty, unit_price = str(item), 1, decimal_value(0)
        rows.append({
            'description': name,
            'qty': qty,
            'unit_price': unit_price,
            'amount': unit_price * qty,
        })
    return rows or [{
        'description': 'Medicine order',
        'qty': 1,
        'unit_price': total_amount,
        'amount': total_amount,
    }]


def test_rows(tests, total_fee):
    rows = []
    for item in tests or []:
        if isinstance(item, dict):
            name = item.get('name') or item.get('test_name') or 'Lab Test'
            unit_price = decimal_value(item.get('fee', item.get('price', 0)))
        else:
            name, unit_price = str(item), decimal_value(0)
        rows.append({
            'description': name,
            'qty': 1,
            'unit_price': unit_price,
            'amount': unit_price,
        })
    return rows or [{
        'description': 'Lab test order',
        'qty': 1,
        'unit_price': total_fee,
        'amount': total_fee,
    }]


class MedicineOrderBillView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request, order_id):
        from apps.pharmacy.models import MedicineOrder

        patient = get_patient(request)
        try:
            order = MedicineOrder.objects.select_related(
                'patient_id', 'patient_id__login_id', 'pharmacist_id',
            ).get(med_order_id=order_id, patient_id=patient)
        except MedicineOrder.DoesNotExist:
            return err('Medicine order not found.', status=404)

        payment_error = paid_bill_or_error(order)
        if payment_error:
            return payment_error

        pharmacist = order.pharmacist_id
        provider = {
            'name': pharmacist.pharmacy_name if pharmacist else 'FederCare Pharmacy',
            'address': pharmacist.address if pharmacist else '',
            'contact': pharmacist.login_id.email if pharmacist and pharmacist.login_id else '',
        }
        bill_no = f'MED-{str(order.med_order_id)[:8].upper()}'
        return bill_pdf_response(
            title='Medicine Order Bill',
            bill_no=bill_no,
            billed_to=patient_party(patient),
            provider=provider,
            rows=medicine_rows(order.medicines, order.total_amount),
            total_amount=order.total_amount,
            payment_status=order.payment_status,
            meta_rows=[
                ('Order ID', str(order.med_order_id)),
                ('Order Date', format_datetime(order.ordered_at)),
                ('Delivery Address', order.delivery_address),
                ('Delivery Phone', order.delivery_phone),
                ('Razorpay Order ID', order.razorpay_order_id),
                ('Razorpay Payment ID', order.razorpay_payment_id),
            ],
            notes='Keep this bill for medicine purchase and delivery reference.',
        )


class LabTestOrderBillView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request, order_id):
        from .models import LabTestOrder

        patient = get_patient(request)
        try:
            order = LabTestOrder.objects.select_related(
                'patient_id', 'patient_id__login_id', 'hospital_id', 'doctor_id',
            ).get(order_id=order_id, patient_id=patient)
        except LabTestOrder.DoesNotExist:
            return err('Lab test order not found.', status=404)

        payment_error = paid_bill_or_error(order)
        if payment_error:
            return payment_error

        hospital = order.hospital_id
        doctor = order.doctor_id
        provider = {
            'name': hospital.hospital_name if hospital else 'FederCare Lab',
            'address': hospital.address if hospital else '',
            'contact': (
                hospital.contact_email or hospital.contact_phone
                if hospital else ''
            ),
        }
        bill_no = f'LAB-{str(order.order_id)[:8].upper()}'
        return bill_pdf_response(
            title='Lab Test Order Bill',
            bill_no=bill_no,
            billed_to=patient_party(patient),
            provider=provider,
            rows=test_rows(order.tests, order.total_fee),
            total_amount=order.total_fee,
            payment_status=order.payment_status,
            meta_rows=[
                ('Order ID', str(order.order_id)),
                ('Order Date', format_datetime(order.ordered_at)),
                ('Appointment Date', format_date(order.appointment_date)),
                ('Appointment Time', format_time(order.appointment_time)),
                ('Doctor', doctor.full_name if doctor else ''),
                ('Razorpay Order ID', order.razorpay_order_id),
                ('Razorpay Payment ID', order.razorpay_payment_id),
            ],
            notes='Keep this bill with your lab appointment and report records.',
        )


class ConsultationBillView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request, consultation_id):
        from apps.doctor.models import Consultation

        patient = get_patient(request)
        try:
            consultation = Consultation.objects.select_related(
                'patient_id', 'patient_id__login_id',
                'doctor_id', 'doctor_id__hospital_id', 'slot_id',
            ).get(consultation_id=consultation_id, patient_id=patient)
        except Consultation.DoesNotExist:
            return err('Consultation not found.', status=404)

        payment_error = paid_bill_or_error(consultation)
        if payment_error:
            return payment_error

        doctor = consultation.doctor_id
        hospital = doctor.hospital_id if doctor else None
        slot = consultation.slot_id
        fee = (
            slot.consultation_fee
            if slot and slot.consultation_fee is not None
            else doctor.consultation_fee
        )
        mode = consultation.consult_mode or (slot.consult_type if slot else 'online')
        provider = {
            'name': hospital.hospital_name if hospital else 'FederCare Consultation',
            'address': hospital.address if hospital else '',
            'contact': (
                hospital.contact_email or hospital.contact_phone
                if hospital else ''
            ),
        }
        bill_no = f'DOC-{str(consultation.consultation_id)[:8].upper()}'
        return bill_pdf_response(
            title='Doctor Consultation Bill',
            bill_no=bill_no,
            billed_to=patient_party(patient),
            provider=provider,
            rows=[{
                'description': f'Consultation with Dr. {doctor.full_name} ({doctor.specialization})',
                'qty': 1,
                'unit_price': fee,
                'amount': fee,
            }],
            total_amount=fee,
            payment_status=consultation.payment_status,
            meta_rows=[
                ('Consultation ID', str(consultation.consultation_id)),
                ('Booked On', format_datetime(consultation.created_at)),
                ('Consultation Date', format_date(slot.slot_date if slot else None)),
                ('Consultation Time', (
                    f'{format_time(slot.start_time)} - {format_time(slot.end_time)}'
                    if slot else ''
                )),
                ('Consultation Type', str(mode).replace('_', ' ').title()),
                ('Razorpay Order ID', consultation.razorpay_order_id),
                ('Razorpay Payment ID', consultation.razorpay_payment_id),
            ],
            notes='This bill confirms payment only. Consultation status is managed separately.',
        )
