import hmac
import hashlib
import re
from datetime import date

from django.conf import settings
from django.db.models import Case, When, IntegerField
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from apps.auth_app.permissions import IsLabTech, IsPatient, IsDoctor
from utils import log_audit, send_notification
from email_utils import send_lab_report_email
from .models import LabTechRegistration, LabOrder, LabReport
from .serializers import (
    LabTechProfileSerializer,
    LabOrderSerializer,
    LabReportSerializer,
    UploadReportSerializer,
    UpdateOrderStatusSerializer,
)

def clean_doctor_name(name):
    """Normalise a doctor name to exactly one 'Dr. ' prefix — collapses any
    leading 'Dr.'/'Dr. Dr.' run and re-adds a single prefix. Mirrors the
    frontend `cleanDoctorName` so referred-doctor names never read 'Dr. Dr.'."""
    if not name:
        return name
    stripped = re.sub(r'^(?:dr\.?\s*)+', '', str(name).strip(), flags=re.IGNORECASE).strip()
    return f'Dr. {stripped}' if stripped else f'Dr. {name}'


def save_lab_report_to_ehr(patient, report_url, test_names, hospital_name, uploaded_by):
    """Auto-add a completed lab report to the patient's EHR image wallet (type
    'lab_report') so it shows up under Lab Reports without the patient uploading
    anything. Best-effort: a failure here never blocks the report upload."""
    if not report_url:
        return False
    try:
        from django.utils import timezone as dj_tz
        from apps.patient.models import EHRImage

        names = ', '.join(str(t) for t in (test_names or []) if t) or 'Lab Test'
        date_str = dj_tz.now().strftime('%d %b %Y')
        EHRImage.objects.create(
            patient_id=patient,
            image_type='lab_report',
            image_url=report_url,
            title=f'Lab Report — {names}',
            description=f'{names} — {date_str}',
            hospital_name=hospital_name or '',
            scan_date=dj_tz.now().date(),
            uploaded_by=uploaded_by,
        )
        print(f'[EHR] Lab report auto-saved for {patient.full_name}: {names}')
        return True
    except Exception as e:
        print(f'[EHR] lab report auto-save error: {e}')
        return False


NORMAL_RANGES = {
    'hemoglobin':          {'min': 12.0,   'max': 17.5,    'unit': 'g/dL'},
    'wbc':                 {'min': 4000,   'max': 11000,   'unit': 'cells/μL'},
    'rbc':                 {'min': 4.2,    'max': 5.9,     'unit': 'million/μL'},
    'platelets':           {'min': 150000, 'max': 400000,  'unit': '/μL'},
    'blood_sugar_fasting': {'min': 70,     'max': 100,     'unit': 'mg/dL'},
    'blood_sugar_pp':      {'min': 70,     'max': 140,     'unit': 'mg/dL'},
    'hba1c':               {'min': 0,      'max': 5.7,     'unit': '%'},
    'cholesterol':         {'min': 0,      'max': 200,     'unit': 'mg/dL'},
    'hdl':                 {'min': 40,     'max': 999,     'unit': 'mg/dL'},
    'ldl':                 {'min': 0,      'max': 100,     'unit': 'mg/dL'},
    'triglycerides':       {'min': 0,      'max': 150,     'unit': 'mg/dL'},
    'creatinine':          {'min': 0.6,    'max': 1.2,     'unit': 'mg/dL'},
    'urea':                {'min': 7,      'max': 20,      'unit': 'mg/dL'},
    'uric_acid':           {'min': 2.4,    'max': 7.0,     'unit': 'mg/dL'},
    'sgpt':                {'min': 0,      'max': 40,      'unit': 'U/L'},
    'sgot':                {'min': 0,      'max': 40,      'unit': 'U/L'},
    'bilirubin':           {'min': 0,      'max': 1.2,     'unit': 'mg/dL'},
}


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


def get_lab_tech(request):
    try:
        return LabTechRegistration.objects.select_related('hospital_id', 'login_id').get(
            login_id=request.user
        )
    except LabTechRegistration.DoesNotExist:
        return None


def _rx_verified_email(order, test_names):
    """Prescription-verified → complete-payment email (orange/cream theme)."""
    return f"""
    <div style="font-family:Arial;max-width:600px;margin:0 auto;">
      <div style="background:#F97316;padding:20px;text-align:center;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;">&#x2705; Prescription Verified!</h1>
      </div>
      <div style="background:#FAF7F2;padding:30px;border-radius:0 0 12px 12px;">
        <p style="color:#333;">Hi <b>{order.patient_id.full_name}</b>!</p>
        <p style="color:#333;">Your prescription for <b>{test_names}</b> has been verified by our lab.</p>
        <div style="background:white;border-radius:12px;padding:20px;margin:20px 0;border:1px solid #E5E5E5;">
          <p style="margin:0;color:#666;">Test(s): <b style="color:#000;">{test_names}</b></p>
          <p style="margin:8px 0 0;color:#666;">Amount: <b style="color:#F97316;">&#8377;{order.total_fee}</b></p>
        </div>
        <div style="text-align:center;">
          <a href="http://localhost:3000/patient/test-records"
             style="background:#F97316;color:white;padding:12px 32px;border-radius:999px;text-decoration:none;font-weight:bold;">
            Complete Payment &rarr;
          </a>
        </div>
        <p style="color:#999;font-size:12px;text-align:center;margin-top:20px;">FederCare: AI Health Network</p>
      </div>
    </div>
    """


def detect_abnormal_flags(results):
    flags = []
    for test_key, test_data in results.items():
        norm = NORMAL_RANGES.get(test_key.lower())
        if not norm:
            continue
        try:
            value = float(test_data.get('value', 0))
        except (TypeError, ValueError):
            continue
        if value < norm['min'] or value > norm['max']:
            flags.append({
                'test': test_key,
                'value': value,
                'unit': test_data.get('unit', norm['unit']),
                'normal_range': f"{norm['min']} – {norm['max']} {norm['unit']}",
                'status': 'LOW' if value < norm['min'] else 'HIGH',
            })
    return flags


# Substring-matched ranges for the list-style results sent by the upload modal
# (test names come from the order, e.g. "Blood Sugar Fasting", "Lipid Profile").
LIST_RANGES = [
    ('blood sugar', 70, 140, 'mg/dL'),
    ('glucose', 70, 100, 'mg/dL'),
    ('hba1c', 0, 5.7, '%'),
    ('hemoglobin', 12, 17, 'g/dL'),
    ('wbc', 4000, 11000, 'cells/μL'),
    ('rbc', 4.2, 5.9, 'million/μL'),
    ('platelet', 150000, 400000, '/μL'),
    ('creatinine', 0.6, 1.2, 'mg/dL'),
    ('cholesterol', 0, 200, 'mg/dL'),
    ('ldl', 0, 100, 'mg/dL'),
    ('hdl', 40, 999, 'mg/dL'),
    ('triglyceride', 0, 150, 'mg/dL'),
    ('urea', 7, 20, 'mg/dL'),
    ('uric acid', 2.4, 7.0, 'mg/dL'),
    ('sgpt', 0, 40, 'U/L'),
    ('sgot', 0, 40, 'U/L'),
    ('bilirubin', 0, 1.2, 'mg/dL'),
    ('bp systolic', 90, 120, 'mmHg'),
    ('systolic', 90, 120, 'mmHg'),
    ('bp diastolic', 60, 80, 'mmHg'),
    ('diastolic', 60, 80, 'mmHg'),
    ('vitamin d', 20, 50, 'ng/mL'),
    ('vitamin b12', 200, 900, 'pg/mL'),
]


def detect_abnormal_list(results):
    """Detect abnormal values from a list of {test_name, value, unit} dicts."""
    flags = []
    for result in results or []:
        test_name = str(result.get('test_name', '')).lower()
        raw_value = result.get('value', '')
        try:
            val = float(raw_value)
        except (TypeError, ValueError):
            continue
        for key, low, high, unit in LIST_RANGES:
            if key in test_name:
                if val < low or val > high:
                    flags.append({
                        'test': result.get('test_name', ''),
                        'value': raw_value,
                        'unit': result.get('unit', '') or unit,
                        'normal_range': f'{low}-{high} {unit}',
                        'status': 'LOW' if val < low else 'HIGH',
                    })
                break
    return flags


CRITICAL_RANGES = {
    'glucose':     {'low': 50,    'high': 400,    'unit': 'mg/dL',     'critical_low': 40,   'critical_high': 500},
    'blood sugar': {'low': 50,    'high': 400,    'unit': 'mg/dL',     'critical_low': 40,   'critical_high': 500},
    'hemoglobin':  {'low': 7,     'high': 20,     'unit': 'g/dL',      'critical_low': 5,    'critical_high': 22},
    'potassium':   {'low': 3.0,   'high': 6.0,    'unit': 'mEq/L',     'critical_low': 2.5,  'critical_high': 6.5},
    'sodium':      {'low': 130,   'high': 150,    'unit': 'mEq/L',     'critical_low': 120,  'critical_high': 160},
    'creatinine':  {'low': 0,     'high': 5.0,    'unit': 'mg/dL',     'critical_low': 0,    'critical_high': 10.0},
    'wbc':         {'low': 2000,  'high': 30000,  'unit': 'cells/μL',  'critical_low': 1000, 'critical_high': 50000},
    'platelet':    {'low': 50000, 'high': 1000000,'unit': '/μL',       'critical_low': 20000,'critical_high': 2000000},
    'ph':          {'low': 7.30,  'high': 7.50,   'unit': '',          'critical_low': 7.20, 'critical_high': 7.60},
}


def check_critical_values(results):
    """Split list-style results into (critical, abnormal) flag lists.
    A value that falls in the critical band is only added to critical_flags
    (not duplicated into abnormal_flags)."""
    critical_flags = []
    abnormal_flags = []

    for result in results or []:
        test_name = str(result.get('test_name', '')).lower()
        value_str = result.get('value', '')
        try:
            value = float(value_str)
        except (TypeError, ValueError):
            continue

        for key, ranges in CRITICAL_RANGES.items():
            if key in test_name:
                is_critical = value <= ranges['critical_low'] or value >= ranges['critical_high']
                is_abnormal = value < ranges['low'] or value > ranges['high']

                if is_critical:
                    critical_flags.append({
                        'test': result.get('test_name', ''),
                        'value': value_str,
                        'unit': result.get('unit', '') or ranges['unit'],
                        'status': ('CRITICAL LOW' if value <= ranges['critical_low']
                                   else 'CRITICAL HIGH'),
                        'normal_range': f"{ranges['low']}-{ranges['high']} {ranges['unit']}",
                    })
                elif is_abnormal:
                    abnormal_flags.append({
                        'test': result.get('test_name', ''),
                        'value': value_str,
                        'unit': result.get('unit', '') or ranges['unit'],
                        'status': 'LOW' if value < ranges['low'] else 'HIGH',
                        'normal_range': f"{ranges['low']}-{ranges['high']} {ranges['unit']}",
                    })
                break

    return critical_flags, abnormal_flags


def notify_doctor_critical_values(order, critical_flags, order_type):
    """Send urgent in-app + email alert to the doctor when critical lab values
    are detected. Best-effort — never raises."""
    try:
        from email_utils import send_email

        doctor_login = None
        patient_name = ''

        if order_type == 'doctor_referred':
            try:
                doctor_login = order.doctor_id.login_id
                patient_name = order.patient_id.full_name
            except Exception:
                pass
        elif order_type == 'patient_booking':
            if getattr(order, 'doctor_id', None):
                doctor_login = order.doctor_id.login_id
                patient_name = order.patient_id.full_name

        if not doctor_login:
            print('[LAB] No doctor found for critical alert')
            return

        critical_text = '\n'.join([
            f"• {f['test']}: {f['value']} {f['unit']} ({f['status']})"
            for f in critical_flags
        ])

        send_notification(
            doctor_login,
            f'🚨 CRITICAL LAB VALUES — {patient_name}',
            f'URGENT: Critical lab values detected!\n{critical_text}\n'
            f'Immediate attention required!',
            notif_type='alert',
        )

        try:
            critical_rows = ''.join([
                f"""
                <tr>
                  <td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">{f['test']}</td>
                  <td style="padding:10px;border-bottom:1px solid #eee;color:#EF4444;font-weight:bold;">{f['value']} {f['unit']}</td>
                  <td style="padding:10px;border-bottom:1px solid #eee;">{f['normal_range']}</td>
                  <td style="padding:10px;border-bottom:1px solid #eee;color:#EF4444;font-weight:bold;">{f['status']}</td>
                </tr>
                """
                for f in critical_flags
            ])

            html = f"""
            <div style="font-family:Arial;max-width:600px;margin:0 auto;">
              <div style="background:#EF4444;padding:20px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;">🚨 CRITICAL LAB VALUES</h1>
                <p style="color:#FEE2E2;margin:8px 0 0 0;">Immediate Attention Required</p>
              </div>
              <div style="background:#FAF7F2;padding:30px;border-radius:0 0 12px 12px;">
                <div style="background:#FEF2F2;border:2px solid #FCA5A5;border-radius:12px;padding:16px;margin-bottom:20px;">
                  <p style="margin:0;font-size:16px;font-weight:bold;color:#DC2626;">Patient: {patient_name}</p>
                  <p style="margin:8px 0 0 0;color:#666;">Critical values detected in lab report. Please review immediately!</p>
                </div>

                <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;">
                  <thead>
                    <tr style="background:#EF4444;">
                      <th style="padding:12px;color:white;text-align:left;">Test</th>
                      <th style="padding:12px;color:white;text-align:left;">Value</th>
                      <th style="padding:12px;color:white;text-align:left;">Normal Range</th>
                      <th style="padding:12px;color:white;text-align:left;">Status</th>
                    </tr>
                  </thead>
                  <tbody>{critical_rows}</tbody>
                </table>

                <div style="background:#FFF7ED;border-left:4px solid #F97316;padding:16px;border-radius:8px;margin-top:20px;">
                  <p style="margin:0;color:#333;font-weight:bold;">⚡ Action Required:</p>
                  <p style="margin:8px 0 0 0;color:#666;">
                    Please contact the patient or review their condition immediately.
                    Critical values may indicate a medical emergency.
                  </p>
                </div>

                <p style="color:#999;font-size:12px;margin-top:20px;">FederCare: AI Health Network</p>
              </div>
            </div>
            """
            send_email(
                to_email=doctor_login.email,
                subject=f'🚨 URGENT: Critical Lab Values — {patient_name}',
                html_content=html,
            )
            print(f'[LAB] Critical alert email sent to {doctor_login.email}')
        except Exception as e:
            print(f'[LAB] Critical email error: {e}')

    except Exception as e:
        print(f'[LAB] Critical notify error: {e}')


def priority_order():
    return Case(
        When(priority='stat', then=0),
        When(priority='urgent', then=1),
        When(priority='normal', then=2),
        default=3,
        output_field=IntegerField(),
    )


# ─── Views ────────────────────────────────────────────────────────────────────

class LabDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsLabTech]

    def get(self, request):
        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)

        orders = LabOrder.objects.filter(lab_tech_id=lab_tech)
        today = date.today()
        completed_today = orders.filter(status='completed', updated_at__date=today).count()
        recent_orders = orders.select_related('patient_id', 'doctor_id').order_by(
            '-ordered_at'
        )[:5]
        flagged_count = LabReport.objects.filter(
            order_id__lab_tech_id=lab_tech
        ).exclude(abnormal_flags=[]).count()

        return ok('Lab dashboard loaded.', {
            'lab_tech_name': lab_tech.full_name,
            'hospital_name': lab_tech.hospital_id.hospital_name,
            'pending_orders': orders.filter(status='pending').count(),
            'processing_orders': orders.filter(status='processing').count(),
            'completed_today': completed_today,
            'recent_orders': LabOrderSerializer(recent_orders, many=True).data,
            'flagged_reports': flagged_count,
        })


class ListLabOrdersView(APIView):
    """Returns BOTH doctor-referred lab orders (LabOrder) and patient self-booked
    lab tests (LabTestOrder) for the lab tech's hospital, in one unified list."""
    permission_classes = [IsAuthenticated, IsLabTech]

    def get(self, request):
        from apps.patient.models import LabTestOrder
        from apps.lab.utils import detect_and_mark_no_shows

        # On-read sweep: auto-mark appointments missed by 30+ min before listing,
        # so the lab tech always sees current statuses without a background job.
        try:
            detect_and_mark_no_shows()
        except Exception as exc:  # noqa: BLE001
            print(f'[no-show] sweep error: {exc}')

        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)

        hospital = lab_tech.hospital_id
        status_filter = request.query_params.get('status')

        # ─── Type 1: doctor-referred orders (scoped by the doctor's hospital so
        # orders not yet assigned to a specific lab tech still appear) ──────────
        doctor_qs = (
            LabOrder.objects
            .filter(doctor_id__hospital_id=hospital)
            .select_related('patient_id', 'doctor_id')
            .prefetch_related('reports')
        )
        if status_filter:
            doctor_qs = doctor_qs.filter(status=status_filter)

        def _has_critical(flags):
            return any(
                'CRITICAL' in str((f or {}).get('status', '')).upper()
                for f in (flags or [])
            )

        doctor_orders = []
        for o in doctor_qs.order_by('-ordered_at')[:100]:
            report = o.reports.first()
            doctor_orders.append({
                'order_id': str(o.order_id),
                'order_type': 'doctor_referred',
                'source': 'Doctor Referral',
                'patient_name': o.patient_id.full_name,
                'patient_id': str(o.patient_id.patient_id),
                'doctor_name': clean_doctor_name(o.doctor_id.full_name),
                'tests': o.tests_ordered,
                'tests_ordered': o.tests_ordered,
                'priority': o.priority,
                'status': o.status,
                'payment_status': o.payment_status,
                'notes': o.notes,
                'ordered_at': o.ordered_at.isoformat(),
                'appointment_date': None,
                'appointment_time': None,
                'report_url': (report.report_file_url if report else ''),
                'has_critical_values': _has_critical(report.abnormal_flags if report else None),
            })

        # ─── Type 2: patient self-bookings ─────────────────────────────────────
        # Show paid orders, plus unpaid orders awaiting prescription verification
        # (those defer payment until the lab tech verifies the prescription).
        from django.db.models import Q
        patient_qs = LabTestOrder.objects.filter(hospital_id=hospital).filter(
            Q(payment_status='paid') | Q(prescription_status='pending'),
        ).select_related('patient_id', 'doctor_id')
        if status_filter:
            patient_qs = patient_qs.filter(status=status_filter)

        patient_orders = []
        for b in patient_qs.order_by('-ordered_at')[:100]:
            patient_orders.append({
                'order_id': str(b.order_id),
                'order_type': 'patient_booking',
                'source': 'Patient Self-Booking',
                'patient_name': b.patient_id.full_name,
                'patient_id': str(b.patient_id.patient_id),
                'doctor_name': (clean_doctor_name(b.doctor_id.full_name) if b.doctor_id else 'Self-Booked'),
                'tests': b.tests,
                'tests_ordered': b.tests,
                'priority': 'normal',
                'status': b.status,
                'payment_status': b.payment_status,
                'notes': b.notes,
                'ordered_at': b.ordered_at.isoformat(),
                'appointment_date': str(b.appointment_date) if b.appointment_date else None,
                'appointment_time': str(b.appointment_time) if b.appointment_time else None,
                'report_url': b.report_url or '',
                'prescription_required': b.prescription_required,
                'prescription_status': b.prescription_status,
                'prescription_verified': b.prescription_verified,
                'prescription_image': b.prescription_image,
                'has_critical_values': _has_critical(b.abnormal_flags),
            })

        all_orders = doctor_orders + patient_orders
        all_orders.sort(key=lambda x: x['ordered_at'], reverse=True)

        stats = {
            'total': len(all_orders),
            'pending': len([o for o in all_orders if o['status'] in ('pending', 'confirmed')]),
            'processing': len([o for o in all_orders if o['status'] == 'processing']),
            'completed': len([o for o in all_orders if o['status'] == 'completed']),
            'doctor_referred': len(doctor_orders),
            'patient_bookings': len(patient_orders),
        }
        return ok('Lab orders retrieved.', {'orders': all_orders, 'stats': stats})


class VerifyPrescriptionView(APIView):
    """Lab tech verifies or rejects an uploaded prescription on a patient
    self-booked lab-test order, and the patient is notified."""
    permission_classes = [IsAuthenticated, IsLabTech]

    def post(self, request, order_id):
        from apps.patient.models import LabTestOrder

        new_status = request.data.get('status')
        if new_status not in ('verified', 'rejected'):
            return err('status must be "verified" or "rejected".')

        try:
            order = LabTestOrder.objects.select_related('patient_id').get(order_id=order_id)
        except LabTestOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        test_names = ', '.join(
            (t.get('name') if isinstance(t, dict) else str(t)) for t in (order.tests or [])
        ) or 'your lab test'

        order.prescription_status = new_status
        order.prescription_verified = (new_status == 'verified')

        if new_status == 'verified':
            # Unlock payment: move back to a normal unpaid 'pending' order and
            # create the Razorpay order the patient pays from Test Records.
            order.status = 'pending'
            from payment_utils import create_razorpay_order
            rz = create_razorpay_order(amount=float(order.total_fee), receipt=str(order.order_id))
            if rz.get('success'):
                order.razorpay_order_id = rz['order_id']
            order.save(update_fields=[
                'prescription_status', 'prescription_verified', 'status', 'razorpay_order_id',
            ])
        else:
            order.status = 'cancelled'
            order.save(update_fields=['prescription_status', 'prescription_verified', 'status'])

        if new_status == 'verified':
            send_notification(
                order.patient_id.login_id,
                '✅ Prescription Verified — Please Pay',
                f'Your prescription for {test_names} has been verified. '
                f'Please complete payment of ₹{order.total_fee} to confirm your booking.',
                notif_type='lab',
            )
            try:
                from email_utils import send_email
                send_email(
                    to_email=order.patient_id.login_id.email,
                    subject='FederCare: Prescription Verified — Complete Payment',
                    html_content=_rx_verified_email(order, test_names),
                )
            except Exception as e:
                print(f'[VerifyPrescription] email error: {e}')
        else:
            send_notification(
                order.patient_id.login_id,
                '❌ Prescription Rejected',
                f'Your prescription for {test_names} was rejected. '
                'Please upload a valid prescription.',
                notif_type='lab',
            )

        log_audit(
            request.user, f'lab_prescription_{new_status}', module='lab',
            entity_type='LabTestOrder', entity_id=order.order_id,
            ip_address=request.META.get('REMOTE_ADDR'),
        )

        return ok(f'Prescription {new_status}!', {
            'order_id': str(order.order_id),
            'prescription_status': order.prescription_status,
        })


class GetLabOrderDetailView(APIView):
    permission_classes = [IsAuthenticated, IsLabTech]

    def get(self, request, order_id):
        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)

        try:
            order = LabOrder.objects.select_related(
                'patient_id', 'doctor_id', 'lab_tech_id'
            ).prefetch_related('reports').get(
                order_id=order_id,
                lab_tech_id__hospital_id=lab_tech.hospital_id,
            )
        except LabOrder.DoesNotExist:
            return err('Lab order not found.', status_code=404)

        data = LabOrderSerializer(order).data
        data['reports'] = LabReportSerializer(order.reports.all(), many=True).data
        return ok('Lab order details retrieved.', data)


class UpdateLabOrderStatusView(APIView):
    """Updates status for either order type. The frontend sends `order_type`
    ('doctor_referred' | 'patient_booking') so we route to the right model."""
    permission_classes = [IsAuthenticated, IsLabTech]

    def put(self, request, order_id):
        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)

        order_type = request.data.get('order_type', 'doctor_referred')

        if order_type == 'patient_booking':
            return self._update_patient_booking(request, order_id, lab_tech)
        return self._update_doctor_order(request, order_id, lab_tech)

    # ─── Doctor-referred (LabOrder) ─────────────────────────────────────────
    def _update_doctor_order(self, request, order_id, lab_tech):
        try:
            order = LabOrder.objects.select_related('doctor_id', 'patient_id').get(
                order_id=order_id,
                doctor_id__hospital_id=lab_tech.hospital_id,
            )
        except LabOrder.DoesNotExist:
            return err('Lab order not found.', status_code=404)

        ser = UpdateOrderStatusSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        new_status = ser.validated_data['status']
        order.status = new_status
        if not order.lab_tech_id:
            order.lab_tech_id = lab_tech
        order.save(update_fields=['status', 'lab_tech_id', 'updated_at'])

        send_notification(
            login_id=order.doctor_id.login_id,
            title='Lab Order Update',
            message=f'Lab order for {order.patient_id.full_name} is now {new_status}.',
            notif_type='info',
            related_id=str(order_id),
        )
        send_notification(
            login_id=order.patient_id.login_id,
            title=('📋 Lab Report Ready!' if new_status == 'completed' else '🔬 Lab Test Update'),
            message=(
                'Your lab test report is ready. You can download it from your portal.'
                if new_status == 'completed'
                else f'Your lab test status updated to: {new_status}'
            ),
            notif_type='alert',
            related_id=str(order_id),
        )

        log_audit(
            login_id=request.user,
            action=f'Lab order status updated to {new_status}',
            module='lab',
            entity_type='LabOrder',
            entity_id=str(order_id),
        )
        return ok('Order status updated.', LabOrderSerializer(order).data)

    # ─── Patient self-booking (LabTestOrder) ────────────────────────────────
    def _update_patient_booking(self, request, order_id, lab_tech):
        from apps.patient.models import LabTestOrder, EHRRecord

        try:
            order = LabTestOrder.objects.select_related('patient_id').get(
                order_id=order_id, hospital_id=lab_tech.hospital_id,
            )
        except LabTestOrder.DoesNotExist:
            return err('Lab booking not found.', status_code=404)

        new_status = request.data.get('status')
        if new_status not in ('pending', 'confirmed', 'processing', 'completed', 'cancelled'):
            return err('Invalid status.', status_code=400)

        # Time-lock: a self-booked test can only start processing once the
        # patient's appointment time has arrived (doctor-referred orders have no
        # appointment and are unaffected).
        if new_status == 'processing' and order.appointment_date:
            from django.utils import timezone as dj_tz
            now = dj_tz.localtime(dj_tz.now())
            appt_time_str = (
                f' at {order.appointment_time.strftime("%I:%M %p").lstrip("0")}'
                if order.appointment_time else ''
            )
            if order.appointment_date > now.date():
                return err(
                    f'Cannot start processing yet — the appointment is on '
                    f'{order.appointment_date.strftime("%d %b %Y")}{appt_time_str}.',
                    status_code=400,
                )
            if (order.appointment_date == now.date()
                    and order.appointment_time
                    and now.time() < order.appointment_time):
                return err(
                    f'Cannot start yet — the appointment starts'
                    f'{appt_time_str}.',
                    status_code=400,
                )

        report_url = request.data.get('report_url', '')
        results = request.data.get('results', {})
        flags = request.data.get('abnormal_flags', [])

        order.status = new_status
        if report_url:
            order.report_url = report_url
        if results:
            order.report_results = results
            # Auto-detect abnormal values if none were supplied explicitly.
            if not flags:
                flags = detect_abnormal_flags(results)
        if flags:
            order.abnormal_flags = flags
        order.save()

        if new_status == 'completed':
            test_names = [t.get('name', t) if isinstance(t, dict) else t for t in (order.tests or [])]
            EHRRecord.objects.create(
                patient_id=order.patient_id,
                added_by=request.user,
                record_type='lab',
                title=', '.join(str(t) for t in test_names),
                content=(
                    'Abnormal values detected: ' + ', '.join(
                        f'{f.get("test")} ({f.get("status")}: {f.get("value")} {f.get("unit", "")})'
                        for f in flags
                    ) if flags else 'All values within normal range.'
                ),
                file_url=order.report_url or '',
            )
            send_notification(
                login_id=order.patient_id.login_id,
                title='📋 Lab Report Ready!',
                message='Your lab test report is ready. You can download it from your portal.',
                notif_type='alert',
                related_id=str(order_id),
            )
            try:
                send_lab_report_email(
                    to_email=order.patient_id.login_id.email,
                    patient_name=order.patient_id.full_name,
                    tests_done=[str(t) for t in test_names],
                    abnormal_flags=flags,
                    report_url=order.report_url or '',
                )
            except Exception as exc:  # noqa: BLE001
                print(f'[lab] patient report email error: {exc}')
        else:
            send_notification(
                login_id=order.patient_id.login_id,
                title='🔬 Lab Test Update',
                message=f'Your lab test status updated to: {new_status}',
                notif_type='alert',
                related_id=str(order_id),
            )

        log_audit(
            login_id=request.user,
            action=f'Patient lab booking status updated to {new_status}',
            module='lab',
            entity_type='LabTestOrder',
            entity_id=str(order_id),
        )
        return ok('Order status updated.', {
            'order_id': str(order.order_id),
            'status': order.status,
            'abnormal_flags': order.abnormal_flags,
        })


class UploadLabReportView(APIView):
    """Upload a lab report (local file + per-test results) for either order type.
    Accepts multipart/form-data: `order_type`, `results` (JSON), `report_file`."""
    permission_classes = [IsAuthenticated, IsLabTech]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    ALLOWED_EXT = ('pdf', 'jpg', 'jpeg', 'png')

    def _parse_results(self, request):
        import json
        raw = request.data.get('results', '[]')
        if isinstance(raw, (list, dict)):
            return raw
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return []

    def _save_report_file(self, request):
        """Save the uploaded report to MEDIA_ROOT/lab_reports/. Returns
        (absolute_url, error_response)."""
        report_file = request.FILES.get('report_file')
        if not report_file:
            return '', None

        import os
        import uuid
        from django.conf import settings

        ext = report_file.name.rsplit('.', 1)[-1].lower()
        if ext not in self.ALLOWED_EXT:
            return '', err('Only PDF/JPG/PNG allowed!', status_code=400)

        filename = f'lab_report_{uuid.uuid4().hex[:8]}.{ext}'
        save_dir = os.path.join(settings.MEDIA_ROOT, 'lab_reports')
        os.makedirs(save_dir, exist_ok=True)
        with open(os.path.join(save_dir, filename), 'wb+') as f:
            for chunk in report_file.chunks():
                f.write(chunk)
        return request.build_absolute_uri(f'/media/lab_reports/{filename}'), None

    @staticmethod
    def _test_names(results):
        return [str(r.get('test_name', '')) for r in results if r.get('test_name')]

    def post(self, request, order_id):
        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)

        order_type = request.data.get('order_type', 'doctor_referred')
        results = self._parse_results(request)
        report_url, file_err = self._save_report_file(request)
        if file_err:
            return file_err

        critical_flags, _ = check_critical_values(results)
        other_abnormal = detect_abnormal_list(results)
        # Merge: critical first, then any non-critical abnormals from the wider
        # NORMAL_RANGES sweep, de-duped by test name so a critical hit isn't
        # listed twice.
        critical_test_names = {f['test'] for f in critical_flags}
        abnormal_flags = critical_flags + [
            f for f in other_abnormal if f['test'] not in critical_test_names
        ]
        has_critical = len(critical_flags) > 0

        ai_analysis = (
            'All values within normal range.'
            if not abnormal_flags
            else 'Abnormal values detected: ' + ', '.join(
                f'{f["test"]} ({f["status"]}: {f["value"]} {f["unit"]})'
                for f in abnormal_flags
            )
        )

        if order_type == 'patient_booking':
            ok_resp, order_obj = self._save_patient_booking(
                request, order_id, lab_tech, results, report_url, abnormal_flags, ai_analysis,
            )
        else:
            ok_resp, order_obj = self._save_doctor_order(
                request, order_id, lab_tech, results, report_url, abnormal_flags, ai_analysis,
            )

        if has_critical and order_obj is not None:
            notify_doctor_critical_values(order_obj, critical_flags, order_type)

        return ok_resp

    # ─── Doctor-referred (LabOrder + LabReport) ─────────────────────────────
    def _save_doctor_order(self, request, order_id, lab_tech, results, report_url, abnormal_flags, ai_analysis):
        try:
            order = LabOrder.objects.select_related('patient_id', 'doctor_id').get(
                order_id=order_id, doctor_id__hospital_id=lab_tech.hospital_id,
            )
        except LabOrder.DoesNotExist:
            return err('Order not found!', status_code=404), None

        report = LabReport.objects.create(
            order_id=order,
            patient_id=order.patient_id,
            results=results,
            report_file_url=report_url,
            abnormal_flags=abnormal_flags,
            ai_analysis=ai_analysis,
            saved_to_ehr=False,  # lab tech pushes to EHR explicitly from the Reports page
        )

        order.status = 'completed'
        if not order.lab_tech_id:
            order.lab_tech_id = lab_tech
        order.save(update_fields=['status', 'lab_tech_id', 'updated_at'])

        # Auto-save the report into the patient's EHR image wallet.
        save_lab_report_to_ehr(
            patient=order.patient_id,
            report_url=report_url,
            test_names=(self._test_names(results) or order.tests_ordered),
            hospital_name=lab_tech.hospital_id.hospital_name,
            uploaded_by=request.user,
        )

        send_notification(
            login_id=order.patient_id.login_id,
            title='📋 Lab Report Ready!',
            message='Your doctor-ordered lab report is ready. Check your EHR wallet for results.',
            notif_type='alert',
            related_id=str(report.report_id),
        )
        send_notification(
            login_id=order.doctor_id.login_id,
            title='Lab Report Ready',
            message=f'Lab report for {order.patient_id.full_name} is ready. {ai_analysis}',
            notif_type='alert',
            related_id=str(report.report_id),
        )
        try:
            send_lab_report_email(
                to_email=order.patient_id.login_id.email,
                patient_name=order.patient_id.full_name,
                tests_done=order.tests_ordered,
                abnormal_flags=abnormal_flags,
                report_url=report_url,
            )
        except Exception as exc:  # noqa: BLE001
            print(f'[lab] report email error: {exc}')

        log_audit(
            login_id=request.user, action='Lab report uploaded',
            module='lab', entity_type='LabReport', entity_id=str(report.report_id),
        )
        return ok('Report uploaded successfully!', {
            'report_url': report_url,
            'abnormal_count': len(abnormal_flags),
            'abnormal_flags': abnormal_flags,
        }, status_code=201), order

    # ─── Patient self-booking (LabTestOrder) ────────────────────────────────
    def _save_patient_booking(self, request, order_id, lab_tech, results, report_url, abnormal_flags, ai_analysis):
        from apps.patient.models import LabTestOrder
        try:
            order = LabTestOrder.objects.select_related('patient_id').get(
                order_id=order_id, hospital_id=lab_tech.hospital_id,
            )
        except LabTestOrder.DoesNotExist:
            return err('Order not found!', status_code=404), None

        order.status = 'completed'
        if report_url:
            order.report_url = report_url
        order.report_results = results
        order.abnormal_flags = abnormal_flags
        order.save()

        test_names = self._test_names(results) or [
            (t.get('name', t) if isinstance(t, dict) else t) for t in (order.tests or [])
        ]

        # Auto-save the report into the patient's EHR image wallet.
        save_lab_report_to_ehr(
            patient=order.patient_id,
            report_url=report_url,
            test_names=test_names,
            hospital_name=lab_tech.hospital_id.hospital_name,
            uploaded_by=request.user,
        )

        send_notification(
            login_id=order.patient_id.login_id,
            title='📋 Lab Report Ready!',
            message=(
                f'Your lab report is ready. {len(abnormal_flags)} abnormal value(s) detected.'
                if abnormal_flags else 'Your lab report is ready. All values normal!'
            ),
            notif_type='alert',
            related_id=str(order.order_id),
        )
        try:
            send_lab_report_email(
                to_email=order.patient_id.login_id.email,
                patient_name=order.patient_id.full_name,
                tests_done=[str(t) for t in test_names],
                abnormal_flags=abnormal_flags,
                report_url=report_url or '',
            )
        except Exception as exc:  # noqa: BLE001
            print(f'[lab] patient report email error: {exc}')

        log_audit(
            login_id=request.user, action='Patient lab report uploaded',
            module='lab', entity_type='LabTestOrder', entity_id=str(order.order_id),
        )
        return ok('Report uploaded successfully!', {
            'report_url': report_url,
            'abnormal_count': len(abnormal_flags),
            'abnormal_flags': abnormal_flags,
        }, status_code=201), order


class ListLabReportsView(APIView):
    """Lists reports from BOTH LabReport (doctor-referred) and completed
    LabTestOrder (patient self-bookings) for the lab tech's hospital."""
    permission_classes = [IsAuthenticated, IsLabTech]

    def get(self, request):
        from apps.patient.models import LabTestOrder

        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)

        hospital = lab_tech.hospital_id

        # ─── Doctor-referred reports ────────────────────────────────────────
        lab_reports = LabReport.objects.filter(
            order_id__doctor_id__hospital_id=hospital
        ).select_related('order_id', 'patient_id').order_by('-uploaded_at')

        doctor_reports = []
        for report in lab_reports:
            order = report.order_id
            flags = report.abnormal_flags or []
            doctor_reports.append({
                'report_id': str(report.report_id),
                'order_id': str(order.order_id),
                'order_type': 'doctor_referred',
                'source': 'Doctor Referral',
                'patient_name': report.patient_id.full_name,
                'patient_id': str(report.patient_id.patient_id),
                'tests': order.tests_ordered,
                'results': report.results,
                'report_file_url': report.report_file_url,
                'abnormal_flags': flags,
                'abnormal_count': len(flags),
                'uploaded_at': report.uploaded_at.isoformat(),
                'saved_to_ehr': report.saved_to_ehr,
            })

        # ─── Patient self-booking reports ───────────────────────────────────
        patient_qs = LabTestOrder.objects.filter(
            hospital_id=hospital, status='completed',
        ).select_related('patient_id').order_by('-ordered_at')

        patient_reports = []
        for order in patient_qs:
            flags = order.abnormal_flags or []
            patient_reports.append({
                'report_id': str(order.order_id),
                'order_id': str(order.order_id),
                'order_type': 'patient_booking',
                'source': 'Patient Self-Booking',
                'patient_name': order.patient_id.full_name,
                'patient_id': str(order.patient_id.patient_id),
                'tests': order.tests,
                'results': order.report_results or [],
                'report_file_url': order.report_url or '',
                'abnormal_flags': flags,
                'abnormal_count': len(flags),
                'uploaded_at': order.ordered_at.isoformat(),
                'saved_to_ehr': False,
            })

        all_reports = doctor_reports + patient_reports
        all_reports.sort(key=lambda x: x['uploaded_at'], reverse=True)

        return ok('Lab reports retrieved.', {
            'reports': all_reports,
            'total': len(all_reports),
            'doctor_referred': len(doctor_reports),
            'patient_bookings': len(patient_reports),
        })


class SaveReportToEHRView(APIView):
    """Lab tech pushes a finished report into the patient's EHR wallet."""
    permission_classes = [IsAuthenticated, IsLabTech]

    def post(self, request):
        from apps.patient.models import LabTestOrder, EHRRecord

        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)

        order_type = request.data.get('order_type', 'doctor_referred')
        report_id = request.data.get('report_id') or request.data.get('order_id')
        if not report_id:
            return err('report_id is required.', status_code=400)

        if order_type == 'patient_booking':
            try:
                order = LabTestOrder.objects.select_related('patient_id').get(
                    order_id=report_id, hospital_id=lab_tech.hospital_id,
                )
            except LabTestOrder.DoesNotExist:
                return err('Report not found!', status_code=404)
            tests = [(t.get('name', t) if isinstance(t, dict) else t) for t in (order.tests or [])]
            EHRRecord.objects.create(
                patient_id=order.patient_id,
                added_by=request.user,
                record_type='lab',
                title=', '.join(str(t) for t in tests),
                content=('Abnormal values detected.' if order.abnormal_flags else 'All values within normal range.'),
                file_url=order.report_url or '',
            )
            patient = order.patient_id
        else:
            try:
                report = LabReport.objects.select_related('order_id', 'patient_id').get(
                    report_id=report_id, order_id__doctor_id__hospital_id=lab_tech.hospital_id,
                )
            except LabReport.DoesNotExist:
                return err('Report not found!', status_code=404)
            if report.saved_to_ehr:
                return ok('Report already saved to EHR.', {'saved_to_ehr': True})
            EHRRecord.objects.create(
                patient_id=report.patient_id,
                added_by=request.user,
                record_type='lab',
                title=', '.join(report.order_id.tests_ordered),
                content=report.ai_analysis or 'Lab report',
                file_url=report.report_file_url or '',
            )
            report.saved_to_ehr = True
            report.save(update_fields=['saved_to_ehr'])
            patient = report.patient_id

        send_notification(
            login_id=patient.login_id,
            title='Lab Report Added to EHR',
            message='A lab report has been added to your EHR wallet.',
            notif_type='info',
        )
        log_audit(
            login_id=request.user, action='Lab report saved to EHR',
            module='lab', entity_type='LabReport', entity_id=str(report_id),
        )
        return ok('Report saved to EHR.', {'saved_to_ehr': True})


class VerifyPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        razorpay_order_id = request.data.get('razorpay_order_id', '')
        razorpay_payment_id = request.data.get('razorpay_payment_id', '')
        razorpay_signature = request.data.get('razorpay_signature', '')

        if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
            return err('razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.')

        try:
            order = LabOrder.objects.select_related('patient_id').get(
                razorpay_order_id=razorpay_order_id
            )
        except LabOrder.DoesNotExist:
            return err('Lab order not found for this Razorpay order ID.', status_code=404)

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
        order.save(update_fields=['razorpay_payment_id', 'razorpay_signature', 'payment_status'])

        send_notification(
            login_id=order.patient_id.login_id,
            title='Lab Payment Confirmed',
            message='Your lab test payment has been confirmed. Tests will be processed soon.',
            notif_type='success',
            related_id=str(order.order_id),
        )

        log_audit(
            login_id=request.user,
            action='Lab order payment verified',
            module='lab',
            entity_type='LabOrder',
            entity_id=str(order.order_id),
        )
        return ok('Payment verified successfully.', {
            'order_id': str(order.order_id),
            'payment_status': order.payment_status,
        })


class CriticalAlertsView(APIView):
    """Recent lab reports (last 24 h) containing CRITICAL flagged values, for
    the logged-in doctor's own LabOrders. Powers the dashboard banner."""
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        from datetime import timedelta
        from django.utils import timezone
        from apps.doctor.models import DoctorRegistration

        try:
            doctor = DoctorRegistration.objects.get(login_id=request.user)
        except DoctorRegistration.DoesNotExist:
            return err('Doctor profile not found.', status_code=404)

        cutoff = timezone.now() - timedelta(hours=24)

        critical_reports = []
        recent_orders = LabOrder.objects.filter(
            doctor_id=doctor,
            ordered_at__gte=cutoff,
        ).select_related('patient_id').prefetch_related('reports')

        for order in recent_orders:
            try:
                report = order.reports.order_by('-uploaded_at').first()
                if not report or not report.abnormal_flags:
                    continue

                flags = report.abnormal_flags
                if isinstance(flags, str):
                    import json
                    flags = json.loads(flags)

                critical = [
                    f for f in flags
                    if 'CRITICAL' in str(f.get('status', '')).upper()
                ]
                if critical:
                    critical_reports.append({
                        'patient_name': order.patient_id.full_name,
                        'patient_id': str(order.patient_id.patient_id),
                        'order_id': str(order.order_id),
                        'report_id': str(report.report_id),
                        'critical_flags': critical,
                        'uploaded_at': report.uploaded_at.isoformat(),
                    })
            except Exception as e:
                print(f'Critical check error: {e}')

        return Response({
            'success': True,
            'data': critical_reports,
            'count': len(critical_reports),
        })


class TestCompletionStatsView(APIView):
    """Today / weekly / 7-day breakdown of lab order completion for the lab
    tech's hospital. Powers the dashboard progress section."""
    permission_classes = [IsAuthenticated, IsLabTech]

    def get(self, request):
        from datetime import timedelta
        from apps.patient.models import LabTestOrder

        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)

        hospital = lab_tech.hospital_id
        today = date.today()

        # ─── TODAY ──────────────────────────────────────────────────────────
        doctor_today = LabOrder.objects.filter(
            doctor_id__hospital_id=hospital,
            ordered_at__date=today,
        )
        patient_today = LabTestOrder.objects.filter(
            hospital_id=hospital,
            ordered_at__date=today,
            payment_status='paid',
        )

        doctor_total_today = doctor_today.count()
        doctor_completed_today = doctor_today.filter(status='completed').count()
        doctor_pending_today = doctor_today.filter(status__in=['pending', 'confirmed']).count()
        doctor_processing_today = doctor_today.filter(status='processing').count()

        patient_total_today = patient_today.count()
        patient_completed_today = patient_today.filter(status='completed').count()
        patient_pending_today = patient_today.filter(status__in=['pending', 'confirmed']).count()

        total_today = doctor_total_today + patient_total_today
        completed_today = doctor_completed_today + patient_completed_today
        pending_today = doctor_pending_today + patient_pending_today
        processing_today = doctor_processing_today

        completion_rate = round(
            (completed_today / total_today * 100) if total_today > 0 else 0, 1
        )

        # ─── WEEKLY (last 7 days inclusive of today) ────────────────────────
        week_start = today - timedelta(days=7)

        doctor_week = LabOrder.objects.filter(
            doctor_id__hospital_id=hospital,
            ordered_at__date__gte=week_start,
        )
        patient_week = LabTestOrder.objects.filter(
            hospital_id=hospital,
            ordered_at__date__gte=week_start,
            payment_status='paid',
        )

        doctor_weekly = doctor_week.count()
        doctor_completed_weekly = doctor_week.filter(status='completed').count()
        patient_weekly = patient_week.count()
        patient_completed_weekly = patient_week.filter(status='completed').count()

        total_weekly = doctor_weekly + patient_weekly
        completed_weekly = doctor_completed_weekly + patient_completed_weekly
        weekly_rate = round(
            (completed_weekly / total_weekly * 100) if total_weekly > 0 else 0, 1
        )

        # ─── DAILY BREAKDOWN (last 7 days, oldest first) ────────────────────
        daily_data = []
        for i in range(6, -1, -1):
            day = today - timedelta(days=i)
            day_total = (
                LabOrder.objects.filter(
                    doctor_id__hospital_id=hospital,
                    ordered_at__date=day,
                ).count()
                + LabTestOrder.objects.filter(
                    hospital_id=hospital,
                    ordered_at__date=day,
                    payment_status='paid',
                ).count()
            )
            day_completed = (
                LabOrder.objects.filter(
                    doctor_id__hospital_id=hospital,
                    ordered_at__date=day,
                    status='completed',
                ).count()
                + LabTestOrder.objects.filter(
                    hospital_id=hospital,
                    ordered_at__date=day,
                    payment_status='paid',
                    status='completed',
                ).count()
            )
            daily_data.append({
                'date': str(day),
                'day': day.strftime('%a'),
                'total': day_total,
                'completed': day_completed,
                'rate': round(
                    (day_completed / day_total * 100) if day_total > 0 else 0, 1
                ),
            })

        return ok('Completion stats retrieved.', {
            'today': {
                'total': total_today,
                'completed': completed_today,
                'pending': pending_today,
                'processing': processing_today,
                'completion_rate': completion_rate,
                'doctor_referred': doctor_total_today,
                'self_booked': patient_total_today,
            },
            'weekly': {
                'total': total_weekly,
                'completed': completed_weekly,
                'completion_rate': weekly_rate,
            },
            'daily_breakdown': daily_data,
        })


# ─── Lab slot booking (Option B+) ───────────────────────────────────────────

class LabMonthlyReportView(APIView):
    """Monthly analytics for the lab tech's hospital — combines doctor-referred
    LabOrders (no fee) and patient self-booked LabTestOrders (total_fee).
    Powers the Monthly Report page + CSV export."""
    permission_classes = [IsAuthenticated, IsLabTech]

    def get(self, request):
        import calendar
        from django.db.models import Sum
        from django.utils import timezone as dj_tz
        from apps.patient.models import LabTestOrder

        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)
        hospital = lab_tech.hospital_id

        now = dj_tz.now()
        try:
            month = int(request.GET.get('month', now.month))
            year = int(request.GET.get('year', now.year))
        except (TypeError, ValueError):
            month, year = now.month, now.year

        doctor_orders = LabOrder.objects.filter(
            doctor_id__hospital_id=hospital,
            ordered_at__year=year, ordered_at__month=month,
        ).select_related('doctor_id')
        patient_orders = LabTestOrder.objects.filter(
            hospital_id=hospital,
            ordered_at__year=year, ordered_at__month=month,
        )

        def status_count(status):
            return (doctor_orders.filter(status=status).count()
                    + patient_orders.filter(status=status).count())

        total_orders = doctor_orders.count() + patient_orders.count()
        completed = status_count('completed')
        pending = status_count('pending') + status_count('confirmed')
        processing = status_count('processing')
        cancelled = patient_orders.filter(status='cancelled').count()
        revenue = float(
            patient_orders.filter(payment_status='paid')
            .aggregate(total=Sum('total_fee'))['total'] or 0
        )

        test_counts = {}   # name -> {count, revenue}
        daily = {}         # 'YYYY-MM-DD' -> {date, orders, revenue}

        def bump_test(name, rev=0.0):
            t = test_counts.setdefault(name or 'Unknown', {'count': 0, 'revenue': 0.0})
            t['count'] += 1
            t['revenue'] += rev

        def bump_day(dt, rev=0.0):
            key = dj_tz.localtime(dt).strftime('%Y-%m-%d')
            d = daily.setdefault(key, {'date': key, 'orders': 0, 'revenue': 0.0})
            d['orders'] += 1
            d['revenue'] += rev

        for o in doctor_orders:
            bump_day(o.ordered_at, 0.0)
            for t in (o.tests_ordered or []):
                bump_test(t.get('name') if isinstance(t, dict) else str(t))

        for b in patient_orders:
            fee = float(b.total_fee or 0) if b.payment_status == 'paid' else 0.0
            bump_day(b.ordered_at, fee)
            tests = b.tests or []
            per_test = (fee / len(tests)) if tests else 0.0
            for t in tests:
                bump_test(t.get('name') if isinstance(t, dict) else str(t), per_test)

        test_breakdown = sorted(
            [{'test_name': n, 'count': v['count'], 'revenue': round(v['revenue'], 2)}
             for n, v in test_counts.items()],
            key=lambda x: x['count'], reverse=True,
        )
        daily_breakdown = sorted(daily.values(), key=lambda d: d['date'])

        return ok('Monthly report generated.', {
            'month': calendar.month_name[month],
            'year': year,
            'hospital': hospital.hospital_name,
            'summary': {
                'total_orders': total_orders,
                'completed': completed,
                'pending': pending,
                'processing': processing,
                'cancelled': cancelled,
                'total_revenue': revenue,
                'completion_rate': round((completed / total_orders * 100) if total_orders else 0, 1),
            },
            'test_breakdown': test_breakdown,
            'daily_breakdown': daily_breakdown,
        })


class MarkNoShowView(APIView):
    """Lab tech manually marks a patient's confirmed lab booking as no-show
    (after the grace period). Frees the slot seat and notifies the patient."""
    permission_classes = [IsAuthenticated, IsLabTech]

    def post(self, request, order_id):
        from django.utils import timezone
        from apps.patient.models import LabTestOrder
        from apps.lab.utils import monthly_no_show_count, _test_label

        lab_tech = get_lab_tech(request)
        if not lab_tech:
            return err('Lab tech profile not found.', status_code=404)

        try:
            order = LabTestOrder.objects.select_related('patient_id', 'slot_id').get(
                order_id=order_id, hospital_id=lab_tech.hospital_id,
            )
        except LabTestOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        if order.status != 'confirmed':
            return err('Only confirmed bookings can be marked as no-show.', status_code=400)

        now = timezone.localtime(timezone.now())
        order.status = 'no_show'
        order.no_show_at = now
        order.no_show_marked_by = 'lab_tech'
        order.save(update_fields=['status', 'no_show_at', 'no_show_marked_by'])

        if order.slot_id:
            order.slot_id.booked_count = max(0, order.slot_id.booked_count - 1)
            order.slot_id.save(update_fields=['booked_count'])

        test_name = _test_label(order)
        send_notification(
            order.patient_id.login_id,
            '😔 Marked as No-Show',
            f'Your {test_name} appointment was marked as no-show by the lab. '
            'Please rebook if needed.',
            notif_type='lab',
        )
        monthly_count = monthly_no_show_count(order.patient_id, now)
        if monthly_count >= 3:
            send_notification(
                order.patient_id.login_id,
                '⚠️ Warning: Multiple No-Shows',
                f'You have missed {monthly_count} appointments this month. '
                'Please attend your booked tests.',
                notif_type='lab',
            )

        log_audit(
            login_id=request.user, action='Lab booking marked no-show',
            module='lab', entity_type='LabTestOrder', entity_id=str(order.order_id),
        )
        return ok('Marked as no-show.', {'monthly_no_shows': monthly_count})


class LabSlotsView(APIView):
    """Patient-facing available lab slots for a hospital/date, with per-test
    timing restrictions and fasting flags applied."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import date as date_cls, datetime as dt
        from apps.lab.models import LabSlot, LabTestSlotRule
        from apps.hospital.models import HospitalRegistration
        from apps.lab.utils import generate_lab_slots, fmt_12hr
        from apps.patient.views_extra import AVAILABLE_TESTS

        hospital_id = request.GET.get('hospital_id')
        date_str = request.GET.get('date')
        test_ids = [t for t in (request.GET.get('test_ids', '') or '').split(',') if t]

        try:
            hospital = HospitalRegistration.objects.get(hospital_id=hospital_id)
        except (HospitalRegistration.DoesNotExist, ValueError, TypeError):
            return err('Hospital not found', status_code=404)

        try:
            slot_date = dt.strptime(date_str, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            slot_date = date_cls.today()

        from django.utils import timezone as dj_tz
        now_local = dj_tz.localtime(dj_tz.now())
        today = now_local.date()
        current_time = now_local.time()

        # Past dates can never be booked.
        if slot_date < today:
            return Response({
                'success': True,
                'data': [],
                'message': 'Cannot book slots for past dates!',
            }, status=200)

        # Block booking for hospitals that haven't set up their lab schedule.
        # (Generating slots here used to silently auto-create a config — we now
        # require the admin to configure the lab explicitly first.)
        from apps.lab.models import HospitalLabConfig
        if not HospitalLabConfig.objects.filter(hospital_id=hospital, is_active=True).exists():
            return Response({
                'success': False,
                'lab_configured': False,
                'message': 'This hospital has not configured their lab schedule yet. '
                           'Please select another hospital or contact them directly.',
                'data': [],
            }, status=200)

        generate_lab_slots(hospital, days_ahead=30)

        by_id = {t['test_id']: t for t in AVAILABLE_TESTS}
        test_names = [(by_id.get(tid, {}).get('name') or tid).lower() for tid in test_ids]

        allowed_start = None
        allowed_end = None
        restriction_note = None
        fasting_required = False
        for rule in LabTestSlotRule.objects.all():
            kw = rule.test_name_keyword.lower()
            if not any(kw in n for n in test_names):
                continue
            if rule.requires_fasting:
                fasting_required = True
            if rule.time_restriction != 'any' and rule.allowed_start:
                if allowed_start is None or rule.allowed_start > allowed_start:
                    allowed_start = rule.allowed_start
                if rule.allowed_end and (allowed_end is None or rule.allowed_end < allowed_end):
                    allowed_end = rule.allowed_end
                restriction_note = rule.preparation_note
            elif rule.preparation_note and not restriction_note:
                restriction_note = rule.preparation_note

        slots_qs = LabSlot.objects.filter(hospital_id=hospital, slot_date=slot_date)
        if allowed_start:
            slots_qs = slots_qs.filter(start_time__gte=allowed_start)
        if allowed_end:
            slots_qs = slots_qs.filter(start_time__lte=allowed_end)

        # When booking for today, hide slots that have already started.
        if slot_date == today:
            slots_qs = slots_qs.filter(start_time__gt=current_time)

        slots_data = [{
            'slot_id': str(s.slot_id),
            'start_time': s.start_time.strftime('%H:%M'),
            'end_time': s.end_time.strftime('%H:%M'),
            'start_time_12hr': fmt_12hr(s.start_time),
            'end_time_12hr': fmt_12hr(s.end_time),
            'max_patients': s.max_patients,
            'booked_count': s.booked_count,
            'remaining': s.max_patients - s.booked_count,
            'is_available': s.is_available,
            'status': s.availability_status,
            'is_blocked': s.is_blocked,
            'block_reason': s.block_reason,
        } for s in slots_qs]

        return Response({
            'success': True,
            'data': slots_data,
            'date': str(slot_date),
            'hospital': hospital.hospital_name,
            'restriction_note': restriction_note,
            'fasting_required': fasting_required,
            'time_restricted': allowed_start is not None,
            'allowed_window': (fmt_12hr(allowed_start) + ' - ' + fmt_12hr(allowed_end))
            if allowed_start and allowed_end else None,
        })


class UpdateLabSlotView(APIView):
    """Hospital/lab blocks or unblocks a slot (e.g. equipment down)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, slot_id):
        from apps.lab.models import LabSlot
        action = request.data.get('action')
        try:
            slot = LabSlot.objects.get(slot_id=slot_id)
        except LabSlot.DoesNotExist:
            return err('Slot not found', status_code=404)

        if action == 'block':
            slot.is_blocked = True
            slot.block_reason = request.data.get('reason', 'Blocked by admin')
            slot.save(update_fields=['is_blocked', 'block_reason'])
        elif action == 'unblock':
            slot.is_blocked = False
            slot.block_reason = None
            slot.save(update_fields=['is_blocked', 'block_reason'])
        else:
            return err('action must be block or unblock')

        return ok(f'Slot {action}ed!', {'slot_id': str(slot.slot_id)})


class LabPrescriptionView(APIView):
    """Resolve a self-booked lab order's uploaded prescription to an absolute,
    openable URL. prescription_image is stored as a relative MEDIA path
    (e.g. /media/lab_prescriptions/x.jpg) which 404s/loads the SPA index when
    opened against the frontend origin — so build the absolute backend URL.
    A full Cloudinary https URL is returned unchanged."""
    permission_classes = [IsAuthenticated, IsLabTech]

    def get(self, request, order_id):
        from apps.patient.models import LabTestOrder
        try:
            order = LabTestOrder.objects.get(order_id=order_id)
        except LabTestOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        raw = (order.prescription_image or '').strip()
        if not raw:
            url = None
        elif raw.startswith('http'):
            url = raw
        else:
            url = request.build_absolute_uri(raw)

        return ok('Prescription retrieved.', {
            'url': url,
            'prescription_status': order.prescription_status,
        })
