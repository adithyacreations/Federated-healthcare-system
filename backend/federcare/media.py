from pathlib import Path
from urllib.parse import quote, unquote, urlencode, urlsplit
from uuid import UUID

from django.conf import settings
from django.core import signing
from django.db.models import Q
from django.http import FileResponse, Http404
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.views.decorators.http import require_safe
from rest_framework.renderers import JSONRenderer

from apps.auth_app.authentication import session_stamp
from apps.auth_app.models import LoginCredentials
from apps.doctor.models import Prescription
from apps.lab.models import LabReport
from apps.patient.models import EHRConsentLog, EHRImage, EHRRecord, LabTestOrder
from apps.pharmacy.models import MedicineOrder


PUBLIC_IMAGE_FOLDERS = {
    'developers', 'features', 'profile_photos', 'medicine_images',
    'equipment_images', 'products',
}
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'}
LINK_SALT = 'federcare.media'
LINK_TTL = 900


def media_path(value):
    """Extract a local media path from a stored relative or absolute URL."""
    try:
        url = urlsplit(value)
    except ValueError:
        return None
    if url.scheme not in {'', 'http', 'https'}:
        return None
    prefix = settings.MEDIA_URL.rstrip('/') + '/'
    path = unquote(url.path)
    if path.startswith(prefix):
        return path[len(prefix):]
    return None


def is_public_image(path):
    return path.split('/', 1)[0] in PUBLIC_IMAGE_FOLDERS and Path(path).suffix.lower() in IMAGE_EXTENSIONS


def stored_url(field, path):
    url = settings.MEDIA_URL.rstrip('/') + '/' + path
    encoded = quote(url, safe='/')
    return (Q(**{field: path}) | Q(**{field: url}) |
            Q(**{field + '__endswith': url}) | Q(**{field + '__endswith': encoded}))


def ehr_patient_access(user):
    access = Q(patient_id__login_id=user)
    if user.role == 'doctor':
        consent = EHRConsentLog.objects.filter(
            accessed_by=user, consent_given=True, expires_at__gt=timezone.now(),
        ).values('patient_id')
        access |= Q(patient_id__in=consent)
    return access


def patient_file_allowed(user, path):
    folder, _, filename = path.partition('/')
    ehr_access = ehr_patient_access(user)
    medicine_access = Q(patient_id__login_id=user) | Q(pharmacist_id__login_id=user)
    if folder == 'ehr_images':
        return EHRImage.objects.filter(ehr_access, stored_url('image_url', path)).exists()
    if folder == 'prescriptions':
        return (
            Prescription.objects.filter(
                ehr_access | Q(doctor_id__login_id=user) | Q(medicine_orders__pharmacist_id__login_id=user),
                stored_url('pdf_url', path),
            ).exists()
            or MedicineOrder.objects.filter(
                medicine_access,
                stored_url('prescription_local_url', path) | stored_url('prescription_url', path) |
                Q(prescription_file=path),
            ).exists()
        )
    if folder == 'invoices':
        if not filename.startswith('inv_') or not filename.endswith('.pdf'):
            return False
        try:
            order_id = UUID(filename[4:-4])
        except ValueError:
            return False
        return MedicineOrder.objects.filter(medicine_access, pk=order_id).exists()
    if folder == 'lab_prescriptions':
        booking_access = Q(patient_id__login_id=user) | Q(doctor_id__login_id=user)
        if user.role == 'lab_tech' and hasattr(user, 'lab_tech_profile'):
            booking_access |= Q(hospital_id=user.lab_tech_profile.hospital_id_id)
        return LabTestOrder.objects.filter(
            booking_access, stored_url('prescription_image', path),
        ).exists()
    if folder == 'lab_reports':
        booking_access = ehr_access | Q(doctor_id__login_id=user)
        if user.role == 'lab_tech' and hasattr(user, 'lab_tech_profile'):
            booking_access |= Q(hospital_id=user.lab_tech_profile.hospital_id_id)
        return (
            LabReport.objects.filter(
                ehr_access | Q(order_id__doctor_id__login_id=user) | Q(order_id__lab_tech_id__login_id=user),
                stored_url('report_file_url', path),
            ).exists()
            or LabTestOrder.objects.filter(booking_access, stored_url('report_url', path)).exists()
        )
    if folder == 'uploads':
        return EHRRecord.objects.filter(ehr_access, stored_url('file_url', path)).exists()
    return folder == 'fl_models' and user.role in {'super_admin', 'hospital_admin'}


class MediaLinkRenderer(JSONRenderer):
    """Issue expiring browser links for local files in authenticated API responses."""

    def render(self, data, accepted_media_type=None, renderer_context=None):
        request = (renderer_context or {}).get('request')
        user = getattr(request, 'user', None)
        if (isinstance(user, LoginCredentials) and user.is_active
                and user.is_approved and not user.force_password_change):
            data = self.add_links(data, request, (str(user.pk), session_stamp(user)))
        return super().render(data, accepted_media_type, renderer_context)

    def add_links(self, value, request, account_signature):
        if isinstance(value, dict):
            return {key: self.add_links(item, request, account_signature) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [self.add_links(item, request, account_signature) for item in value]
        if not isinstance(value, str) or '/media/' not in value:
            return value
        path = media_path(value)
        if not path or is_public_image(path):
            return value
        access = signing.dumps((*account_signature, path), salt=LINK_SALT)
        return request.build_absolute_uri(
            settings.MEDIA_URL + quote(path, safe='/') + '?' + urlencode({'access': access}),
        )


@require_safe
def serve_media(request, path):
    if '\\' in path or any(part in {'', '.', '..'} for part in path.split('/')):
        raise Http404
    public = is_public_image(path)
    if not public:
        try:
            login_id, stamp, signed_path = signing.loads(
                request.GET.get('access', ''), salt=LINK_SALT, max_age=LINK_TTL,
            )
            user = LoginCredentials.objects.get(
                pk=UUID(login_id), is_active=True, is_approved=True, force_password_change=False,
            )
        except (signing.BadSignature, TypeError, ValueError, AttributeError, LoginCredentials.DoesNotExist) as exc:
            raise Http404 from exc
        if (signed_path != path or not constant_time_compare(stamp, session_stamp(user))
                or not patient_file_allowed(user, path)):
            raise Http404

    root = Path(settings.MEDIA_ROOT).resolve()
    file = (root / path).resolve()
    if not file.is_relative_to(root) or not file.is_file():
        raise Http404
    download = file.suffix.lower() not in IMAGE_EXTENSIONS | {'.pdf'}
    response = FileResponse(file.open('rb'), as_attachment=download, filename=file.name)
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = "sandbox"
    response['Referrer-Policy'] = 'no-referrer'
    if not public:
        response['Cache-Control'] = 'private, no-store'
    return response
