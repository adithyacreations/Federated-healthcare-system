import hmac
import hashlib
import io
from datetime import date, datetime, timezone, timedelta

from django.conf import settings
from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from apps.auth_app.permissions import IsDoctor
from utils import log_audit, send_notification, broadcast_new_slots_to_patients
from email_utils import send_prescription_email
from .models import DoctorRegistration, DoctorSchedule, DoctorSlot, Consultation, Prescription
from .serializers import (
    DoctorProfileSerializer,
    DoctorScheduleSerializer,
    DoctorSlotSerializer,
    ConsultationSerializer,
    PrescriptionSerializer,
    CreateSlotSerializer,
    BlockDoctorSlotSerializer,
    CreatePrescriptionSerializer,
    CreateLabOrderSerializer,
)
from .utils import AUTO_OBSOLETE_BLOCK_REASONS, block_doctor_slot


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


def _age_from_dob(dob):
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _to_time(t):
    """Coerce 'HH:MM' / 'HH:MM:SS' strings (or a time object) to a time."""
    if isinstance(t, str):
        for fmt in ('%H:%M', '%H:%M:%S'):
            try:
                return datetime.strptime(t, fmt).time()
            except ValueError:
                continue
        return None
    return t


def check_slot_overlap(doctor, slot_date, start_time, end_time, exclude_slot_id=None):
    """Return (has_overlap, message).

    A new [start, end) range on `slot_date` conflicts if it overlaps any of the
    doctor's existing slots OR any active physical (offline) visit, which holds
    a 2-hour window from the moment it started. Back-to-back ranges (one ends
    exactly when the next begins) do NOT overlap.
    """
    from django.utils import timezone as dj_tz

    new_start = _to_time(start_time)
    new_end = _to_time(end_time)

    # 1) Existing slots on the same date.
    existing = DoctorSlot.objects.filter(doctor_id=doctor, slot_date=slot_date)
    if exclude_slot_id:
        existing = existing.exclude(slot_id=exclude_slot_id)
    for s in existing:
        if new_start < s.end_time and new_end > s.start_time:
            return True, (
                f'Overlaps with existing slot {s.start_time.strftime("%H:%M")}'
                f'–{s.end_time.strftime("%H:%M")}. Next available from '
                f'{s.end_time.strftime("%H:%M")}.'
            )

    # 2) Active physical visits (2-hour window from their start).
    offline = Consultation.objects.filter(
        doctor_id=doctor,
        consult_mode='offline',
        status__in=['ongoing', 'scheduled'],
        started_at__date=slot_date,
    )
    for o in offline:
        local_start = dj_tz.localtime(o.started_at)
        o_start = local_start.time()
        o_end = (local_start + timedelta(hours=2)).time()
        if new_start < o_end and new_end > o_start:
            return True, (
                f'Overlaps with a physical visit {o_start.strftime("%H:%M")}'
                f'–{o_end.strftime("%H:%M")}. Next available from '
                f'{o_end.strftime("%H:%M")}.'
            )

    return False, ''


def get_doctor(request):
    try:
        return DoctorRegistration.objects.select_related(
            'hospital_id', 'dept_id', 'login_id'
        ).get(login_id=request.user)
    except DoctorRegistration.DoesNotExist:
        return None


def generate_prescription_pdf(prescription, doctor, patient):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.units import cm

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph('FederCare Digital Prescription', styles['Title']))
    elements.append(Spacer(1, 0.5*cm))

    elements.append(Paragraph(f'<b>Doctor:</b> Dr. {doctor.full_name} | {doctor.specialization}', styles['Normal']))
    elements.append(Paragraph(f'<b>Hospital:</b> {doctor.hospital_id.hospital_name}', styles['Normal']))
    elements.append(Paragraph(f'<b>Patient:</b> {patient.full_name}', styles['Normal']))
    elements.append(Paragraph(f'<b>Date:</b> {prescription.created_at.strftime("%d %b %Y")}', styles['Normal']))
    if prescription.valid_until:
        elements.append(Paragraph(f'<b>Valid Until:</b> {prescription.valid_until.strftime("%d %b %Y")}', styles['Normal']))
    elements.append(Spacer(1, 0.5*cm))

    if prescription.diagnosis:
        elements.append(Paragraph(f'<b>Diagnosis:</b> {prescription.diagnosis}', styles['Normal']))
        elements.append(Spacer(1, 0.3*cm))

    elements.append(Paragraph('<b>Medicines Prescribed:</b>', styles['Normal']))
    elements.append(Spacer(1, 0.2*cm))

    med_data = [['Medicine', 'Dosage', 'Duration', 'Notes']]
    for med in prescription.medicines:
        med_data.append([
            med.get('name', ''),
            med.get('dosage', ''),
            med.get('duration', ''),
            med.get('notes', ''),
        ])

    table = Table(med_data, colWidths=[5*cm, 4*cm, 4*cm, 4*cm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1A3C6E')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F0F4FF')]),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(table)
    elements.append(Spacer(1, 0.4*cm))

    if prescription.instructions:
        elements.append(Paragraph(f'<b>Instructions:</b> {prescription.instructions}', styles['Normal']))

    elements.append(Spacer(1, 1*cm))
    elements.append(Paragraph('_____________________________', styles['Normal']))
    elements.append(Paragraph(f'Dr. {doctor.full_name}', styles['Normal']))
    elements.append(Paragraph('Digital Signature — FederCare', styles['Normal']))

    doc.build(elements)
    buffer.seek(0)
    return buffer


def save_prescription_pdf(buffer, filename, request=None):
    """Save a generated prescription PDF to local media storage. Returns URL."""
    try:
        from utils import save_bytes_locally
        return save_bytes_locally(buffer, f'{filename}.pdf', subdir='prescriptions', request=request)
    except Exception:
        return ''


# ─── Views ───────────────────────────────────────────────────────────────────

class DoctorDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        today = date.today()
        today_consultations = Consultation.objects.filter(
            doctor_id=doctor,
            slot_id__slot_date=today,
        ).count()

        from apps.lab.models import LabOrder
        pending_lab = LabOrder.objects.filter(doctor_id=doctor, status='pending').count()

        total_patients = Consultation.objects.filter(
            doctor_id=doctor, status='completed'
        ).values('patient_id').distinct().count()

        upcoming_slots = DoctorSlot.objects.filter(
            doctor_id=doctor,
            slot_date__gte=today,
            is_booked=False,
            is_blocked=False,
            status='available',
            schedule__isnull=False,
        ).order_by('slot_date', 'start_time')[:5]

        schedules = DoctorSchedule.objects.filter(
            doctor=doctor,
        ).order_by('-is_active', 'start_time')

        recent_prescriptions = Prescription.objects.filter(
            doctor_id=doctor
        ).select_related('patient_id').order_by('-created_at')[:5]

        return ok('Doctor dashboard loaded.', {
            'doctor_name': doctor.full_name,
            'specialization': doctor.specialization,
            'hospital_name': doctor.hospital_id.hospital_name,
            'is_online': doctor.is_online,
            'today_consultations': today_consultations,
            'pending_lab_results': pending_lab,
            'total_patients_seen': total_patients,
            'schedules': DoctorScheduleSerializer(schedules, many=True).data,
            'upcoming_slots': DoctorSlotSerializer(upcoming_slots, many=True).data,
            'recent_prescriptions': PrescriptionSerializer(recent_prescriptions, many=True).data,
        })


class ToggleOnlineStatusView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def put(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        doctor.is_online = not doctor.is_online
        doctor.save(update_fields=['is_online'])

        state = 'online' if doctor.is_online else 'offline'
        log_audit(
            login_id=request.user,
            action=f'Doctor toggled status to {state}',
            module='doctor',
            entity_type='DoctorRegistration',
            entity_id=str(doctor.doctor_id),
        )
        return ok(f'You are now {state}.', {'is_online': doctor.is_online})


class GetPatientEHRView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request, patient_id):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        from apps.patient.models import PatientRegistration, EHRRecord, Allergy, EHRConsentLog
        try:
            patient = PatientRegistration.objects.get(patient_id=patient_id)
        except PatientRegistration.DoesNotExist:
            return err('Patient not found.', status_code=404)

        now = datetime.now(tz=timezone.utc)
        has_consent = EHRConsentLog.objects.filter(
            patient_id=patient,
            accessed_by=request.user,
            consent_given=True,
            expires_at__gt=now,
        ).exists()

        if not has_consent:
            return err(
                'Access denied. Patient has not granted QR consent for EHR access.',
                status_code=403,
            )

        records = EHRRecord.objects.filter(patient_id=patient).order_by('-recorded_at')
        allergies = Allergy.objects.filter(patient_id=patient)

        from apps.patient.serializers import EHRRecordSerializer, AllergySerializer, PatientProfileSerializer
        log_audit(
            login_id=request.user,
            action='Doctor accessed patient EHR',
            module='doctor',
            entity_type='PatientRegistration',
            entity_id=str(patient_id),
        )

        return ok('Patient EHR loaded.', {
            'patient': PatientProfileSerializer(patient).data,
            'ehr_records': EHRRecordSerializer(records, many=True).data,
            'allergies': AllergySerializer(allergies, many=True).data,
        })


class CreateSlotView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)
        return err('Doctor cannot modify hospital-created schedule', status_code=403)


class ListSlotsView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        # Newest dates first; drop slots older than a week to keep the list tidy.
        cutoff = date.today() - timedelta(days=7)
        slots_qs = DoctorSlot.objects.filter(
            doctor_id=doctor, slot_date__gte=cutoff
        ).exclude(
            Q(is_booked=False)
            & (Q(is_blocked=True) | Q(status='blocked'))
            & Q(block_reason__in=AUTO_OBSOLETE_BLOCK_REASONS)
        ).order_by('-slot_date', 'start_time')

        filter_date = request.query_params.get('date')
        if filter_date:
            slots_qs = slots_qs.filter(slot_date=filter_date)

        return ok('Slots retrieved.', DoctorSlotSerializer(slots_qs, many=True).data)


class DoctorSchedulesView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        schedules = DoctorSchedule.objects.filter(doctor=doctor).order_by(
            '-is_active', 'start_time',
        )
        return ok('Doctor schedules retrieved.', DoctorScheduleSerializer(schedules, many=True).data)


class BlockSlotView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request, slot_id):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        ser = BlockDoctorSlotSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        try:
            slot = DoctorSlot.objects.get(slot_id=slot_id, doctor_id=doctor)
        except DoctorSlot.DoesNotExist:
            return err('Slot not found.', status_code=404)

        try:
            block_doctor_slot(
                slot,
                blocked_by='doctor',
                reason=ser.validated_data.get('block_reason') or 'Doctor unavailable',
            )
        except ValueError as exc:
            return err(str(exc), status_code=400)

        log_audit(
            login_id=request.user,
            action='Doctor blocked slot',
            module='doctor',
            entity_type='DoctorSlot',
            entity_id=str(slot.slot_id),
        )
        return ok('Slot blocked successfully', DoctorSlotSerializer(slot).data)


class ConsultationChatView(APIView):
    """Persisted consultation chat — shared by patient and doctor.

    GET  → full message history (oldest first).
    POST → save a message, broadcast it over the chat socket, return it.
    Frames match the shape the `ConsultationChat` React component renders.
    """
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _frame(m):
        from django.utils import timezone as dj_timezone
        sent = m.sent_at
        try:
            sent = dj_timezone.localtime(sent)
        except Exception:
            pass
        return {
            'type': 'message',
            'chat_id': str(m.chat_id),
            'sender': m.sender_type,
            'sender_name': m.sender_name,
            'text': m.message,
            'time': sent.strftime('%I:%M %p'),
            'is_read': m.is_read,
        }

    @staticmethod
    def _can_access(request, consultation):
        u = request.user
        role = getattr(u, 'role', None)
        if role == 'super_admin':
            return True
        try:
            if role == 'patient':
                return consultation.patient_id.login_id_id == u.login_id
            if role == 'doctor':
                return consultation.doctor_id.login_id_id == u.login_id
        except Exception:
            return False
        return False

    def get(self, request, consultation_id):
        from .models import ConsultationChat
        try:
            consultation = Consultation.objects.select_related(
                'patient_id', 'doctor_id'
            ).get(consultation_id=consultation_id)
        except Consultation.DoesNotExist:
            return err('Consultation not found.', status_code=404)
        if not self._can_access(request, consultation):
            return err('Not allowed to view this chat.', status_code=403)

        msgs = ConsultationChat.objects.filter(consultation_id=consultation).order_by('sent_at')
        return ok('Chat history retrieved.', [self._frame(m) for m in msgs])

    def post(self, request, consultation_id):
        from .models import ConsultationChat
        text = (request.data.get('message') or '').strip()
        if not text:
            return err('Message cannot be empty.', status_code=400)

        try:
            consultation = Consultation.objects.select_related(
                'patient_id', 'doctor_id'
            ).get(consultation_id=consultation_id)
        except Consultation.DoesNotExist:
            return err('Consultation not found.', status_code=404)
        if not self._can_access(request, consultation):
            return err('Not allowed to post to this chat.', status_code=403)

        sender_type = 'doctor' if getattr(request.user, 'role', None) == 'doctor' else 'patient'
        sender_name = request.user.email
        try:
            if sender_type == 'patient':
                sender_name = consultation.patient_id.full_name
            else:
                sender_name = f'Dr. {consultation.doctor_id.full_name}'
        except Exception:
            pass

        msg = ConsultationChat.objects.create(
            consultation_id=consultation,
            sender_type=sender_type,
            sender_name=sender_name,
            message=text,
        )
        frame = self._frame(msg)

        # Real-time fan-out to everyone in this consultation's chat socket.
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                async_to_sync(channel_layer.group_send)(
                    f'consultation_chat_{consultation_id}',
                    {'type': 'chat_message', 'data': frame},
                )
        except Exception as e:
            print(f'[WS] Chat broadcast error: {e}')

        return ok('Message sent.', frame, status_code=201)


class DoctorConsultationsView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        qs = Consultation.objects.filter(doctor_id=doctor).select_related(
            'patient_id', 'slot_id'
        )
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        return ok('Consultations retrieved.', ConsultationSerializer(qs, many=True).data)


class UpdateConsultationView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def put(self, request, consultation_id):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        try:
            consultation = Consultation.objects.select_related(
                'patient_id', 'doctor_id', 'slot_id'
            ).get(consultation_id=consultation_id, doctor_id=doctor)
        except Consultation.DoesNotExist:
            return err('Consultation not found.', status_code=404)

        allowed = ['status', 'doctor_notes', 'final_diagnosis', 'ai_suggestions', 'to_emergency']
        for field in allowed:
            if field in request.data:
                setattr(consultation, field, request.data[field])

        now = datetime.now(tz=timezone.utc)
        if request.data.get('status') == 'ongoing' and not consultation.started_at:
            consultation.started_at = now
        if request.data.get('status') == 'completed' and not consultation.ended_at:
            consultation.ended_at = now

        consultation.save()

        if request.data.get('status') == 'completed' and consultation.final_diagnosis:
            from apps.patient.models import EHRRecord
            EHRRecord.objects.create(
                patient_id=consultation.patient_id,
                added_by=request.user,
                record_type='diagnosis',
                title=f'Consultation — {consultation.created_at.strftime("%d %b %Y")}',
                content=consultation.final_diagnosis,
            )
            send_notification(
                login_id=consultation.patient_id.login_id,
                title='Consultation Completed',
                message=f'Your consultation with Dr. {doctor.full_name} has been completed.',
                notif_type='info',
                related_id=str(consultation_id),
            )

        log_audit(
            login_id=request.user,
            action='Doctor updated consultation',
            module='doctor',
            entity_type='Consultation',
            entity_id=str(consultation_id),
        )
        return ok('Consultation updated.', ConsultationSerializer(consultation).data)


class CreatePrescriptionView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        ser = CreatePrescriptionSerializer(data=request.data, context={'doctor': doctor})
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        d = ser.validated_data
        consultation = d['_consultation']
        patient = consultation.patient_id

        prescription = Prescription.objects.create(
            doctor_id=doctor,
            patient_id=patient,
            consultation_id=consultation,
            medicines=d['medicines'],
            diagnosis=d.get('diagnosis', ''),
            instructions=d.get('instructions', ''),
            valid_until=d.get('valid_until'),
        )

        pdf_buffer = generate_prescription_pdf(prescription, doctor, patient)
        filename = f'rx_{prescription.prescription_id}'
        pdf_url = save_prescription_pdf(pdf_buffer, filename, request=request)
        if pdf_url:
            prescription.pdf_url = pdf_url
            prescription.save(update_fields=['pdf_url'])

        from apps.patient.models import EHRRecord
        EHRRecord.objects.create(
            patient_id=patient,
            added_by=request.user,
            record_type='prescription',
            title=f'Prescription — Dr. {doctor.full_name}',
            content=', '.join(m['name'] for m in d['medicines']),
            file_url=pdf_url,
        )

        send_notification(
            login_id=patient.login_id,
            title='New Prescription',
            message=f'Dr. {doctor.full_name} has issued you a prescription.',
            notif_type='alert',
            related_id=str(prescription.prescription_id),
        )

        log_audit(
            login_id=request.user,
            action='Doctor created prescription',
            module='doctor',
            entity_type='Prescription',
            entity_id=str(prescription.prescription_id),
        )

        send_prescription_email(
            to_email=patient.login_id.email,
            patient_name=patient.full_name,
            doctor_name=doctor.full_name,
            medicines=d['medicines'],
            pdf_url=pdf_url,
        )

        return ok('Prescription created.', PrescriptionSerializer(prescription).data, status_code=201)


class CreateLabOrderView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        ser = CreateLabOrderSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        d = ser.validated_data
        from apps.patient.models import PatientRegistration
        from apps.lab.models import LabOrder, LabTechRegistration

        patient = PatientRegistration.objects.get(patient_id=d['patient_id'])

        lab_tech = LabTechRegistration.objects.filter(
            hospital_id=doctor.hospital_id,
            approval_status='approved',
        ).first()

        order = LabOrder.objects.create(
            doctor_id=doctor,
            patient_id=patient,
            lab_tech_id=lab_tech,
            tests_ordered=d['tests_ordered'],
            priority=d.get('priority', 'normal'),
            notes=d.get('notes', ''),
        )

        if lab_tech:
            send_notification(
                login_id=lab_tech.login_id,
                title='New Lab Order',
                message=f'Dr. {doctor.full_name} ordered lab tests for {patient.full_name}. Priority: {order.priority}.',
                notif_type='alert',
                related_id=str(order.order_id),
            )

        send_notification(
            login_id=patient.login_id,
            title='Lab Tests Ordered',
            message=f'Dr. {doctor.full_name} has ordered lab tests for you.',
            notif_type='info',
            related_id=str(order.order_id),
        )

        log_audit(
            login_id=request.user,
            action='Doctor created lab order',
            module='doctor',
            entity_type='LabOrder',
            entity_id=str(order.order_id),
        )
        return ok('Lab order created.', {
            'order_id': str(order.order_id),
            'tests_ordered': order.tests_ordered,
            'priority': order.priority,
            'status': order.status,
            'lab_tech_assigned': lab_tech.full_name if lab_tech else None,
        }, status_code=201)


class DoctorLabOrdersView(APIView):
    """All lab work tied to this doctor — both clinician-ordered LabOrders and
    patient-booked LabTestOrders — normalized into one list for the UI."""
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        from apps.lab.models import LabOrder
        from apps.patient.models import LabTestOrder

        data = []

        # 1. Clinician-ordered lab tests (apps.lab.LabOrder)
        lab_orders = LabOrder.objects.filter(doctor_id=doctor).select_related(
            'patient_id', 'lab_tech_id'
        ).prefetch_related('reports').order_by('-ordered_at')
        for o in lab_orders:
            report = o.reports.all().first()
            tests = o.tests_ordered if isinstance(o.tests_ordered, list) else [o.tests_ordered]
            data.append({
                'order_id': str(o.order_id),
                'source': 'doctor_order',
                'patient_name': o.patient_id.full_name,
                'patient_id': str(o.patient_id.patient_id),
                'patient_blood_group': o.patient_id.blood_group or '',
                'patient_age': _age_from_dob(o.patient_id.dob),
                'hospital_name': '',
                'tests': tests,
                'tests_count': len(tests),
                'total_fee': 0.0,
                'appointment_date': None,
                'appointment_time': None,
                'priority': o.priority,
                'status': o.status,
                'payment_status': o.payment_status,
                'notes': o.notes,
                'lab_tech_name': o.lab_tech_id.full_name if o.lab_tech_id else 'Not assigned',
                'report_url': report.report_file_url if report else '',
                'abnormal_flags': report.abnormal_flags if report else [],
                'ordered_at': o.ordered_at.isoformat(),
                'updated_at': o.updated_at.isoformat(),
            })

        # 2. Patient-booked lab tests linked to this doctor (apps.patient.LabTestOrder)
        test_orders = LabTestOrder.objects.filter(doctor_id=doctor).select_related(
            'patient_id', 'hospital_id'
        ).order_by('-ordered_at')
        for o in test_orders:
            tests = o.tests if isinstance(o.tests, list) else [o.tests]
            data.append({
                'order_id': str(o.order_id),
                'source': 'patient_booking',
                'patient_name': o.patient_id.full_name,
                'patient_id': str(o.patient_id.patient_id),
                'patient_blood_group': o.patient_id.blood_group or '',
                'patient_age': _age_from_dob(o.patient_id.dob),
                'hospital_name': o.hospital_id.hospital_name if o.hospital_id else '',
                'tests': tests,
                'tests_count': len(tests),
                'total_fee': float(o.total_fee),
                'appointment_date': str(o.appointment_date) if o.appointment_date else None,
                'appointment_time': str(o.appointment_time) if o.appointment_time else None,
                'priority': 'normal',
                'status': o.status,
                'payment_status': o.payment_status,
                'notes': getattr(o, 'notes', ''),
                'lab_tech_name': 'Not assigned',
                'report_url': o.report_url,
                'abnormal_flags': o.abnormal_flags,
                'ordered_at': o.ordered_at.isoformat(),
                'updated_at': getattr(o, 'updated_at', o.ordered_at).isoformat(),
            })

        data.sort(key=lambda x: x['ordered_at'], reverse=True)
        return ok('Lab orders retrieved.', {'data': data, 'total': len(data)})


class DoctorPrescriptionsView(APIView):
    """All prescriptions issued by this doctor."""
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        prescriptions = Prescription.objects.filter(
            doctor_id=doctor
        ).select_related('patient_id', 'consultation_id').order_by('-created_at')

        data = [
            {
                'prescription_id': str(rx.prescription_id),
                'patient_name': rx.patient_id.full_name,
                'patient_id': str(rx.patient_id.patient_id),
                'medicines': rx.medicines,
                'diagnosis': rx.diagnosis,
                'instructions': rx.instructions,
                'valid_until': str(rx.valid_until) if rx.valid_until else None,
                'pdf_url': rx.pdf_url,
                'is_verified': rx.is_verified,
                'created_at': rx.created_at.isoformat(),
                'consultation_id': (
                    str(rx.consultation_id.consultation_id) if rx.consultation_id else None
                ),
            }
            for rx in prescriptions
        ]
        return ok('Prescriptions retrieved.', {'data': data, 'total': len(data)})


class VerifyPaymentView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        razorpay_order_id = request.data.get('razorpay_order_id', '')
        razorpay_payment_id = request.data.get('razorpay_payment_id', '')
        razorpay_signature = request.data.get('razorpay_signature', '')

        if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
            return err('razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.')

        try:
            consultation = Consultation.objects.select_related('patient_id').get(
                razorpay_order_id=razorpay_order_id,
                doctor_id=doctor,
            )
        except Consultation.DoesNotExist:
            return err('Consultation not found for this Razorpay order.', status_code=404)

        expected_sig = hmac.new(
            settings.RAZORPAY_KEY_SECRET.encode(),
            f'{razorpay_order_id}|{razorpay_payment_id}'.encode(),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(expected_sig, razorpay_signature):
            consultation.payment_status = 'failed'
            consultation.save(update_fields=['payment_status'])
            return err('Payment signature verification failed.', status_code=400)

        consultation.razorpay_payment_id = razorpay_payment_id
        consultation.razorpay_signature = razorpay_signature
        consultation.payment_status = 'paid'
        consultation.save(update_fields=['razorpay_payment_id', 'razorpay_signature', 'payment_status'])

        send_notification(
            login_id=consultation.patient_id.login_id,
            title='Payment Confirmed',
            message=f'Your consultation payment has been confirmed. Dr. {doctor.full_name} will see you shortly.',
            notif_type='success',
            related_id=str(consultation.consultation_id),
        )

        log_audit(
            login_id=request.user,
            action='Consultation payment verified',
            module='doctor',
            entity_type='Consultation',
            entity_id=str(consultation.consultation_id),
        )
        return ok('Payment verified successfully.', {
            'consultation_id': str(consultation.consultation_id),
            'payment_status': consultation.payment_status,
        })


# ════════════════════════════════════════════════════════════════════════════
#  Doctor's own patients + EHR consent validation
# ════════════════════════════════════════════════════════════════════════════

class DoctorPatientsView(APIView):
    """List only patients who have had a consultation with this doctor."""
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        from apps.patient.models import PatientRegistration

        consults = Consultation.objects.filter(doctor_id=doctor).select_related('patient_id')

        # Group consultations by patient
        by_patient = {}
        for c in consults:
            p = c.patient_id
            entry = by_patient.setdefault(p.patient_id, {'patient': p, 'count': 0, 'last': None})
            entry['count'] += 1
            cdate = c.created_at
            if cdate and (entry['last'] is None or cdate > entry['last']):
                entry['last'] = cdate

        today = date.today()
        patients = []
        for entry in by_patient.values():
            p = entry['patient']
            age = None
            if p.dob:
                age = today.year - p.dob.year - ((today.month, today.day) < (p.dob.month, p.dob.day))
            patients.append({
                'patient_id': str(p.patient_id),
                'full_name': p.full_name,
                'age': age,
                'gender': p.gender,
                'blood_group': p.blood_group,
                'email': p.login_id.email if p.login_id else None,
                'last_consultation_date': entry['last'].isoformat() if entry['last'] else None,
                'total_consultations': entry['count'],
            })

        patients.sort(key=lambda x: x['last_consultation_date'] or '', reverse=True)
        return ok('Patients retrieved.', {'patients': patients, 'total': len(patients)})


class ValidateConsentView(APIView):
    """Doctor submits a patient's QR consent token (the EHRConsentLog UUID).

    On success a doctor-scoped consent record is created so the doctor's
    subsequent EHR fetch passes the consent gate.
    """
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        from apps.patient.models import EHRConsentLog
        from django.utils import timezone as dj_tz

        token = (request.data.get('token') or '').strip()
        patient_id = request.data.get('patient_id')

        if not token:
            return err('QR token is required.')

        # A 6-digit numeric token is a patient short code; anything else is the
        # full consent UUID (from QR scan or manual entry). Short codes can be
        # reused over time, so always match the active (unexpired) one.
        if len(token) == 6 and token.isdigit():
            try:
                consent = EHRConsentLog.objects.select_related('patient_id').filter(
                    short_code=token,
                    expires_at__gt=dj_tz.now(),
                ).latest('accessed_at')
            except EHRConsentLog.DoesNotExist:
                return err('Invalid or expired short code!', status_code=400)
        else:
            try:
                consent = EHRConsentLog.objects.select_related('patient_id').get(consent_id=token)
            except (EHRConsentLog.DoesNotExist, ValueError, Exception):
                return err('Invalid QR token!', status_code=400)

        if patient_id and str(consent.patient_id.patient_id) != str(patient_id):
            return err('This QR token does not belong to this patient.', status_code=400)

        if consent.expires_at and dj_tz.now() > consent.expires_at:
            return Response({
                'success': False,
                'message': 'QR token expired! Ask patient to generate a new one.',
                'expired': True,
            }, status=400)

        # Grant doctor-scoped access mirroring the patient's consent window.
        EHRConsentLog.objects.create(
            patient_id=consent.patient_id,
            accessed_by=request.user,
            access_type='qr_scan',
            consent_given=True,
            expires_at=consent.expires_at,
            data_shared=consent.data_shared,
        )

        log_audit(
            login_id=request.user,
            action='Doctor validated EHR consent token',
            module='doctor',
            entity_type='PatientRegistration',
            entity_id=str(consent.patient_id.patient_id),
        )

        minutes_remaining = 30
        if consent.expires_at:
            minutes_remaining = max(
                0, int((consent.expires_at - dj_tz.now()).total_seconds() / 60)
            )

        return Response({
            'success': True,
            'message': 'Consent verified! Access granted for 30 minutes.',
            'data': {
                'patient_id': str(consent.patient_id.patient_id),
                'expires_at': str(consent.expires_at),
                'minutes_remaining': minutes_remaining,
            },
        })


# ════════════════════════════════════════════════════════════════════════════
#  Offline (physical visit) consultations + patient search
# ════════════════════════════════════════════════════════════════════════════

class SearchPatientView(APIView):
    """Doctor-only patient lookup by name or email — used when starting a
    walk-in (physical visit) consultation."""
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        query = (request.query_params.get('q') or '').strip()
        if len(query) < 2:
            return err('Search query too short.', status_code=400)

        from apps.patient.models import PatientRegistration

        patients = (
            PatientRegistration.objects.filter(full_name__icontains=query)
            | PatientRegistration.objects.filter(login_id__email__icontains=query)
        ).select_related('login_id').distinct()[:10]

        today = date.today()
        data = []
        for p in patients:
            age = None
            if p.dob:
                age = today.year - p.dob.year - ((today.month, today.day) < (p.dob.month, p.dob.day))
            data.append({
                'patient_id': str(p.patient_id),
                'full_name': p.full_name,
                'dob': str(p.dob) if p.dob else None,
                'age': age,
                'gender': p.gender,
                'blood_group': p.blood_group,
                'email': p.login_id.email if p.login_id else None,
                'phone': p.emergency_contact,
            })

        return ok('Patients found.', data)


class CreateOfflineConsultationView(APIView):
    """Start a physical-visit consultation record (no Jitsi room, marked paid).

    The doctor can then use every clinical tool — AI diagnosis, X-ray, EHR,
    prescriptions, lab orders — for a patient who is present in person.
    """
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request):
        doctor = get_doctor(request)
        if not doctor:
            return err('Doctor profile not found.', status_code=404)

        from apps.patient.models import PatientRegistration
        from django.utils import timezone as dj_tz

        patient_id = request.data.get('patient_id')
        if not patient_id:
            return err('patient_id is required.', status_code=400)

        try:
            patient = PatientRegistration.objects.select_related('login_id').get(
                patient_id=patient_id
            )
        except (PatientRegistration.DoesNotExist, ValueError):
            return err('Patient not found.', status_code=404)

        # One physical visit at a time.
        if Consultation.objects.filter(
            doctor_id=doctor, consult_mode='offline', status='ongoing'
        ).exists():
            return err(
                'You already have an active physical visit. Complete it first.',
                status_code=400,
            )

        # The next 2 hours must not collide with an existing slot / visit.
        now = dj_tz.localtime(dj_tz.now())
        end = now + timedelta(hours=2)
        has_overlap, msg = check_slot_overlap(
            doctor, now.date(), now.time(), end.time()
        )
        if has_overlap:
            return err(f'Cannot start physical visit now — {msg}', status_code=400)

        consultation = Consultation.objects.create(
            patient_id=patient,
            doctor_id=doctor,
            consult_mode='offline',
            status='ongoing',
            jitsi_room_id='',
            payment_status='paid',
            started_at=dj_tz.now(),
        )

        send_notification(
            login_id=patient.login_id,
            title='Physical Consultation Started',
            message=f'Dr. {doctor.full_name} has started a physical visit record for your consultation.',
            notif_type='reminder',
            related_id=consultation.consultation_id,
        )

        log_audit(
            login_id=request.user,
            action=f'Doctor started offline consultation with {patient.full_name}',
            module='doctor',
            entity_type='Consultation',
            entity_id=str(consultation.consultation_id),
        )

        return ok('Offline consultation started.', {
            'consultation_id': str(consultation.consultation_id),
            'patient_name': patient.full_name,
            'patient_id': str(patient.patient_id),
            'consult_mode': 'offline',
            'started_at': str(consultation.started_at),
        }, status_code=201)


# ════════════════════════════════════════════════════════════════════════════
#  Prescription PDF — generated on-the-fly by ReportLab (no Cloudinary)
# ════════════════════════════════════════════════════════════════════════════

def _calc_age(dob):
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def build_prescription_pdf(rx):
    """Render a Prescription to a PDF and return it as a BytesIO buffer."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    NAVY = (0.1, 0.235, 0.431)
    rx_short = str(rx.prescription_id)[:8]
    doctor = rx.doctor_id
    patient = rx.patient_id

    # ── Header band ──────────────────────────────────────────────
    c.setFillColorRGB(*NAVY)
    c.rect(0, height - 80, width, 80, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(50, height - 40, 'FederCare')
    c.setFont('Helvetica', 12)
    c.drawString(50, height - 60, 'AI Health Network - Digital Prescription')
    c.setFont('Helvetica', 9)
    c.drawRightString(width - 50, height - 40, f'Rx ID: {rx_short}')
    c.drawRightString(width - 50, height - 60,
                      f"Date: {rx.created_at.strftime('%d %b %Y')}")

    # ── Patient details ──────────────────────────────────────────
    y = height - 110
    c.setFillColorRGB(0, 0, 0)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(50, y, 'Patient Details:')
    y -= 20
    c.setFont('Helvetica', 11)
    c.drawString(70, y, f'Name: {patient.full_name}')
    y -= 18
    age = _calc_age(getattr(patient, 'dob', None))
    if age is not None:
        c.drawString(70, y, f'Age: {age} years | Gender: {patient.gender or "-"} '
                            f'| Blood Group: {patient.blood_group or "-"}')
        y -= 18

    # ── Doctor details ───────────────────────────────────────────
    y -= 10
    c.setFont('Helvetica-Bold', 12)
    c.drawString(50, y, 'Prescribed By:')
    y -= 20
    c.setFont('Helvetica', 11)
    c.drawString(70, y, f'Dr. {doctor.full_name}')
    y -= 18
    c.drawString(70, y, f'Specialization: {doctor.specialization}')
    y -= 18
    c.drawString(70, y, f'License: {doctor.license_no}')
    y -= 25

    # ── Divider ──────────────────────────────────────────────────
    c.setStrokeColorRGB(*NAVY)
    c.setLineWidth(2)
    c.line(50, y, width - 50, y)
    y -= 20

    if rx.diagnosis:
        c.setFillColorRGB(0, 0, 0)
        c.setFont('Helvetica-Bold', 11)
        c.drawString(50, y, f'Diagnosis: {rx.diagnosis}')
        y -= 22

    # ── Medicines ────────────────────────────────────────────────
    c.setFillColorRGB(*NAVY)
    c.setFont('Helvetica-Bold', 14)
    c.drawString(50, y, 'PRESCRIBED MEDICINES')
    y -= 25

    medicines = rx.medicines if isinstance(rx.medicines, list) else []
    for i, med in enumerate(medicines, 1):
        if y < 150:
            c.showPage()
            y = height - 50
        c.setFillColorRGB(0.95, 0.97, 1.0)
        c.roundRect(45, y - 45, width - 90, 55, 5, fill=1, stroke=0)
        c.setFillColorRGB(0, 0, 0)
        c.setFont('Helvetica-Bold', 12)
        c.drawString(60, y - 10, f"{i}. {med.get('name', 'Unknown')}")
        c.setFont('Helvetica', 10)
        details = (f"Dosage: {med.get('dosage', '-')} | "
                   f"Frequency: {med.get('frequency', '-')} | "
                   f"Duration: {med.get('days', '-')} days")
        c.drawString(60, y - 28, details)
        y -= 65

    if not medicines:
        c.setFillColorRGB(0.4, 0.4, 0.4)
        c.setFont('Helvetica-Oblique', 10)
        c.drawString(60, y, 'No medicines listed.')
        y -= 20

    # ── Instructions ─────────────────────────────────────────────
    if rx.instructions:
        if y < 130:
            c.showPage()
            y = height - 50
        y -= 10
        c.setStrokeColorRGB(*NAVY)
        c.setLineWidth(1)
        c.line(50, y, width - 50, y)
        y -= 20
        c.setFillColorRGB(0, 0, 0)
        c.setFont('Helvetica-Bold', 12)
        c.drawString(50, y, 'Instructions:')
        y -= 20
        c.setFont('Helvetica', 11)
        line = ''
        for word in rx.instructions.split():
            if len(line + word) < 80:
                line += word + ' '
            else:
                c.drawString(70, y, line.strip())
                y -= 18
                line = word + ' '
        if line:
            c.drawString(70, y, line.strip())
            y -= 18

    # ── Valid until ──────────────────────────────────────────────
    if rx.valid_until:
        y -= 10
        c.setFont('Helvetica-Bold', 11)
        c.drawString(50, y, f'Valid Until: {rx.valid_until}')

    # ── Digital signature ────────────────────────────────────────
    c.setFillColorRGB(0, 0, 0)
    c.setFont('Helvetica', 10)
    c.drawRightString(width - 50, 80, f'Dr. {doctor.full_name}')
    c.drawRightString(width - 50, 65, f'{doctor.specialization}')
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1)
    c.line(width - 200, 58, width - 50, 58)
    c.drawRightString(width - 50, 48, 'Digital Signature')

    # ── Footer band ──────────────────────────────────────────────
    c.setFillColorRGB(*NAVY)
    c.rect(0, 0, width, 40, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont('Helvetica', 9)
    c.drawString(50, 24, 'This is a digitally generated prescription from FederCare AI Health Network')
    c.drawString(50, 11, 'Mar Thoma Institute of Information Technology, Ayur, Kollam, Kerala')

    c.save()
    buffer.seek(0)
    return buffer, rx_short


def _prescription_pdf_response(rx):
    from django.http import HttpResponse
    buffer, rx_short = build_prescription_pdf(rx)
    response = HttpResponse(buffer.getvalue(), content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="prescription_{rx_short}.pdf"'
    return response


def _can_access_prescription(user, rx):
    """A prescription is viewable by its doctor, its patient, or a super admin."""
    role = getattr(user, 'role', None)
    if role == 'super_admin':
        return True
    if role == 'doctor' and rx.doctor_id.login_id_id == user.login_id:
        return True
    if role == 'patient' and rx.patient_id.login_id_id == user.login_id:
        return True
    return False


class DownloadPrescriptionView(APIView):
    """Doctor-facing prescription PDF download (generated on-the-fly)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, prescription_id):
        try:
            rx = Prescription.objects.select_related(
                'doctor_id', 'doctor_id__login_id', 'patient_id', 'patient_id__login_id'
            ).get(prescription_id=prescription_id)
        except Prescription.DoesNotExist:
            return err('Prescription not found.', status_code=404)

        if not _can_access_prescription(request.user, rx):
            return err('You are not authorized to view this prescription.', status_code=403)

        return _prescription_pdf_response(rx)


class PublicPrescriptionDownloadView(APIView):
    """Prescription PDF for the doctor, the patient it belongs to, or an admin."""
    permission_classes = [IsAuthenticated]

    def get(self, request, prescription_id):
        try:
            rx = Prescription.objects.select_related(
                'doctor_id', 'doctor_id__login_id', 'patient_id', 'patient_id__login_id'
            ).get(prescription_id=prescription_id)
        except Prescription.DoesNotExist:
            return err('Prescription not found.', status_code=404)

        if not _can_access_prescription(request.user, rx):
            return err('You are not authorized to view this prescription.', status_code=403)

        return _prescription_pdf_response(rx)
