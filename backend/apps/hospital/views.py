import csv
import io
import os
import pickle
import random
import string

from decimal import Decimal
from datetime import date, datetime
from uuid import UUID

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db.models import F, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser

from apps.auth_app.models import LoginCredentials
from apps.auth_app.permissions import IsHospitalAdmin
from .models import (
    HospitalRegistration, Department, Bed, HospitalInventory, HospitalPatient,
    EquipmentStockMovement,
)
from .serializers import (
    AddDoctorSerializer,
    AddLabTechSerializer,
    AddDriverSerializer,
)
from utils import log_audit, send_notification


# ─── FL / Demo constants ──────────────────────────────────────────────────────

VALID_DISEASES = [
    'Fungal infection', 'Allergy', 'GERD', 'Chronic cholestasis', 'Drug Reaction',
    'Peptic ulcer disease', 'AIDS', 'Diabetes', 'Gastroenteritis', 'Bronchial Asthma',
    'Hypertension', 'Migraine', 'Cervical spondylosis', 'Paralysis (brain hemorrhage)',
    'Jaundice', 'Malaria', 'Chicken pox', 'Dengue', 'Typhoid', 'hepatitis A',
    'Hepatitis B', 'Hepatitis C', 'Hepatitis D', 'Hepatitis E', 'Alcoholic hepatitis',
    'Tuberculosis', 'Common Cold', 'Pneumonia', 'Dimorphic hemmorhoids(piles)',
    'Heart attack', 'Varicose veins', 'Hypothyroidism', 'Hyperthyroidism',
    'Hypoglycemia', 'Osteoarthristis', 'Arthritis',
    '(vertigo) Paroymsal Positional Vertigo', 'Acne', 'Urinary tract infection',
    'Psoriasis', 'Impetigo',
]

VALID_SYMPTOMS = [
    'itching', 'skin_rash', 'nodal_skin_eruptions', 'continuous_sneezing', 'shivering',
    'chills', 'joint_pain', 'stomach_pain', 'acidity', 'ulcers_on_tongue',
    'muscle_wasting', 'vomiting', 'burning_micturition', 'fatigue', 'weight_gain',
    'anxiety', 'cold_hands_and_feets', 'mood_swings', 'weight_loss', 'restlessness',
    'lethargy', 'patches_in_throat', 'irregular_sugar_level', 'cough', 'high_fever',
    'sunken_eyes', 'breathlessness', 'sweating', 'dehydration', 'indigestion',
    'headache', 'yellowish_skin', 'dark_urine', 'nausea', 'loss_of_appetite',
    'pain_behind_the_eyes', 'back_pain', 'constipation', 'abdominal_pain', 'diarrhoea',
    'mild_fever', 'yellow_urine', 'yellowing_of_eyes', 'acute_liver_failure',
    'fluid_overload', 'swelling_of_stomach', 'swelled_lymph_nodes', 'malaise',
    'blurred_and_distorted_vision', 'phlegm', 'throat_irritation', 'redness_of_eyes',
    'sinus_pressure', 'runny_nose', 'congestion', 'chest_pain', 'weakness_in_limbs',
    'fast_heart_rate', 'pain_during_bowel_movements', 'pain_in_anal_region',
    'bloody_stool', 'irritation_in_anus', 'neck_pain', 'dizziness', 'cramps',
    'bruising', 'obesity', 'swollen_legs', 'swollen_blood_vessels', 'puffy_face_and_eyes',
    'enlarged_thyroid', 'brittle_nails', 'swollen_extremeties', 'excessive_hunger',
    'extra_marital_contacts', 'drying_and_tingling_lips', 'slurred_speech', 'knee_pain',
    'hip_joint_pain', 'muscle_weakness', 'stiff_neck', 'swelling_joints',
    'movement_stiffness', 'spinning_movements', 'loss_of_balance', 'unsteadiness',
    'weakness_of_one_body_side', 'loss_of_smell', 'bladder_discomfort',
    'foul_smell_of_urine', 'continuous_feel_of_urine', 'passage_of_gases',
    'internal_itching', 'toxic_look_(typhos)', 'depression', 'irritability',
    'muscle_pain', 'altered_sensorium', 'red_spots_over_body', 'belly_pain',
    'abnormal_menstruation', 'watering_from_eyes', 'increased_appetite', 'polyuria',
    'family_history', 'mucoid_sputum', 'rusty_sputum', 'lack_of_concentration',
    'visual_disturbances', 'receiving_blood_transfusion', 'receiving_unsterile_injections',
    'coma', 'stomach_bleeding', 'distention_of_abdomen', 'history_of_alcohol_consumption',
    'blood_in_sputum', 'prominent_veins_on_calf', 'palpitations', 'painful_walking',
    'pus_filled_pimples', 'blackheads', 'scurring', 'skin_peeling', 'silver_like_dusting',
    'small_dents_in_nails', 'inflammatory_nails', 'blister', 'red_sore_around_nose',
    'yellow_crust_ooze',
]

DISEASE_SYMPTOMS_MAP = {
    'Diabetes': ['fatigue', 'weight_loss', 'polyuria', 'excessive_hunger', 'restlessness', 'lethargy', 'irregular_sugar_level', 'blurred_and_distorted_vision'],
    'Malaria': ['chills', 'high_fever', 'sweating', 'headache', 'nausea', 'vomiting', 'muscle_pain', 'fatigue'],
    'Tuberculosis': ['fatigue', 'cough', 'weight_loss', 'breathlessness', 'high_fever', 'phlegm', 'blood_in_sputum', 'loss_of_appetite', 'chest_pain'],
    'Hypertension': ['headache', 'dizziness', 'loss_of_balance', 'chest_pain', 'fatigue', 'lack_of_concentration'],
    'Common Cold': ['continuous_sneezing', 'chills', 'fatigue', 'cough', 'high_fever', 'headache', 'swelled_lymph_nodes', 'runny_nose', 'congestion'],
    'Dengue': ['skin_rash', 'chills', 'vomiting', 'high_fever', 'headache', 'nausea', 'pain_behind_the_eyes', 'back_pain', 'muscle_pain', 'fatigue'],
    'Heart attack': ['vomiting', 'breathlessness', 'sweating', 'chest_pain', 'fast_heart_rate'],
    'Pneumonia': ['chills', 'fatigue', 'cough', 'high_fever', 'breathlessness', 'sweating', 'malaise', 'phlegm', 'chest_pain', 'rusty_sputum'],
    'Typhoid': ['chills', 'vomiting', 'high_fever', 'headache', 'nausea', 'constipation', 'abdominal_pain', 'diarrhoea', 'toxic_look_(typhos)'],
    'Hepatitis B': ['fatigue', 'itching', 'vomiting', 'yellowish_skin', 'dark_urine', 'nausea', 'loss_of_appetite', 'yellowing_of_eyes', 'abdominal_pain'],
    'Migraine': ['headache', 'nausea', 'vomiting', 'visual_disturbances', 'blurred_and_distorted_vision', 'excessive_hunger', 'fatigue'],
    'Bronchial Asthma': ['fatigue', 'cough', 'breathlessness', 'high_fever', 'chest_pain', 'mucoid_sputum', 'family_history'],
    'Urinary tract infection': ['burning_micturition', 'fatigue', 'bladder_discomfort', 'foul_smell_of_urine', 'continuous_feel_of_urine'],
    'Allergy': ['continuous_sneezing', 'shivering', 'chills', 'itching', 'skin_rash', 'watering_from_eyes', 'runny_nose'],
    'Jaundice': ['fatigue', 'vomiting', 'yellowish_skin', 'dark_urine', 'nausea', 'loss_of_appetite', 'yellowing_of_eyes', 'abdominal_pain'],
}

DEMO_NAMES_MALE = [
    'Rahul Sharma', 'Arjun Kumar', 'Mohammed Ali', 'John Thomas', 'Suresh Nair',
    'Vijay Menon', 'Arun Pillai', 'Rajesh Varma', 'Deepak Singh', 'Anand Krishnan',
    'Ravi Mohan', 'Sanjay Patel', 'Manoj Tiwari', 'Vinod Gupta', 'Prakash Rao',
    'Santosh Reddy', 'Ramesh Iyer', 'Ganesh Naik', 'Harish Bose', 'Nitin Joshi',
]

DEMO_NAMES_FEMALE = [
    'Priya Nair', 'Lakshmi Devi', 'Anjali Singh', 'Meera Pillai', 'Sunita Sharma',
    'Kavitha Menon', 'Divya Kumar', 'Rekha Thomas', 'Anitha Raj', 'Seetha Krishnan',
    'Deepa Mohan', 'Latha Patel', 'Usha Tiwari', 'Radha Gupta', 'Savitha Rao',
    'Nalini Reddy', 'Vimala Iyer', 'Shobha Naik', 'Geetha Bose', 'Padma Joshi',
]


def normalize_symptom(symptom):
    return symptom.strip().lower().replace(' ', '_').replace('-', '_')


def find_closest_disease(disease_input):
    disease_input = disease_input.strip()
    for d in VALID_DISEASES:
        if d.lower() == disease_input.lower():
            return d, True
    for d in VALID_DISEASES:
        if disease_input.lower() in d.lower() or d.lower() in disease_input.lower():
            return d, True
    return None, False


# ─── Helpers ──────────────────────────────────────────────────────────────────

def ok(message, data=None, status=200):
    return Response({'success': True, 'message': message, 'data': data or {}}, status=status)


def err(message, errors=None, status=400):
    return Response({'success': False, 'message': message, 'errors': errors or {}}, status=status)


def get_hospital(request):
    return request.user.hospital_profile


def generate_temp_password(length=10):
    """Strong random temporary password.

    Guarantees at least one uppercase, one lowercase and one digit so it also
    satisfies the first-login password policy (the new-password check rejects
    reusing this value anyway). Replaces the old predictable "Doctor@John" scheme.
    """
    pool = string.ascii_letters + string.digits
    chars = [
        random.choice(string.ascii_uppercase),
        random.choice(string.ascii_lowercase),
        random.choice(string.digits),
    ] + random.choices(pool, k=max(0, length - 3))
    random.shuffle(chars)
    return ''.join(chars)


def email_staff_credentials(login, full_name, role, hospital, temp_password):
    """Flag the account for a forced password change, store the temp password,
    and email the new staff member their credentials. Returns True if the email
    was sent (so the UI can offer a "share manually" fallback if it failed)."""
    login.force_password_change = True
    login.temp_password = temp_password
    login.save(update_fields=['force_password_change', 'temp_password', 'updated_at'])
    try:
        from email_utils import send_staff_welcome_email
        return send_staff_welcome_email(
            login.email, full_name, role, hospital.hospital_name, temp_password,
        )
    except Exception as e:  # noqa: BLE001
        print(f'[STAFF] welcome email error: {e}')
        return False


# ─── Serializers (dict helpers) ───────────────────────────────────────────────

def serialize_hospital(h):
    return {
        'hospital_id': str(h.hospital_id),
        'hospital_name': h.hospital_name,
        'registration_no': h.registration_no,
        'address': h.address,
        'city': h.city,
        'state': h.state,
        'latitude': float(h.latitude) if h.latitude else None,
        'longitude': float(h.longitude) if h.longitude else None,
        'contact_phone': h.contact_phone,
        'contact_email': h.contact_email,
        'telemedicine_enabled': h.telemedicine_enabled,
        'approval_status': h.approval_status,
        'created_at': h.created_at.isoformat(),
    }


def serialize_dept(d):
    return {
        'dept_id': str(d.dept_id),
        'dept_name': d.dept_name,
        'description': d.description,
        'department_photo': d.department_photo or None,
        'created_at': d.created_at.isoformat(),
    }


def serialize_bed(b):
    # Dynamic emergency-lock countdown so the UI never shows a stale "X days".
    locked = b.emergency_id_id is not None
    min_days = b.minimum_lock_days or 3
    days_locked = (timezone.now() - b.emergency_locked_at).days if b.emergency_locked_at else 0
    days_remaining = max(0, min_days - days_locked) if b.emergency_locked_at else min_days
    return {
        'bed_id': str(b.bed_id),
        'bed_type': b.bed_type,
        'ward_name': b.ward_name,
        'status': b.status,
        'reserved_for_emergency': locked,
        'is_emergency_locked': locked,
        'emergency_id': str(b.emergency_id_id) if b.emergency_id_id else None,
        'emergency_locked_at': b.emergency_locked_at.isoformat() if b.emergency_locked_at else None,
        'minimum_lock_days': min_days,
        'days_locked': days_locked,
        'days_remaining': days_remaining,
        'can_unlock': locked and days_locked >= min_days,
        'updated_at': b.updated_at.isoformat(),
    }


def serialize_inventory(i):
    return {
        'inventory_id': str(i.inventory_id),
        'item_name': i.item_name,
        'category': i.category,
        'quantity': i.quantity,
        'unit': i.unit,
        'reorder_level': i.reorder_level,
        'condition': i.condition,
        'image_url': i.image_url,
        'is_low_stock': i.quantity <= i.reorder_level,
        'last_restocked': i.last_restocked.isoformat() if i.last_restocked else None,
        'maintenance_due': i.maintenance_due.isoformat() if i.maintenance_due else None,
    }


def serialize_doctor(d):
    return {
        'doctor_id': str(d.doctor_id),
        'full_name': d.full_name,
        'specialization': d.specialization,
        'license_no': d.license_no,
        'experience_years': d.experience_years,
        'consultation_fee': float(d.consultation_fee),
        'dept_id': str(d.dept_id.dept_id) if d.dept_id else None,
        'dept_name': d.dept_id.dept_name if d.dept_id else None,
        'is_online': d.is_online,
        'approval_status': d.approval_status,
        'is_active': d.login_id.is_active,
        'email': d.login_id.email,
        'created_at': d.created_at.isoformat(),
    }


# ─── Dashboard ────────────────────────────────────────────────────────────────

class HospitalDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        from datetime import date as _date
        from apps.lab.models import LabOrder
        from apps.doctor.models import Consultation, DoctorRegistration
        from apps.emergency.models import EmergencyRequest

        hospital = get_hospital(request)
        beds = hospital.beds.all()

        pending_lab_orders = LabOrder.objects.filter(
            doctor_id__hospital_id=hospital,
            status='pending',
        ).count()

        today = _date.today()
        month_start = timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        hosp_consults = Consultation.objects.filter(doctor_id__hospital_id=hospital)

        # Real (non-cancelled) consultations only — a cancelled booking is not a
        # patient being served.
        live_statuses = ['scheduled', 'ongoing', 'completed']
        todays_qs = hosp_consults.filter(slot_id__slot_date=today, status__in=live_statuses)
        todays_consultations = todays_qs.count()
        monthly_consultations = hosp_consults.filter(
            created_at__gte=month_start, status__in=live_statuses,
        ).count()

        # Active patients = DISTINCT patients with a consultation today +
        # patients currently inbound on an active emergency. (Counting distinct
        # patients, not consultation rows, was the bug — two slots for the same
        # patient previously inflated the count.)
        active_today = todays_qs.values('patient_id').distinct().count()
        active_emergency = EmergencyRequest.objects.filter(
            assigned_hospital_id=hospital, status='dispatched',
        ).count()
        active_patients = active_today + active_emergency

        # Available doctors = hospital doctors who have toggled themselves ONLINE
        # (live availability), out of all active doctors.
        active_doctors = DoctorRegistration.objects.filter(
            hospital_id=hospital, login_id__is_active=True,
        )
        total_doctors = active_doctors.count()
        online_doctors = active_doctors.filter(is_online=True).count()
        available_doctors = online_doctors

        return ok('Dashboard fetched', {
            'hospital_name': hospital.hospital_name,
            'city': hospital.city,
            'total_doctors': total_doctors,
            'online_doctors': online_doctors,
            'available_doctors': available_doctors,
            'active_patients': active_patients,
            'active_emergency': active_emergency,
            'todays_consultations': todays_consultations,
            'consultations_today': todays_consultations,  # alias for clarity
            'monthly_consultations': monthly_consultations,
            'total_beds': beds.count(),
            'available_beds': beds.filter(status='available').count(),
            'occupied_beds': beds.filter(status='occupied').count(),
            'icu_available': beds.filter(bed_type='icu', status='available').count(),
            'total_inventory_items': hospital.inventory.count(),
            'low_stock_items': hospital.inventory.filter(quantity__lte=F('reorder_level')).count(),
            'pending_lab_orders': pending_lab_orders,
            'departments_count': hospital.departments.count(),
        })


# ─── Staff — Add Doctor ───────────────────────────────────────────────────────

class AddDoctorView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request):
        from apps.doctor.models import DoctorRegistration

        serializer = AddDoctorSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors)

        d = serializer.validated_data
        hospital = get_hospital(request)

        # Optional department — must be one of THIS hospital's own departments.
        dept = None
        if d.get('dept_id'):
            dept = Department.objects.filter(dept_id=d['dept_id'], hospital_id=hospital).first()
            if not dept:
                return err('Selected department does not belong to your hospital.')

        temp_password = generate_temp_password()

        login = LoginCredentials.objects.create(
            email=d['email'],
            password_hash=make_password(temp_password),
            role='doctor',
            is_active=True,
            is_approved=True,
        )

        doctor = DoctorRegistration.objects.create(
            login_id=login,
            hospital_id=hospital,
            dept_id=dept,
            full_name=d['full_name'],
            specialization=d['specialization'],
            license_no=d['license_no'],
            experience_years=d.get('experience_years', 0),
            consultation_fee=d.get('consultation_fee', 0),
            approval_status='approved',
        )

        # Force a password change on first login + email the credentials.
        email_sent = email_staff_credentials(login, d['full_name'], 'doctor', hospital, temp_password)

        send_notification(
            login,
            'Welcome to FederCare',
            f'Your doctor account at {hospital.hospital_name} is ready. Login: {d["email"]}',
            notif_type='alert',
        )

        # Real-time hint so patients' "Book a Doctor" lists refresh automatically.
        try:
            from utils import broadcast_new_doctor_to_patients
            broadcast_new_doctor_to_patients(doctor.full_name, hospital.hospital_name)
        except Exception as e:
            print(f'[AddDoctorView] doctor refresh broadcast error: {e}')

        log_audit(
            request.user, 'doctor_added', module='hospital',
            entity_type='DoctorRegistration', entity_id=doctor.doctor_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok('Doctor added successfully', {
            'doctor_id': str(doctor.doctor_id),
            'full_name': doctor.full_name,
            'login_email': login.email,
            'temp_password': temp_password,
            'email_sent': email_sent,
        }, status=201)


# ─── Staff — Add Lab Technician ───────────────────────────────────────────────

class AddLabTechView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request):
        from apps.lab.models import LabTechRegistration

        serializer = AddLabTechSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors)

        d = serializer.validated_data
        hospital = get_hospital(request)
        temp_password = generate_temp_password()

        login = LoginCredentials.objects.create(
            email=d['email'],
            password_hash=make_password(temp_password),
            role='lab_tech',
            is_active=True,
            is_approved=True,
        )

        lab_tech = LabTechRegistration.objects.create(
            login_id=login,
            hospital_id=hospital,
            full_name=d['full_name'],
            qualification=d.get('qualification', ''),
            specialization=d.get('specialization', ''),
            phone=d.get('phone', ''),
            approval_status='approved',
        )

        email_sent = email_staff_credentials(login, d['full_name'], 'lab_tech', hospital, temp_password)

        send_notification(
            login,
            'Welcome to FederCare',
            f'Your lab technician account at {hospital.hospital_name} is ready. Login: {d["email"]}',
            notif_type='alert',
        )
        log_audit(
            request.user, 'lab_tech_added', module='hospital',
            entity_type='LabTechRegistration', entity_id=lab_tech.lab_tech_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok('Lab technician added', {
            'lab_tech_id': str(lab_tech.lab_tech_id),
            'full_name': lab_tech.full_name,
            'login_email': login.email,
            'temp_password': temp_password,
            'email_sent': email_sent,
        }, status=201)


# ─── Staff — Add Driver ───────────────────────────────────────────────────────

class AddDriverView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request):
        from apps.emergency.models import AmbulanceDriverRegistration, Ambulance

        serializer = AddDriverSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors)

        d = serializer.validated_data
        hospital = get_hospital(request)
        temp_password = generate_temp_password()

        login = LoginCredentials.objects.create(
            email=d['email'],
            password_hash=make_password(temp_password),
            role='driver',
            is_active=True,
            is_approved=True,
        )

        driver = AmbulanceDriverRegistration.objects.create(
            login_id=login,
            hospital_id=hospital,
            full_name=d['full_name'],
            license_no=d['license_no'],
            phone=d['phone'],
            approval_status='approved',
        )

        Ambulance.objects.create(
            hospital_id=hospital,
            driver_id=driver,
            vehicle_no=d['vehicle_no'],
            ambulance_type=d.get('ambulance_type', 'basic'),
        )

        email_sent = email_staff_credentials(login, d['full_name'], 'driver', hospital, temp_password)

        send_notification(
            login,
            'Welcome to FederCare',
            f'Your driver account at {hospital.hospital_name} is ready. Login: {d["email"]}',
            notif_type='alert',
        )
        log_audit(
            request.user, 'driver_added', module='hospital',
            entity_type='AmbulanceDriverRegistration', entity_id=driver.driver_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok('Driver added successfully', {
            'driver_id': str(driver.driver_id),
            'full_name': driver.full_name,
            'login_email': login.email,
            'temp_password': temp_password,
            'vehicle_no': d['vehicle_no'],
            'email_sent': email_sent,
        }, status=201)


# ─── Staff — List Doctors ─────────────────────────────────────────────────────

class ListDoctorsView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        hospital = get_hospital(request)
        # Include suspended staff too (is_active=False) so the UI can show a
        # SUSPENDED badge and a Resume button — only the active filter is dropped.
        doctors = (hospital.doctors
                   .select_related('login_id', 'dept_id')
                   .order_by('full_name'))
        return ok('Doctors fetched', [serialize_doctor(d) for d in doctors])


class UpdateDoctorView(APIView):
    """Edit a hospital's own doctor — name, specialization, license, experience
    and department (dept_id). Also used by the inline "set department" fix for
    doctors created before department selection existed."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def put(self, request, doctor_id):
        from apps.doctor.models import DoctorRegistration

        hospital = get_hospital(request)
        try:
            doctor = DoctorRegistration.objects.get(doctor_id=doctor_id, hospital_id=hospital)
        except DoctorRegistration.DoesNotExist:
            return err('Doctor not found', status=404)

        updated = []

        full_name = (request.data.get('full_name') or '').strip()
        if full_name:
            doctor.full_name = full_name
            updated.append('full_name')

        specialization = (request.data.get('specialization') or '').strip()
        if specialization:
            doctor.specialization = specialization
            updated.append('specialization')

        license_no = (request.data.get('license_no') or '').strip()
        if license_no and license_no != doctor.license_no:
            if DoctorRegistration.objects.filter(license_no=license_no).exclude(pk=doctor.pk).exists():
                return err('License number already in use by another doctor.')
            doctor.license_no = license_no
            updated.append('license_no')

        if 'experience_years' in request.data:
            try:
                doctor.experience_years = int(request.data.get('experience_years') or 0)
                updated.append('experience_years')
            except (ValueError, TypeError):
                return err('Experience must be a number.')

        dept_id = request.data.get('dept_id')
        if dept_id:
            dept = Department.objects.filter(dept_id=dept_id, hospital_id=hospital).first()
            if not dept:
                return err('Selected department does not belong to your hospital.')
            doctor.dept_id = dept
            updated.append('dept_id')

        if not updated:
            return err('Nothing to update')

        doctor.save(update_fields=updated + ['updated_at'])
        log_audit(
            request.user, 'doctor_updated', module='hospital',
            entity_type='DoctorRegistration', entity_id=doctor.doctor_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Doctor updated successfully!', serialize_doctor(doctor))


class UpdateLabTechView(APIView):
    """Edit a hospital's own lab technician — name, phone, qualification,
    specialization."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def put(self, request, lab_tech_id):
        from apps.lab.models import LabTechRegistration

        hospital = get_hospital(request)
        try:
            lab_tech = LabTechRegistration.objects.get(lab_tech_id=lab_tech_id, hospital_id=hospital)
        except LabTechRegistration.DoesNotExist:
            return err('Lab technician not found', status=404)

        updated = []
        for field in ('full_name', 'phone', 'qualification', 'specialization'):
            if field in request.data:
                setattr(lab_tech, field, (request.data.get(field) or '').strip())
                updated.append(field)

        if not updated:
            return err('Nothing to update')

        lab_tech.save(update_fields=updated + ['updated_at'])
        log_audit(
            request.user, 'lab_tech_updated', module='hospital',
            entity_type='LabTechRegistration', entity_id=lab_tech.lab_tech_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Lab technician updated successfully!', {
            'lab_tech_id': str(lab_tech.lab_tech_id),
            'full_name': lab_tech.full_name,
            'phone': lab_tech.phone,
            'qualification': lab_tech.qualification,
            'specialization': lab_tech.specialization,
        })


class UpdateDriverView(APIView):
    """Edit a hospital's own ambulance driver — name, phone, license, and the
    linked ambulance's vehicle number."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def put(self, request, driver_id):
        from apps.emergency.models import AmbulanceDriverRegistration, Ambulance

        hospital = get_hospital(request)
        try:
            driver = AmbulanceDriverRegistration.objects.get(driver_id=driver_id, hospital_id=hospital)
        except AmbulanceDriverRegistration.DoesNotExist:
            return err('Driver not found', status=404)

        updated = []

        full_name = (request.data.get('full_name') or '').strip()
        if full_name:
            driver.full_name = full_name
            updated.append('full_name')

        if 'phone' in request.data:
            driver.phone = (request.data.get('phone') or '').strip()
            updated.append('phone')

        license_no = (request.data.get('license_no') or '').strip()
        if license_no and license_no != driver.license_no:
            if AmbulanceDriverRegistration.objects.filter(license_no=license_no).exclude(pk=driver.pk).exists():
                return err('License number already in use by another driver.')
            driver.license_no = license_no
            updated.append('license_no')

        if updated:
            driver.save(update_fields=updated + ['updated_at'])

        # Vehicle number lives on the linked Ambulance, not the driver.
        vehicle_no = (request.data.get('vehicle_no') or '').strip()
        if vehicle_no:
            amb = driver.ambulance.first()
            if amb and vehicle_no != amb.vehicle_no:
                if Ambulance.objects.filter(vehicle_no=vehicle_no).exclude(pk=amb.pk).exists():
                    return err('Vehicle number already in use by another ambulance.')
                amb.vehicle_no = vehicle_no
                amb.save(update_fields=['vehicle_no'])
            elif not amb:
                Ambulance.objects.create(hospital_id=hospital, driver_id=driver, vehicle_no=vehicle_no)

        if not updated and not vehicle_no:
            return err('Nothing to update')

        log_audit(
            request.user, 'driver_updated', module='hospital',
            entity_type='AmbulanceDriverRegistration', entity_id=driver.driver_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Driver updated successfully!', {
            'driver_id': str(driver.driver_id),
            'full_name': driver.full_name,
            'phone': driver.phone,
            'license_no': driver.license_no,
        })


class DeleteStaffView(APIView):
    """Deactivate a hospital staff member (doctor / lab_tech / driver) and email
    them a role-specific account-deactivation notice. The account is deactivated
    (not hard-deleted) so it can be restored by support if needed."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def delete(self, request, role, staff_id):
        hospital = get_hospital(request)

        if role == 'doctor':
            from apps.doctor.models import DoctorRegistration
            staff = DoctorRegistration.objects.filter(doctor_id=staff_id, hospital_id=hospital).first()
        elif role == 'lab_tech':
            from apps.lab.models import LabTechRegistration
            staff = LabTechRegistration.objects.filter(lab_tech_id=staff_id, hospital_id=hospital).first()
        elif role == 'driver':
            from apps.emergency.models import AmbulanceDriverRegistration
            staff = AmbulanceDriverRegistration.objects.filter(driver_id=staff_id, hospital_id=hospital).first()
        else:
            return err('Invalid role.', status=400)

        if not staff:
            return err('Staff member not found.', status=404)

        full_name = staff.full_name
        email = staff.login_id.email

        # Deactivate the central login (blocks sign-in) — reversible by support.
        staff.login_id.is_active = False
        staff.login_id.save(update_fields=['is_active', 'updated_at'])

        hospital_email = getattr(hospital.login_id, 'email', 'federcaresupport@gmail.com')
        try:
            from email_utils import send_staff_termination_email
            email_sent = send_staff_termination_email(
                email, full_name, role, hospital.hospital_name, hospital_email,
            )
        except Exception as e:  # noqa: BLE001
            print(f'[STAFF] termination email error: {e}')
            email_sent = False

        log_audit(
            request.user, f'{role}_removed', module='hospital',
            entity_type=staff.__class__.__name__, entity_id=staff.pk,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok(
            f'{full_name} has been removed from {hospital.hospital_name}!',
            {'email_sent': email_sent},
        )


class StaffActionView(APIView):
    """Suspend, terminate or resume a hospital staff member (doctor / lab_tech /
    driver). Suspend/terminate deactivate the central login (blocking sign-in);
    resume reactivates it. A role-specific email is sent for every action."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request, role, staff_id):
        action = request.data.get('action')
        if action not in ('suspend', 'terminate', 'resume'):
            return err('Invalid action!')

        hospital = get_hospital(request)

        if role == 'doctor':
            from apps.doctor.models import DoctorRegistration
            staff = DoctorRegistration.objects.filter(doctor_id=staff_id, hospital_id=hospital).first()
        elif role == 'lab_tech':
            from apps.lab.models import LabTechRegistration
            staff = LabTechRegistration.objects.filter(lab_tech_id=staff_id, hospital_id=hospital).first()
        elif role == 'driver':
            from apps.emergency.models import AmbulanceDriverRegistration
            staff = AmbulanceDriverRegistration.objects.filter(driver_id=staff_id, hospital_id=hospital).first()
        else:
            return err('Invalid role.', status=400)

        if not staff:
            return err('Staff member not found.', status=404)

        full_name = staff.full_name
        email = staff.login_id.email

        # suspend / terminate block sign-in; resume restores it.
        staff.login_id.is_active = (action == 'resume')
        staff.login_id.save(update_fields=['is_active', 'updated_at'])

        hospital_email = getattr(hospital.login_id, 'email', 'federcaresupport@gmail.com')

        if action == 'resume':
            email_sent = self._send_resume_email(email, full_name, role, hospital, hospital_email)
            action_msg = 'reactivated'
        else:
            try:
                from email_utils import send_staff_action_email
                email_sent = send_staff_action_email(
                    email, full_name, role, action, hospital.hospital_name, hospital_email,
                )
            except Exception as e:  # noqa: BLE001
                print(f'[STAFF] action email error: {e}')
                email_sent = False
            action_msg = 'suspended' if action == 'suspend' else 'terminated'

        log_audit(
            request.user, f'{role}_{action}', module='hospital',
            entity_type=staff.__class__.__name__, entity_id=staff.pk,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok(
            f'{full_name} has been {action_msg}!',
            {'email_sent': email_sent, 'action': action, 'is_active': staff.login_id.is_active},
        )

    @staticmethod
    def _send_resume_email(email, full_name, role, hospital, hospital_email):
        """Welcome-back email sent when a suspended staff member is reactivated."""
        from email_utils import send_email, clean_name_for_email

        cleaned_name = clean_name_for_email(f'Dr. {full_name}' if role == 'doctor' else full_name)
        role_display = {
            'doctor': 'Doctor', 'lab_tech': 'Lab Technician',
            'pharmacist': 'Pharmacist', 'driver': 'Ambulance Driver',
        }.get(role, role.replace('_', ' ').title())
        icon = {'doctor': '👨‍⚕️', 'lab_tech': '🔬', 'pharmacist': '💊', 'driver': '🚑'}.get(role, '👤')

        try:
            send_email(
                to_email=email,
                subject=f'Welcome Back to FederCare — {hospital.hospital_name}',
                html_content=f"""
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                    <div style="background:#22C55E;padding:30px;text-align:center;border-radius:12px 12px 0 0;">
                        <p style="font-size:48px;margin:0 0 8px;">{icon}</p>
                        <h1 style="color:white;margin:0;font-size:22px;font-weight:800;">Account Reactivated!</h1>
                        <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">FederCare Health Network</p>
                    </div>
                    <div style="background:#FAF7F2;padding:32px;border-radius:0 0 12px 12px;">
                        <p style="color:#333;font-size:16px;margin:0 0 16px;">Dear <b>{cleaned_name}</b>,</p>
                        <div style="background:white;border-radius:12px;padding:20px;border-left:4px solid #22C55E;margin:0 0 20px;">
                            <p style="color:#16A34A;font-weight:700;margin:0 0 8px;">✅ Great News!</p>
                            <p style="color:#666;font-size:14px;line-height:1.7;margin:0;">
                                Your account as <b>{role_display}</b> at <b>{hospital.hospital_name}</b>
                                has been <b style="color:#22C55E;">reactivated</b>. You can now login to
                                FederCare and resume your duties!
                            </p>
                        </div>
                        <div style="background:white;border-radius:12px;padding:16px;text-align:center;margin:0 0 20px;">
                            <p style="color:#333;font-weight:700;margin:0 0 8px;font-size:14px;">🏥 {hospital.hospital_name}</p>
                            <p style="color:#9CA3AF;font-size:12px;margin:0;">Contact: {hospital_email}</p>
                        </div>
                        <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0;">
                            FederCare: AI Health Network<br>federcaresupport@gmail.com
                        </p>
                    </div>
                </div>
                """,
            )
            return True
        except Exception as e:  # noqa: BLE001
            print(f'[EMAIL] Resume error: {e}')
            return False


# ─── Bed Management ───────────────────────────────────────────────────────────

class ListBedsView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        hospital = get_hospital(request)
        beds = hospital.beds.all().order_by('bed_type', 'ward_name')
        return ok('Beds fetched', {
            'summary': {
                'total': beds.count(),
                'available': beds.filter(status='available').count(),
                'occupied': beds.filter(status='occupied').count(),
                'reserved': beds.filter(status='reserved').count(),
            },
            'beds': [serialize_bed(b) for b in beds],
        })


class AddBedView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request):
        hospital = get_hospital(request)
        bed_type = request.data.get('bed_type', '')
        if bed_type not in ['general', 'icu', 'ventilator']:
            return err('bed_type must be general, icu, or ventilator')
        bed = Bed.objects.create(
            hospital_id=hospital,
            bed_type=bed_type,
            ward_name=request.data.get('ward_name', ''),
        )
        log_audit(
            request.user, 'bed_added', module='hospital',
            entity_type='Bed', entity_id=bed.bed_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Bed added', serialize_bed(bed), status=201)


class UpdateBedView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def put(self, request, bed_id):
        hospital = get_hospital(request)
        try:
            bed = Bed.objects.get(bed_id=bed_id, hospital_id=hospital)
        except Bed.DoesNotExist:
            return err('Bed not found', status=404)

        # Hard lock: a bed held for an active emergency can't be changed by
        # hospital staff until that emergency is resolved (acknowledged/cancelled).
        if bed.emergency_id_id is not None:
            return err(
                'This bed is reserved for an active emergency and cannot be '
                'modified until the emergency is resolved.',
                status=400,
            )

        new_status = request.data.get('status', '')
        if new_status not in ['available', 'occupied', 'reserved']:
            return err('status must be available, occupied, or reserved')

        old_status = bed.status
        bed.status = new_status
        if new_status == 'available':
            bed.reserved_for = None
            bed.reserved_at = None
        bed.save()

        log_audit(
            request.user, 'bed_status_updated', module='hospital',
            entity_type='Bed', entity_id=bed_id,
            old_value=old_status, new_value=new_status,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Bed status updated', serialize_bed(bed))


class UnlockEmergencyBedView(APIView):
    """Hospital admin force-unlocks an emergency-locked bed — but only after the
    minimum lock period (default 3 days) has elapsed."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request, bed_id):
        from datetime import timedelta

        hospital = get_hospital(request)
        try:
            bed = Bed.objects.get(bed_id=bed_id, hospital_id=hospital)
        except Bed.DoesNotExist:
            return err('Bed not found', status=404)

        if bed.emergency_id_id is None:
            return err('This bed is not emergency-locked.', status=400)

        min_days = bed.minimum_lock_days or 3
        if bed.emergency_locked_at:
            elapsed_days = (timezone.now() - bed.emergency_locked_at).days
            if elapsed_days < min_days:
                remaining = min_days - elapsed_days
                return err(
                    f'Bed cannot be unlocked yet! Minimum lock period is {min_days} days. '
                    f'{remaining} day(s) remaining.',
                    status=400,
                )

        bed.status = 'available'
        bed.emergency_id = None
        bed.reserved_for = None
        bed.reserved_at = None
        bed.emergency_locked_at = None
        bed.save(update_fields=[
            'status', 'emergency_id', 'reserved_for', 'reserved_at',
            'emergency_locked_at', 'updated_at',
        ])

        log_audit(
            request.user, 'emergency_bed_unlocked', module='hospital',
            entity_type='Bed', entity_id=bed_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Bed unlocked and available again!', serialize_bed(bed))


def bed_display_label(bed):
    """Friendly label for a bed in selectors (model has no bed_number column —
    build one from ward + type, falling back to a short id)."""
    parts = []
    if bed.ward_name:
        parts.append(bed.ward_name)
    parts.append((bed.bed_type or 'Bed').upper())
    parts.append(f'#{str(bed.bed_id)[:6]}')
    return ' · '.join(parts)


class AvailableBedsView(APIView):
    """Real-time list of free beds at the admin's hospital — powers the
    emergency dashboard bed selector."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        hospital = get_hospital(request)
        beds = Bed.objects.filter(
            hospital_id=hospital, status='available',
        ).order_by('bed_type', 'ward_name')
        return ok('Available beds fetched', {
            'available_count': beds.count(),
            'beds': [{
                'bed_id': str(b.bed_id),
                'bed_number': bed_display_label(b),
                'ward': b.ward_name or '',
                'bed_type': b.bed_type or '',
            } for b in beds],
        })


# ─── Inventory Management ─────────────────────────────────────────────────────

class ListInventoryView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        hospital = get_hospital(request)
        items = list(hospital.inventory.all().order_by('category', 'item_name'))
        return ok('Inventory fetched', {
            'low_stock_count': sum(1 for i in items if i.quantity <= i.reorder_level),
            'items': [serialize_inventory(i) for i in items],
        })


class UpdateInventoryView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def put(self, request, inventory_id):
        hospital = get_hospital(request)
        try:
            item = HospitalInventory.objects.get(
                inventory_id=inventory_id, hospital_id=hospital
            )
        except HospitalInventory.DoesNotExist:
            return err('Inventory item not found', status=404)

        old_qty = item.quantity
        if 'quantity' in request.data:
            item.quantity = int(request.data['quantity'])
            item.last_restocked = timezone.now()
        if 'reorder_level' in request.data:
            item.reorder_level = int(request.data['reorder_level'])
        if 'item_name' in request.data:
            item.item_name = request.data['item_name']
        if 'unit' in request.data:
            item.unit = request.data['unit']
        if 'category' in request.data:
            item.category = request.data['category']
        if 'condition' in request.data:
            item.condition = request.data['condition']
        if 'maintenance_due' in request.data:
            item.maintenance_due = request.data['maintenance_due'] or None
        if 'image_url' in request.data:
            item.image_url = request.data['image_url']
        item.save()

        log_audit(
            request.user, 'inventory_updated', module='hospital',
            entity_type='HospitalInventory', entity_id=inventory_id,
            old_value=str(old_qty), new_value=str(item.quantity),
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Inventory updated', serialize_inventory(item))

    def delete(self, request, inventory_id):
        hospital = get_hospital(request)
        try:
            item = HospitalInventory.objects.get(
                inventory_id=inventory_id, hospital_id=hospital
            )
        except HospitalInventory.DoesNotExist:
            return err('Inventory item not found', status=404)
        item.delete()
        log_audit(
            request.user, 'inventory_item_deleted', module='hospital',
            entity_type='HospitalInventory', entity_id=inventory_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Inventory item deleted')


class EquipmentStockMovementView(APIView):
    """Professional stock-movement system for hospital equipment.

    GET  → movement history (latest 50) for an equipment item.
    POST → record a stock-in / stock-out movement, adjust the live count
           atomically, and store a before/after audit row.
    All operations are scoped to the requesting hospital admin's own hospital.
    """
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request, equipment_id):
        hospital = get_hospital(request)
        try:
            equipment = HospitalInventory.objects.get(
                inventory_id=equipment_id, hospital_id=hospital
            )
        except HospitalInventory.DoesNotExist:
            return err('Equipment not found!', status=404)

        movements = EquipmentStockMovement.objects.filter(
            equipment_id=equipment
        ).order_by('-created_at')[:50]

        return ok('Movement history fetched', {
            'equipment_name': equipment.item_name,
            'current_quantity': equipment.quantity,
            'movements': [{
                'movement_id': str(m.movement_id),
                'movement_type': m.movement_type,
                'quantity': m.quantity,
                'reason': m.reason,
                'reason_display': m.get_reason_display(),
                'vendor_name': m.vendor_name,
                'invoice_number': m.invoice_number,
                'notes': m.notes,
                'stock_before': m.stock_before,
                'stock_after': m.stock_after,
                'movement_date': str(m.movement_date),
                'performed_by': m.performed_by.email if m.performed_by else 'System',
                'created_at': m.created_at.strftime('%d %b %Y %I:%M %p'),
            } for m in movements],
        })

    def post(self, request, equipment_id):
        from django.db import transaction

        hospital = get_hospital(request)

        movement_type = request.data.get('movement_type')
        try:
            quantity = int(request.data.get('quantity', 0))
        except (TypeError, ValueError):
            return err('Quantity must be a number!', status=400)
        reason = request.data.get('reason')
        vendor_name = request.data.get('vendor_name', '')
        invoice_number = request.data.get('invoice_number', '')
        notes = request.data.get('notes', '')
        movement_date = request.data.get('movement_date')

        # ── Validate ────────────────────────────────────────────────────────
        if quantity <= 0:
            return err('Quantity must be greater than 0!', status=400)
        if movement_type not in ['in', 'out']:
            return err('Invalid movement type!', status=400)
        if not reason:
            return err('Please select a reason!', status=400)

        try:
            with transaction.atomic():
                equipment = HospitalInventory.objects.select_for_update().get(
                    inventory_id=equipment_id, hospital_id=hospital
                )

                stock_before = equipment.quantity

                if movement_type == 'out':
                    if quantity > equipment.quantity:
                        return err(
                            f'Cannot remove {quantity} units! '
                            f'Only {equipment.quantity} available.',
                            status=400,
                        )
                    equipment.quantity -= quantity
                else:
                    equipment.quantity += quantity
                    equipment.last_restocked = timezone.now()

                stock_after = equipment.quantity
                equipment.save()

                mov_date = date.today()
                if movement_date:
                    try:
                        mov_date = datetime.strptime(movement_date, '%Y-%m-%d').date()
                    except (TypeError, ValueError):
                        pass

                movement = EquipmentStockMovement.objects.create(
                    equipment_id=equipment,
                    movement_type=movement_type,
                    quantity=quantity,
                    reason=reason,
                    vendor_name=vendor_name or None,
                    invoice_number=invoice_number or None,
                    notes=notes or None,
                    performed_by=request.user,
                    stock_before=stock_before,
                    stock_after=stock_after,
                    movement_date=mov_date,
                )
        except HospitalInventory.DoesNotExist:
            return err('Equipment not found!', status=404)

        log_audit(
            request.user, f'stock_{movement_type}', module='hospital',
            entity_type='HospitalInventory', entity_id=equipment_id,
            old_value=str(stock_before), new_value=str(stock_after),
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok(
            f'Stock {"added" if movement_type == "in" else "removed"} successfully!',
            {
                'movement_id': str(movement.movement_id),
                'stock_before': stock_before,
                'stock_after': stock_after,
                'current_quantity': equipment.quantity,
            },
        )


class InventoryImageUploadView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]
    parser_classes = [MultiPartParser]

    def post(self, request, item_id):
        import uuid
        hospital = get_hospital(request)
        try:
            item = HospitalInventory.objects.get(
                inventory_id=item_id, hospital_id=hospital
            )
        except HospitalInventory.DoesNotExist:
            return err('Inventory item not found', status=404)

        image = request.FILES.get('image')
        if not image:
            return err('No image provided!')

        ext = image.name.rsplit('.', 1)[-1].lower()
        filename = f'equip_{uuid.uuid4().hex[:8]}.{ext}'
        save_dir = os.path.join(settings.MEDIA_ROOT, 'equipment_images')
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, filename)

        with open(save_path, 'wb+') as f:
            for chunk in image.chunks():
                f.write(chunk)

        item.image_url = request.build_absolute_uri(f'/media/equipment_images/{filename}')
        item.save(update_fields=['image_url'])

        log_audit(
            request.user, 'inventory_image_uploaded', module='hospital',
            entity_type='HospitalInventory', entity_id=item_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Image uploaded', {'image_url': item.image_url})


class FileVendorComplaintView(APIView):
    """Hospital admin files a complaint against a vendor from the Equipment
    Orders page. Stored as a Complaint with filed_by_hospital set so the super
    admin sees it under 'Hospital Complaints'."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request):
        from apps.patient.models import Complaint
        from apps.vendor.models import VendorRegistration

        hospital = get_hospital(request)
        vendor_id = request.data.get('vendor_id')
        subject = (request.data.get('subject') or '').strip()
        description = (request.data.get('description') or '').strip()

        if not subject or not description:
            return err('subject and description are required.')

        vendor_obj = VendorRegistration.objects.filter(vendor_id=vendor_id).first() if vendor_id else None
        if not vendor_obj:
            return err('Vendor not found.', status=404)

        complaint = Complaint.objects.create(
            patient_id=None,
            filed_by_hospital=hospital,
            complaint_type='vendor',
            vendor_id=vendor_obj,
            subject=subject,
            description=description,
        )

        for admin in LoginCredentials.objects.filter(role='super_admin', is_active=True):
            send_notification(
                admin,
                'New Vendor Complaint',
                f'{hospital.hospital_name} filed a complaint against {vendor_obj.company_name}: {subject}',
                notif_type='alert',
            )

        log_audit(
            request.user, 'vendor_complaint_filed', module='hospital',
            entity_type='Complaint', entity_id=complaint.complaint_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Complaint submitted successfully', {
            'complaint_id': str(complaint.complaint_id),
        }, status=201)


# ─── Department Management ────────────────────────────────────────────────────

class ListLabTechsView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        from apps.lab.models import LabTechRegistration
        hospital = get_hospital(request)
        # Include suspended techs so the UI can offer Resume + a SUSPENDED badge.
        lab_techs = (hospital.lab_technicians
                     .select_related('login_id')
                     .order_by('full_name'))
        return ok('Lab techs fetched', [
            {
                'lab_tech_id': str(lt.lab_tech_id),
                'full_name': lt.full_name,
                'qualification': lt.qualification,
                'specialization': lt.specialization,
                'phone': lt.phone,
                'email': lt.login_id.email,
                'approval_status': lt.approval_status,
                'is_active': lt.login_id.is_active,
                'created_at': lt.created_at.isoformat(),
            }
            for lt in lab_techs
        ])


class ListDriversView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        hospital = get_hospital(request)
        # Include suspended drivers so the UI can offer Resume + a SUSPENDED badge.
        drivers = (hospital.drivers
                   .select_related('login_id')
                   .prefetch_related('ambulance')
                   .order_by('full_name'))
        result = []
        for dr in drivers:
            ambulance = dr.ambulance.first() if dr.ambulance.exists() else None
            result.append({
                'driver_id': str(dr.driver_id),
                'full_name': dr.full_name,
                'license_no': dr.license_no,
                'phone': dr.phone,
                'email': dr.login_id.email,
                'is_available': dr.is_available,
                'approval_status': dr.approval_status,
                'is_active': dr.login_id.is_active,
                'vehicle_no': ambulance.vehicle_no if ambulance else '',
                'ambulance_type': ambulance.ambulance_type if ambulance else '',
                'created_at': dr.created_at.isoformat(),
            })
        return ok('Drivers fetched', result)


class AddInventoryItemView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request):
        hospital = get_hospital(request)
        item_name = request.data.get('item_name', '').strip()
        if not item_name:
            return err('item_name is required')
        # Hospital inventory is equipment-only — no medicines here.
        valid_categories = [c[0] for c in HospitalInventory._meta.get_field('category').choices]
        category = request.data.get('category', 'medical_equipment')
        if category not in valid_categories:
            return err(f'category must be one of: {", ".join(valid_categories)}')
        try:
            quantity = int(request.data.get('quantity', 0))
            reorder_level = int(request.data.get('reorder_level', 10))
        except (ValueError, TypeError):
            return err('quantity and reorder_level must be integers')

        valid_conditions = [c[0] for c in HospitalInventory._meta.get_field('condition').choices]
        condition = request.data.get('condition', 'good')
        if condition not in valid_conditions:
            condition = 'good'

        item = HospitalInventory.objects.create(
            hospital_id=hospital,
            item_name=item_name,
            category=category,
            quantity=quantity,
            unit=request.data.get('unit', ''),
            reorder_level=reorder_level,
            condition=condition,
            maintenance_due=(request.data.get('maintenance_due') or None),
            image_url=request.data.get('image_url', ''),
        )
        log_audit(
            request.user, 'inventory_item_added', module='hospital',
            entity_type='HospitalInventory', entity_id=item.inventory_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Inventory item added', serialize_inventory(item), status=201)


class ListHospitalEquipmentOrdersView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        from apps.vendor.models import EquipmentOrder
        hospital = get_hospital(request)
        orders = (hospital.equipment_orders
                  .select_related('vendor_id', 'vendor_id__login_id', 'product_id')
                  .order_by('-ordered_at'))
        return ok('Equipment orders fetched', [
            {
                'eq_order_id': str(o.eq_order_id),
                'product_name': o.product_id.product_name,
                'vendor_id': str(o.vendor_id.vendor_id),
                'vendor_name': o.vendor_id.company_name,
                'vendor_phone': o.vendor_id.phone,
                'vendor_email': o.vendor_id.login_id.email,
                'quantity': o.quantity,
                'total_price': float(o.total_price),
                'order_status': o.order_status,
                'payment_status': o.payment_status,
                'tracking_info': o.tracking_info,
                'estimated_delivery_days': o.estimated_delivery_days,
                'otp_expiry': o.otp_expiry.isoformat() if o.otp_expiry else None,
                'dispatched_at': o.dispatched_at.isoformat() if o.dispatched_at else None,
                'delivered_at': o.delivered_at.isoformat() if o.delivered_at else None,
                'status_history': o.status_history or [],
                'ordered_at': o.ordered_at.isoformat(),
            }
            for o in orders
        ])


class ConfirmDeliveryView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request, order_id):
        from apps.vendor.models import EquipmentOrder
        hospital = get_hospital(request)
        entered_otp = str(request.data.get('otp', '')).strip()

        if not entered_otp:
            return err('OTP is required.')

        try:
            order = EquipmentOrder.objects.select_related(
                'product_id', 'vendor_id'
            ).get(eq_order_id=order_id, hospital_id=hospital, order_status='dispatched')
        except EquipmentOrder.DoesNotExist:
            return err('Dispatched order not found.', status=404)

        if not order.otp_expiry or timezone.now() > order.otp_expiry:
            return err('OTP has expired. Ask the vendor to resend the OTP.', status=400)

        if entered_otp != order.delivery_otp:
            return err('Invalid OTP. Please check your email.', status=400)

        history = list(order.status_history or [])
        history.append({
            'status': 'delivered',
            'timestamp': timezone.now().strftime('%Y-%m-%d %H:%M'),
            'note': 'Delivery confirmed by hospital admin',
        })

        order.order_status = 'delivered'
        order.otp_verified = True
        order.delivered_at = timezone.now()
        order.installed_at = timezone.now()
        order.status_history = history
        order.save(update_fields=[
            'order_status', 'otp_verified', 'delivered_at', 'installed_at', 'status_history',
        ])

        # Auto-update hospital inventory
        existing = HospitalInventory.objects.filter(
            hospital_id=hospital,
            item_name__iexact=order.product_id.product_name,
        ).first()
        if existing:
            existing.quantity += order.quantity
            existing.last_restocked = timezone.now()
            existing.save(update_fields=['quantity', 'last_restocked'])
        else:
            HospitalInventory.objects.create(
                hospital_id=hospital,
                item_name=order.product_id.product_name,
                category='medical_equipment',
                quantity=order.quantity,
                unit='units',
                reorder_level=2,
                last_restocked=timezone.now(),
            )

        try:
            from email_utils import send_delivery_confirmed_email
            send_delivery_confirmed_email(
                to_email=hospital.login_id.email,
                hospital_name=hospital.hospital_name,
                product_name=order.product_id.product_name,
                quantity=order.quantity,
                vendor_name=order.vendor_id.company_name,
            )
            send_delivery_confirmed_email(
                to_email=order.vendor_id.login_id.email,
                hospital_name=hospital.hospital_name,
                product_name=order.product_id.product_name,
                quantity=order.quantity,
                vendor_name=order.vendor_id.company_name,
            )
        except Exception as e:
            print(f'Delivery email error: {e}')

        send_notification(
            login_id=hospital.login_id,
            title='Order Delivered!',
            message=f'{order.product_id.product_name} x{order.quantity} delivered and added to inventory!',
            notif_type='order',
            related_id=str(order_id),
        )
        send_notification(
            login_id=order.vendor_id.login_id,
            title='Delivery Confirmed!',
            message=f'Order delivered to {hospital.hospital_name}. Amount: ₹{order.total_price}',
            notif_type='order',
            related_id=str(order_id),
        )

        log_audit(
            login_id=request.user,
            action=f'Confirmed delivery of order {order_id}',
            module='hospital',
            entity_type='EquipmentOrder',
            entity_id=str(order_id),
        )

        return ok('Delivery confirmed! Items added to inventory.', {
            'product_name': order.product_id.product_name,
            'quantity': order.quantity,
            'delivered_at': order.delivered_at.isoformat(),
        })


class TrackOrderView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request, order_id):
        from apps.vendor.models import EquipmentOrder
        hospital = get_hospital(request)

        try:
            order = EquipmentOrder.objects.select_related(
                'product_id', 'vendor_id'
            ).get(eq_order_id=order_id, hospital_id=hospital)
        except EquipmentOrder.DoesNotExist:
            return err('Order not found.', status=404)

        return ok('Order tracked.', {
            'eq_order_id': str(order.eq_order_id),
            'product_name': order.product_id.product_name,
            'quantity': order.quantity,
            'total_price': float(order.total_price),
            'vendor_name': order.vendor_id.company_name,
            'order_status': order.order_status,
            'payment_status': order.payment_status,
            'tracking_info': order.tracking_info,
            'estimated_delivery_days': order.estimated_delivery_days,
            'otp_expiry': order.otp_expiry.isoformat() if order.otp_expiry else None,
            'dispatched_at': order.dispatched_at.isoformat() if order.dispatched_at else None,
            'delivered_at': order.delivered_at.isoformat() if order.delivered_at else None,
            'ordered_at': order.ordered_at.isoformat(),
            'status_history': order.status_history or [],
        })


class ListDepartmentsView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        hospital = get_hospital(request)
        depts = hospital.departments.all().order_by('dept_name')
        return ok('Departments fetched', [
            {**serialize_dept(d), 'doctor_count': d.doctors.count()}
            for d in depts
        ])


class AddDepartmentView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        hospital = get_hospital(request)
        dept_name = request.data.get('dept_name', '').strip()
        if not dept_name:
            return err('dept_name is required')

        # Optional department photo → saved to local media, stored as a URL.
        photo_url = ''
        photo = request.FILES.get('department_photo')
        if photo:
            try:
                from utils import save_upload_locally
                photo_url = save_upload_locally(
                    photo, subdir='departments', request=request, prefix='dept',
                )
            except Exception as e:  # noqa: BLE001
                print(f'[Department] photo upload error: {e}')

        dept = Department.objects.create(
            hospital_id=hospital,
            dept_name=dept_name,
            description=request.data.get('description', ''),
            department_photo=photo_url,
        )
        log_audit(
            request.user, 'department_added', module='hospital',
            entity_type='Department', entity_id=dept.dept_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Department added', serialize_dept(dept), status=201)


class UpdateDepartmentView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def put(self, request, dept_id):
        hospital = get_hospital(request)
        try:
            dept = Department.objects.get(dept_id=dept_id, hospital_id=hospital)
        except Department.DoesNotExist:
            return err('Department not found', status=404)

        updated = []

        if 'dept_name' in request.data:
            dept_name = request.data.get('dept_name').strip()
            if dept_name and dept_name != dept.dept_name:
                dept.dept_name = dept_name
                updated.append('dept_name')

        if 'description' in request.data:
            dept.description = request.data.get('description', '').strip()
            updated.append('description')

        photo = request.FILES.get('department_photo')
        if photo:
            try:
                from utils import save_upload_locally
                photo_url = save_upload_locally(
                    photo, subdir='departments', request=request, prefix='dept',
                )
                dept.department_photo = photo_url
                updated.append('department_photo')
            except Exception as e:
                print(f'[Department] photo upload error: {e}')

        if updated:
            dept.save(update_fields=updated)
            log_audit(
                request.user, 'department_updated', module='hospital',
                entity_type='Department', entity_id=dept.dept_id,
                ip_address=request.META.get('REMOTE_ADDR'),
            )
            return ok('Department updated', serialize_dept(dept))
        else:
            return err('Nothing to update')


# ─── Hospital Patient (FL Training Data) ─────────────────────────────────────

def serialize_patient_summary(p):
    return {
        'patient_id': str(p.patient_id),
        'full_name': p.full_name,
        'age': p.age,
        'gender': p.gender,
        'blood_group': p.blood_group,
        'symptoms_count': len(p.symptoms),
        'diagnosis': p.diagnosis,
        'visit_date': p.visit_date.isoformat(),
    }


def serialize_patient_full(p):
    return {
        'patient_id': str(p.patient_id),
        'full_name': p.full_name,
        'age': p.age,
        'gender': p.gender,
        'blood_group': p.blood_group,
        'symptoms': p.symptoms,
        'diagnosis': p.diagnosis,
        'medications': p.medications,
        'notes': p.notes,
        'source': p.source,
        'visit_date': p.visit_date.isoformat(),
        'created_at': p.created_at.isoformat(),
    }


class AddHospitalPatientView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request):
        hospital = get_hospital(request)

        full_name = request.data.get('full_name', '').strip()
        diagnosis = request.data.get('diagnosis', '').strip()
        symptoms = request.data.get('symptoms', [])

        if not full_name:
            return err('full_name is required')
        if not diagnosis:
            return err('diagnosis is required')
        if not symptoms or not isinstance(symptoms, list):
            return err('symptoms must be a non-empty list')

        try:
            age = int(request.data.get('age', 0))
        except (ValueError, TypeError):
            return err('age must be an integer')
        if not (1 <= age <= 120):
            return err('age must be between 1 and 120')

        gender = request.data.get('gender', '').strip()
        if gender not in ['male', 'female', 'other']:
            return err('gender must be male, female, or other')

        patient = HospitalPatient.objects.create(
            hospital_id=hospital,
            added_by=request.user,
            full_name=full_name,
            age=age,
            gender=gender,
            blood_group=request.data.get('blood_group', '').strip(),
            symptoms=symptoms,
            diagnosis=diagnosis,
            notes=request.data.get('notes', '').strip(),
        )

        log_audit(
            request.user, 'hospital_patient_added', module='hospital',
            entity_type='HospitalPatient', entity_id=patient.patient_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Patient record added', {'patient_id': str(patient.patient_id)}, status=201)


class ListHospitalPatientsView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        hospital = get_hospital(request)
        qs = hospital.hospital_patients.all()

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(full_name__icontains=search) |
                Q(diagnosis__icontains=search)
            )

        diagnosis_filter = request.query_params.get('diagnosis', '').strip()
        if diagnosis_filter:
            qs = qs.filter(diagnosis__iexact=diagnosis_filter)

        return ok('Patients fetched', [serialize_patient_summary(p) for p in qs])


class GetHospitalPatientView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request, patient_id):
        hospital = get_hospital(request)
        try:
            patient = HospitalPatient.objects.get(patient_id=patient_id, hospital_id=hospital)
        except HospitalPatient.DoesNotExist:
            return err('Patient not found', status=404)
        return ok('Patient fetched', serialize_patient_full(patient))


class ExportTrainingDataView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        hospital = get_hospital(request)

        symptom_list_path = os.path.join(str(settings.BASE_DIR), '..', 'ml_models', 'symptom_list.pkl')
        symptom_list_path = os.path.normpath(symptom_list_path)

        try:
            with open(symptom_list_path, 'rb') as f:
                symptom_vocab = pickle.load(f)
        except FileNotFoundError:
            return err('symptom_list.pkl not found — run train_models.py first')

        patients = hospital.hospital_patients.all()
        if not patients.exists():
            return err('No patient records to export')

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(symptom_vocab + ['prognosis'])

        for p in patients:
            symptom_set = set(p.symptoms)
            row = [1 if s in symptom_set else 0 for s in symptom_vocab]
            row.append(p.diagnosis)
            writer.writerow(row)

        response = HttpResponse(output.getvalue(), content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="hospital_training_data.csv"'
        return response


class HospitalPatientStatsView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        hospital = get_hospital(request)
        patients = list(hospital.hospital_patients.all())
        total = len(patients)

        diagnosis_dist = {}
        symptom_freq = {}
        for p in patients:
            diagnosis_dist[p.diagnosis] = diagnosis_dist.get(p.diagnosis, 0) + 1
            for s in p.symptoms:
                symptom_freq[s] = symptom_freq.get(s, 0) + 1

        return ok('Stats fetched', {
            'total_patients': total,
            'diagnosis_distribution': diagnosis_dist,
            'symptoms_frequency': symptom_freq,
            'ready_for_training': total >= 10,
        })


class ImportPatientsCSVView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]
    parser_classes = [MultiPartParser]

    def post(self, request):
        hospital = get_hospital(request)

        csv_file = request.FILES.get('csv_file')
        if not csv_file:
            return err('No CSV file provided')
        if not csv_file.name.endswith('.csv'):
            return err('Only CSV files accepted!')

        decoded_file = csv_file.read().decode('utf-8')
        reader = csv.DictReader(io.StringIO(decoded_file))

        results = {'success': [], 'warnings': [], 'errors': []}

        for row_num, row in enumerate(reader, start=2):
            if row.get('full_name', '').startswith('INSTRUCTIONS'):
                continue

            try:
                full_name = row.get('full_name', '').strip()
                age = row.get('age', '').strip()
                gender = row.get('gender', 'male').strip().lower()
                blood_group = row.get('blood_group', '').strip()
                diagnosis_input = row.get('diagnosis', '').strip()
                symptoms_raw = row.get('symptoms', '').strip()
                notes = row.get('notes', '').strip()

                if not full_name and not diagnosis_input:
                    continue
                if not full_name:
                    results['errors'].append(f'Row {row_num}: Missing name')
                    continue
                if not age or not str(age).isdigit():
                    results['errors'].append(f'Row {row_num}: Invalid age')
                    continue
                if not diagnosis_input:
                    results['errors'].append(f'Row {row_num}: Missing diagnosis')
                    continue

                diagnosis, found = find_closest_disease(diagnosis_input)
                if not found:
                    results['errors'].append(f"Row {row_num}: Unknown disease '{diagnosis_input}'")
                    continue
                if diagnosis != diagnosis_input:
                    results['warnings'].append(f"Row {row_num}: '{diagnosis_input}' corrected to '{diagnosis}'")

                valid_symptoms = []
                invalid_symptoms = []
                if symptoms_raw:
                    for sym in symptoms_raw.split(','):
                        normalized = normalize_symptom(sym)
                        if normalized in VALID_SYMPTOMS:
                            valid_symptoms.append(normalized)
                        else:
                            invalid_symptoms.append(sym.strip())
                if invalid_symptoms:
                    results['warnings'].append(f"Row {row_num}: Skipped unknown symptoms: {', '.join(invalid_symptoms)}")

                if gender not in ['male', 'female', 'other']:
                    gender = 'male'

                HospitalPatient.objects.create(
                    hospital_id=hospital,
                    added_by=request.user,
                    full_name=full_name,
                    age=int(age),
                    gender=gender,
                    blood_group=blood_group,
                    symptoms=valid_symptoms,
                    diagnosis=diagnosis,
                    notes=notes,
                    source='import',
                )
                results['success'].append(f'{full_name} ({diagnosis})')

            except Exception as e:
                results['errors'].append(f'Row {row_num}: {str(e)}')

        log_audit(
            request.user, f"Imported {len(results['success'])} patients via CSV",
            module='hospital',
        )
        return ok(
            f"Import complete! {len(results['success'])} patients added.",
            {
                'imported': len(results['success']),
                'warnings': len(results['warnings']),
                'errors': len(results['errors']),
                'success_list': results['success'][:10],
                'warning_list': results['warnings'],
                'error_list': results['errors'],
            },
        )


class ParseCSVHeadersView(APIView):
    """Read ONLY the header row + a small preview of an uploaded CSV so the
    frontend can build a smart column-mapper for custom hospital formats.
    Does not import anything."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]
    parser_classes = [MultiPartParser]

    def post(self, request):
        csv_file = request.FILES.get('file')
        if not csv_file:
            return err('No file uploaded!')

        try:
            raw = csv_file.read()
            try:
                content = raw.decode('utf-8-sig')
            except UnicodeDecodeError:
                content = raw.decode('latin-1')

            reader = csv.reader(io.StringIO(content))
            rows = list(reader)
            if not rows:
                return err('CSV file is empty!')

            headers = [h.strip() for h in rows[0] if h.strip()]
            # Skip fully-empty rows (template files pad with blank lines).
            data_rows = [r for r in rows[1:] if any((c or '').strip() for c in r)]

            return ok('CSV parsed', {
                'headers': headers,
                'preview_rows': data_rows[:3],
                'total_rows': len(data_rows),
                'filename': csv_file.name,
            })
        except Exception as e:  # noqa: BLE001
            return err(f'Cannot read file: {e}', status=400)


class ImportMappedCSVView(APIView):
    """Import offline patient records from a custom-format CSV using a
    user-supplied column mapping. Records are stored as HospitalPatient rows
    (source='import') for FL training / prediction only — NO login is created.
    Diagnosis + symptoms are normalised to the known vocab so the data stays
    usable by the FL export."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]
    parser_classes = [MultiPartParser]

    DATE_FORMATS = ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y', '%Y/%m/%d']
    VALID_BLOOD_GROUPS = {'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'}

    def post(self, request):
        import json
        import re
        from datetime import datetime

        hospital = get_hospital(request)
        csv_file = request.FILES.get('file')
        if not csv_file:
            return err('No file!')

        try:
            mapping = json.loads(request.data.get('mapping', '{}'))
        except (ValueError, TypeError):
            return err('Invalid column mapping!')

        # full_name is the only required mapping.
        if not mapping.get('full_name') or mapping.get('full_name') == 'skip':
            return err('Please map the Full Name column!')

        def cell(row, field):
            src = mapping.get(field)
            if not src or src == 'skip':
                return ''
            return (row.get(src) or '').strip()

        try:
            raw = csv_file.read()
            try:
                content = raw.decode('utf-8-sig')
            except UnicodeDecodeError:
                content = raw.decode('latin-1')
            reader = csv.DictReader(io.StringIO(content))

            success_count = 0
            error_count = 0
            error_rows = []
            batch = []
            BATCH_SIZE = 100

            for row_num, row in enumerate(reader, start=2):
                try:
                    full_name = cell(row, 'full_name')[:120]
                    if not full_name:
                        continue  # silently skip blank rows

                    record = {
                        'hospital_id': hospital,
                        'added_by': request.user,
                        'source': 'import',
                        'full_name': full_name,
                    }

                    age_raw = cell(row, 'age')
                    if age_raw:
                        try:
                            age = int(float(age_raw))
                            if 0 < age < 150:
                                record['age'] = age
                        except (ValueError, TypeError):
                            pass

                    gender_raw = cell(row, 'gender').lower()
                    if gender_raw:
                        if gender_raw.startswith('m'):
                            record['gender'] = 'male'
                        elif gender_raw.startswith('f'):
                            record['gender'] = 'female'
                        else:
                            record['gender'] = 'other'

                    bg = cell(row, 'blood_group').upper().replace(' ', '')
                    if bg in self.VALID_BLOOD_GROUPS:
                        record['blood_group'] = bg

                    diag_raw = cell(row, 'primary_diagnosis')
                    if diag_raw:
                        canonical, found = find_closest_disease(diag_raw)
                        record['diagnosis'] = (canonical if found else diag_raw)[:200]

                    sym_raw = cell(row, 'symptoms')
                    if sym_raw:
                        symptoms = []
                        for token in re.split(r'[,;|]', sym_raw):
                            norm = normalize_symptom(token)
                            if norm and norm in VALID_SYMPTOMS and norm not in symptoms:
                                symptoms.append(norm)
                        record['symptoms'] = symptoms

                    meds = cell(row, 'medications')
                    if meds:
                        record['medications'] = meds[:1000]

                    visit_raw = cell(row, 'visit_date')
                    if visit_raw:
                        for fmt in self.DATE_FORMATS:
                            try:
                                record['visit_date'] = datetime.strptime(visit_raw, fmt).date()
                                break
                            except ValueError:
                                continue

                    batch.append(HospitalPatient(**record))
                    success_count += 1

                    if len(batch) >= BATCH_SIZE:
                        HospitalPatient.objects.bulk_create(batch, ignore_conflicts=True)
                        batch = []

                except Exception as e:  # noqa: BLE001
                    error_count += 1
                    if len(error_rows) < 20:
                        error_rows.append({'row': row_num, 'error': str(e)})

            if batch:
                HospitalPatient.objects.bulk_create(batch, ignore_conflicts=True)

            log_audit(
                request.user, f'Imported {success_count} patients via mapped CSV',
                module='hospital',
            )
            return ok(f'Successfully imported {success_count} patient records!', {
                'imported': success_count,
                'errors': error_count,
                'error_rows': error_rows,
            })
        except Exception as e:  # noqa: BLE001
            return err(f'Import failed: {e}', status=500)


class DownloadCSVTemplateView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="federcare_patients_template.csv"'

        writer = csv.writer(response)
        writer.writerow(['full_name', 'age', 'gender', 'blood_group', 'diagnosis', 'symptoms', 'notes'])
        writer.writerow([
            'INSTRUCTIONS →', '1-120', 'male/female/other',
            'A+/A-/B+/B-/O+/O-/AB+/AB-', 'See valid diseases below',
            'comma_separated_symptoms', 'optional',
        ])
        writer.writerow(['Rahul Sharma', '45', 'male', 'O+', 'Diabetes', 'fatigue,weight_loss,polyuria,excessive_hunger', 'Type 2 diabetes'])
        writer.writerow(['Priya Nair', '32', 'female', 'B+', 'Malaria', 'chills,high_fever,sweating,headache,nausea', 'Mild case'])
        writer.writerow(['John Thomas', '28', 'male', 'A+', 'Common Cold', 'continuous_sneezing,chills,fatigue,cough', ''])

        for _ in range(20):
            writer.writerow(['', '', '', '', '', '', ''])

        writer.writerow([])
        writer.writerow(['=== VALID DISEASE NAMES ==='])
        for disease in VALID_DISEASES:
            writer.writerow([disease])

        writer.writerow([])
        writer.writerow(['=== VALID SYMPTOM NAMES ==='])
        for i in range(0, len(VALID_SYMPTOMS), 4):
            writer.writerow(VALID_SYMPTOMS[i:i + 4])

        return response


class GenerateDemoPatientsView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request):
        import random

        hospital = get_hospital(request)
        count = min(int(request.data.get('count', 30)), 50)

        existing = HospitalPatient.objects.filter(hospital_id=hospital).count()
        if existing >= 30:
            return err(f'Hospital already has {existing} patients. No need to generate!')

        diseases_to_use = list(DISEASE_SYMPTOMS_MAP.keys())
        blood_groups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']

        male_names = DEMO_NAMES_MALE.copy()
        female_names = DEMO_NAMES_FEMALE.copy()
        random.shuffle(male_names)
        random.shuffle(female_names)

        created = []
        for i in range(count):
            gender = 'male' if i % 2 == 0 else 'female'
            if gender == 'male' and male_names:
                name = male_names.pop(0)
            elif gender == 'female' and female_names:
                name = female_names.pop(0)
            else:
                name = f'Patient {existing + i + 1}'

            disease = diseases_to_use[i % len(diseases_to_use)]
            base_symptoms = DISEASE_SYMPTOMS_MAP.get(disease, ['fatigue', 'headache'])
            symptoms = base_symptoms[:random.randint(5, min(7, len(base_symptoms)))]

            if disease in ['Diabetes', 'Hypertension', 'Heart attack']:
                age = random.randint(40, 70)
            elif disease in ['Common Cold', 'Allergy', 'Dengue']:
                age = random.randint(15, 45)
            else:
                age = random.randint(20, 60)

            HospitalPatient.objects.create(
                hospital_id=hospital,
                added_by=request.user,
                full_name=name,
                age=age,
                gender=gender,
                blood_group=random.choice(blood_groups),
                symptoms=symptoms,
                diagnosis=disease,
                notes='Auto-generated demo patient',
                source='demo',
            )
            created.append({'name': name, 'diagnosis': disease, 'age': age})

        log_audit(
            request.user, f'Generated {len(created)} demo patients',
            module='hospital',
        )
        return ok(
            f'{len(created)} demo patients generated successfully!',
            {
                'generated': len(created),
                'total_patients': existing + len(created),
                'patients': created,
            },
            status=201,
        )


class UploadImageView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        image = request.FILES.get('image')
        if not image:
            return err('No image provided.')

        try:
            from utils import save_upload_locally
            image_url = save_upload_locally(image, subdir='products', request=request, prefix='product')
            return ok('Image uploaded successfully.', {'image_url': image_url})
        except Exception as e:
            print(f'[UploadImage] Local upload error: {e}')
            return err(f'Upload failed: {str(e)}', status=500)


class DoctorScheduleView(APIView):
    """Hospital admin — full doctor schedule for a given day with per-slot
    status (available / booked / in_progress / completed / past) and a
    per-doctor availability bucket."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        from datetime import date as date_cls, datetime
        from django.utils import timezone
        from apps.doctor.models import DoctorRegistration, DoctorSlot, Consultation

        hospital = get_hospital(request)
        if not hospital:
            return err('Hospital profile not found.', status=404)

        selected_date_str = request.GET.get('date', str(date_cls.today()))
        try:
            selected_date = datetime.strptime(selected_date_str, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            selected_date = date_cls.today()

        doctors = DoctorRegistration.objects.filter(
            hospital_id=hospital,
            approval_status='approved',
        )

        now = timezone.localtime(timezone.now())
        current_time = now.time()
        is_today = selected_date == date_cls.today()

        schedule = []
        for doctor in doctors:
            slots = DoctorSlot.objects.filter(
                doctor_id=doctor,
                slot_date=selected_date,
            ).order_by('start_time')

            slot_list = []
            for slot in slots:
                consultation = Consultation.objects.filter(
                    slot_id=slot,
                    status__in=['scheduled', 'active', 'completed'],
                ).select_related('patient_id').first()

                if slot.is_booked and consultation:
                    if consultation.status == 'completed':
                        slot_status = 'completed'
                    elif is_today and slot.start_time <= current_time <= slot.end_time:
                        slot_status = 'in_progress'
                    elif is_today and slot.end_time < current_time:
                        slot_status = 'past'
                    else:
                        slot_status = 'booked'
                elif is_today and slot.end_time < current_time:
                    slot_status = 'past'
                else:
                    slot_status = 'available'

                slot_list.append({
                    'slot_id': str(slot.slot_id),
                    'start_time': str(slot.start_time),
                    'end_time': str(slot.end_time),
                    'consult_type': slot.consult_type,
                    'is_booked': slot.is_booked,
                    'status': slot_status,
                    'patient_name': consultation.patient_id.full_name if consultation else None,
                    'consultation_id': str(consultation.consultation_id) if consultation else None,
                })

            has_active = any(s['status'] == 'in_progress' for s in slot_list)
            has_upcoming = any(s['status'] in ('available', 'booked') for s in slot_list)

            if has_active:
                availability = 'in_consultation'
            elif has_upcoming:
                availability = 'has_slots'
            elif slot_list:
                availability = 'done_for_day'
            else:
                availability = 'no_slots'

            schedule.append({
                'doctor_id': str(doctor.doctor_id),
                'full_name': doctor.full_name,
                'specialization': getattr(doctor, 'specialization', '') or '',
                'availability': availability,
                'total_slots': len(slot_list),
                'booked_slots': sum(1 for s in slot_list if s['is_booked']),
                'completed_slots': sum(1 for s in slot_list if s['status'] == 'completed'),
                'slots': slot_list,
            })

        order = {'in_consultation': 0, 'has_slots': 1, 'done_for_day': 2, 'no_slots': 3}
        schedule.sort(key=lambda x: order.get(x['availability'], 4))

        summary = {
            'total_doctors': len(schedule),
            'in_consultation': sum(1 for d in schedule if d['availability'] == 'in_consultation'),
            'has_slots': sum(1 for d in schedule if d['availability'] == 'has_slots'),
            'done_for_day': sum(1 for d in schedule if d['availability'] == 'done_for_day'),
            'no_slots': sum(1 for d in schedule if d['availability'] == 'no_slots'),
            'selected_date': str(selected_date),
            'is_today': is_today,
        }

        return Response({
            'success': True,
            'message': 'Doctor schedule retrieved.',
            'data': schedule,
            'summary': summary,
        })


# ─── Lab slot configuration (Option B+) ─────────────────────────────────────

class HospitalLabConfigView(APIView):
    """Hospital admin reads/updates its lab availability config. Saving
    regenerates upcoming LabSlots so patients see the new availability."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        from apps.lab.models import HospitalLabConfig

        hospital = get_hospital(request)
        if not hospital:
            return err('Hospital profile not found.', status=404)

        # Do NOT auto-create here — a config row exists only once the admin has
        # deliberately saved one. Until then patients can't book this lab.
        config = HospitalLabConfig.objects.filter(hospital_id=hospital).first()
        if not config:
            return ok('Lab not configured yet', {
                'config_id': None,
                'configured': False,
                'working_days': [0, 1, 2, 3, 4, 5],
                'start_time': '08:00',
                'end_time': '18:00',
                'slot_duration_minutes': 30,
                'max_patients_per_slot': 5,
                'lunch_break_start': '13:00',
                'lunch_break_end': '14:00',
                'is_active': False,
            })
        return ok('Lab config fetched', {
            'config_id': str(config.config_id),
            'configured': True,
            'working_days': config.working_days,
            'start_time': config.start_time.strftime('%H:%M'),
            'end_time': config.end_time.strftime('%H:%M'),
            'slot_duration_minutes': config.slot_duration_minutes,
            'max_patients_per_slot': config.max_patients_per_slot,
            'lunch_break_start': config.lunch_break_start.strftime('%H:%M') if config.lunch_break_start else None,
            'lunch_break_end': config.lunch_break_end.strftime('%H:%M') if config.lunch_break_end else None,
            'is_active': config.is_active,
        })

    def put(self, request):
        from datetime import time
        from apps.lab.models import HospitalLabConfig
        from apps.lab.utils import generate_lab_slots

        hospital = get_hospital(request)
        if not hospital:
            return err('Hospital profile not found.', status=404)

        config, _ = HospitalLabConfig.objects.get_or_create(hospital_id=hospital)

        def parse_time(value):
            parts = str(value).split(':')
            return time(int(parts[0]), int(parts[1]))

        d = request.data
        if 'working_days' in d:
            config.working_days = d['working_days']
        if d.get('start_time'):
            config.start_time = parse_time(d['start_time'])
        if d.get('end_time'):
            config.end_time = parse_time(d['end_time'])
        if 'slot_duration_minutes' in d:
            config.slot_duration_minutes = int(d['slot_duration_minutes'])
        if 'max_patients_per_slot' in d:
            config.max_patients_per_slot = int(d['max_patients_per_slot'])
        if d.get('lunch_break_start'):
            config.lunch_break_start = parse_time(d['lunch_break_start'])
        if d.get('lunch_break_end'):
            config.lunch_break_end = parse_time(d['lunch_break_end'])
        config.save()

        generate_lab_slots(hospital, days_ahead=30)
        return ok('Lab config updated! Slots regenerated.', {'config_id': str(config.config_id)})
