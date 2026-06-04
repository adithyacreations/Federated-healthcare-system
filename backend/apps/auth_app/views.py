import hashlib
import io
import base64
from decimal import Decimal
from datetime import date, datetime
from uuid import UUID

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.tokens import RefreshToken

from .models import LoginCredentials, LoginSession, Developer, ProjectFeature
from .serializers import (
    LoginSerializer,
    PatientRegisterSerializer,
    HospitalRegisterSerializer,
    PharmacistRegisterSerializer,
    VendorRegisterSerializer,
)
from .permissions import IsSuperAdmin
from utils import log_audit, send_notification
from email_utils import (
    send_welcome_email,
    send_approval_email,
    send_password_change_email,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def ok(message, data=None, status=200):
    return Response({'success': True, 'message': message, 'data': data or {}}, status=status)


def err(message, errors=None, status=400):
    return Response({'success': False, 'message': message, 'errors': errors or {}}, status=status)


def make_tokens(login_obj):
    """Create access + refresh JWT tokens with login_id and role as custom claims."""
    refresh = RefreshToken()
    refresh['login_id'] = str(login_obj.login_id)
    refresh['role'] = login_obj.role
    return str(refresh.access_token), str(refresh)


def instance_to_dict(obj):
    """Serialize a Django model instance to a JSON-safe dict."""
    if obj is None:
        return {}
    result = {}
    for field in obj._meta.fields:
        value = getattr(obj, field.attname)
        if isinstance(value, UUID):
            result[field.name] = str(value)
        elif isinstance(value, Decimal):
            result[field.name] = float(value)
        elif isinstance(value, datetime):
            result[field.name] = value.isoformat() if value else None
        elif isinstance(value, date):
            result[field.name] = value.isoformat() if value else None
        else:
            result[field.name] = value
    return result


def get_profile(login_obj):
    """Return the role-specific profile dict for a LoginCredentials object."""
    role = login_obj.role
    try:
        mapping = {
            'super_admin': 'super_admin_profile',
            'hospital_admin': 'hospital_profile',
            'doctor': 'doctor_profile',
            'patient': 'patient_profile',
            'pharmacist': 'pharmacist_profile',
            'lab_tech': 'lab_tech_profile',
            'driver': 'driver_profile',
            'vendor': 'vendor_profile',
        }
        related_name = mapping.get(role)
        if not related_name:
            return {}
        profile = getattr(login_obj, related_name, None)
        return instance_to_dict(profile)
    except Exception:
        return {}


def save_session(login_obj, access_token_str, request):
    """Persist a LoginSession for the newly issued access token."""
    token_hash = hashlib.sha256(access_token_str.encode()).hexdigest()
    LoginSession.objects.create(
        login_id=login_obj,
        jwt_token_hash=token_hash,
        ip_address=request.META.get('REMOTE_ADDR'),
        device_info=request.headers.get('User-Agent', ''),
        expires_at=timezone.now() + timezone.timedelta(minutes=60),
    )


def generate_qr_code(patient_id):
    """Generate a base64-encoded PNG QR code for the patient's EHR wallet."""
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(f"federcare:patient:{patient_id}")
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""


def notify_super_admins(title, message):
    """Send a notification to every active super admin."""
    for sa in LoginCredentials.objects.filter(role='super_admin', is_active=True):
        send_notification(sa, title, message, notif_type='approval')


MAX_ACCOUNTS_PER_PHONE = 5


def check_phone_limit(phone_number):
    """Return (can_register, existing_count) for a phone number.

    A single phone number may back at most MAX_ACCOUNTS_PER_PHONE accounts.
    Empty phone numbers are never limited.
    """
    phone = (phone_number or '').replace(' ', '')
    if not phone:
        return True, 0
    count = LoginCredentials.objects.filter(phone_number=phone).count()
    return count < MAX_ACCOUNTS_PER_PHONE, count


def phone_limit_error(phone_number):
    """If the phone is at its account limit, return an error Response; else None."""
    can_register, existing_count = check_phone_limit(phone_number)
    if not can_register:
        return err(
            f'This phone number already has {existing_count} registered accounts. '
            f'Maximum {MAX_ACCOUNTS_PER_PHONE} accounts per phone number allowed.',
            {'phone_number': 'Maximum 5 accounts reached for this number'},
            status=400,
        )
    return None


# ─── Views ────────────────────────────────────────────────────────────────────

class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except AuthenticationFailed as e:
            return err(str(e.detail), status=401)
        except PermissionDenied as e:
            return err(str(e.detail), status=403)

        user = serializer.validated_data['user']
        access_token, refresh_token = make_tokens(user)

        # Update last login
        user.last_login = timezone.now()
        user.login_attempts = 0
        user.save(update_fields=['last_login', 'login_attempts', 'updated_at'])

        save_session(user, access_token, request)
        log_audit(user, 'user_login', module='auth', entity_type='LoginCredentials',
                  entity_id=user.login_id, ip_address=request.META.get('REMOTE_ADDR'))

        # Pharmacist: surface any expiry / low-stock issues right at login so
        # the bell lights up before they even look at the dashboard.
        if user.role == 'pharmacist':
            try:
                from datetime import timedelta
                from apps.pharmacy.models import PharmacyInventory, PharmacistRegistration

                pharmacist = PharmacistRegistration.objects.get(login_id=user)
                today = date.today()
                warning_date = today + timedelta(days=30)

                expiring_soon = PharmacyInventory.objects.filter(
                    pharmacy_id=pharmacist,
                    expiry_date__lte=warning_date,
                    expiry_date__gte=today,
                ).count()
                expired = PharmacyInventory.objects.filter(
                    pharmacy_id=pharmacist,
                    expiry_date__lt=today,
                    stock_quantity__gt=0,
                ).count()
                low_stock = PharmacyInventory.objects.filter(
                    pharmacy_id=pharmacist,
                    stock_quantity__lte=10,
                ).count()

                alerts = []
                if expired > 0:
                    alerts.append(f'🚫 {expired} expired medicine(s)!')
                if expiring_soon > 0:
                    alerts.append(f'⚠️ {expiring_soon} expiring soon!')
                if low_stock > 0:
                    alerts.append(f'📦 {low_stock} low stock item(s)!')

                if alerts:
                    send_notification(
                        user,
                        '⚠️ Inventory Alert',
                        ' | '.join(alerts),
                        notif_type='alert',
                    )
                    print(f'[PHARMACY] Login alert: {alerts}')
            except Exception as e:
                print(f'Login check error: {e}')

        return ok('Login successful', {
            'access_token': access_token,
            'refresh_token': refresh_token,
            'role': user.role,
            'login_id': str(user.login_id),
            'profile': get_profile(user),
        })


class PatientRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from apps.patient.models import PatientRegistration

        serializer = PatientRegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors, status=400)

        d = serializer.validated_data

        limit_err = phone_limit_error(d.get('phone'))
        if limit_err:
            return limit_err

        login = LoginCredentials.objects.create(
            email=d['email'],
            phone_number=d.get('phone', ''),
            password_hash=make_password(d['password']),
            role='patient',
            is_active=True,
            is_approved=True,
        )

        # BMI calculation
        bmi = None
        if d.get('height_cm') and d.get('weight_kg'):
            h = float(d['height_cm']) / 100
            bmi = round(float(d['weight_kg']) / (h ** 2), 2)

        patient = PatientRegistration.objects.create(
            login_id=login,
            full_name=d['full_name'],
            dob=d['dob'],
            gender=d.get('gender', ''),
            blood_group=d.get('blood_group', ''),
            height_cm=d.get('height_cm'),
            weight_kg=d.get('weight_kg'),
            bmi=bmi,
            address=d.get('address', ''),
            emergency_contact=d.get('emergency_contact', ''),
        )

        patient.qr_code_url = generate_qr_code(str(patient.patient_id))
        patient.save(update_fields=['qr_code_url'])

        # No auto-login: the patient is sent to the login page to sign in with
        # the credentials they just created (no token issued, no session saved).
        log_audit(login, 'patient_registered', module='auth', entity_type='PatientRegistration',
                  entity_id=patient.patient_id)

        send_welcome_email(d['email'], d['full_name'], 'patient')

        return ok('Registration successful! Please log in.', {
            'email': login.email,
            'role': 'patient',
            'login_id': str(login.login_id),
            'patient_id': str(patient.patient_id),
            'redirect_to': '/login',
        }, status=201)


class HospitalRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from apps.hospital.models import HospitalRegistration

        serializer = HospitalRegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors, status=400)

        d = serializer.validated_data

        limit_err = phone_limit_error(d.get('contact_phone'))
        if limit_err:
            return limit_err

        login = LoginCredentials.objects.create(
            email=d['email'],
            phone_number=d.get('contact_phone', ''),
            password_hash=make_password(d['password']),
            role='hospital_admin',
            is_active=False,
            is_approved=False,
        )

        HospitalRegistration.objects.create(
            login_id=login,
            hospital_name=d['hospital_name'],
            registration_no=d['registration_no'],
            address=d['address'],
            city=d['city'],
            state=d.get('state', 'Kerala'),
            contact_phone=d.get('contact_phone', ''),
            contact_email=d.get('contact_email', ''),
            latitude=d.get('latitude'),
            longitude=d.get('longitude'),
            approval_status='pending',
        )

        notify_super_admins(
            'New Hospital Registration',
            f"{d['hospital_name']} ({d['city']}) has applied for registration.",
        )

        return ok('Registration submitted. Awaiting Super Admin approval.', status=201)


class PharmacistRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from apps.pharmacy.models import PharmacistRegistration

        serializer = PharmacistRegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors, status=400)

        d = serializer.validated_data

        limit_err = phone_limit_error(d.get('phone'))
        if limit_err:
            return limit_err

        login = LoginCredentials.objects.create(
            email=d['email'],
            phone_number=d.get('phone', ''),
            password_hash=make_password(d['password']),
            role='pharmacist',
            is_active=False,
            is_approved=False,
        )

        PharmacistRegistration.objects.create(
            login_id=login,
            pharmacy_name=d['pharmacy_name'],
            license_no=d['license_no'],
            full_name=d['full_name'],
            address=d.get('address', ''),
            approval_status='pending',
        )

        notify_super_admins(
            'New Pharmacist Registration',
            f"{d['full_name']} ({d['pharmacy_name']}) has applied for registration.",
        )

        return ok('Registration submitted. Awaiting Super Admin approval.', status=201)


class VendorRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from apps.vendor.models import VendorRegistration

        serializer = VendorRegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return err('Validation failed', serializer.errors, status=400)

        d = serializer.validated_data

        limit_err = phone_limit_error(d.get('phone'))
        if limit_err:
            return limit_err

        login = LoginCredentials.objects.create(
            email=d['email'],
            phone_number=d.get('phone', ''),
            password_hash=make_password(d['password']),
            role='vendor',
            is_active=False,
            is_approved=False,
        )

        VendorRegistration.objects.create(
            login_id=login,
            company_name=d['company_name'],
            tax_id=d['tax_id'],
            contact_name=d['contact_name'],
            phone=d.get('phone', ''),
            approval_status='pending',
        )

        notify_super_admins(
            'New Vendor Registration',
            f"{d['company_name']} has applied for vendor registration.",
        )

        return ok('Registration submitted. Awaiting Super Admin approval.', status=201)


class CheckPhoneView(APIView):
    """Lightweight, unauthenticated lookup used by the registration forms to
    show a live "X/5 accounts" counter for a phone number."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        import re
        phone = (request.data.get('phone_number') or '').replace(' ', '')

        if not re.match(r'^[6-9]\d{9}$', phone):
            return Response({
                'success': False,
                'valid_format': False,
                'message': 'Invalid phone number format',
            })

        count = LoginCredentials.objects.filter(phone_number=phone).count()
        return Response({
            'success': True,
            'valid_format': True,
            'count': count,
            'available': count < MAX_ACCOUNTS_PER_PHONE,
            'message': (
                f'{count}/{MAX_ACCOUNTS_PER_PHONE} accounts registered'
                if count > 0 else 'Phone available'
            ),
        })


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token_str = auth_header.split(' ', 1)[1]
            token_hash = hashlib.sha256(token_str.encode()).hexdigest()
            LoginSession.objects.filter(
                login_id=request.user, jwt_token_hash=token_hash
            ).delete()
        return ok('Logged out successfully')


class GetProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = get_profile(request.user)
        return ok('Profile fetched', {
            'login_id': str(request.user.login_id),
            'email': request.user.email,
            'role': request.user.role,
            'created_at': request.user.created_at.isoformat() if request.user.created_at else None,
            'profile': profile,
        })


class GetPendingApprovalsView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        from apps.hospital.models import HospitalRegistration
        from apps.pharmacy.models import PharmacistRegistration
        from apps.vendor.models import VendorRegistration

        hospitals = [
            {
                'login_id': str(h.login_id.login_id),
                'email': h.login_id.email,
                'hospital_name': h.hospital_name,
                'registration_no': h.registration_no,
                'city': h.city,
                'state': h.state,
                'contact_phone': h.contact_phone,
                'created_at': h.created_at.isoformat(),
            }
            for h in HospitalRegistration.objects.filter(
                approval_status='pending'
            ).select_related('login_id')
        ]

        pharmacists = [
            {
                'login_id': str(p.login_id.login_id),
                'email': p.login_id.email,
                'full_name': p.full_name,
                'pharmacy_name': p.pharmacy_name,
                'license_no': p.license_no,
                'created_at': p.created_at.isoformat(),
            }
            for p in PharmacistRegistration.objects.filter(
                approval_status='pending'
            ).select_related('login_id')
        ]

        vendors = [
            {
                'login_id': str(v.login_id.login_id),
                'email': v.login_id.email,
                'company_name': v.company_name,
                'contact_name': v.contact_name,
                'tax_id': v.tax_id,
                'created_at': v.created_at.isoformat(),
            }
            for v in VendorRegistration.objects.filter(
                approval_status='pending'
            ).select_related('login_id')
        ]

        return ok('Pending approvals fetched', {
            'hospitals': hospitals,
            'pharmacists': pharmacists,
            'vendors': vendors,
            'total': len(hospitals) + len(pharmacists) + len(vendors),
        })


class ApproveEntityView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def post(self, request, login_id):
        try:
            login = LoginCredentials.objects.get(login_id=login_id)
        except LoginCredentials.DoesNotExist:
            return err('User not found', status=404)

        login.is_active = True
        login.is_approved = True
        login.save(update_fields=['is_active', 'is_approved', 'updated_at'])

        role = login.role
        if role == 'hospital_admin':
            from apps.hospital.models import HospitalRegistration
            HospitalRegistration.objects.filter(login_id=login).update(approval_status='approved')
        elif role == 'pharmacist':
            from apps.pharmacy.models import PharmacistRegistration
            PharmacistRegistration.objects.filter(login_id=login).update(approval_status='approved')
        elif role == 'vendor':
            from apps.vendor.models import VendorRegistration
            VendorRegistration.objects.filter(login_id=login).update(approval_status='approved')

        send_notification(
            login,
            'Account Approved',
            'Your FederCare account has been approved. You can now log in.',
            notif_type='approval',
        )
        log_audit(
            request.user, f'{role}_approved', module='auth',
            entity_type='LoginCredentials', entity_id=login_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        send_approval_email(login.email, login.email, role, 'approved')

        return ok(f'Account approved successfully')


class RejectEntityView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def post(self, request, login_id):
        try:
            login = LoginCredentials.objects.get(login_id=login_id)
        except LoginCredentials.DoesNotExist:
            return err('User not found', status=404)

        role = login.role
        if role == 'hospital_admin':
            from apps.hospital.models import HospitalRegistration
            HospitalRegistration.objects.filter(login_id=login).update(approval_status='rejected')
        elif role == 'pharmacist':
            from apps.pharmacy.models import PharmacistRegistration
            PharmacistRegistration.objects.filter(login_id=login).update(approval_status='rejected')
        elif role == 'vendor':
            from apps.vendor.models import VendorRegistration
            VendorRegistration.objects.filter(login_id=login).update(approval_status='rejected')

        send_notification(
            login,
            'Account Rejected',
            'Your FederCare registration has been reviewed and rejected. Contact support for details.',
            notif_type='approval',
        )
        log_audit(
            request.user, f'{role}_rejected', module='auth',
            entity_type='LoginCredentials', entity_id=login_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        send_approval_email(login.email, login.email, role, 'rejected')

        return ok('Account rejected')


# ─── Super Admin Dashboard ────────────────────────────────────────────────────

class SuperAdminDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        from apps.hospital.models import HospitalRegistration
        from apps.doctor.models import DoctorRegistration, Consultation, Prescription
        from apps.patient.models import PatientRegistration
        from apps.pharmacy.models import PharmacistRegistration
        from apps.vendor.models import VendorRegistration
        from apps.emergency.models import EmergencyRequest
        from apps.federated.models import FLRound, EpidemicTrend
        from apps.lab.models import LabReport

        pending_hospitals = HospitalRegistration.objects.filter(approval_status='pending').count()
        pending_pharmacists = PharmacistRegistration.objects.filter(approval_status='pending').count()
        pending_vendors = VendorRegistration.objects.filter(approval_status='pending').count()

        active_round = (
            FLRound.objects
            .filter(status__in=['pending', 'training', 'aggregating'])
            .select_related('model_id')
            .first()
        )

        return ok('Dashboard fetched', {
            'total_hospitals': HospitalRegistration.objects.filter(approval_status='approved').count(),
            'total_doctors': DoctorRegistration.objects.count(),
            'total_patients': PatientRegistration.objects.count(),
            'total_pharmacists': PharmacistRegistration.objects.filter(approval_status='approved').count(),
            'total_vendors': VendorRegistration.objects.filter(approval_status='approved').count(),
            'pending_approvals': pending_hospitals + pending_pharmacists + pending_vendors,
            'active_fl_round': {
                'round_id': str(active_round.round_id),
                'round_number': active_round.round_number,
                'status': active_round.status,
                'hospitals_invited': active_round.hospitals_invited,
                'hospitals_completed': active_round.hospitals_completed,
                'model_version': active_round.model_id.version,
            } if active_round else None,
            'epidemic_alerts': EpidemicTrend.objects.filter(spike_detected=True).count(),
            'total_consultations': Consultation.objects.count(),
            'total_emergency_requests': EmergencyRequest.objects.count(),
            'total_prescriptions': Prescription.objects.count(),
            'total_lab_reports': LabReport.objects.count(),
        })


# ─── Audit Logs ───────────────────────────────────────────────────────────────

class SystemAuditLogsView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        from .models import AuditLog
        from django.db.models import Q

        search = request.query_params.get('search', '').strip()
        module_filter = request.query_params.get('module', '').strip()
        date_from = request.query_params.get('date_from', '').strip()
        date_to = request.query_params.get('date_to', '').strip()
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except ValueError:
            page = 1
        page_size = 20
        offset = (page - 1) * page_size

        qs = AuditLog.objects.select_related('login_id').order_by('-logged_at')
        if search:
            qs = qs.filter(Q(action__icontains=search) | Q(module__icontains=search))
        if module_filter:
            qs = qs.filter(module=module_filter)
        if date_from:
            qs = qs.filter(logged_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(logged_at__date__lte=date_to)

        distinct_modules = list(
            AuditLog.objects.values_list('module', flat=True).distinct().order_by('module')
        )

        total = qs.count()
        logs = qs[offset: offset + page_size]

        return ok('Audit logs fetched', {
            'total': total,
            'page': page,
            'pages': max(1, (total + page_size - 1) // page_size),
            'modules': distinct_modules,
            'logs': [
                {
                    'log_id': str(log.log_id),
                    'action': log.action,
                    'module': log.module,
                    'entity_type': log.entity_type,
                    'login_email': log.login_id.email if log.login_id else None,
                    'ip_address': log.ip_address,
                    'logged_at': log.logged_at.isoformat(),
                }
                for log in logs
            ],
        })


# ─── All Users ────────────────────────────────────────────────────────────────

class AllUsersView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        from apps.hospital.models import HospitalRegistration
        from apps.doctor.models import DoctorRegistration
        from apps.patient.models import PatientRegistration
        from apps.pharmacy.models import PharmacistRegistration
        from apps.vendor.models import VendorRegistration
        from apps.lab.models import LabTechRegistration
        from apps.emergency.models import AmbulanceDriverRegistration

        def base(login):
            return {
                'login_id': str(login.login_id),
                'email': login.email,
                'role': login.role,
                'is_active': login.is_active,
                'is_approved': login.is_approved,
                'created_at': login.created_at.isoformat(),
            }

        hospital_admins = []
        for h in HospitalRegistration.objects.select_related('login_id').all():
            d = base(h.login_id)
            d.update({'hospital_name': h.hospital_name, 'city': h.city,
                      'approval_status': h.approval_status})
            hospital_admins.append(d)

        doctors = []
        for doc in DoctorRegistration.objects.select_related('login_id', 'hospital_id').all():
            d = base(doc.login_id)
            d.update({'full_name': doc.full_name, 'specialization': doc.specialization,
                      'hospital_name': doc.hospital_id.hospital_name})
            doctors.append(d)

        patients = []
        patient_qs = PatientRegistration.objects.select_related('login_id').prefetch_related(
            'risk_assessments', 'ehr_records'
        ).all()
        for p in patient_qs:
            d = base(p.login_id)
            latest_risk = p.risk_assessments.first()
            ehr_records = list(p.ehr_records.all())
            ehr_by_type = {}
            for r in ehr_records:
                ehr_by_type[r.record_type] = ehr_by_type.get(r.record_type, 0) + 1
            recent_ehr = [
                {
                    'record_id': str(r.record_id),
                    'record_type': r.record_type,
                    'title': r.title,
                    'recorded_at': r.recorded_at.isoformat(),
                }
                for r in ehr_records[:5]
            ]
            d.update({
                'patient_id': str(p.patient_id),
                'full_name': p.full_name,
                'blood_group': p.blood_group,
                'gender': p.gender,
                'dob': p.dob.isoformat() if p.dob else None,
                'bmi': float(p.bmi) if p.bmi else None,
                'risk_level': latest_risk.risk_level if latest_risk else None,
                'diabetes_risk': float(latest_risk.diabetes_risk) if latest_risk and latest_risk.diabetes_risk else None,
                'heart_risk': float(latest_risk.heart_risk) if latest_risk and latest_risk.heart_risk else None,
                'hypertension_risk': float(latest_risk.hypertension_risk) if latest_risk and latest_risk.hypertension_risk else None,
                'ehr_count': len(ehr_records),
                'ehr_by_type': ehr_by_type,
                'recent_ehr': recent_ehr,
            })
            patients.append(d)

        pharmacists = []
        for ph in PharmacistRegistration.objects.select_related('login_id').all():
            d = base(ph.login_id)
            d.update({'full_name': ph.full_name, 'pharmacy_name': ph.pharmacy_name,
                      'approval_status': ph.approval_status})
            pharmacists.append(d)

        vendors = []
        for v in VendorRegistration.objects.select_related('login_id').all():
            d = base(v.login_id)
            d.update({'company_name': v.company_name, 'contact_name': v.contact_name,
                      'approval_status': v.approval_status})
            vendors.append(d)

        lab_techs = []
        for lt in LabTechRegistration.objects.select_related('login_id', 'hospital_id').all():
            d = base(lt.login_id)
            d.update({'full_name': lt.full_name, 'hospital_name': lt.hospital_id.hospital_name})
            lab_techs.append(d)

        drivers = []
        for dr in AmbulanceDriverRegistration.objects.select_related('login_id', 'hospital_id').all():
            d = base(dr.login_id)
            d.update({'full_name': dr.full_name, 'hospital_name': dr.hospital_id.hospital_name})
            drivers.append(d)

        return ok('Users fetched', {
            'hospital_admins': hospital_admins,
            'doctors': doctors,
            'patients': patients,
            'pharmacists': pharmacists,
            'vendors': vendors,
            'lab_techs': lab_techs,
            'drivers': drivers,
            'total': (len(hospital_admins) + len(doctors) + len(patients)
                      + len(pharmacists) + len(vendors) + len(lab_techs) + len(drivers)),
        })


# ─── Role Permissions ─────────────────────────────────────────────────────────

class RolePermissionsView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        from .models import RolePermissions
        perms = RolePermissions.objects.all().order_by('role', 'module')
        grouped = {}
        for p in perms:
            grouped.setdefault(p.role, []).append({
                'permission_id': str(p.permission_id),
                'module': p.module,
                'can_read': p.can_read,
                'can_write': p.can_write,
                'can_delete': p.can_delete,
            })
        return ok('Role permissions fetched', grouped)

    def post(self, request):
        from .models import RolePermissions
        role = request.data.get('role', '').strip()
        module = request.data.get('module', '').strip()
        if not role or not module:
            return err('role and module are required')

        perm, created = RolePermissions.objects.get_or_create(role=role, module=module)
        perm.can_read = bool(request.data.get('can_read', perm.can_read))
        perm.can_write = bool(request.data.get('can_write', perm.can_write))
        perm.can_delete = bool(request.data.get('can_delete', perm.can_delete))
        perm.save()

        log_audit(request.user, 'role_permissions_updated', module='auth',
                  entity_type='RolePermissions', entity_id=perm.permission_id,
                  ip_address=request.META.get('REMOTE_ADDR'))

        return ok(
            'Permissions created' if created else 'Permissions updated',
            {
                'permission_id': str(perm.permission_id),
                'role': perm.role,
                'module': perm.module,
                'can_read': perm.can_read,
                'can_write': perm.can_write,
                'can_delete': perm.can_delete,
            },
            status=201 if created else 200,
        )


# ─── Notifications ────────────────────────────────────────────────────────────

class NotificationsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import Notification

        notifs_qs = Notification.objects.filter(login_id=request.user)

        if request.query_params.get('mark_all_read', '').lower() == 'true':
            notifs_qs.filter(is_read=False).update(is_read=True)

        notifs = notifs_qs.order_by('is_read', '-created_at')

        return ok('Notifications fetched', [
            {
                'notif_id': str(n.notif_id),
                'title': n.title,
                'message': n.message,
                'notif_type': n.notif_type,
                'is_read': n.is_read,
                'created_at': n.created_at.isoformat(),
            }
            for n in notifs
        ])


class MarkNotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, notif_id):
        from .models import Notification
        try:
            notif = Notification.objects.get(notif_id=notif_id, login_id=request.user)
        except Notification.DoesNotExist:
            return err('Notification not found', status=404)
        notif.is_read = True
        notif.save(update_fields=['is_read'])
        return ok('Notification marked as read', {'notif_id': str(notif.notif_id)})


# ─── System Stats ─────────────────────────────────────────────────────────────

class SystemStatsView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        from datetime import timedelta
        from django.db.models import Count
        from django.db.models.functions import TruncMonth

        from apps.doctor.models import Consultation
        from apps.emergency.models import EmergencyRequest
        from apps.hospital.models import HospitalRegistration
        from apps.federated.models import FLGlobalModel

        six_months_ago = timezone.now() - timedelta(days=180)

        # Registrations by month
        reg_qs = (
            LoginCredentials.objects
            .filter(created_at__gte=six_months_ago)
            .annotate(month=TruncMonth('created_at'))
            .values('month')
            .annotate(count=Count('login_id'))
            .order_by('month')
        )
        registrations_by_month = [
            {'month': r['month'].strftime('%Y-%m'), 'count': r['count']}
            for r in reg_qs
        ]

        # Consultations by month
        consult_qs = (
            Consultation.objects
            .filter(created_at__gte=six_months_ago)
            .annotate(month=TruncMonth('created_at'))
            .values('month')
            .annotate(count=Count('consultation_id'))
            .order_by('month')
        )
        consultations_by_month = [
            {'month': r['month'].strftime('%Y-%m'), 'count': r['count']}
            for r in consult_qs
        ]

        # Emergency by severity
        emergency_by_severity = {
            'high': EmergencyRequest.objects.filter(severity='high').count(),
            'critical': EmergencyRequest.objects.filter(severity='critical').count(),
        }

        # Top 5 hospitals by doctor count
        top_hospitals = (
            HospitalRegistration.objects
            .filter(approval_status='approved')
            .annotate(doctor_count=Count('doctors'))
            .order_by('-doctor_count')[:5]
        )
        top_hospitals_by_doctors = [
            {
                'hospital_name': h.hospital_name,
                'city': h.city,
                'doctor_count': h.doctor_count,
            }
            for h in top_hospitals
        ]

        # FL global model accuracy trend
        fl_models = (
            FLGlobalModel.objects
            .filter(accuracy__isnull=False)
            .order_by('created_at')[:10]
        )
        fl_accuracy_trend = [
            {
                'version': m.version,
                'accuracy': float(m.accuracy),
                'hospitals_count': m.hospitals_count,
                'created_at': m.created_at.strftime('%Y-%m-%d'),
            }
            for m in fl_models
        ]

        return ok('System stats fetched', {
            'registrations_by_month': registrations_by_month,
            'consultations_by_month': consultations_by_month,
            'emergency_by_severity': emergency_by_severity,
            'top_hospitals_by_doctors': top_hospitals_by_doctors,
            'fl_accuracy_trend': fl_accuracy_trend,
        })


# ─── Change Password ──────────────────────────────────────────────────────────

class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.contrib.auth.hashers import check_password

        current_password = request.data.get('current_password', '').strip()
        new_password = request.data.get('new_password', '').strip()

        if not current_password or not new_password:
            return err('current_password and new_password are required')

        if len(new_password) < 6:
            return err('New password must be at least 6 characters')

        login = request.user
        if not check_password(current_password, login.password_hash):
            return err('Current password is incorrect', status=400)

        login.password_hash = make_password(new_password)
        login.save(update_fields=['password_hash', 'updated_at'])

        log_audit(
            login, 'password_changed', module='auth',
            entity_type='LoginCredentials', entity_id=login.login_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        profile = get_profile(login)
        full_name = profile.get('full_name') or profile.get('contact_name') or login.email
        send_password_change_email(login.email, full_name)

        return ok('Password changed successfully')


# ─── Password Reset via OTP ───────────────────────────────────────────────────

class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        import random
        from django.core.cache import cache
        from email_utils import send_email

        email = (request.data.get('email') or '').strip().lower()
        if not email:
            return err('Email is required')

        try:
            LoginCredentials.objects.get(email=email)
        except LoginCredentials.DoesNotExist:
            # Same response either way — don't leak which emails exist.
            return ok('If this email exists, an OTP has been sent!')

        otp = str(random.randint(100000, 999999))
        cache.set(f'password_reset_otp_{email}', otp, timeout=600)  # 10 minutes

        html = f"""
        <div style="font-family: Arial; max-width: 600px; margin: 0 auto;">
            <div style="background: #F97316; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="color: white; margin: 0;">🔐 Password Reset OTP</h1>
            </div>
            <div style="background: #FAF7F2; padding: 30px; border-radius: 0 0 12px 12px;">
                <p style="color: #333;">You requested a password reset for your FederCare account.</p>
                <div style="background: white; border: 2px solid #F97316; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
                    <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">Your OTP Code:</p>
                    <p style="color: #F97316; font-size: 40px; font-weight: 800; letter-spacing: 8px; margin: 0;">{otp}</p>
                    <p style="color: #999; font-size: 12px; margin: 10px 0 0 0;">Valid for 10 minutes only</p>
                </div>
                <p style="color: #333;">Enter this OTP on the FederCare app to reset your password.</p>
                <div style="background: #FFF7ED; border-left: 4px solid #F97316; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #333; font-size: 13px;">
                        ⚠️ If you did not request this, ignore this email. Your account is safe.
                    </p>
                </div>
                <p style="color: #999; font-size: 12px;">
                    FederCare: AI Health Network<br>MRIT, Ayur, Kollam, Kerala
                </p>
            </div>
        </div>
        """
        try:
            send_email(email, 'FederCare: Password Reset OTP', html)
        except Exception as e:
            print(f'OTP email error: {e}')

        return ok('OTP sent to your email!')


class PasswordResetVerifyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        from django.contrib.auth.hashers import check_password
        from django.core.cache import cache
        from email_utils import send_email

        email = (request.data.get('email') or '').strip().lower()
        otp = (request.data.get('otp') or '').strip()
        current_password = request.data.get('current_password') or ''
        new_password = (request.data.get('new_password') or '').strip()

        if not email or not otp or not new_password:
            return err('email, otp and new_password are required')
        if len(new_password) < 6:
            return err('New password must be at least 6 characters')

        cache_key = f'password_reset_otp_{email}'
        stored_otp = cache.get(cache_key)
        if not stored_otp:
            return err('OTP expired! Request a new one.', status=400)
        if stored_otp != otp:
            return err('Invalid OTP!', status=400)

        try:
            user = LoginCredentials.objects.get(email=email)
        except LoginCredentials.DoesNotExist:
            return err('User not found!', status=404)

        # Current password is optional here so the plain "forgot password" flow
        # still works; when the secure reset modal supplies it, we verify it.
        if current_password:
            if not check_password(current_password, user.password_hash):
                return err('Current password is incorrect!', status=400)
            if current_password == new_password:
                return err('New password must be different from the current one!', status=400)

        user.password_hash = make_password(new_password)
        user.save(update_fields=['password_hash', 'updated_at'])
        cache.delete(cache_key)

        # Best-effort in-app notification (also surfaces in the bell on next login).
        try:
            send_notification(
                user, '🔐 Password Changed',
                'Your FederCare password was successfully changed.',
                notif_type='alert',
            )
        except Exception as e:
            print(f'Reset notification error: {e}')

        html = """
        <div style="font-family: Arial; max-width: 600px; margin: 0 auto;">
            <div style="background: #F97316; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="color: white; margin: 0;">✅ Password Reset Successful</h1>
            </div>
            <div style="background: #FAF7F2; padding: 30px; border-radius: 0 0 12px 12px;">
                <p style="color: #333;">Your FederCare password has been successfully reset.</p>
                <p style="color: #333;">You can now login with your new password.</p>
                <p style="color: #999; font-size: 12px;">FederCare: AI Health Network</p>
            </div>
        </div>
        """
        try:
            send_email(email, 'FederCare: Password Reset Successful', html)
        except Exception as e:
            print(f'Reset success email error: {e}')

        log_audit(
            user, 'password_reset_otp', module='auth',
            entity_type='LoginCredentials', entity_id=user.login_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Password changed successfully!')


class AuthenticatedPasswordResetView(APIView):
    """OTP-verified password reset for users already logged in (dashboards).

    Two actions on the same endpoint:
      - action='send_otp'          → emails an OTP to the logged-in user.
      - action='verify_and_reset'  → verifies OTP + current password, sets the new one.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import random
        from django.contrib.auth.hashers import check_password
        from django.core.cache import cache
        from email_utils import send_email

        login = request.user
        email = login.email
        action = request.data.get('action')
        cache_key = f'password_reset_otp_{email}'

        if action == 'send_otp':
            otp = str(random.randint(100000, 999999))
            cache.set(cache_key, otp, timeout=600)  # 10 minutes

            html = f"""
            <div style="font-family: Arial; max-width: 600px; margin: 0 auto;">
                <div style="background: #F97316; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
                    <h1 style="color: white; margin: 0;">🔐 Password Reset OTP</h1>
                </div>
                <div style="background: #FAF7F2; padding: 30px; border-radius: 0 0 12px 12px;">
                    <p style="color: #333;">Hi <b>{email}</b>,</p>
                    <p style="color: #333;">Your OTP for password reset:</p>
                    <div style="background: white; border: 2px solid #F97316; border-radius: 16px; padding: 24px; text-align: center; margin: 20px 0;">
                        <p style="color: #F97316; font-size: 48px; font-weight: 800; letter-spacing: 12px; margin: 0;">{otp}</p>
                        <p style="color: #999; font-size: 12px; margin: 12px 0 0 0;">Valid for 10 minutes only</p>
                    </div>
                    <p style="color: #999; font-size: 12px;">FederCare: AI Health Network</p>
                </div>
            </div>
            """
            try:
                send_email(email, 'FederCare: Password Reset OTP', html)
            except Exception as e:
                print(f'OTP email error: {e}')

            return ok(f'OTP sent to {email}!')

        elif action == 'verify_and_reset':
            otp = (request.data.get('otp') or '').strip()
            current_password = request.data.get('current_password') or ''
            new_password = (request.data.get('new_password') or '').strip()

            stored_otp = cache.get(cache_key)
            if not stored_otp:
                return err('OTP expired! Request a new one.', status=400)
            if stored_otp != otp:
                return err('Invalid OTP!', status=400)

            if not check_password(current_password, login.password_hash):
                return err('Current password is incorrect!', status=400)
            if len(new_password) < 6:
                return err('New password must be at least 6 characters')
            if current_password == new_password:
                return err('New password must be different from the current one!', status=400)

            login.password_hash = make_password(new_password)
            login.save(update_fields=['password_hash', 'updated_at'])
            cache.delete(cache_key)

            try:
                send_notification(
                    login, '🔐 Password Changed Successfully',
                    'Your FederCare password has been updated.',
                    notif_type='alert',
                )
            except Exception as e:
                print(f'Notification error: {e}')

            profile = get_profile(login)
            full_name = profile.get('full_name') or profile.get('contact_name') or email
            try:
                send_password_change_email(email, full_name)
            except Exception as e:
                print(f'Password change email error: {e}')

            log_audit(
                login, 'password_changed_otp', module='auth',
                entity_type='LoginCredentials', entity_id=login.login_id,
                ip_address=request.META.get('REMOTE_ADDR'),
            )
            return ok('Password changed successfully!')

        return err("Invalid action. Use 'send_otp' or 'verify_and_reset'.")


# ─── Update Profile ───────────────────────────────────────────────────────────

class UpdateProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request):
        login = request.user
        full_name = request.data.get('full_name', '').strip()
        phone = request.data.get('phone', '').strip()
        latitude = request.data.get('latitude')
        longitude = request.data.get('longitude')
        reminder_enabled = request.data.get('reminder_enabled')

        if (
            not full_name and not phone
            and latitude is None and longitude is None
            and reminder_enabled is None
        ):
            return err('No data to update')

        try:
            role = login.role
            if role == 'super_admin':
                from .models import SuperAdmin
                obj = SuperAdmin.objects.get(login_id=login)
                if full_name:
                    obj.full_name = full_name
                if phone:
                    obj.phone = phone
                obj.save()
            elif role == 'patient':
                from apps.patient.models import PatientRegistration
                obj = PatientRegistration.objects.get(login_id=login)
                if full_name:
                    obj.full_name = full_name
                if reminder_enabled is not None:
                    obj.reminder_enabled = bool(reminder_enabled)
                obj.save()
            elif role == 'doctor':
                from apps.doctor.models import DoctorRegistration
                obj = DoctorRegistration.objects.get(login_id=login)
                if full_name:
                    obj.full_name = full_name
                obj.save()
            elif role == 'hospital_admin':
                from apps.hospital.models import HospitalRegistration
                obj = HospitalRegistration.objects.get(login_id=login)
                if phone:
                    obj.contact_phone = phone
                for field, raw in (('latitude', latitude), ('longitude', longitude)):
                    if raw not in (None, ''):
                        try:
                            setattr(obj, field, float(raw))
                        except (ValueError, TypeError):
                            pass
                obj.save()
            elif role == 'pharmacist':
                from apps.pharmacy.models import PharmacistRegistration
                obj = PharmacistRegistration.objects.get(login_id=login)
                if full_name:
                    obj.full_name = full_name
                obj.save()
            elif role == 'lab_tech':
                from apps.lab.models import LabTechRegistration
                obj = LabTechRegistration.objects.get(login_id=login)
                if full_name:
                    obj.full_name = full_name
                obj.save()
            elif role == 'driver':
                from apps.emergency.models import AmbulanceDriverRegistration
                obj = AmbulanceDriverRegistration.objects.get(login_id=login)
                if full_name:
                    obj.full_name = full_name
                obj.save()
            elif role == 'vendor':
                from apps.vendor.models import VendorRegistration
                obj = VendorRegistration.objects.get(login_id=login)
                if full_name:
                    obj.contact_name = full_name
                if phone:
                    obj.phone = phone
                obj.save()
        except Exception as e:
            return err(f'Profile update failed: {e}', status=400)

        log_audit(
            login, 'profile_updated', module='auth',
            entity_type='Profile', entity_id=login.login_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Profile updated successfully', get_profile(login))


# ─── Upload Profile Photo ─────────────────────────────────────────────────────

class UploadProfilePhotoView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        file = request.FILES.get('image')
        if not file:
            return err('No image file provided')
        if not file.content_type.startswith('image/'):
            return err('File must be a JPEG or PNG image')

        try:
            from utils import save_upload_locally
            photo_url = save_upload_locally(
                file, subdir='profile_photos', request=request,
                prefix=f'profile_{request.user.login_id}',
            )
        except Exception as exc:
            return err(f'Upload failed: {exc}', status=500)

        # Persist to the role-specific profile table (best-effort)
        login = request.user
        role = login.role
        try:
            mapping = {
                'super_admin': ('super_admin_profile', 'profile_photo'),
                'hospital_admin': ('hospital_profile', 'profile_photo'),
                'doctor': ('doctor_profile', 'profile_photo'),
                'patient': ('patient_profile', 'profile_photo'),
                'pharmacist': ('pharmacist_profile', 'profile_photo'),
                'lab_tech': ('lab_tech_profile', 'profile_photo'),
                'driver': ('driver_profile', 'profile_photo'),
                'vendor': ('vendor_profile', 'profile_photo'),
            }
            related_name, field = mapping.get(role, (None, None))
            if related_name and field:
                obj = getattr(login, related_name, None)
                if obj and hasattr(obj, field):
                    setattr(obj, field, photo_url)
                    obj.save(update_fields=[field])
        except Exception:
            pass  # Photo is uploaded; DB save is best-effort

        log_audit(
            login, 'profile_photo_uploaded', module='auth',
            entity_type='Profile', entity_id=login.login_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return ok('Profile photo updated successfully', {'photo_url': photo_url})


# ─── Website Management: Developers & Project Features ─────────────────────────

def _developer_dict(d, request, include_admin=False):
    data = {
        'developer_id': str(d.developer_id),
        'name': d.name,
        'role': d.role,
        'department': d.department,
        'college': d.college,
        'photo': request.build_absolute_uri(d.photo.url) if d.photo else None,
        'github_url': d.github_url,
        'linkedin_url': d.linkedin_url,
        'email': d.email,
    }
    if include_admin:
        data['order'] = d.order
        data['is_active'] = d.is_active
    return data


def _feature_dict(f, request, include_admin=False):
    data = {
        'feature_id': str(f.feature_id),
        'title': f.title,
        'description': f.description,
        'photo': request.build_absolute_uri(f.photo.url) if f.photo else None,
        'icon': f.icon,
        'category': f.category,
    }
    if include_admin:
        data['order'] = f.order
        data['is_active'] = f.is_active
    return data


def _to_bool(value):
    return value in ['true', True, '1', 1]


class DeveloperListView(APIView):
    """Public — active developers for the landing page team section."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        devs = Developer.objects.filter(is_active=True).order_by('order')
        return Response({
            'success': True,
            'data': [_developer_dict(d, request) for d in devs],
        })


class FeatureListView(APIView):
    """Public — active features for the landing page showcase section."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        features = ProjectFeature.objects.filter(is_active=True).order_by('order')
        return Response({
            'success': True,
            'data': [_feature_dict(f, request) for f in features],
        })


class AdminDeveloperView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        devs = Developer.objects.all().order_by('order')
        return Response({
            'success': True,
            'data': [_developer_dict(d, request, include_admin=True) for d in devs],
        })

    def post(self, request):
        try:
            dev = Developer.objects.create(
                name=request.data.get('name'),
                role=request.data.get('role'),
                department=request.data.get('department', ''),
                college=request.data.get('college', 'MIIT'),
                photo=request.FILES.get('photo'),
                github_url=request.data.get('github_url', ''),
                linkedin_url=request.data.get('linkedin_url', ''),
                email=request.data.get('email', ''),
                order=int(request.data.get('order', 0) or 0),
            )
            log_audit(request.user, 'developer_added', module='website',
                      entity_type='Developer', entity_id=dev.developer_id,
                      ip_address=request.META.get('REMOTE_ADDR'))
            return Response({
                'success': True,
                'message': 'Developer added!',
                'developer_id': str(dev.developer_id),
            })
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=400)

    def put(self, request, developer_id):
        try:
            dev = Developer.objects.get(developer_id=developer_id)
            for field in ('name', 'role', 'department', 'college',
                          'github_url', 'linkedin_url', 'email'):
                if field in request.data:
                    setattr(dev, field, request.data[field])
            if 'order' in request.data:
                dev.order = int(request.data['order'] or 0)
            if 'is_active' in request.data:
                dev.is_active = _to_bool(request.data['is_active'])
            if request.FILES.get('photo'):
                dev.photo = request.FILES['photo']
            dev.save()
            return Response({'success': True, 'message': 'Developer updated!'})
        except Developer.DoesNotExist:
            return Response({'success': False, 'message': 'Developer not found'}, status=404)
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=400)

    def delete(self, request, developer_id):
        try:
            Developer.objects.get(developer_id=developer_id).delete()
            return Response({'success': True, 'message': 'Developer removed!'})
        except Developer.DoesNotExist:
            return Response({'success': False, 'message': 'Developer not found'}, status=404)


class AdminFeatureView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        features = ProjectFeature.objects.all().order_by('order')
        return Response({
            'success': True,
            'data': [_feature_dict(f, request, include_admin=True) for f in features],
        })

    def post(self, request):
        try:
            feature = ProjectFeature.objects.create(
                title=request.data.get('title'),
                description=request.data.get('description', ''),
                photo=request.FILES.get('photo'),
                icon=request.data.get('icon', '⚙️'),
                category=request.data.get('category', 'General'),
                order=int(request.data.get('order', 0) or 0),
            )
            log_audit(request.user, 'feature_added', module='website',
                      entity_type='ProjectFeature', entity_id=feature.feature_id,
                      ip_address=request.META.get('REMOTE_ADDR'))
            return Response({
                'success': True,
                'message': 'Feature added!',
                'feature_id': str(feature.feature_id),
            })
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=400)

    def put(self, request, feature_id):
        try:
            feature = ProjectFeature.objects.get(feature_id=feature_id)
            for field in ('title', 'description', 'icon', 'category'):
                if field in request.data:
                    setattr(feature, field, request.data[field])
            if 'order' in request.data:
                feature.order = int(request.data['order'] or 0)
            if 'is_active' in request.data:
                feature.is_active = _to_bool(request.data['is_active'])
            if request.FILES.get('photo'):
                feature.photo = request.FILES['photo']
            feature.save()
            return Response({'success': True, 'message': 'Feature updated!'})
        except ProjectFeature.DoesNotExist:
            return Response({'success': False, 'message': 'Feature not found'}, status=404)
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=400)

    def delete(self, request, feature_id):
        try:
            ProjectFeature.objects.get(feature_id=feature_id).delete()
            return Response({'success': True, 'message': 'Feature removed!'})
        except ProjectFeature.DoesNotExist:
            return Response({'success': False, 'message': 'Feature not found'}, status=404)
