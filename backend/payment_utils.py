"""Centralized Razorpay payment utilities for FederCare.

Used by apps/payments/views.py and any per-module payment endpoints
(consultations, medicine, lab tests, equipment).
"""
import hashlib
import hmac
import logging

from django.conf import settings
from django.utils import timezone


logger = logging.getLogger(__name__)

PAYMENT_TYPES = ('consultation', 'medicine', 'lab', 'lab_test', 'equipment')


# ─── Razorpay client ────────────────────────────────────────────────────────

def get_razorpay_client():
    import razorpay
    return razorpay.Client(
        auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
    )


# ─── Order creation ─────────────────────────────────────────────────────────

def create_razorpay_order(amount, currency='INR', receipt=None, notes=None):
    """Create a Razorpay order. Amount is in rupees and is converted to paise here.

    Returns a dict with 'success' and either order details or an error message.
    Never raises — caller can rely on `success` flag.
    """
    notes = notes or {}
    try:
        if amount is None or float(amount) <= 0:
            return {'success': False, 'error': 'Amount must be greater than zero.'}

        amount_paise = int(round(float(amount) * 100))
        payload = {
            'amount': amount_paise,
            'currency': currency,
            'payment_capture': 1,
            'notes': notes,
        }
        if receipt:
            payload['receipt'] = str(receipt)[:40]  # Razorpay receipt limit

        client = get_razorpay_client()
        order = client.order.create(payload)
        return {
            'success': True,
            'order_id': order['id'],
            'amount': order['amount'],
            'currency': order['currency'],
            'key_id': settings.RAZORPAY_KEY_ID,
        }
    except Exception as exc:
        logger.warning('Razorpay order creation failed: %s', exc)
        return {'success': False, 'error': str(exc)}


# ─── Signature verification ─────────────────────────────────────────────────

def verify_razorpay_payment(razorpay_order_id, razorpay_payment_id, razorpay_signature):
    """Verify the HMAC-SHA256 signature returned by the Razorpay checkout."""
    if not (razorpay_order_id and razorpay_payment_id and razorpay_signature):
        return False
    try:
        message = f'{razorpay_order_id}|{razorpay_payment_id}'
        generated = hmac.new(
            key=settings.RAZORPAY_KEY_SECRET.encode('utf-8'),
            msg=message.encode('utf-8'),
            digestmod=hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(generated, razorpay_signature)
    except Exception as exc:
        logger.warning('Signature verification raised: %s', exc)
        return False


# ─── Save Razorpay order_id onto the right record ───────────────────────────

def attach_order_id_to_record(payment_type, object_id, razorpay_order_id):
    """Persist the Razorpay order_id on the matching domain record. Returns the record or None."""
    obj = _fetch_record(payment_type, object_id)
    if obj is None:
        return None
    obj.razorpay_order_id = razorpay_order_id
    obj.save(update_fields=['razorpay_order_id'])
    return obj


def _fetch_record(payment_type, object_id):
    """Resolve a payment_type + object_id pair to the actual domain object."""
    try:
        if payment_type == 'consultation':
            from apps.doctor.models import Consultation
            return Consultation.objects.get(consultation_id=object_id)
        if payment_type == 'medicine':
            from apps.pharmacy.models import MedicineOrder
            return MedicineOrder.objects.get(med_order_id=object_id)
        if payment_type == 'lab':
            from apps.lab.models import LabOrder
            return LabOrder.objects.get(order_id=object_id)
        if payment_type == 'lab_test':
            from apps.patient.models import LabTestOrder
            return LabTestOrder.objects.get(order_id=object_id)
        if payment_type == 'equipment':
            from apps.vendor.models import EquipmentOrder
            return EquipmentOrder.objects.get(eq_order_id=object_id)
    except Exception as exc:
        logger.warning('Failed to fetch %s record %s: %s', payment_type, object_id, exc)
    return None


def get_amount_for_record(payment_type, record):
    """Best-effort amount lookup so the API can validate caller-supplied amounts."""
    if record is None:
        return None
    if payment_type == 'consultation':
        try:
            return float(record.doctor_id.consultation_fee or 0)
        except Exception:
            return None
    if payment_type == 'medicine':
        return float(record.total_amount or 0)
    if payment_type == 'lab':
        # Lab orders use a fixed per-test fee (e.g. ₹250). Fall back to caller amount.
        try:
            return float(getattr(record, 'fee_amount', 0) or 250 * len(record.tests_ordered or []))
        except Exception:
            return None
    if payment_type == 'lab_test':
        return float(record.total_fee or 0)
    if payment_type == 'equipment':
        return float(record.total_price or 0)
    return None


# ─── Mark payment success across all 4 flows ────────────────────────────────

def process_payment_success(payment_type, object_id, razorpay_payment_id, actor_login=None,
                            razorpay_signature=None, razorpay_order_id=None):
    """Update the matching record + downstream notifications + audit log."""
    from utils import log_audit, send_notification, broadcast_medicine_update

    record = _fetch_record(payment_type, object_id)
    if record is None:
        return {'success': False, 'error': f'{payment_type} record not found'}

    record.razorpay_payment_id = razorpay_payment_id
    if razorpay_signature:
        record.razorpay_signature = razorpay_signature
    if razorpay_order_id and not record.razorpay_order_id:
        record.razorpay_order_id = razorpay_order_id
    record.payment_status = 'paid'

    update_fields = ['razorpay_payment_id', 'razorpay_signature', 'razorpay_order_id', 'payment_status']

    # Per-type post-processing + notifications
    if payment_type == 'consultation':
        record.save(update_fields=update_fields)
        patient_login = record.patient_id.login_id
        doctor_login = record.doctor_id.login_id
        send_notification(
            patient_login,
            title='Consultation payment received',
            message=f'Your consultation with Dr. {record.doctor_id.full_name} is confirmed.',
            notif_type='success',
            related_id=str(record.consultation_id),
        )
        send_notification(
            doctor_login,
            title='New paid consultation',
            message=f'{record.patient_id.full_name} has paid for a consultation.',
            notif_type='info',
            related_id=str(record.consultation_id),
        )
        # Booking confirmation email is sent HERE — only once payment is
        # confirmed. (Free/₹0 consultations are emailed at booking time instead.)
        try:
            from email_utils import send_appointment_confirmation
            slot = record.slot_id
            send_appointment_confirmation(
                to_email=record.patient_id.login_id.email,
                patient_name=record.patient_id.full_name,
                doctor_name=record.doctor_id.full_name,
                doctor_specialization=record.doctor_id.specialization,
                appointment_date=str(slot.slot_date),
                appointment_time=str(slot.start_time),
                jitsi_room_id=record.jitsi_room_id,
            )
        except Exception as exc:
            print(f'[PaymentUtils] consultation email error: {exc}')
        entity_id = str(record.consultation_id)

    elif payment_type == 'medicine':
        record.order_status = 'confirmed'
        update_fields.append('order_status')
        try:
            history = list(getattr(record, 'status_history', None) or [])
            history.append({
                'status': 'confirmed',
                'timestamp': str(timezone.now()),
                'note': 'Payment confirmed',
            })
            record.status_history = history
            update_fields.append('status_history')
        except Exception as e:
            print(f'Medicine status_history error: {e}')
        record.save(update_fields=update_fields)

        # CRITICAL: commit the reservation now that the patient has paid —
        # deduct real stock AND release the held units. Without this the
        # inventory's reserved_quantity is never decremented on the patient
        # payment path (the pharmacist-side VerifyPaymentView did this, but the
        # patient pays through here). finalize_stock also broadcasts the new
        # availability to anyone browsing.
        try:
            from apps.pharmacy.views import finalize_stock
            finalize_stock(record.pharmacist_id, record.medicines)
            record.stock_reserved = False
            record.save(update_fields=['stock_reserved'])
        except Exception as exc:
            print(f'[PaymentUtils] medicine finalize_stock error: {exc}')

        send_notification(
            record.patient_id.login_id,
            title='Medicine order confirmed',
            message=f'Payment received for medicine order {record.med_order_id}.',
            notif_type='success',
            related_id=str(record.med_order_id),
        )
        if record.pharmacist_id:
            send_notification(
                record.pharmacist_id.login_id,
                title='New paid medicine order',
                message=f'New order from {record.patient_id.full_name} (₹{record.total_amount}).',
                notif_type='info',
                related_id=str(record.med_order_id),
            )
            broadcast_medicine_update(
                str(record.pharmacist_id.login_id.login_id),
                'payment_received',
                {
                    'order_id': str(record.med_order_id),
                    'patient_name': record.patient_id.full_name,
                    'amount': float(record.total_amount),
                    'message': 'Payment received! Please dispatch order.',
                },
            )
        entity_id = str(record.med_order_id)

    elif payment_type == 'lab':
        record.save(update_fields=update_fields)
        send_notification(
            record.patient_id.login_id,
            title='Lab test payment received',
            message=f'Payment received for {len(record.tests_ordered or [])} lab test(s).',
            notif_type='success',
            related_id=str(record.order_id),
        )
        if record.lab_tech_id:
            send_notification(
                record.lab_tech_id.login_id,
                title='New paid lab order',
                message=f'New lab order from {record.patient_id.full_name}.',
                notif_type='info',
                related_id=str(record.order_id),
            )
        entity_id = str(record.order_id)

    elif payment_type == 'lab_test':
        from apps.lab.models import LabTechRegistration
        record.status = 'confirmed'
        update_fields.append('status')
        record.save(update_fields=update_fields)
        send_notification(
            record.patient_id.login_id,
            title='Lab test payment received',
            message=f'Payment confirmed for {len(record.tests or [])} lab test(s) '
                    f'on {record.appointment_date}.',
            notif_type='success',
            related_id=str(record.order_id),
        )
        if record.hospital_id:
            for tech in LabTechRegistration.objects.filter(
                hospital_id=record.hospital_id, approval_status='approved'
            ):
                send_notification(
                    tech.login_id,
                    title='Lab appointment confirmed',
                    message=f'{record.patient_id.full_name} confirmed payment for a lab booking.',
                    notif_type='info',
                    related_id=str(record.order_id),
                )
        entity_id = str(record.order_id)

    elif payment_type == 'equipment':
        print(f'[PaymentUtils] Equipment branch: eq_order_id={object_id}')
        print(f'[PaymentUtils] Record found: payment_status={record.payment_status}, order_status={record.order_status}')
        print(f'[PaymentUtils] Hospital: {record.hospital_id.hospital_name}, Product: {record.product_id.product_name}')
        record.order_status = 'confirmed'
        update_fields.append('order_status')
        try:
            history = list(getattr(record, 'status_history', None) or [])
            history.append({
                'status': 'confirmed',
                'timestamp': timezone.now().strftime('%Y-%m-%d %H:%M'),
                'note': 'Payment confirmed',
            })
            record.status_history = history
            update_fields.append('status_history')
            print(f'[PaymentUtils] status_history updated: {len(history)} entries')
        except Exception as e:
            print(f'[PaymentUtils] status_history error: {e}')
        print(f'[PaymentUtils] Saving update_fields={update_fields}')
        record.save(update_fields=update_fields)
        print(f'[PaymentUtils] Saved OK — new payment_status=paid, order_status=confirmed')
        send_notification(
            record.hospital_id.login_id,
            title='Equipment order confirmed',
            message=f'Payment received for {record.product_id.product_name} (qty {record.quantity}).',
            notif_type='success',
            related_id=str(record.eq_order_id),
        )
        send_notification(
            record.vendor_id.login_id,
            title='New paid equipment order',
            message=f'New order from {record.hospital_id.hospital_name}.',
            notif_type='info',
            related_id=str(record.eq_order_id),
        )
        print(f'[PaymentUtils] Notifications sent to hospital and vendor')
        entity_id = str(record.eq_order_id)

    else:
        return {'success': False, 'error': f'Unknown payment_type: {payment_type}'}

    if actor_login is not None:
        log_audit(
            login_id=actor_login,
            action='payment_success',
            module='payments',
            entity_type=payment_type,
            entity_id=entity_id,
            new_value={
                'razorpay_payment_id': razorpay_payment_id,
                'razorpay_order_id': record.razorpay_order_id,
            },
        )

    return {'success': True, 'payment_type': payment_type, 'object_id': entity_id}


# ─── Connection sanity check ────────────────────────────────────────────────

def test_razorpay_connection():
    """Smoke-test Razorpay credentials by creating a ₹1 test order.

    Bootstraps Django settings so this also works when invoked directly via
    `python -c "from payment_utils import test_razorpay_connection; test_razorpay_connection()"`.
    """
    try:
        from django.conf import settings as _s  # noqa: F401
        _ = _s.RAZORPAY_KEY_ID
    except Exception:
        import os, django
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'federcare.settings')
        django.setup()

    result = create_razorpay_order(amount=1, receipt='conn_test', notes={'purpose': 'connection-test'})
    if result.get('success'):
        print(f'[OK] Razorpay connected -- test order created: {result["order_id"]}')
        return True
    print(f'[FAIL] Razorpay connection failed -- check API keys. Reason: {result.get("error")}')
    return False
