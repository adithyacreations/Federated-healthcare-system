import io
import math
import base64
from datetime import date, timedelta

from django.conf import settings
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from apps.auth_app.permissions import IsPatient
from .models import EHRRecord, Allergy, EHRConsentLog
from .serializers import (
    BookConsultationSerializer,
    EmergencyRequestSerializer,
    MedicineOrderSerializer,
)
from utils import log_audit, send_notification, broadcast_medicine_update
from email_utils import send_appointment_confirmation, send_emergency_alert_email


# ─── Helpers ──────────────────────────────────────────────────────────────────

def ok(message, data=None, status=200):
    return Response(
        {'success': True, 'message': message, 'data': data if data is not None else {}},
        status=status,
    )


def err(message, errors=None, status=400):
    return Response(
        {'success': False, 'message': message, 'errors': errors if errors is not None else {}},
        status=status,
    )


def get_patient(request):
    return request.user.patient_profile


def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def create_razorpay_order(amount_rupees):
    """Create Razorpay order. Returns order_id string or '' on failure."""
    try:
        import razorpay
        client = razorpay.Client(
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)
        )
        order = client.order.create({
            'amount': int(float(amount_rupees) * 100),
            'currency': 'INR',
            'payment_capture': 1,
        })
        return order['id']
    except Exception:
        return ''


def generate_qr(data_str):
    """Return base64-encoded PNG QR code or '' on failure."""
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(data_str)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ''


# ─── Dashboard ────────────────────────────────────────────────────────────────

class PatientDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from apps.doctor.models import Consultation, Prescription
        from apps.lab.models import LabOrder

        patient = get_patient(request)

        # Future-only upcoming list, soonest first. Past 'scheduled' rows are
        # effectively "missed" and must not show up on the dashboard or the
        # next-consultation banner.
        from django.utils import timezone as _tz
        now = _tz.localtime(_tz.now())
        today_ = now.date()
        upcoming_qs = (
            Consultation.objects
            .filter(patient_id=patient, status='scheduled')
            .select_related('doctor_id', 'slot_id')
            .filter(slot_id__slot_date__gte=today_)
            .order_by('slot_id__slot_date', 'slot_id__start_time')
        )
        # Drop today's slots whose end_time has already passed.
        upcoming = []
        for c in upcoming_qs:
            slot = c.slot_id
            if slot and slot.slot_date == today_ and slot.end_time < now.time():
                continue
            upcoming.append(c)
            if len(upcoming) >= 3:
                break
        prescriptions = (
            Prescription.objects
            .filter(patient_id=patient)
            .select_related('doctor_id')
            .order_by('-created_at')[:3]
        )
        pending_labs = LabOrder.objects.filter(patient_id=patient, status='pending').count()
        recent_ehr = patient.ehr_records.order_by('-recorded_at')[:5]
        risk = patient.risk_assessments.first()
        unread_count = request.user.notifications.filter(is_read=False).count()

        # Missed (no-show) lab appointments this calendar month → blacklist warning.
        from apps.lab.utils import monthly_no_show_count
        monthly_no_shows = monthly_no_show_count(patient, now)

        return ok('Dashboard fetched', {
            'patient_name': patient.full_name,
            'blood_group': patient.blood_group,
            'bmi': float(patient.bmi) if patient.bmi else None,
            'qr_code_url': patient.qr_code_url,
            'unread_notifications': unread_count,
            'pending_lab_orders': pending_labs,
            'monthly_no_shows': monthly_no_shows,
            'no_show_warning': monthly_no_shows >= 3,
            'upcoming_consultations': [
                {
                    'consultation_id': str(c.consultation_id),
                    'doctor_name': c.doctor_id.full_name,
                    'specialization': c.doctor_id.specialization,
                    'doctor_specialization': c.doctor_id.specialization,
                    'slot_date': c.slot_id.slot_date.isoformat() if c.slot_id else None,
                    'slot_time': str(c.slot_id.start_time) if c.slot_id else None,
                    'start_time': c.slot_id.start_time.strftime('%H:%M') if c.slot_id else None,
                    'end_time': c.slot_id.end_time.strftime('%H:%M') if c.slot_id else None,
                    'consult_type': c.slot_id.consult_type if c.slot_id else 'online',
                    'jitsi_room_id': c.jitsi_room_id,
                    'status': c.status,
                }
                for c in upcoming
            ],
            'active_prescriptions': [
                {
                    'prescription_id': str(p.prescription_id),
                    'doctor_name': p.doctor_id.full_name,
                    'diagnosis': p.diagnosis,
                    'medicines_count': len(p.medicines),
                    'created_at': p.created_at.isoformat(),
                }
                for p in prescriptions
            ],
            'recent_ehr_records': [
                {
                    'record_id': str(r.record_id),
                    'record_type': r.record_type,
                    'title': r.title,
                    'recorded_at': r.recorded_at.isoformat(),
                }
                for r in recent_ehr
            ],
            'risk_summary': {
                'risk_level': risk.risk_level,
                'diabetes_risk': float(risk.diabetes_risk) if risk.diabetes_risk else None,
                'heart_risk': float(risk.heart_risk) if risk.heart_risk else None,
                'hypertension_risk': float(risk.hypertension_risk) if risk.hypertension_risk else None,
                'assessed_at': risk.assessed_at.isoformat(),
            } if risk else None,
        })


# ─── EHR Wallet ───────────────────────────────────────────────────────────────

class EHRWalletView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        patient = get_patient(request)
        records = patient.ehr_records.all().order_by('-recorded_at')
        allergies = patient.allergies.all()

        wallet = {
            'diagnoses': [],
            'lab_reports': [],
            'prescriptions': [],
            'history': [],
            'allergies': [],
        }
        type_map = {
            'diagnosis': 'diagnoses',
            'lab': 'lab_reports',
            'prescription': 'prescriptions',
            'history': 'history',
        }

        for r in records:
            key = type_map.get(r.record_type)
            if key and key != 'prescriptions':
                wallet[key].append({
                    'record_id': str(r.record_id),
                    'title': r.title,
                    'content': r.content,
                    'file_url': r.file_url,
                    'recorded_at': r.recorded_at.isoformat(),
                })

        # Prescriptions are sourced directly from the Prescription table so
        # the wallet can expose prescription_id for the local PDF endpoint
        # (no Cloudinary URL needed).
        from apps.doctor.models import Prescription
        prescriptions = (
            Prescription.objects.filter(patient_id=patient)
            .select_related('doctor_id')
            .order_by('-created_at')
        )
        for p in prescriptions:
            doctor_name = getattr(p.doctor_id, 'full_name', '') if p.doctor_id else ''
            wallet['prescriptions'].append({
                'record_id': str(p.prescription_id),
                'prescription_id': str(p.prescription_id),
                'title': f'Prescription — Dr. {doctor_name}' if doctor_name else 'Prescription',
                'content': ', '.join(
                    m.get('name', '') for m in (p.medicines or []) if isinstance(m, dict)
                ) or (p.diagnosis or ''),
                'file_url': '',
                'recorded_at': p.created_at.isoformat(),
            })

        for a in allergies:
            wallet['allergies'].append({
                'allergy_id': str(a.allergy_id),
                'allergen': a.allergen,
                'reaction': a.reaction,
                'severity': a.severity,
                'noted_at': a.noted_at.isoformat(),
            })

        return ok('EHR wallet fetched', wallet)


# ─── QR Token ─────────────────────────────────────────────────────────────────

def generate_short_code():
    """Generate a unique 6-digit code not currently tied to an active consent."""
    import random
    import string
    while True:
        code = ''.join(random.choices(string.digits, k=6))
        if not EHRConsentLog.objects.filter(
            short_code=code,
            expires_at__gt=timezone.now(),
        ).exists():
            return code


class GenerateQRTokenView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        patient = get_patient(request)
        expires_at = timezone.now() + timedelta(minutes=30)

        consent = EHRConsentLog.objects.create(
            patient_id=patient,
            accessed_by=request.user,
            access_type='qr_scan',
            consent_given=True,
            expires_at=expires_at,
            data_shared=['diagnosis', 'lab', 'prescription'],
            short_code=generate_short_code(),
        )

        qr_url = f"http://localhost:3000/patient/qr/{consent.consent_id}"
        qr_image = generate_qr(qr_url)

        return ok('QR token generated', {
            'consent_id': str(consent.consent_id),
            'token': str(consent.consent_id),
            'short_code': consent.short_code,
            'qr_url': qr_url,
            'qr_code': qr_image,
            'expires_at': expires_at.isoformat(),
            'valid_minutes': 30,
        })


# ─── Browse Doctors ───────────────────────────────────────────────────────────

class BrowseDoctorsView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from apps.doctor.models import DoctorRegistration

        today = date.today()
        specialization = request.query_params.get('specialization', '').strip()
        hospital_id = request.query_params.get('hospital_id', '').strip()

        qs = (
            DoctorRegistration.objects
            .filter(approval_status='approved')
            .select_related('hospital_id', 'dept_id')
            .annotate(
                available_slots_count=Count(
                    'slots',
                    filter=Q(slots__is_booked=False, slots__slot_date__gte=today),
                )
            )
        )

        if specialization:
            qs = qs.filter(specialization__icontains=specialization)
        if hospital_id:
            qs = qs.filter(hospital_id__hospital_id=hospital_id)

        return ok('Doctors fetched', {
            'doctors': [
                {
                    'doctor_id': str(d.doctor_id),
                    'full_name': d.full_name,
                    'specialization': d.specialization,
                    'hospital_name': d.hospital_id.hospital_name,
                    'hospital_id': str(d.hospital_id.hospital_id),
                    'dept_name': d.dept_id.dept_name if d.dept_id else None,
                    'consultation_fee': float(d.consultation_fee),
                    'is_online': d.is_online,
                    'available_slots_count': d.available_slots_count,
                }
                for d in qs
            ]
        })


# ─── Book Consultation ────────────────────────────────────────────────────────

class DoctorSlotsView(APIView):
    """Patient-facing list of a doctor's available slots."""
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request, doctor_id):
        from apps.doctor.models import DoctorRegistration, DoctorSlot
        try:
            doctor = DoctorRegistration.objects.get(doctor_id=doctor_id, approval_status='approved')
        except DoctorRegistration.DoesNotExist:
            return err('Doctor not found.', status=404)

        now = timezone.localtime(timezone.now())
        today = now.date()
        current_time = now.time()

        slots = (
            DoctorSlot.objects
            .filter(doctor_id=doctor, is_booked=False, slot_date__gte=today)
            .order_by('slot_date', 'start_time')
        )

        slot_list = []
        for s in slots:
            # Hide today's slots that have already started — patients cannot join
            # a consultation mid-way, so a slot disappears the moment it begins.
            if s.slot_date == today and s.start_time <= current_time:
                continue
            slot_list.append({
                'slot_id': str(s.slot_id),
                # Raw fields kept for frontend grouping / validation logic.
                'slot_date': s.slot_date.isoformat(),
                'start_time': str(s.start_time),
                'end_time': str(s.end_time),
                # Pre-formatted, human-friendly display fields.
                'date_display': s.slot_date.strftime('%d %b %Y'),
                'start_display': s.start_time.strftime('%I:%M %p'),
                'end_display': s.end_time.strftime('%I:%M %p'),
                'consult_type': s.consult_type,
            })

        return ok('Slots fetched', {
            'doctor_id': str(doctor.doctor_id),
            'doctor_name': doctor.full_name,
            'slots': slot_list,
        })


class BookConsultationView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        from apps.doctor.models import Consultation

        serializer = BookConsultationSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors)

        d = serializer.validated_data
        patient = get_patient(request)
        doctor = d['_doctor']
        slot = d['_slot']

        consultation = Consultation.objects.create(
            patient_id=patient,
            doctor_id=doctor,
            slot_id=slot,
            status='scheduled',
            payment_status='pending',
        )

        jitsi_room_id = f"federcare-{str(consultation.consultation_id)[:8]}"
        consultation.jitsi_room_id = jitsi_room_id
        consultation.save(update_fields=['jitsi_room_id'])

        slot.is_booked = True
        slot.save(update_fields=['is_booked'])

        # Create the Razorpay order via the shared util — it returns a dict
        # with order_id / amount (paise) / key_id, all needed by the frontend.
        from payment_utils import create_razorpay_order as rzp_create_order

        fee = float(doctor.consultation_fee or 0)
        razorpay_order_id = ''
        razorpay_amount = int(fee * 100)
        key_id = settings.RAZORPAY_KEY_ID
        if fee > 0:
            razorpay_data = rzp_create_order(
                amount=fee,
                receipt=str(consultation.consultation_id),
                notes={
                    'payment_type': 'consultation',
                    'doctor': doctor.full_name,
                    'patient': patient.full_name,
                },
            )
            print(f'[BookConsultation] Razorpay data: {razorpay_data}')
            if razorpay_data.get('success'):
                razorpay_order_id = razorpay_data['order_id']
                razorpay_amount = razorpay_data['amount']
                key_id = razorpay_data.get('key_id', key_id)
                consultation.razorpay_order_id = razorpay_order_id
                consultation.save(update_fields=['razorpay_order_id'])

        send_notification(
            doctor.login_id,
            'New Consultation Booked',
            f'{patient.full_name} booked a consultation on {slot.slot_date} at {slot.start_time}.',
            notif_type='alert',
        )
        log_audit(
            request.user, 'consultation_booked', module='patient',
            entity_type='Consultation', entity_id=consultation.consultation_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        # Email is sent only once the consultation is actually confirmed:
        #  • free (₹0) consultations have no payment step → confirm + email now
        #  • paid consultations → email is sent after payment succeeds, in
        #    payment_utils.process_payment_success (so a cancelled/unpaid
        #    booking never triggers a confirmation email).
        if fee <= 0:
            send_appointment_confirmation(
                to_email=request.user.email,
                patient_name=patient.full_name,
                doctor_name=doctor.full_name,
                doctor_specialization=doctor.specialization,
                appointment_date=str(slot.slot_date),
                appointment_time=str(slot.start_time),
                jitsi_room_id=jitsi_room_id,
            )

        return ok('Consultation booked successfully', {
            'consultation_id': str(consultation.consultation_id),
            'jitsi_room_id': jitsi_room_id,
            'doctor_name': doctor.full_name,
            'slot_date': slot.slot_date.isoformat(),
            'slot_time': str(slot.start_time),
            'fee': fee,
            # Required by the frontend to open the Razorpay checkout:
            'razorpay_order_id': razorpay_order_id,
            'amount': razorpay_amount,
            'key_id': key_id,
        }, status=201)


class ConsultationPaymentFailureView(APIView):
    """Release a consultation booking when its payment is cancelled or fails.

    Marks the consultation cancelled, frees the held slot, and notifies both the
    patient and the doctor. Only acts on a still-unpaid booking owned by the
    requesting patient — a paid booking is never disturbed.
    """
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        from apps.doctor.models import Consultation

        consultation_id = request.data.get('consultation_id')
        reason = request.data.get('reason', 'Payment cancelled')
        if not consultation_id:
            return err('consultation_id is required.')

        patient = get_patient(request)
        if not patient:
            return err('Patient profile not found.', status=404)

        try:
            consultation = Consultation.objects.select_related(
                'patient_id', 'patient_id__login_id',
                'doctor_id', 'doctor_id__login_id', 'slot_id',
            ).get(consultation_id=consultation_id)
        except Consultation.DoesNotExist:
            return err('Consultation not found.', status=404)

        if consultation.patient_id != patient:
            return err('Not your consultation.', status=403)

        # Never cancel a booking that was actually paid for.
        if consultation.payment_status == 'paid':
            return ok('Payment already completed; booking kept.', {
                'consultation_id': str(consultation.consultation_id),
                'status': consultation.status,
            })

        consultation.status = 'cancelled'
        consultation.save(update_fields=['status'])

        slot = consultation.slot_id
        if slot and slot.is_booked:
            slot.is_booked = False
            slot.save(update_fields=['is_booked'])

        send_notification(
            consultation.patient_id.login_id,
            '❌ Booking Cancelled',
            'Your consultation booking was cancelled because payment was not '
            'completed. The slot has been released.',
            notif_type='consultation',
            related_id=str(consultation.consultation_id),
        )
        send_notification(
            consultation.doctor_id.login_id,
            '❌ Booking Cancelled',
            f'Consultation with {consultation.patient_id.full_name} was cancelled '
            '— payment was not completed.',
            notif_type='consultation',
            related_id=str(consultation.consultation_id),
        )

        log_audit(
            request.user, 'consultation_payment_failed', module='patient',
            entity_type='Consultation', entity_id=consultation.consultation_id,
            new_value=reason, ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok('Booking cancelled.', {
            'consultation_id': str(consultation.consultation_id),
            'status': 'cancelled',
        })


# ─── Patient Consultations ────────────────────────────────────────────────────

def compute_consultation_status(consultation, slot):
    """Derive a display status. Past 'scheduled' consultations whose slot
    end time has elapsed become 'missed'. Terminal statuses pass through."""
    if consultation.status in ('completed', 'cancelled'):
        return consultation.status
    if not slot:
        return consultation.status

    now = timezone.localtime(timezone.now())
    today_ = now.date()
    if slot.slot_date < today_:
        return 'missed'
    if slot.slot_date == today_ and slot.end_time < now.time():
        return 'missed'
    if consultation.status == 'scheduled':
        return 'upcoming'
    return consultation.status


class PatientConsultationsView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from apps.doctor.models import Consultation

        patient = get_patient(request)
        consultations = (
            Consultation.objects
            .filter(patient_id=patient)
            .select_related('doctor_id', 'slot_id')
            .order_by('-created_at')
        )

        return ok('Consultations fetched', {
            'consultations': [
                {
                    'consultation_id': str(c.consultation_id),
                    'doctor_name': c.doctor_id.full_name,
                    'specialization': c.doctor_id.specialization,
                    'doctor_specialization': c.doctor_id.specialization or 'General',
                    'slot_date': c.slot_id.slot_date.isoformat() if c.slot_id else None,
                    'slot_time': str(c.slot_id.start_time) if c.slot_id else None,
                    'start_time': c.slot_id.start_time.strftime('%H:%M') if c.slot_id else None,
                    'end_time': c.slot_id.end_time.strftime('%H:%M') if c.slot_id else None,
                    'consult_type': c.slot_id.consult_type if c.slot_id else None,
                    # `status` is the computed display status (may be 'missed');
                    # `original_status` is whatever the DB had so callers can
                    # still distinguish "missed but not cancelled" cleanly.
                    'status': compute_consultation_status(c, c.slot_id),
                    'original_status': c.status,
                    'jitsi_room_id': c.jitsi_room_id,
                    'jitsi_url': f'https://meet.jit.si/{c.jitsi_room_id}' if c.jitsi_room_id else None,
                    'payment_status': c.payment_status,
                    'amount': float(c.doctor_id.consultation_fee),
                    'created_at': c.created_at.isoformat(),
                }
                for c in consultations
            ]
        })


class PatientPrescriptionsView(APIView):
    """Active doctor prescriptions for the logged-in patient. Used by the
    medicine-ordering page to flag which catalog medicines the patient already
    has a prescription for."""
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        import json
        from apps.doctor.models import Prescription

        patient = get_patient(request)
        if not patient:
            return err('Patient profile not found.', status=404)

        prescriptions = (
            Prescription.objects
            .filter(patient_id=patient)
            .select_related('doctor_id')
            .order_by('-created_at')
        )

        data = []
        for p in prescriptions:
            medicines = p.medicines
            if isinstance(medicines, str):
                try:
                    medicines = json.loads(medicines)
                except (ValueError, TypeError):
                    medicines = []
            norm_medicines = []
            if isinstance(medicines, list):
                for m in medicines:
                    if isinstance(m, dict):
                        norm_medicines.append({
                            'name': m.get('name', ''),
                            'dosage': m.get('dosage', ''),
                            'duration': m.get('duration', ''),
                        })
                    else:
                        norm_medicines.append({'name': str(m), 'dosage': '', 'duration': ''})

            data.append({
                'prescription_id': str(p.prescription_id),
                'doctor_name': getattr(p.doctor_id, 'full_name', '') if p.doctor_id else '',
                'diagnosis': p.diagnosis or '',
                'medicines': norm_medicines,
                'valid_until': p.valid_until.isoformat() if p.valid_until else None,
                'created_at': p.created_at.isoformat(),
            })

        return ok('Prescriptions fetched', data)


# ─── Emergency SOS ────────────────────────────────────────────────────────────

class EmergencySOSView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        from apps.emergency.models import EmergencyRequest, Ambulance, AmbulanceDispatch
        from apps.hospital.models import HospitalRegistration, Bed

        serializer = EmergencyRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors)

        d = serializer.validated_data
        patient = get_patient(request)
        p_lat = float(d['patient_lat'])
        p_lng = float(d['patient_lng'])

        # Optional wider-radius retry: when nobody was free within the default
        # 10 km the patient can re-dispatch with a larger search radius (e.g.
        # 20 km). Clamp to a sane ceiling so a bad value can't scan the country.
        try:
            radius_km = float(request.data.get('radius_km', 10) or 10)
        except (TypeError, ValueError):
            radius_km = 10
        radius_km = max(1, min(radius_km, 25))

        emergency = EmergencyRequest.objects.create(
            patient_id=patient,
            patient_lat=d['patient_lat'],
            patient_lng=d['patient_lng'],
            severity=d['severity'],
            status='pending',
        )

        # Find nearest available ambulance (GPS of ambulance; fall back to hospital GPS)
        from apps.emergency.utils import find_nearest_ambulance
        nearest_ambulance, min_distance = find_nearest_ambulance(p_lat, p_lng, radius_km=radius_km)

        if not nearest_ambulance:
            # No ambulance at all — flag the emergency so the patient's tracker
            # surfaces the "no ambulance available, call 108" screen rather than
            # a dead-end error toast.
            emergency.status = 'no_drivers'
            emergency.save(update_fields=['status'])
            send_notification(
                patient.login_id,
                '❌ No Ambulance Available!',
                'All nearby drivers are unavailable. Please call 108 immediately for emergency help!',
                notif_type='emergency', related_id=str(emergency.emergency_id),
            )
            return ok('No ambulance available right now. Please call 108.', {
                'emergency_id': str(emergency.emergency_id),
                'status': 'no_drivers',
                'no_drivers': True,
            }, status=201)

        # Average ambulance speed ≈ 40 km/h → ETA in minutes.
        eta_minutes = max(1, int((min_distance / 40) * 60))

        dispatch = AmbulanceDispatch.objects.create(
            emergency_id=emergency,
            ambulance_id=nearest_ambulance,
            dispatch_status='dispatched',
            eta_minutes=eta_minutes,
        )

        nearest_ambulance.is_available = False
        nearest_ambulance.save(update_fields=['is_available'])

        # Auto-reassign to the next-nearest ambulance if the driver doesn't
        # accept within the severity-based window.
        from apps.emergency.views import get_timeout_seconds
        timeout_seconds = get_timeout_seconds(d['severity'])
        try:
            from apps.emergency.views import schedule_dispatch_timeout
            schedule_dispatch_timeout(dispatch.dispatch_id, timeout_seconds)
        except Exception as exc:
            print(f'Timeout scheduling error: {exc}')

        driver = nearest_ambulance.driver_id
        if driver:
            driver.is_available = False
            driver.save(update_fields=['is_available'])

        # Find nearest hospital with an available bed — only approved AND active
        # (not admin-suspended) hospitals are eligible to receive the patient.
        hospitals_with_beds = HospitalRegistration.objects.filter(
            approval_status='approved',
            login_id__is_active=True,
            beds__status='available',
        ).distinct()

        nearest_hospital = None
        min_hosp_dist = float('inf')

        for hosp in hospitals_with_beds:
            if not hosp.latitude or not hosp.longitude:
                continue
            dist = haversine(p_lat, p_lng, float(hosp.latitude), float(hosp.longitude))
            if dist < min_hosp_dist:
                min_hosp_dist = dist
                nearest_hospital = hosp

        reserved_bed = None
        no_beds_warning = False
        if nearest_hospital:
            from apps.emergency.views import reserve_bed_for_emergency
            reserved_bed = reserve_bed_for_emergency(nearest_hospital, emergency)
            if reserved_bed:
                emergency.assigned_hospital_id = nearest_hospital
                emergency.assigned_bed_id = reserved_bed
                emergency.status = 'dispatched'
                emergency.save(
                    update_fields=['assigned_hospital_id', 'assigned_bed_id', 'status']
                )

        # Bug-1 fallback: no approved+active hospital currently has a free bed.
        # Still route the patient to the nearest hospital (no bed reserved) and
        # alert it to prepare one immediately — never leave an SOS with no
        # destination.
        if not nearest_hospital:
            fallback_hospital = None
            min_fb_dist = float('inf')
            for hosp in HospitalRegistration.objects.filter(
                approval_status='approved', login_id__is_active=True,
            ):
                if not hosp.latitude or not hosp.longitude:
                    continue
                dist = haversine(p_lat, p_lng, float(hosp.latitude), float(hosp.longitude))
                if dist < min_fb_dist:
                    min_fb_dist = dist
                    fallback_hospital = hosp

            if fallback_hospital:
                nearest_hospital = fallback_hospital
                no_beds_warning = True
                emergency.assigned_hospital_id = fallback_hospital
                emergency.status = 'dispatched'
                emergency.save(update_fields=['assigned_hospital_id', 'status'])
                try:
                    send_notification(
                        fallback_hospital.login_id,
                        '🚨 Incoming Emergency — No Beds!',
                        f'Ambulance dispatched for {patient.full_name} '
                        f'({d["severity"].upper()}) but NO beds are free. '
                        f'Please prepare a bed immediately. Patient ETA: ~{eta_minutes} min.',
                        notif_type='emergency', related_id=str(emergency.emergency_id),
                    )
                except Exception as exc:
                    print(f'[BED ALERT] No-bed dispatch alert error: {exc}')

        # Real-time bed monitor: if the reserved bed gets taken mid-trip,
        # auto-reroute to the next-nearest hospital with a free bed.
        if reserved_bed:
            try:
                from apps.emergency.views import start_bed_monitor
                start_bed_monitor(dispatch.dispatch_id, emergency.emergency_id, check_interval=30)
            except Exception as exc:
                print(f'Bed monitor start error: {exc}')

        if driver:
            send_notification(
                driver.login_id,
                'EMERGENCY DISPATCH',
                f'Pick up {patient.full_name}. Severity: {d["severity"].upper()}. Navigate to patient GPS.',
                notif_type='emergency',
            )

        if nearest_hospital:
            try:
                send_notification(
                    nearest_hospital.login_id,
                    'Incoming Emergency Patient',
                    f'Emergency patient {patient.full_name} ({d["severity"]}) is en route.',
                    notif_type='emergency',
                )
                send_emergency_alert_email(
                    to_email=nearest_hospital.login_id.email,
                    hospital_name=nearest_hospital.hospital_name,
                    patient_name=patient.full_name,
                    severity=d['severity'],
                    eta=eta_minutes,
                )
            except Exception:
                pass

        # Real-time push to the assigned driver's emergency WebSocket channel,
        # so the driver dashboard pops the dispatch alert immediately.
        if driver:
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
                async_to_sync(channel_layer.group_send)(
                    f'emergency_{driver.login_id.login_id}',
                    {
                        'type': 'emergency_dispatch',
                        'data': {
                            'emergency_id': str(emergency.emergency_id),
                            'dispatch_id': str(dispatch.dispatch_id),
                            'patient_name': patient.full_name,
                            'patient_phone': patient.emergency_contact,
                            'patient_lat': p_lat,
                            'patient_lng': p_lng,
                            'severity': d['severity'].upper(),
                            'eta_minutes': eta_minutes,
                            'timeout_seconds': timeout_seconds,
                            'hospital_name': (
                                nearest_hospital.hospital_name
                                if nearest_hospital else 'Nearest Hospital'
                            ),
                            'message': f'Emergency dispatch! {patient.full_name} needs help.',
                        },
                    },
                )
            except Exception as exc:
                print(f'Emergency WS broadcast error: {exc}')

        log_audit(
            request.user, 'emergency_sos_triggered', module='patient',
            entity_type='EmergencyRequest', entity_id=emergency.emergency_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok('Emergency SOS dispatched', {
            'emergency_id': str(emergency.emergency_id),
            'dispatch_id': str(dispatch.dispatch_id),
            'ambulance_vehicle_no': nearest_ambulance.vehicle_no,
            'driver_name': driver.full_name if driver else None,
            'driver_phone': driver.phone if driver else None,
            'driver_assigned': driver is not None,
            'distance_km': round(min_distance, 2),
            'eta_minutes': eta_minutes,
            'patient_lat': p_lat,
            'patient_lng': p_lng,
            'severity': d['severity'].upper(),
            'status': emergency.status,
            'assigned_hospital_name': nearest_hospital.hospital_name if nearest_hospital else None,
            'assigned_bed_type': reserved_bed.bed_type if reserved_bed else None,
            'no_beds_warning': no_beds_warning,
            'warning': (
                'No beds currently available at the nearest hospital. '
                'The hospital has been alerted to prepare a bed.'
                if no_beds_warning else None
            ),
        }, status=201)


# ─── Track Emergency ──────────────────────────────────────────────────────────

class TrackEmergencyView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request, emergency_id):
        from apps.emergency.models import EmergencyRequest

        patient = get_patient(request)
        try:
            emergency = EmergencyRequest.objects.select_related(
                'assigned_hospital_id'
            ).get(emergency_id=emergency_id, patient_id=patient)
        except EmergencyRequest.DoesNotExist:
            return err('Emergency request not found', status=404)

        # Skip rejected/timed-out dispatches so the tracker shows the current
        # (or no) ambulance rather than a stale rejected one.
        dispatch = emergency.dispatches.exclude(
            dispatch_status='rejected'
        ).select_related('ambulance_id__driver_id').first()

        data = {
            'emergency_id': str(emergency.emergency_id),
            'status': emergency.status,
            'no_drivers': emergency.status == 'no_drivers',
            'cancelled': emergency.status == 'cancelled',
            'patient_safe': emergency.patient_safe,
            'cancelled_by': emergency.cancelled_by,
            'severity': emergency.severity.upper(),
            'patient_lat': float(emergency.patient_lat) if emergency.patient_lat is not None else None,
            'patient_lng': float(emergency.patient_lng) if emergency.patient_lng is not None else None,
            'assigned_hospital_name': (
                emergency.assigned_hospital_id.hospital_name
                if emergency.assigned_hospital_id else None
            ),
            'assigned_hospital': ({
                'name': emergency.assigned_hospital_id.hospital_name,
                'lat': str(emergency.assigned_hospital_id.latitude or ''),
                'lon': str(emergency.assigned_hospital_id.longitude or ''),
            } if emergency.assigned_hospital_id else None),
            'bed_reserved': emergency.assigned_bed_id is not None,
            'rerouted': False,
            'dispatch': None,
            'vehicle_number': None,
            'ambulance_current_lat': None,
            'ambulance_current_lng': None,
            'driver_name': None,
            'driver_phone': None,
        }

        if dispatch:
            amb = dispatch.ambulance_id
            drv = amb.driver_id
            data['rerouted'] = dispatch.rerouted
            # Always expose the dispatch lifecycle so the tracker can show
            # "awaiting driver" while pending.
            data['dispatch'] = {
                'id': str(dispatch.dispatch_id),
                'status': dispatch.dispatch_status,
                'eta_minutes': dispatch.eta_minutes,
                'dispatched_at': dispatch.dispatched_at.isoformat() if dispatch.dispatched_at else None,
                'accepted_at': dispatch.accepted_at.isoformat() if dispatch.accepted_at else None,
            }
            # Only reveal the driver/ambulance identity once a driver has
            # ACCEPTED — while still 'dispatched' (merely offered, not yet
            # accepted) the patient should see "Assigning…", not a name that may
            # change if this driver rejects and it reroutes to another.
            ACCEPTED = ('en_route', 'arrived', 'pending_acknowledgment', 'completed')
            if dispatch.dispatch_status in ACCEPTED:
                data.update({
                    'vehicle_number': amb.vehicle_no,
                    'ambulance_current_lat': float(amb.current_lat) if amb.current_lat is not None else None,
                    'ambulance_current_lng': float(amb.current_lng) if amb.current_lng is not None else None,
                    'driver_name': drv.full_name if drv else None,
                    'driver_phone': drv.phone if drv else None,
                })

        return ok('Emergency status fetched', data)


# ─── Order Medicine ───────────────────────────────────────────────────────────

class OrderMedicineView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        from apps.pharmacy.models import PharmacistRegistration, MedicineOrder

        serializer = MedicineOrderSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors)

        d = serializer.validated_data
        patient = get_patient(request)
        pharmacist = PharmacistRegistration.objects.get(pharmacist_id=d['pharmacist_id'])

        total_amount = sum(
            float(med.get('price', 0)) * int(med.get('qty', 1))
            for med in d['medicines']
        )

        order = MedicineOrder.objects.create(
            patient_id=patient,
            pharmacist_id=pharmacist,
            medicines=d['medicines'],
            total_amount=total_amount,
            delivery_address=d.get('delivery_address', ''),
            payment_status='pending',
        )

        razorpay_order_id = create_razorpay_order(total_amount) if total_amount > 0 else ''
        if razorpay_order_id:
            order.razorpay_order_id = razorpay_order_id
            order.save(update_fields=['razorpay_order_id'])

        send_notification(
            pharmacist.login_id,
            'New Medicine Order',
            f'{patient.full_name} placed a medicine order ({len(d["medicines"])} items).',
            notif_type='order',
            related_id=str(order.med_order_id),
        )

        # Real-time: push to the pharmacist's medicine socket so their pending
        # orders list (and dashboard) refreshes the instant the order is placed.
        broadcast_medicine_update(
            str(pharmacist.login_id.login_id),
            'new_order',
            {
                'order_id': str(order.med_order_id),
                'patient_name': patient.full_name,
                'medicines_count': len(d['medicines']),
                'total_amount': total_amount,
                'message': f'New order from {patient.full_name}!',
            },
        )

        log_audit(
            request.user, 'medicine_order_placed', module='patient',
            entity_type='MedicineOrder', entity_id=order.med_order_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok('Medicine order placed', {
            'med_order_id': str(order.med_order_id),
            'pharmacy_name': pharmacist.pharmacy_name,
            'medicines_count': len(d['medicines']),
            'total_amount': total_amount,
            'razorpay_order_id': razorpay_order_id,
            'order_status': order.order_status,
            'payment_status': order.payment_status,
        }, status=201)


# ─── Patient Orders ───────────────────────────────────────────────────────────

class PatientOrdersView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from apps.pharmacy.models import MedicineOrder

        patient = get_patient(request)
        orders = (
            MedicineOrder.objects
            .filter(patient_id=patient)
            .select_related('pharmacist_id')
            .order_by('-ordered_at')
        )

        return ok('Orders fetched', {
            'orders': [
                {
                    'med_order_id': str(o.med_order_id),
                    'pharmacy_name': o.pharmacist_id.pharmacy_name if o.pharmacist_id else None,
                    'medicines_count': len(o.medicines),
                    'total_amount': float(o.total_amount),
                    'order_status': o.order_status,
                    'payment_status': o.payment_status,
                    'delivery_address': o.delivery_address,
                    'ordered_at': o.ordered_at.isoformat(),
                }
                for o in orders
            ]
        })


# ─── Risk Report ──────────────────────────────────────────────────────────────

class GetRiskReportView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        patient = get_patient(request)
        risk = patient.risk_assessments.first()

        if not risk:
            return ok('No risk assessment yet.', {
                'has_assessment': False,
                'message': 'No risk assessment yet. Complete your profile for AI prediction.',
            })

        return ok('Risk report fetched', {
            'has_assessment': True,
            'risk_id': str(risk.risk_id),
            'risk_level': risk.risk_level,
            'diabetes_risk': float(risk.diabetes_risk) if risk.diabetes_risk else None,
            'heart_risk': float(risk.heart_risk) if risk.heart_risk else None,
            'hypertension_risk': float(risk.hypertension_risk) if risk.hypertension_risk else None,
            'recommendations': risk.recommendations,
            'assessed_at': risk.assessed_at.isoformat(),
        })


# ─── Add Allergy ──────────────────────────────────────────────────────────────

class AddAllergyView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        patient = get_patient(request)
        allergen = request.data.get('allergen', '').strip()
        if not allergen:
            return err('allergen is required')

        severity = request.data.get('severity', '')
        if severity and severity not in ['mild', 'moderate', 'severe']:
            return err('severity must be mild, moderate, or severe')

        allergy = Allergy.objects.create(
            patient_id=patient,
            allergen=allergen,
            reaction=request.data.get('reaction', ''),
            severity=severity,
        )

        EHRRecord.objects.create(
            patient_id=patient,
            added_by=request.user,
            record_type='allergy',
            title=f'Allergy: {allergen}',
            content=request.data.get('reaction', ''),
        )

        log_audit(
            request.user, 'allergy_added', module='patient',
            entity_type='Allergy', entity_id=allergy.allergy_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok('Allergy added', {
            'allergy_id': str(allergy.allergy_id),
            'allergen': allergy.allergen,
            'reaction': allergy.reaction,
            'severity': allergy.severity,
        }, status=201)


class PatientHealthDataView(APIView):
    """Compact health snapshot (last 90 days) used to build the AI Health
    Summary prompt — basic profile + recent consultations / prescriptions / labs."""
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        import json
        from apps.doctor.models import Consultation, Prescription
        from apps.patient.models import LabTestOrder

        patient = get_patient(request)
        if not patient:
            return err('Patient profile not found.', status=404)

        now = timezone.now()
        last_90_days = now - timedelta(days=90)

        age = None
        if patient.dob:
            age = now.year - patient.dob.year

        basic_info = {
            'name': patient.full_name,
            'age': age if age is not None else 'Unknown',
            'blood_group': patient.blood_group or 'Unknown',
            'gender': patient.gender or 'Unknown',
        }

        consultations = (
            Consultation.objects
            .filter(patient_id=patient, status='completed', created_at__gte=last_90_days)
            .select_related('doctor_id')
            .order_by('-created_at')[:10]
        )
        consultation_data = []
        for c in consultations:
            diagnosis = (
                getattr(c, 'final_diagnosis', '')
                or getattr(c, 'doctor_notes', '')
                or ''
            )
            consultation_data.append({
                'doctor': c.doctor_id.full_name,
                'date': str(c.created_at.date()),
                'diagnosis': diagnosis[:150],
            })

        prescriptions = (
            Prescription.objects
            .filter(patient_id=patient, created_at__gte=last_90_days)
            .order_by('-created_at')[:5]
        )
        prescription_data = []
        for p in prescriptions:
            medicines = p.medicines
            if isinstance(medicines, str):
                try:
                    medicines = json.loads(medicines)
                except (ValueError, TypeError):
                    medicines = []
            med_names = []
            if isinstance(medicines, list):
                for m in medicines[:5]:
                    if isinstance(m, dict):
                        med_names.append(m.get('name', ''))
                    else:
                        med_names.append(str(m))
            prescription_data.append({
                'date': str(p.created_at.date()),
                'medicines': med_names,
                'diagnosis': getattr(p, 'diagnosis', '') or '',
            })

        lab_tests = (
            LabTestOrder.objects
            .filter(patient_id=patient, ordered_at__gte=last_90_days, status='completed')
            .order_by('-ordered_at')[:5]
        )
        lab_data = []
        for l in lab_tests:
            tests = l.tests if isinstance(l.tests, list) else [str(l.tests)]
            tests = [
                (t.get('name', t) if isinstance(t, dict) else str(t))
                for t in tests
            ]
            abnormal = l.abnormal_flags or []
            lab_data.append({
                'date': str(l.ordered_at.date()),
                'tests': tests[:5],
                'abnormal_count': len(abnormal) if isinstance(abnormal, list) else 0,
            })

        return ok('Health data retrieved.', {
            'basic_info': basic_info,
            'consultations': consultation_data,
            'prescriptions': prescription_data,
            'lab_tests': lab_data,
            'stats': {
                'total_consultations': len(consultation_data),
                'total_prescriptions': len(prescription_data),
                'total_lab_tests': len(lab_data),
            },
        })
