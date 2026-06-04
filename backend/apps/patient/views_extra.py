"""Patient module — Complaints, Medicine Orders, Lab Tests, QR Code, EHR Images.

These views supplement apps/patient/views.py. They are kept in a separate
module purely for readability; URLs are registered in apps/patient/urls.py.
"""
import random
import string
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.parsers import MultiPartParser, FormParser

from apps.auth_app.permissions import IsPatient
from .models import (
    EHRRecord, EHRConsentLog, RiskAssessment,
    Complaint, LabTestOrder, EHRImage,
)
from utils import log_audit, send_notification, broadcast_medicine_update
from email_utils import send_delivery_confirmed_email


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


DANGEROUS_MEDICINES = [
    # Antibiotics
    'amoxicillin', 'azithromycin', 'ciprofloxacin', 'metronidazole',
    'doxycycline', 'clindamycin', 'cephalexin', 'erythromycin',
    # Steroids
    'prednisolone', 'dexamethasone', 'methylprednisolone', 'prednisone',
    'hydrocortisone', 'betamethasone',
    # Controlled substances
    'tramadol', 'codeine', 'morphine', 'alprazolam', 'diazepam',
    'lorazepam', 'clonazepam', 'zolpidem',
    # Cardiac medicines
    'warfarin', 'digoxin', 'amiodarone', 'metoprolol', 'atenolol',
    # Diabetes
    'insulin', 'metformin', 'glibenclamide',
    # Others
    'lithium', 'phenytoin', 'carbamazepine', 'valproate',
    'isotretinoin', 'methotrexate', 'tacrolimus',
]


def medicine_needs_prescription(medicine):
    """True if a single medicine needs a prescription — checked three ways so
    it works for medicines from ANY pharmacy:
      1. name matches a dangerous/controlled drug,
      2. the cart item carries a requires_prescription flag,
      3. the linked PharmacyInventory item is marked requires_prescription.
    """
    name = str(medicine.get('name', '')).lower()
    if any(dangerous in name for dangerous in DANGEROUS_MEDICINES):
        return True
    if medicine.get('requires_prescription'):
        return True
    inv_id = medicine.get('inventory_id')
    if inv_id:
        from apps.pharmacy.models import PharmacyInventory
        try:
            item = PharmacyInventory.objects.get(inventory_id=inv_id)
            if item.requires_prescription:
                return True
        except Exception:
            pass
    return False


def check_requires_prescription(medicines):
    """Return True if ANY medicine in the list needs a prescription."""
    return any(medicine_needs_prescription(m) for m in medicines)


def calculate_age(dob):
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def generate_otp():
    return ''.join(random.choices(string.digits, k=6))


def _push_history(order, status, note):
    history = list(order.status_history or [])
    history.append({
        'status': status,
        'timestamp': str(timezone.now()),
        'note': note,
    })
    order.status_history = history


# Lab test catalog used by the patient booking flow. Option C (hybrid):
# `requires_prescription=False` → book freely; `True` → needs a doctor referral
# or an uploaded prescription that the lab verifies. `category` powers the
# category filter tabs on the patient Lab Tests page.
AVAILABLE_TESTS = [
    # ─── Direct tests (no prescription) ─────────────────────────────────
    {'test_id': 'cbc', 'name': 'Complete Blood Count (CBC)', 'category': 'Blood Tests', 'fee': 250, 'requires_prescription': False, 'description': 'Measures red blood cells, white blood cells, and platelets', 'preparation': 'No special preparation needed', 'duration': '24 hours'},
    {'test_id': 'sugar_fasting', 'name': 'Blood Sugar Fasting', 'category': 'Blood Tests', 'fee': 80, 'requires_prescription': False, 'description': 'Measures blood glucose after fasting 8-10 hours', 'preparation': 'Fast for 8-10 hours before test', 'duration': '24 hours'},
    {'test_id': 'sugar_random', 'name': 'Blood Sugar Random', 'category': 'Blood Tests', 'fee': 80, 'requires_prescription': False, 'description': 'Measures blood glucose at any time', 'preparation': 'No preparation needed', 'duration': '24 hours'},
    {'test_id': 'hba1c', 'name': 'HbA1c', 'category': 'Blood Tests', 'fee': 350, 'requires_prescription': False, 'description': '3-month average blood sugar level', 'preparation': 'No fasting needed', 'duration': '24 hours'},
    {'test_id': 'lipid_profile', 'name': 'Lipid Profile', 'category': 'Blood Tests', 'fee': 450, 'requires_prescription': False, 'description': 'Cholesterol HDL LDL Triglycerides', 'preparation': 'Fast 12 hours before test', 'duration': '24 hours'},
    {'test_id': 'lft', 'name': 'Liver Function Test (LFT)', 'category': 'Blood Tests', 'fee': 500, 'requires_prescription': False, 'description': 'Checks liver health and function', 'preparation': 'Fast 8 hours before test', 'duration': '24 hours'},
    {'test_id': 'kft', 'name': 'Kidney Function Test (KFT)', 'category': 'Blood Tests', 'fee': 450, 'requires_prescription': False, 'description': 'Checks kidney health including creatinine urea', 'preparation': 'No special preparation', 'duration': '24 hours'},
    {'test_id': 'tsh', 'name': 'Thyroid Stimulating Hormone (TSH)', 'category': 'Thyroid', 'fee': 350, 'requires_prescription': False, 'description': 'Checks thyroid gland function', 'preparation': 'No fasting needed', 'duration': '24 hours'},
    {'test_id': 'thyroid_profile', 'name': 'T3 T4 TSH (Thyroid Profile)', 'category': 'Thyroid', 'fee': 650, 'requires_prescription': False, 'description': 'Complete thyroid function test', 'preparation': 'No fasting needed', 'duration': '24 hours'},
    {'test_id': 'vit_d3', 'name': 'Vitamin D3', 'category': 'Vitamins', 'fee': 900, 'requires_prescription': False, 'description': 'Checks Vitamin D levels', 'preparation': 'No special preparation', 'duration': '48 hours'},
    {'test_id': 'vit_b12', 'name': 'Vitamin B12', 'category': 'Vitamins', 'fee': 700, 'requires_prescription': False, 'description': 'Checks Vitamin B12 levels', 'preparation': 'No fasting needed', 'duration': '48 hours'},
    {'test_id': 'urine_routine', 'name': 'Urine Routine & Microscopy', 'category': 'Urine Tests', 'fee': 120, 'requires_prescription': False, 'description': 'General urine examination', 'preparation': 'Collect mid-stream morning sample', 'duration': '24 hours'},
    {'test_id': 'blood_group', 'name': 'Blood Group & Rh Factor', 'category': 'Blood Tests', 'fee': 100, 'requires_prescription': False, 'description': 'Determines blood group A B AB O and Rh', 'preparation': 'No preparation needed', 'duration': '24 hours'},
    {'test_id': 'dengue_ns1', 'name': 'Dengue NS1 Antigen', 'category': 'Infection', 'fee': 800, 'requires_prescription': False, 'description': 'Early dengue detection test', 'preparation': 'No preparation needed', 'duration': '24 hours'},
    {'test_id': 'malaria', 'name': 'Malaria Antigen Test', 'category': 'Infection', 'fee': 400, 'requires_prescription': False, 'description': 'Detects malaria parasites', 'preparation': 'No preparation needed', 'duration': '24 hours'},
    {'test_id': 'widal', 'name': 'Typhoid (Widal Test)', 'category': 'Infection', 'fee': 250, 'requires_prescription': False, 'description': 'Detects typhoid fever antibodies', 'preparation': 'No preparation needed', 'duration': '24 hours'},
    {'test_id': 'iron_studies', 'name': 'Iron Studies (Serum Iron)', 'category': 'Blood Tests', 'fee': 400, 'requires_prescription': False, 'description': 'Checks iron levels in blood', 'preparation': 'Fast 8 hours before test', 'duration': '24 hours'},
    {'test_id': 'uric_acid', 'name': 'Uric Acid', 'category': 'Blood Tests', 'fee': 150, 'requires_prescription': False, 'description': 'Checks uric acid levels for gout', 'preparation': 'Fast 4 hours before test', 'duration': '24 hours'},
    {'test_id': 'esr', 'name': 'ESR (Erythrocyte Sedimentation Rate)', 'category': 'Blood Tests', 'fee': 100, 'requires_prescription': False, 'description': 'Detects inflammation in body', 'preparation': 'No preparation needed', 'duration': '24 hours'},
    {'test_id': 'crp', 'name': 'CRP (C-Reactive Protein)', 'category': 'Blood Tests', 'fee': 350, 'requires_prescription': False, 'description': 'Detects infection or inflammation', 'preparation': 'No preparation needed', 'duration': '24 hours'},

    # ─── Prescription-required tests ────────────────────────────────────
    {'test_id': 'fsh_lh', 'name': 'FSH & LH (Hormonal)', 'category': 'Hormones', 'fee': 800, 'requires_prescription': True, 'description': 'Female reproductive hormones test', 'preparation': 'Day 2-3 of menstrual cycle', 'duration': '48 hours'},
    {'test_id': 'prolactin', 'name': 'Prolactin', 'category': 'Hormones', 'fee': 600, 'requires_prescription': True, 'description': 'Checks prolactin hormone levels', 'preparation': 'Morning sample preferred', 'duration': '48 hours'},
    {'test_id': 'testosterone', 'name': 'Testosterone', 'category': 'Hormones', 'fee': 700, 'requires_prescription': True, 'description': 'Checks testosterone hormone levels', 'preparation': 'Morning sample preferred', 'duration': '48 hours'},
    {'test_id': 'cortisol', 'name': 'Cortisol', 'category': 'Hormones', 'fee': 650, 'requires_prescription': True, 'description': 'Stress hormone test', 'preparation': 'Morning sample 8-9 AM', 'duration': '48 hours'},
    {'test_id': 'psa', 'name': 'PSA (Prostate Specific Antigen)', 'category': 'Cancer Markers', 'fee': 900, 'requires_prescription': True, 'description': 'Prostate cancer screening test', 'preparation': 'No preparation needed', 'duration': '48 hours'},
    {'test_id': 'ca125', 'name': 'CA-125', 'category': 'Cancer Markers', 'fee': 1200, 'requires_prescription': True, 'description': 'Ovarian cancer marker', 'preparation': 'No preparation needed', 'duration': '48 hours'},
    {'test_id': 'cea', 'name': 'CEA (Carcinoembryonic Antigen)', 'category': 'Cancer Markers', 'fee': 1100, 'requires_prescription': True, 'description': 'Cancer marker test', 'preparation': 'No preparation needed', 'duration': '48 hours'},
    {'test_id': 'troponin', 'name': 'Troponin I (Cardiac)', 'category': 'Cardiac', 'fee': 1500, 'requires_prescription': True, 'description': 'Heart attack detection test', 'preparation': 'No preparation needed', 'duration': '6 hours'},
    {'test_id': 'urine_culture', 'name': 'Urine Culture & Sensitivity', 'category': 'Urine Tests', 'fee': 600, 'requires_prescription': True, 'description': 'Identifies bacteria in urine', 'preparation': 'Mid-stream clean catch sample', 'duration': '72 hours'},
    {'test_id': 'blood_culture', 'name': 'Blood Culture', 'category': 'Infection', 'fee': 800, 'requires_prescription': True, 'description': 'Detects bacteria in blood', 'preparation': 'No preparation needed', 'duration': '72 hours'},
    {'test_id': 'hiv', 'name': 'HIV Test', 'category': 'Infection', 'fee': 500, 'requires_prescription': True, 'description': 'HIV antibody detection test', 'preparation': 'Counselling required', 'duration': '24 hours'},
    {'test_id': 'hbsag', 'name': 'Hepatitis B Surface Antigen', 'category': 'Infection', 'fee': 400, 'requires_prescription': True, 'description': 'Hepatitis B infection test', 'preparation': 'No preparation needed', 'duration': '24 hours'},
    {'test_id': 'hcv', 'name': 'Hepatitis C Antibody', 'category': 'Infection', 'fee': 500, 'requires_prescription': True, 'description': 'Hepatitis C infection test', 'preparation': 'No preparation needed', 'duration': '24 hours'},
    {'test_id': 'anti_tpo', 'name': 'Anti-TPO (Thyroid Antibody)', 'category': 'Thyroid', 'fee': 800, 'requires_prescription': True, 'description': 'Autoimmune thyroid disease test', 'preparation': 'No preparation needed', 'duration': '48 hours'},
    {'test_id': 'insulin_fasting', 'name': 'Insulin Fasting', 'category': 'Hormones', 'fee': 700, 'requires_prescription': True, 'description': 'Checks insulin resistance', 'preparation': 'Fast 8 hours before test', 'duration': '48 hours'},
    {'test_id': 'vdrl', 'name': 'VDRL (Syphilis)', 'category': 'Infection', 'fee': 200, 'requires_prescription': True, 'description': 'Syphilis screening test', 'preparation': 'No preparation needed', 'duration': '24 hours'},
]

# Fast lookup: test name → requires_prescription (server-side source of truth so
# a tampered client payload can't bypass the prescription requirement).
RX_REQUIRED_TESTS = {t['name']: t['requires_prescription'] for t in AVAILABLE_TESTS}


# ─── Complaints ───────────────────────────────────────────────────────────────

class SubmitComplaintView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        from apps.doctor.models import DoctorRegistration
        from apps.hospital.models import HospitalRegistration
        from apps.vendor.models import VendorRegistration
        from apps.auth_app.models import LoginCredentials

        patient = get_patient(request)
        complaint_type = request.data.get('complaint_type')
        subject = (request.data.get('subject') or '').strip()
        description = (request.data.get('description') or '').strip()

        if complaint_type not in ('doctor', 'vendor'):
            return err('complaint_type must be "doctor" or "vendor".')
        if not subject or not description:
            return err('subject and description are required.')

        doctor_obj = hospital_obj = vendor_obj = None

        if complaint_type == 'doctor':
            doctor_id = request.data.get('doctor_id')
            hospital_id = request.data.get('hospital_id')
            if doctor_id:
                doctor_obj = DoctorRegistration.objects.filter(doctor_id=doctor_id).first()
            if hospital_id:
                hospital_obj = HospitalRegistration.objects.filter(hospital_id=hospital_id).first()
            elif doctor_obj:
                hospital_obj = doctor_obj.hospital_id
        else:
            vendor_id = request.data.get('vendor_id')
            if vendor_id:
                vendor_obj = VendorRegistration.objects.filter(vendor_id=vendor_id).first()

        complaint = Complaint.objects.create(
            patient_id=patient,
            complaint_type=complaint_type,
            subject=subject,
            description=description,
            doctor_id=doctor_obj if complaint_type == 'doctor' else None,
            vendor_id=vendor_obj if complaint_type == 'vendor' else None,
            hospital_id=hospital_obj,
        )

        if complaint_type == 'doctor' and hospital_obj:
            doctor_name = doctor_obj.full_name if doctor_obj else 'a doctor'
            send_notification(
                hospital_obj.login_id,
                'New Doctor Complaint',
                'Patient complaint about Dr. ' + doctor_name + ': ' + subject,
                notif_type='alert',
            )
        elif complaint_type == 'vendor':
            vendor_name = vendor_obj.company_name if vendor_obj else 'a vendor'
            for admin in LoginCredentials.objects.filter(role='super_admin', is_active=True):
                send_notification(
                    admin,
                    'New Vendor Complaint',
                    'Patient complaint about ' + vendor_name + ': ' + subject,
                    notif_type='alert',
                )

        log_audit(
            request.user, 'complaint_submitted', module='patient',
            entity_type='Complaint', entity_id=complaint.complaint_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok('Complaint submitted successfully', {
            'complaint_id': str(complaint.complaint_id),
            'complaint_type': complaint.complaint_type,
            'status': complaint.status,
        }, status=201)


class ListComplaintsView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        patient = get_patient(request)
        complaints = (
            Complaint.objects.filter(patient_id=patient)
            .select_related('doctor_id', 'vendor_id', 'hospital_id')
        )
        return ok('Complaints fetched', {
            'complaints': [
                {
                    'complaint_id': str(c.complaint_id),
                    'complaint_type': c.complaint_type,
                    'subject': c.subject,
                    'description': c.description,
                    'doctor_name': c.doctor_id.full_name if c.doctor_id else None,
                    'vendor_name': c.vendor_id.company_name if c.vendor_id else None,
                    'hospital_name': c.hospital_id.hospital_name if c.hospital_id else None,
                    'status': c.status,
                    'admin_response': c.admin_response,
                    'admin_replied': c.admin_replied,
                    'hospital_response': c.hospital_response,
                    'hospital_replied': c.hospital_replied,
                    'patient_followup': c.patient_followup,
                    'created_at': c.created_at.isoformat(),
                }
                for c in complaints
            ]
        })


# ─── Admin complaint management ────────────────────────────────────────────────

def _complaint_dict(c):
    return {
        'complaint_id': str(c.complaint_id),
        'complaint_type': c.complaint_type,
        'subject': c.subject,
        'description': c.description,
        'patient_name': getattr(c.patient_id, 'full_name', None) if c.patient_id else None,
        'doctor_name': c.doctor_id.full_name if c.doctor_id else None,
        'vendor_name': c.vendor_id.company_name if c.vendor_id else None,
        'hospital_name': c.hospital_id.hospital_name if c.hospital_id else None,
        'filed_by_hospital': c.filed_by_hospital.hospital_name if c.filed_by_hospital else None,
        'filed_by_hospital_id': str(c.filed_by_hospital.hospital_id) if c.filed_by_hospital else None,
        'status': c.status,
        'admin_response': c.admin_response,
        'admin_replied': c.admin_replied,
        'hospital_response': c.hospital_response,
        'hospital_replied': c.hospital_replied,
        'patient_followup': c.patient_followup,
        'created_at': c.created_at.isoformat(),
    }


class AdminListComplaintsView(APIView):
    """Super admins see every complaint; hospital admins see complaints tied to
    their own hospital."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role not in ('super_admin', 'hospital_admin'):
            return err('Not authorized!', status=403)

        from django.db.models import Q
        qs = Complaint.objects.select_related(
            'patient_id', 'doctor_id', 'vendor_id', 'hospital_id', 'filed_by_hospital'
        ).order_by('-created_at')

        if request.user.role == 'hospital_admin':
            from apps.hospital.models import HospitalRegistration
            hospital = HospitalRegistration.objects.filter(login_id=request.user).first()
            # Hospital admins see patient complaints tied to their hospital AND
            # vendor complaints they filed themselves.
            qs = qs.filter(Q(hospital_id=hospital) | Q(filed_by_hospital=hospital)) if hospital else qs.none()

        return ok('Complaints fetched', {'complaints': [_complaint_dict(c) for c in qs]})


class ReplyComplaintView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, complaint_id):
        if request.user.role not in ('super_admin', 'hospital_admin'):
            return err('Not authorized!', status=403)

        try:
            complaint = Complaint.objects.select_related(
                'patient_id', 'hospital_id', 'filed_by_hospital'
            ).get(complaint_id=complaint_id)
        except Complaint.DoesNotExist:
            return err('Complaint not found!', status=404)

        reply = (request.data.get('reply') or '').strip()
        new_status = request.data.get('status', 'reviewed')
        if new_status not in ('reviewed', 'resolved', 'dismissed'):
            new_status = 'reviewed'

        patient_login = complaint.patient_id.login_id if complaint.patient_id else None

        if request.user.role == 'super_admin':
            complaint.admin_response = reply
            complaint.admin_replied = True
            complaint.status = new_status
            complaint.save(update_fields=['admin_response', 'admin_replied', 'status'])

            # Notify the complainant (patient, or the hospital that filed it).
            if patient_login:
                send_notification(
                    patient_login, '📩 Complaint Response Received',
                    f"Your complaint '{complaint.subject}' has been reviewed by admin. Response: {reply}",
                    notif_type='alert',
                )
                try:
                    from email_utils import send_complaint_reply_email
                    send_complaint_reply_email(
                        to_email=patient_login.email, subject_text=complaint.subject,
                        status=new_status, reply=reply,
                    )
                except Exception as exc:  # noqa: BLE001
                    print(f"[complaint reply] email error: {exc}")
            if complaint.filed_by_hospital:
                send_notification(
                    complaint.filed_by_hospital.login_id, '📩 Admin Responded to Your Complaint',
                    f"Admin responded to '{complaint.subject}': {reply}",
                    notif_type='alert',
                )
            # For doctor complaints, also inform the hospital admin of the verdict.
            if complaint.complaint_type == 'doctor' and complaint.hospital_id:
                send_notification(
                    complaint.hospital_id.login_id, 'Admin Replied to Doctor Complaint',
                    f"Admin handled the complaint '{complaint.subject}'. You can no longer reply.",
                    notif_type='info',
                )
            return ok('Reply sent!', {'status': new_status})

        # hospital_admin
        if complaint.admin_replied:
            return err('Admin has already replied. Hospital cannot reply to this complaint.', status=400)

        complaint.hospital_response = reply
        complaint.hospital_replied = True
        complaint.status = 'reviewed'
        complaint.save(update_fields=['hospital_response', 'hospital_replied', 'status'])

        if patient_login:
            send_notification(
                patient_login, '📩 Hospital Responded to Your Complaint',
                f"The hospital responded to '{complaint.subject}': {reply}",
                notif_type='alert',
            )
            try:
                from email_utils import send_complaint_reply_email
                send_complaint_reply_email(
                    to_email=patient_login.email, subject_text=complaint.subject,
                    status='reviewed', reply=reply,
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[complaint reply] email error: {exc}")

        log_audit(
            request.user, 'complaint_replied', module='patient',
            entity_type='Complaint', entity_id=complaint.complaint_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Reply sent!', {'status': complaint.status})


class FollowupComplaintView(APIView):
    """Patient adds a follow-up message to one of their own complaints."""
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request, complaint_id):
        patient = get_patient(request)
        try:
            complaint = Complaint.objects.select_related('hospital_id').get(
                complaint_id=complaint_id, patient_id=patient
            )
        except Complaint.DoesNotExist:
            return err('Complaint not found!', status=404)

        followup = (request.data.get('reply') or request.data.get('followup') or '').strip()
        if not followup:
            return err('Follow-up message is required.')

        complaint.patient_followup = followup
        if complaint.status == 'resolved':
            complaint.status = 'reviewed'
        complaint.save(update_fields=['patient_followup', 'status'])

        # Notify whoever last responded so they can act on the follow-up.
        from apps.auth_app.models import LoginCredentials
        if complaint.admin_replied:
            for admin in LoginCredentials.objects.filter(role='super_admin', is_active=True):
                send_notification(
                    admin, 'Complaint Follow-up',
                    f"{patient.full_name} added a follow-up to '{complaint.subject}': {followup}",
                    notif_type='alert',
                )
        elif complaint.hospital_id:
            send_notification(
                complaint.hospital_id.login_id, 'Complaint Follow-up',
                f"{patient.full_name} added a follow-up to '{complaint.subject}': {followup}",
                notif_type='alert',
            )

        log_audit(
            request.user, 'complaint_followup', module='patient',
            entity_type='Complaint', entity_id=complaint.complaint_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Follow-up sent!', {'patient_followup': followup})


# ─── Medicine Orders ──────────────────────────────────────────────────────────

# Monthly ordering caps (per patient, per medicine, per calendar month).
MAX_STRIPS_PER_ORDER = 3
MONTHLY_STRIP_LIMIT = 10


def monthly_strip_usage(patient):
    """Strips of each medicine this patient has ordered this calendar month,
    keyed by inventory_id (string). Cancelled orders don't count."""
    from apps.pharmacy.models import MedicineOrder

    now = timezone.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    usage = {}
    qs = (
        MedicineOrder.objects
        .filter(patient_id=patient, ordered_at__gte=month_start)
        .exclude(order_status='cancelled')
    )
    for o in qs:
        for m in (o.medicines or []):
            inv = m.get('inventory_id')
            if not inv:
                continue
            qty = int(m.get('quantity', m.get('qty', 1)) or 1)
            usage[str(inv)] = usage.get(str(inv), 0) + qty
    return usage


class MonthlyMedicineUsageView(APIView):
    """Per-medicine strips this patient has ordered this month — powers the
    'X/10 this month' bar on the Order Medicine page."""
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        patient = get_patient(request)
        return ok('Monthly usage fetched', {
            'usage': monthly_strip_usage(patient),
            'limit': MONTHLY_STRIP_LIMIT,
        })


class PlaceMedicineOrderView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        from apps.pharmacy.models import (
            PharmacistRegistration, PharmacyInventory, MedicineOrder,
        )
        from payment_utils import create_razorpay_order

        patient = get_patient(request)
        fallback_pharmacy_id = request.data.get('pharmacy_id')
        medicines = request.data.get('medicines', []) or []
        delivery_address = request.data.get('delivery_address', '')
        delivery_phone = (request.data.get('delivery_phone') or '').strip()

        if not medicines:
            return err('At least one medicine is required.')

        # Per-order cap: at most 3 strips of any single medicine. Larger
        # quantities must go in a separate order (frontend mirrors this).
        for med in medicines:
            qty = int(med.get('quantity', med.get('qty', 1)) or 1)
            if qty < 1:
                return err('Minimum 1 strip required per medicine.')
            if qty > MAX_STRIPS_PER_ORDER:
                name = med.get('name') or 'this medicine'
                return err(
                    f'Maximum {MAX_STRIPS_PER_ORDER} strips of {name} per order. '
                    f'Please place a separate order for more.'
                )

        # Monthly cap: at most 10 strips of any single medicine per patient per
        # calendar month, across all their (non-cancelled) orders.
        usage = monthly_strip_usage(patient)
        new_per_inv = {}
        for med in medicines:
            inv = med.get('inventory_id')
            if not inv:
                continue
            qty = int(med.get('quantity', med.get('qty', 1)) or 1)
            new_per_inv[str(inv)] = new_per_inv.get(str(inv), 0) + qty
        for inv, new_qty in new_per_inv.items():
            used = usage.get(inv, 0)
            if used + new_qty > MONTHLY_STRIP_LIMIT:
                name = next(
                    (m.get('name') for m in medicines if str(m.get('inventory_id')) == inv),
                    'this medicine',
                )
                remaining = max(0, MONTHLY_STRIP_LIMIT - used)
                if remaining <= 0:
                    return err(
                        f'Monthly limit reached for {name}: you have already ordered '
                        f'{used} strips this month (max {MONTHLY_STRIP_LIMIT}).'
                    )
                return err(
                    f'Monthly limit exceeded for {name}: you can order only '
                    f'{remaining} more strip(s) this month.'
                )

        # ─── Group medicines by their pharmacy ───────────────────────────
        # Each medicine's pharmacy is resolved from its inventory_id so a cart
        # can mix medicines from many pharmacies. A separate order is created
        # per pharmacy. If a medicine has no inventory_id, the request-level
        # pharmacy_id is used as a fallback.
        groups = {}  # pharmacist_id -> {'pharmacy': obj, 'medicines': [...]}

        def _add(pharmacy_obj, med):
            key = str(pharmacy_obj.pharmacist_id)
            if key not in groups:
                groups[key] = {'pharmacy': pharmacy_obj, 'medicines': []}
            groups[key]['medicines'].append(med)

        fallback_pharmacy = None
        if fallback_pharmacy_id:
            fallback_pharmacy = PharmacistRegistration.objects.filter(
                pharmacist_id=fallback_pharmacy_id
            ).first()

        for med in medicines:
            inv_id = med.get('inventory_id')
            pharmacy_obj = None
            if inv_id:
                try:
                    item = PharmacyInventory.objects.select_related('pharmacy_id').get(
                        inventory_id=inv_id
                    )
                    pharmacy_obj = item.pharmacy_id
                except Exception:
                    pharmacy_obj = None
            if pharmacy_obj is None:
                pharmacy_obj = fallback_pharmacy
            if pharmacy_obj is None:
                return err('Could not determine the pharmacy for one or more medicines.')
            _add(pharmacy_obj, med)

        from apps.pharmacy.views import reserve_stock, InsufficientStock

        # ─── Phase 1: reserve stock + create the orders atomically ───────
        # select_for_update inside reserve_stock locks each inventory row, so
        # two patients racing for the last unit can't both succeed. If any
        # medicine is short, the whole transaction rolls back — no partial
        # order and no stray reservation remain.
        prepared = []  # (pharmacy_obj, group_medicines, needs_prescription, total, status, order)
        try:
            with transaction.atomic():
                for group in groups.values():
                    pharmacy_obj = group['pharmacy']
                    group_medicines = group['medicines']

                    reserve_stock(group_medicines)  # raises InsufficientStock

                    needs_prescription = check_requires_prescription(group_medicines)
                    total = sum(
                        float(m.get('price', 0)) * int(m.get('quantity', m.get('qty', 1)))
                        for m in group_medicines
                    )

                    # Rx-required orders wait for upload + pharmacist approval
                    # before payment unlocks. Others can be paid immediately.
                    needs_prescription_bool = bool(needs_prescription)
                    initial_status = 'awaiting_prescription' if needs_prescription_bool else 'payment_pending'

                    # Stock is reserved now. Non-Rx orders get a 10-minute payment
                    # deadline (auto-released by release_expired_reservations);
                    # Rx orders are exempt (no expiry) since they await approval.
                    reserved_at = timezone.now()
                    reservation_expires_at = (
                        None if needs_prescription_bool
                        else reserved_at + timedelta(minutes=10)
                    )

                    order = MedicineOrder.objects.create(
                        patient_id=patient,
                        pharmacist_id=pharmacy_obj,
                        medicines=group_medicines,
                        total_amount=total,
                        requires_prescription=needs_prescription_bool,
                        payment_enabled=not needs_prescription_bool,
                        delivery_address=delivery_address,
                        delivery_phone=delivery_phone,
                        order_status=initial_status,
                        stock_reserved=True,
                        reserved_at=reserved_at,
                        reservation_expires_at=reservation_expires_at,
                        status_history=[{
                            'status': initial_status,
                            'timestamp': str(reserved_at),
                            'note': 'Order placed by patient',
                        }],
                    )
                    prepared.append(
                        (pharmacy_obj, group_medicines, needs_prescription, total, initial_status, order)
                    )
        except InsufficientStock as exc:
            return err(str(exc), status=400)

        # ─── Phase 2: payment links + notifications (outside the row lock) ─
        created_orders = []
        for pharmacy_obj, group_medicines, needs_prescription, total, initial_status, order in prepared:
            razorpay_data = {}
            if not needs_prescription:
                razorpay_data = create_razorpay_order(
                    amount=float(total), receipt=str(order.med_order_id)
                )
                if razorpay_data.get('success'):
                    order.razorpay_order_id = razorpay_data['order_id']
                    order.save(update_fields=['razorpay_order_id'])

            print(f"[MedicineOrder] pharmacy={pharmacy_obj.pharmacy_name} "
                  f"needs_prescription={needs_prescription} "
                  f"medicines={[m.get('name') for m in group_medicines]}")

            prescription_note = (' Prescription required!' if needs_prescription
                                 else ' Payment pending.')
            send_notification(
                pharmacy_obj.login_id,
                'New Medicine Order!',
                'New order from ' + patient.full_name + '. Amount: Rs.'
                + str(total) + prescription_note,
                notif_type='order',
            )
            broadcast_medicine_update(
                str(pharmacy_obj.login_id.login_id),
                'new_order',
                {
                    'order_id': str(order.med_order_id),
                    'patient_name': patient.full_name,
                    'medicines_count': len(group_medicines),
                    'total': float(total),
                    'requires_prescription': needs_prescription,
                    'message': f'New order from {patient.full_name}!',
                },
            )
            log_audit(
                request.user, 'medicine_order_placed', module='patient',
                entity_type='MedicineOrder', entity_id=order.med_order_id,
                ip_address=request.META.get('REMOTE_ADDR'),
            )

            # ─── Order-confirmation emails (patient + pharmacist) ─────────
            try:
                from email_utils import (
                    send_medicine_order_email,
                    send_pharmacist_order_email,
                )
                patient_email = getattr(patient.login_id, 'email', None)
                pharmacist_email = getattr(pharmacy_obj.login_id, 'email', None)

                if patient_email:
                    send_medicine_order_email(
                        to_email=patient_email,
                        patient_name=patient.full_name,
                        medicines=group_medicines,
                        pharmacy_name=pharmacy_obj.pharmacy_name,
                        total_amount=total,
                        order_id=order.med_order_id,
                    )
                if pharmacist_email:
                    send_pharmacist_order_email(
                        to_email=pharmacist_email,
                        patient_name=patient.full_name,
                        medicines=group_medicines,
                        pharmacy_name=pharmacy_obj.pharmacy_name,
                        total_amount=total,
                        order_id=order.med_order_id,
                    )
                print(f"[ORDER] Confirmation emails sent for order {order.med_order_id}")
            except Exception as e:
                print(f"[ORDER] Email error: {e}")

            created_orders.append({
                'order_id': str(order.med_order_id),
                'pharmacy_id': str(pharmacy_obj.pharmacist_id),
                'pharmacy_name': pharmacy_obj.pharmacy_name,
                'requires_prescription': needs_prescription,
                'payment_enabled': not needs_prescription,
                'status': initial_status,
                'total_amount': float(total),
                'razorpay_order_id': razorpay_data.get('order_id', ''),
                'amount': razorpay_data.get('amount', 0),
                'key_id': razorpay_data.get('key_id', ''),
            })

        any_rx = any(o['requires_prescription'] for o in created_orders)
        first = created_orders[0]
        return ok('Medicine order placed', {
            # `orders` is the full per-pharmacy list; the top-level fields
            # mirror the first order for backward compatibility.
            'orders': created_orders,
            'order_count': len(created_orders),
            'any_requires_prescription': any_rx,
            'order_id': first['order_id'],
            'requires_prescription': first['requires_prescription'],
            'payment_enabled': first['payment_enabled'],
            'status': first['status'],
            'total_amount': first['total_amount'],
            'razorpay_order_id': first['razorpay_order_id'],
            'amount': first['amount'],
            'key_id': first['key_id'],
        }, status=201)


class UploadPrescriptionView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        from apps.pharmacy.models import MedicineOrder

        patient = get_patient(request)
        order_id = request.data.get('order_id')
        prescription_file = request.FILES.get('prescription')

        if not prescription_file:
            return err('prescription file is required.')

        # Only JPG, PNG and PDF prescriptions are accepted.
        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
        if prescription_file.content_type not in allowed_types:
            return err('Only JPG, PNG or PDF files are allowed.')

        try:
            order = MedicineOrder.objects.get(med_order_id=order_id, patient_id=patient)
        except MedicineOrder.DoesNotExist:
            return err('Order not found.', status=404)

        # Save the prescription file to local media storage.
        import os
        import uuid
        from django.conf import settings

        file_ext = prescription_file.name.rsplit('.', 1)[-1].lower()
        filename = f'rx_{uuid.uuid4().hex[:8]}.{file_ext}'
        save_dir = os.path.join(settings.MEDIA_ROOT, 'prescriptions')
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, filename)

        with open(save_path, 'wb+') as dest:
            for chunk in prescription_file.chunks():
                dest.write(chunk)

        local_url = f'{settings.MEDIA_URL}prescriptions/{filename}'

        order.prescription_local_url = local_url
        order.prescription_url = local_url
        order.order_status = 'prescription_uploaded'
        _push_history(order, 'prescription_uploaded', 'Prescription uploaded by patient')
        order.save(update_fields=[
            'prescription_local_url', 'prescription_url',
            'order_status', 'status_history', 'updated_at',
        ])

        if order.pharmacist_id:
            send_notification(
                order.pharmacist_id.login_id,
                'Prescription Uploaded',
                f'Patient {patient.full_name} uploaded a prescription. Please verify.',
                notif_type='order',
            )
            broadcast_medicine_update(
                str(order.pharmacist_id.login_id.login_id),
                'prescription_uploaded',
                {
                    'order_id': str(order.med_order_id),
                    'patient_name': patient.full_name,
                    'message': 'Prescription uploaded! Please verify.',
                },
            )

        return ok('Prescription uploaded', {
            'order_id': str(order.med_order_id),
            'prescription_url': local_url,
            'status': order.order_status,
        })


class ListMedicineOrdersView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from apps.pharmacy.models import MedicineOrder
        from apps.pharmacy.views import release_expired_reservations
        from django.conf import settings

        # Sweep lapsed reservations first so this list reflects auto-cancellations.
        release_expired_reservations()

        patient = get_patient(request)
        orders = (
            MedicineOrder.objects.filter(patient_id=patient)
            .select_related('pharmacist_id')
        )
        return ok('Medicine orders fetched', {
            'orders': [
                {
                    'order_id': str(o.med_order_id),
                    'pharmacy_name': o.pharmacist_id.pharmacy_name if o.pharmacist_id else None,
                    'medicines': o.medicines,
                    'medicines_count': len(o.medicines),
                    'total_amount': float(o.total_amount),
                    'status': o.order_status,
                    'payment_status': o.payment_status,
                    'payment_enabled': o.payment_enabled,
                    'requires_prescription': o.requires_prescription,
                    'prescription_url': o.prescription_url,
                    'prescription_local_url': o.prescription_local_url,
                    'prescription_verified': o.prescription_verified,
                    'prescription_rejection_reason': o.prescription_rejection_reason,
                    'razorpay_order_id': o.razorpay_order_id,
                    'razorpay_key_id': settings.RAZORPAY_KEY_ID,
                    'razorpay_amount': int(round(float(o.total_amount) * 100)),
                    'delivery_address': o.delivery_address,
                    'delivery_phone': o.delivery_phone,
                    'estimated_delivery_days': o.estimated_delivery_days,
                    'dispatched_at': o.dispatched_at.isoformat() if o.dispatched_at else None,
                    'delivered_at': o.delivered_at.isoformat() if o.delivered_at else None,
                    'otp_verified': o.otp_verified,
                    'status_history': o.status_history,
                    'stock_reserved': o.stock_reserved,
                    'reserved_at': o.reserved_at.isoformat() if o.reserved_at else None,
                    'reservation_expires_at': (
                        o.reservation_expires_at.isoformat() if o.reservation_expires_at else None
                    ),
                    'ordered_at': o.ordered_at.isoformat(),
                }
                for o in orders
            ]
        })


class ConfirmMedicineDeliveryView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        from apps.pharmacy.models import MedicineOrder

        patient = get_patient(request)
        order_id = request.data.get('order_id')
        entered_otp = str(request.data.get('otp', '')).strip()

        try:
            order = MedicineOrder.objects.select_related('pharmacist_id').get(
                med_order_id=order_id, patient_id=patient
            )
        except MedicineOrder.DoesNotExist:
            return err('Order not found.', status=404)

        if order.order_status == 'delivered':
            return err('Order already marked delivered.')
        if not order.delivery_otp:
            return err('This order has not been dispatched yet.')
        if order.otp_expiry and timezone.now() > order.otp_expiry:
            return err('OTP expired! Please request a new OTP from the pharmacy.')
        if entered_otp != order.delivery_otp:
            return err('Invalid OTP!')

        order.order_status = 'delivered'
        order.otp_verified = True
        order.delivered_at = timezone.now()
        _push_history(order, 'delivered', 'Delivery confirmed by patient')
        order.save(update_fields=[
            'order_status', 'otp_verified', 'delivered_at', 'status_history', 'updated_at',
        ])

        # Note: inventory stock is decremented at payment confirmation
        # (pharmacy.VerifyPaymentView), not here, to avoid double-counting.

        try:
            send_delivery_confirmed_email(
                to_email=request.user.email,
                hospital_name=patient.full_name,
                product_name='Medicine Order',
                quantity=len(order.medicines),
                vendor_name=order.pharmacist_id.pharmacy_name if order.pharmacist_id else 'Pharmacy',
            )
        except Exception:
            pass

        send_notification(
            request.user, 'Delivery Confirmed',
            'Your medicine order has been delivered successfully.',
            notif_type='order',
        )
        if order.pharmacist_id:
            send_notification(
                order.pharmacist_id.login_id, 'Medicine Order Delivered',
                patient.full_name + ' confirmed delivery of their medicine order.',
                notif_type='order',
            )

        return ok('Delivery confirmed', {
            'order_id': str(order.med_order_id),
            'status': order.order_status,
        })


# ─── Lab Tests ────────────────────────────────────────────────────────────────

class BookLabTestView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]
    # Accept multipart (when a prescription image is attached) as well as JSON.
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        import json
        from apps.hospital.models import HospitalRegistration
        from apps.lab.models import LabTechRegistration, LabOrder
        from payment_utils import create_razorpay_order

        patient = get_patient(request)
        hospital_id = request.data.get('hospital_id')
        tests = request.data.get('tests', []) or []
        # When sent as multipart, `tests` arrives as a JSON string.
        if isinstance(tests, str):
            try:
                tests = json.loads(tests)
            except (ValueError, TypeError):
                tests = []
        appointment_date = request.data.get('date')
        appointment_time = request.data.get('time')
        slot_id = request.data.get('slot_id')
        prescription_file = request.FILES.get('prescription_image')

        if not tests:
            return err('At least one test is required.')

        # ─── Prescription gating (Option C — hybrid) ────────────────────────
        # Use the server-side catalog as source of truth, not the client flag.
        rx_test_names = [
            t.get('name') for t in tests
            if RX_REQUIRED_TESTS.get(t.get('name'), False)
        ]
        prescription_required = len(rx_test_names) > 0
        prescription_status = 'not_required'

        if prescription_required:
            # Auto-unlock if a doctor has referred ALL the Rx tests for this patient.
            referred_names = set()
            for o in LabOrder.objects.filter(
                patient_id=patient, status__in=['pending', 'confirmed', 'processing'],
            ):
                for t in (o.tests_ordered or []):
                    referred_names.add(t.get('name') if isinstance(t, dict) else t)

            if all(name in referred_names for name in rx_test_names):
                prescription_status = 'doctor_referred'
            elif prescription_file:
                prescription_status = 'pending'
            else:
                return err(
                    'One or more selected tests require a doctor prescription or '
                    'referral. Please upload a prescription to continue.',
                    status=400,
                )

        hospital_obj = HospitalRegistration.objects.filter(hospital_id=hospital_id).first()
        if not hospital_obj:
            return err('Hospital not found.', status=404)

        # Reject past dates, and past times (with a 30-minute buffer) when today.
        if appointment_date:
            from datetime import datetime, timedelta
            today = timezone.localdate()
            try:
                selected_date = datetime.strptime(appointment_date, '%Y-%m-%d').date()
            except ValueError:
                return err('Invalid appointment date.', status=400)

            if selected_date < today:
                return err('Cannot book appointments for past dates!', status=400)

            if selected_date == today and appointment_time:
                current_time = timezone.localtime(timezone.now()).time()
                try:
                    selected_time = datetime.strptime(appointment_time, '%H:%M').time()
                except ValueError:
                    return err('Invalid appointment time.', status=400)
                buffer_time = (
                    datetime.combine(today, current_time) + timedelta(minutes=30)
                ).time()
                if selected_time <= buffer_time:
                    return err(
                        'Cannot book this time slot! Please book at least 30 minutes from now. '
                        f'Current time: {current_time.strftime("%I:%M %p")}',
                        status=400,
                    )

        # Legacy slot-conflict check (one booking per hospital/date/time) only
        # applies to the old fixed-time flow. With capacity-managed LabSlots the
        # reservation below enforces availability instead.
        if not slot_id and appointment_date and appointment_time:
            existing_booking = LabTestOrder.objects.filter(
                hospital_id=hospital_obj,
                appointment_date=appointment_date,
                appointment_time=appointment_time,
                status__in=['pending', 'confirmed', 'processing'],
            ).exists()
            if existing_booking:
                from datetime import datetime, timedelta
                try:
                    slot_dt = datetime.strptime(appointment_time, '%H:%M')
                    next_time = (slot_dt + timedelta(hours=1)).strftime('%H:%M')
                    msg = (f'This time slot is already booked! Next available slot is at '
                           f'{next_time}. Please select a different time.')
                except ValueError:
                    msg = 'This time slot is already booked! Please select a different time.'
                return err(msg, status=400)

        total_fee = sum(float(t.get('fee', 0)) for t in tests)

        # Persist the uploaded prescription image to local media (same pattern
        # as the medicine-order prescription upload).
        prescription_url = ''
        if prescription_file:
            import os
            import uuid
            from django.conf import settings
            file_ext = prescription_file.name.rsplit('.', 1)[-1].lower()
            filename = f'lab_rx_{uuid.uuid4().hex[:8]}.{file_ext}'
            save_dir = os.path.join(settings.MEDIA_ROOT, 'lab_prescriptions')
            os.makedirs(save_dir, exist_ok=True)
            with open(os.path.join(save_dir, filename), 'wb+') as dest:
                for chunk in prescription_file.chunks():
                    dest.write(chunk)
            prescription_url = f'{settings.MEDIA_URL}lab_prescriptions/{filename}'

        # Tests awaiting prescription verification do NOT pay yet — payment is
        # unlocked only after the lab verifies (see VerifyPrescriptionView).
        defer_payment = (prescription_status == 'pending')

        order_kwargs = dict(
            patient_id=patient,
            hospital_id=hospital_obj,
            tests=tests,
            total_fee=total_fee,
            appointment_date=appointment_date or None,
            appointment_time=appointment_time or None,
            status=('pending_verification' if defer_payment else 'pending'),
            payment_status='pending',
            prescription_required=prescription_required,
            prescription_status=prescription_status,
            prescription_verified=(prescription_status == 'doctor_referred'),
            prescription_image=prescription_url,
        )

        # Active bookings (anything not finished/cancelled) count as "already booked".
        active_statuses = ['pending', 'confirmed', 'processing', 'pending_verification']
        same_day_warning = None

        if slot_id:
            # Reserve the chosen capacity slot atomically so two patients can't
            # both grab the last seat.
            from apps.lab.models import LabSlot
            try:
                with transaction.atomic():
                    slot = LabSlot.objects.select_for_update().get(slot_id=slot_id)
                    # Reject past slots — the frontend sends slot_id (not a raw
                    # time), so resolve the slot's real date/time and validate it.
                    now_local = timezone.localtime(timezone.now())
                    if slot.slot_date < now_local.date():
                        return err('Cannot book a past date slot!', status=400)
                    if slot.slot_date == now_local.date() and slot.start_time <= now_local.time():
                        return err(
                            f'This slot ({slot.start_time.strftime("%I:%M %p").lstrip("0")}) '
                            'has already passed! Please select a future slot.',
                            status=400,
                        )

                    # CHECK 1 — this patient already booked THIS exact slot.
                    if LabTestOrder.objects.filter(
                        patient_id=patient, slot_id=slot, status__in=active_statuses,
                    ).exists():
                        return err(
                            f'You already have a lab test booked at '
                            f'{slot.start_time.strftime("%I:%M %p").lstrip("0")} on '
                            f'{slot.slot_date.strftime("%d %b %Y")}! '
                            'Please select a different time slot.',
                            status=400,
                        )

                    # CHECK 2/3 — look at this patient's OTHER active bookings on the
                    # same date: block re-booking the same test, else build a warning.
                    new_names = {
                        (t.get('name') or '').strip().lower()
                        for t in tests if isinstance(t, dict) and t.get('name')
                    }
                    same_day = LabTestOrder.objects.filter(
                        patient_id=patient, appointment_date=slot.slot_date,
                        status__in=active_statuses,
                    )
                    existing_summ = []
                    for o in same_day:
                        o_names = [
                            (t.get('name') if isinstance(t, dict) else str(t))
                            for t in (o.tests or [])
                        ]
                        # CHECK 3 — same test, same day → block.
                        if any((n or '').strip().lower() in new_names for n in o_names):
                            dup = next(n for n in o_names if (n or '').strip().lower() in new_names)
                            return err(
                                f'You have already booked "{dup}" for this date! '
                                'You cannot book the same test twice on the same day.',
                                status=400,
                            )
                        when = (o.appointment_time.strftime('%I:%M %p').lstrip('0')
                                if o.appointment_time else '')
                        label = ', '.join(n for n in o_names if n) or 'Lab Test'
                        existing_summ.append(f'{label}{(" at " + when) if when else ""}')
                    if existing_summ:
                        same_day_warning = (
                            f'Note: you also have {len(existing_summ)} other booking(s) '
                            f'on this date: ' + '; '.join(existing_summ)
                        )

                    if not slot.is_available:
                        return err(
                            'This slot is no longer available! Please select another slot.',
                            status=400,
                        )
                    order_kwargs['slot_id'] = slot
                    order_kwargs['appointment_date'] = slot.slot_date
                    order_kwargs['appointment_time'] = slot.start_time
                    lab_order = LabTestOrder.objects.create(**order_kwargs)
                    slot.booked_count += 1
                    slot.save(update_fields=['booked_count'])
            except LabSlot.DoesNotExist:
                return err('Slot not found!', status=404)
        else:
            lab_order = LabTestOrder.objects.create(**order_kwargs)

        log_audit(
            request.user, 'lab_test_booked', module='patient',
            entity_type='LabTestOrder', entity_id=lab_order.order_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        # ─── Path A: awaiting prescription verification — no payment yet ─────
        if defer_payment:
            for tech in LabTechRegistration.objects.filter(
                hospital_id=hospital_obj, approval_status='approved'
            ):
                send_notification(
                    tech.login_id, 'Lab Prescription to Verify',
                    f'{patient.full_name} submitted a prescription for '
                    f'{len(tests)} test(s). Please verify.',
                    notif_type='order',
                )
            return ok(
                'Prescription submitted! You will be notified to pay once verified.',
                {
                    'order_id': str(lab_order.order_id),
                    'requires_payment': False,
                    'prescription_pending': True,
                    'prescription_status': prescription_status,
                    'warning': same_day_warning,
                },
                status=201,
            )

        # ─── Path B: direct / doctor-referred — pay immediately ─────────────
        razorpay_data = create_razorpay_order(
            amount=float(total_fee), receipt=str(lab_order.order_id)
        )
        if razorpay_data.get('success'):
            lab_order.razorpay_order_id = razorpay_data['order_id']
            lab_order.save(update_fields=['razorpay_order_id'])

        for tech in LabTechRegistration.objects.filter(
            hospital_id=hospital_obj, approval_status='approved'
        ):
            send_notification(
                tech.login_id, 'New Lab Test Booking',
                patient.full_name + ' booked ' + str(len(tests))
                + ' test(s). Amount: Rs.' + str(total_fee),
                notif_type='order',
            )

        return ok('Lab test booked', {
            'order_id': str(lab_order.order_id),
            'total_fee': float(total_fee),
            'appointment_date': appointment_date,
            'appointment_time': appointment_time,
            'prescription_required': prescription_required,
            'prescription_status': prescription_status,
            'requires_payment': True,
            'razorpay_order_id': razorpay_data.get('order_id'),
            'amount': razorpay_data.get('amount'),
            'key_id': razorpay_data.get('key_id'),
            'warning': same_day_warning,
        }, status=201)


class ListLabOrdersView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from django.conf import settings

        patient = get_patient(request)
        orders = LabTestOrder.objects.filter(patient_id=patient).select_related('hospital_id')
        return ok('Lab orders fetched', {
            'orders': [
                {
                    'order_id': str(o.order_id),
                    'hospital_name': o.hospital_id.hospital_name if o.hospital_id else None,
                    'tests': o.tests,
                    'total_fee': float(o.total_fee),
                    'slot_id': str(o.slot_id_id) if o.slot_id_id else None,
                    'appointment_date': o.appointment_date.isoformat() if o.appointment_date else None,
                    'appointment_time': str(o.appointment_time) if o.appointment_time else None,
                    'status': o.status,
                    'no_show_marked_by': o.no_show_marked_by or None,
                    'no_show_at': o.no_show_at.isoformat() if o.no_show_at else None,
                    'payment_status': o.payment_status,
                    'prescription_required': o.prescription_required,
                    'prescription_status': o.prescription_status,
                    'prescription_verified': o.prescription_verified,
                    'prescription_image': o.prescription_image,
                    # Razorpay fields so the patient can pay a verified Rx order.
                    'razorpay_order_id': o.razorpay_order_id,
                    'razorpay_amount': int(round(float(o.total_fee) * 100)),
                    'razorpay_key_id': settings.RAZORPAY_KEY_ID,
                    'report_url': o.report_url,
                    'report_results': o.report_results,
                    'abnormal_flags': o.abnormal_flags,
                    'notes': o.notes,
                    'ordered_at': o.ordered_at.isoformat(),
                }
                for o in orders
            ]
        })


class GetLabTestCatalogView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        categories = {}
        for t in AVAILABLE_TESTS:
            categories.setdefault(t.get('category', 'General'), []).append(t)
        return ok('Lab test catalog fetched', {
            'tests': AVAILABLE_TESTS,
            'categories': categories,
        })


class UploadLabPrescriptionView(APIView):
    """Attach / replace a prescription image on an existing lab-test order
    (e.g. the patient booked first and uploads the prescription afterwards)."""
    permission_classes = [IsAuthenticated, IsPatient]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        import os
        import uuid
        from django.conf import settings

        patient = get_patient(request)
        order_id = request.data.get('order_id')
        prescription_file = request.FILES.get('prescription_image')

        if not prescription_file:
            return err('prescription_image file is required.')

        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
        if prescription_file.content_type not in allowed_types:
            return err('Only JPG, PNG or PDF files are allowed.')

        try:
            order = LabTestOrder.objects.get(order_id=order_id, patient_id=patient)
        except LabTestOrder.DoesNotExist:
            return err('Order not found.', status=404)

        file_ext = prescription_file.name.rsplit('.', 1)[-1].lower()
        filename = f'lab_rx_{uuid.uuid4().hex[:8]}.{file_ext}'
        save_dir = os.path.join(settings.MEDIA_ROOT, 'lab_prescriptions')
        os.makedirs(save_dir, exist_ok=True)
        with open(os.path.join(save_dir, filename), 'wb+') as dest:
            for chunk in prescription_file.chunks():
                dest.write(chunk)

        order.prescription_image = f'{settings.MEDIA_URL}lab_prescriptions/{filename}'
        order.prescription_required = True
        order.prescription_verified = False
        order.prescription_status = 'pending'
        order.save(update_fields=[
            'prescription_image', 'prescription_required',
            'prescription_verified', 'prescription_status',
        ])

        from apps.lab.models import LabTechRegistration
        for tech in LabTechRegistration.objects.filter(
            hospital_id=order.hospital_id, approval_status='approved',
        ):
            send_notification(
                tech.login_id, 'Lab Prescription Uploaded',
                f'{patient.full_name} uploaded a prescription for verification.',
                notif_type='order',
            )

        return ok('Prescription uploaded', {
            'order_id': str(order.order_id),
            'prescription_image': order.prescription_image,
            'prescription_status': order.prescription_status,
        })


class BookedLabSlotsView(APIView):
    """Return already-booked time slots for a hospital on a given date so the
    booking UI can disable them."""
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        hospital_id = request.GET.get('hospital_id')
        date = request.GET.get('date')

        if not hospital_id or not date:
            return ok('Booked slots fetched', {'booked_slots': []})

        booked = LabTestOrder.objects.filter(
            hospital_id=hospital_id,
            appointment_date=date,
            status__in=['pending', 'confirmed', 'processing'],
        ).values_list('appointment_time', flat=True)

        # Normalise to 'HH:MM' strings to match the UI slot list.
        slots = []
        for t in booked:
            if t is None:
                continue
            slots.append(t.strftime('%H:%M') if hasattr(t, 'strftime') else str(t)[:5])

        return ok('Booked slots fetched', {'booked_slots': slots})


# ─── QR Code Info (public — no auth) ──────────────────────────────────────────

class QRCodeView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token):
        try:
            consent = EHRConsentLog.objects.select_related('patient_id').get(consent_id=token)
        except Exception:
            return err('Invalid QR code', status=404)

        if consent.expires_at and timezone.now() > consent.expires_at:
            return Response({
                'success': False,
                'message': 'QR code expired! Patient needs to generate a new one.',
                'expired': True,
            }, status=400)

        patient = consent.patient_id

        risk = (
            RiskAssessment.objects.filter(patient_id=patient)
            .order_by('-assessed_at').first()
        )
        active_prescriptions = EHRRecord.objects.filter(
            patient_id=patient, record_type='prescription'
        ).order_by('-recorded_at')[:3]
        allergies = list(
            patient.allergies.values_list('allergen', flat=True)
        ) + list(
            EHRRecord.objects.filter(patient_id=patient, record_type='allergy')
            .values_list('title', flat=True)
        )

        return ok('QR info fetched', {
            'patient_name': patient.full_name,
            'age': calculate_age(patient.dob),
            'gender': patient.gender,
            'blood_group': patient.blood_group,
            'emergency_contact': patient.emergency_contact,
            'allergies': allergies,
            'risk_level': risk.risk_level if risk else 'unknown',
            'diabetes_risk': float(risk.diabetes_risk) if risk and risk.diabetes_risk else 0,
            'heart_risk': float(risk.heart_risk) if risk and risk.heart_risk else 0,
            'recent_prescriptions': [
                {'title': r.title, 'date': str(r.recorded_at.date())}
                for r in active_prescriptions
            ],
            'qr_generated_at': str(consent.accessed_at),
            'expires_at': str(consent.expires_at),
            'valid': True,
        })


# ─── Emergency History ────────────────────────────────────────────────────────

class EmergencyHistoryView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from apps.emergency.models import EmergencyRequest

        patient = get_patient(request)
        emergencies = (
            EmergencyRequest.objects.filter(patient_id=patient)
            .select_related('assigned_hospital_id')
            .order_by('-created_at')
        )

        result = []
        for e in emergencies:
            dispatch = e.dispatches.select_related('ambulance_id__driver_id').first()
            driver = dispatch.ambulance_id.driver_id if dispatch and dispatch.ambulance_id else None
            result.append({
                'emergency_id': str(e.emergency_id),
                'severity': e.severity,
                'status': e.status,
                'hospital_name': (
                    e.assigned_hospital_id.hospital_name if e.assigned_hospital_id
                    else (dispatch.ambulance_id.hospital_id.hospital_name
                          if dispatch and dispatch.ambulance_id and dispatch.ambulance_id.hospital_id
                          else None)
                ),
                'driver_name': driver.full_name if driver else None,
                'created_at': e.created_at.isoformat(),
                'updated_at': e.updated_at.isoformat(),
                'patient_location': {
                    'lat': float(e.patient_lat),
                    'lng': float(e.patient_lng),
                },
            })

        return ok('Emergency history fetched', {'emergencies': result})


# ─── EHR Images ───────────────────────────────────────────────────────────────

class UploadEHRImageView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        patient = get_patient(request)
        image_file = request.FILES.get('image')
        image_type = request.data.get('image_type', 'other')
        title = (request.data.get('title') or '').strip()
        description = request.data.get('description', '')
        hospital_name = request.data.get('hospital_name', '')
        scan_date = request.data.get('scan_date') or None

        if not image_file:
            return err('image file is required.')
        if not title:
            return err('title is required.')

        try:
            from utils import save_upload_locally
            image_url = save_upload_locally(image_file, subdir='ehr_images', request=request, prefix='ehr')
        except Exception as e:
            return err('Image upload failed: ' + str(e), status=502)

        ehr_image = EHRImage.objects.create(
            patient_id=patient,
            image_type=image_type,
            image_url=image_url,
            title=title,
            description=description,
            hospital_name=hospital_name,
            scan_date=scan_date,
            uploaded_by=request.user,
        )

        EHRRecord.objects.create(
            patient_id=patient,
            added_by=request.user,
            record_type='lab',
            title=title,
            content=description,
            file_url=image_url,
        )

        log_audit(
            request.user, 'ehr_image_uploaded', module='patient',
            entity_type='EHRImage', entity_id=ehr_image.image_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok('EHR image uploaded', {
            'image_id': str(ehr_image.image_id),
            'image_url': image_url,
            'image_type': ehr_image.image_type,
            'title': ehr_image.title,
        }, status=201)


class ListEHRImagesView(APIView):
    """EHR images for the owning patient, or for a doctor holding active QR consent.

    Patients see their own images grouped by type. A doctor passes
    ?patient_id=<uuid>; access is allowed only while a valid (unexpired)
    EHRConsentLog exists for that doctor — this powers the in-consultation
    EHR panel so X-rays can be analysed without the patient downloading them.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import PatientRegistration

        role = getattr(request.user, 'role', None)

        if role == 'patient':
            patient = get_patient(request)
        elif role == 'doctor':
            patient_id = request.GET.get('patient_id')
            if not patient_id:
                return err('patient_id is required.', status=400)
            try:
                patient = PatientRegistration.objects.get(patient_id=patient_id)
            except (PatientRegistration.DoesNotExist, ValueError):
                return err('Patient not found.', status=404)

            has_consent = EHRConsentLog.objects.filter(
                patient_id=patient,
                accessed_by=request.user,
                consent_given=True,
                expires_at__gt=timezone.now(),
            ).exists()
            if not has_consent:
                return err(
                    'Access denied. Patient has not granted EHR consent.',
                    status=403,
                )
        else:
            return err('Not authorized.', status=403)

        images = EHRImage.objects.filter(patient_id=patient)

        # Optional type filter (?type= or ?image_type=) — used by the lab-report
        # views to pull just one category.
        type_filter = request.GET.get('type') or request.GET.get('image_type')
        if type_filter:
            images = images.filter(image_type=type_filter)

        grouped = {'xray': [], 'mri': [], 'skin': [], 'ct_scan': [], 'ultrasound': [], 'lab_report': [], 'other': []}
        flat = []
        for img in images:
            entry = {
                'image_id': str(img.image_id),
                'image_type': img.image_type,
                'image_url': img.image_url,
                'title': img.title,
                'description': img.description,
                'hospital_name': img.hospital_name,
                'scan_date': img.scan_date.isoformat() if img.scan_date else None,
                'uploaded_at': img.uploaded_at.isoformat(),
            }
            grouped.setdefault(img.image_type, []).append(entry)
            flat.append(entry)

        return ok('EHR images fetched', {
            'images_by_type': grouped,
            'images': flat,
            'total': images.count(),
        })


# ─── Directory lookups (pharmacies / hospitals / vendors) ─────────────────────

class PharmacyListView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from apps.pharmacy.models import PharmacistRegistration
        qs = PharmacistRegistration.objects.filter(approval_status='approved')
        return ok('Pharmacies fetched', {
            'pharmacies': [
                {
                    'pharmacy_id': str(p.pharmacist_id),
                    'pharmacy_name': p.pharmacy_name,
                    'full_name': p.full_name,
                    'address': p.address,
                }
                for p in qs
            ]
        })


class HospitalListView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from datetime import date as _date, timedelta as _td
        from apps.hospital.models import HospitalRegistration
        from apps.lab.models import LabTechRegistration, HospitalLabConfig, LabSlot
        qs = HospitalRegistration.objects.filter(approval_status='approved')
        tomorrow = _date.today() + _td(days=1)
        result = []
        for h in qs:
            lab_count = LabTechRegistration.objects.filter(
                hospital_id=h, approval_status='approved'
            ).count()
            # A hospital can only be booked for lab tests once its admin has set
            # up a lab schedule (an active HospitalLabConfig).
            lab_configured = HospitalLabConfig.objects.filter(
                hospital_id=h, is_active=True
            ).exists()
            has_slots = bool(lab_configured) and LabSlot.objects.filter(
                hospital_id=h, slot_date__gte=tomorrow, is_blocked=False,
            ).exists()
            result.append({
                'hospital_id': str(h.hospital_id),
                'hospital_name': h.hospital_name,
                'city': h.city,
                'address': h.address,
                'lab_techs_available': lab_count,
                'lab_configured': lab_configured,
                'has_available_slots': has_slots,
                # Selectable when configured; the slot picker handles per-date availability.
                'lab_available': lab_configured,
            })
        return ok('Hospitals fetched', {'hospitals': result})


class VendorListView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        from apps.vendor.models import VendorRegistration
        qs = VendorRegistration.objects.filter(approval_status='approved')
        return ok('Vendors fetched', {
            'vendors': [
                {
                    'vendor_id': str(v.vendor_id),
                    'company_name': v.company_name,
                    'contact_name': v.contact_name,
                }
                for v in qs
            ]
        })
