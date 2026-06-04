import os
import time
import uuid

from django.conf import settings

from apps.auth_app.models import AuditLog, Notification


# ─── SQLite "database is locked" retry helper ─────────────────────────────────

def db_save_with_retry(instance, update_fields=None, max_retries=5):
    """Save a model instance, retrying with backoff if SQLite reports the
    database is momentarily locked. Returns True on success; re-raises any
    non-lock error (or the lock error after the final attempt).

    NOTE: this only helps OUTSIDE an atomic() block — once a write fails mid
    transaction the connection is poisoned, so the real cure is the WAL mode +
    30s busy_timeout configured in settings.py. Use this for standalone saves
    (management commands, best-effort sweeps).
    """
    for attempt in range(max_retries):
        try:
            if update_fields is not None:
                instance.save(update_fields=update_fields)
            else:
                instance.save()
            return True
        except Exception as exc:  # noqa: BLE001
            if 'database is locked' in str(exc).lower() and attempt < max_retries - 1:
                wait_time = (attempt + 1) * 0.5
                print(f'[DB] Locked, retry {attempt + 1}/{max_retries} in {wait_time}s')
                time.sleep(wait_time)
                continue
            raise
    return False


# ─── Local file storage helpers ───────────────────────────────────────────────
# These replace the old Cloudinary uploads. Files are written under MEDIA_ROOT
# and served from MEDIA_URL (configured in federcare/urls.py).

def _media_url(rel_path, request=None):
    """Build a URL for a file stored at MEDIA_ROOT/<rel_path>.

    Returns an absolute URL when a `request` is given (so it works across the
    React :3000 / Django :8000 origin split, like the old Cloudinary URLs),
    otherwise a root-relative /media/... path.
    """
    url = settings.MEDIA_URL.rstrip('/') + '/' + rel_path.lstrip('/')
    if request is not None:
        return request.build_absolute_uri(url)
    return url


def save_upload_locally(uploaded_file, subdir='uploads', request=None, prefix='file'):
    """Persist a Django UploadedFile to local media storage.

    Returns the file URL (absolute when `request` is supplied).
    """
    name = getattr(uploaded_file, 'name', '') or ''
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else 'bin'
    filename = f'{prefix}_{uuid.uuid4().hex[:10]}.{ext}'
    save_dir = os.path.join(settings.MEDIA_ROOT, subdir)
    os.makedirs(save_dir, exist_ok=True)
    with open(os.path.join(save_dir, filename), 'wb+') as fh:
        for chunk in uploaded_file.chunks():
            fh.write(chunk)
    return _media_url(f'{subdir}/{filename}', request)


def save_bytes_locally(data, filename, subdir='uploads', request=None):
    """Persist raw bytes / a file-like buffer (e.g. a generated PDF or .pkl)
    to local media storage. Returns the file URL.
    """
    if hasattr(data, 'getvalue'):
        data = data.getvalue()
    elif hasattr(data, 'read'):
        data = data.read()
    save_dir = os.path.join(settings.MEDIA_ROOT, subdir)
    os.makedirs(save_dir, exist_ok=True)
    with open(os.path.join(save_dir, filename), 'wb+') as fh:
        fh.write(data)
    return _media_url(f'{subdir}/{filename}', request)


def log_audit(login_id, action, module='', entity_type='', entity_id=None,
              old_value=None, new_value=None, ip_address=None):
    AuditLog.objects.create(
        login_id=login_id,
        action=action,
        module=module,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        ip_address=ip_address,
    )


def send_notification(login_id, title, message, notif_type='alert', related_id=None):
    """Persist a notification and (best-effort) push it via WebSocket.

    The WebSocket push is wrapped in try/except so a missing/down channel layer
    never prevents the DB record from being written.
    """
    notif = Notification.objects.create(
        login_id=login_id,
        title=title,
        message=message,
        notif_type=notif_type,
        related_id=related_id,
    )
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return notif
        async_to_sync(channel_layer.group_send)(
            f'notif_{login_id.login_id}',
            {
                'type': 'push_notification',
                'title': title,
                'message': message,
                'notif_type': notif_type,
                'related_id': str(related_id) if related_id else None,
            },
        )
    except Exception:
        pass
    return notif


def broadcast_new_doctor_to_patients(doctor_name='', hospital_name=''):
    """Tell every patient's notification socket that a new doctor is available
    so their 'Book a Doctor' list refreshes in real time.

    This is a lightweight UI-refresh hint (notif_type='doctor') sent directly
    to each patient's group — it is intentionally NOT persisted as a per-patient
    Notification row. Best-effort: silently no-ops if the channel layer is down.
    """
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        from apps.auth_app.models import LoginCredentials

        channel_layer = get_channel_layer()
        if channel_layer is None:
            return False

        patient_ids = (
            LoginCredentials.objects
            .filter(role='patient', is_active=True)
            .values_list('login_id', flat=True)
        )
        message = (f'{doctor_name} is now available for consultation!'
                   if doctor_name else 'A new doctor is available!')
        for pid in patient_ids[:500]:
            try:
                async_to_sync(channel_layer.group_send)(
                    f'notif_{pid}',
                    {
                        'type': 'push_notification',
                        'title': 'New doctor available',
                        'message': message,
                        'notif_type': 'doctor',
                        'related_id': None,
                    },
                )
            except Exception:
                pass
        return True
    except Exception as e:
        print(f'[broadcast_new_doctor_to_patients] {e}')
        return False


def broadcast_new_slots_to_patients(doctor_name='', doctor_id=None):
    """Tell every patient's notification socket that a doctor added new slots so
    their 'Book a Doctor' list refreshes in real time.

    Mirrors `broadcast_new_doctor_to_patients`: a lightweight UI-refresh hint
    (notif_type='slots') pushed to each patient's `notif_<login_id>` group. It is
    intentionally NOT persisted as a per-patient Notification row. The doctor_id
    is carried in related_id so a patient with that doctor's slot picker open can
    refresh just those slots. Best-effort: no-ops if the channel layer is down.
    """
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        from apps.auth_app.models import LoginCredentials

        channel_layer = get_channel_layer()
        if channel_layer is None:
            return False

        patient_ids = (
            LoginCredentials.objects
            .filter(role='patient', is_active=True)
            .values_list('login_id', flat=True)
        )
        message = (f'Dr. {doctor_name} added new consultation slots!'
                   if doctor_name else 'New consultation slots are available!')
        for pid in patient_ids[:500]:
            try:
                async_to_sync(channel_layer.group_send)(
                    f'notif_{pid}',
                    {
                        'type': 'push_notification',
                        'title': 'New slots available',
                        'message': message,
                        'notif_type': 'slots',
                        'related_id': str(doctor_id) if doctor_id else None,
                    },
                )
            except Exception:
                pass
        return True
    except Exception as e:
        print(f'[broadcast_new_slots_to_patients] {e}')
        return False


def broadcast_pharmacy_update(data):
    """Push a catalog update to every patient browsing medicines (group
    'pharmacy_updates' via ws/pharmacy/). `data` is the inner payload and must
    carry its own 'type' (visibility_changed | out_of_stock | stock_updated).

    Best-effort: never raises if the channel layer is unavailable.
    """
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return False
        # message 'type' routes to PharmacyBroadcastConsumer.medicine_updated
        async_to_sync(channel_layer.group_send)(
            'pharmacy_updates',
            {'type': 'medicine_updated', 'data': data or {}},
        )
        return True
    except Exception as e:
        print(f'[broadcast_pharmacy_update] {e}')
        return False


def broadcast_order_status(order_id, status, message=''):
    """Push a status update to everyone subscribed to ws/orders/<order_id>/.

    Best-effort: silently no-ops if the channel layer is unavailable.
    """
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return False
        async_to_sync(channel_layer.group_send)(
            f'order_{order_id}',
            {
                'type': 'order_status_update',
                'order_id': str(order_id),
                'status': status,
                'message': message,
            },
        )
        return True
    except Exception:
        return False


def broadcast_fl_update(fl_type, data):
    """Push an FL lifecycle event (round_started / weight_submitted /
    model_updated) to all subscribers of the 'fl_global' WebSocket group.

    Best-effort: never raises if the channel layer is unavailable.
    """
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return False
        async_to_sync(channel_layer.group_send)(
            'fl_global',
            {
                'type': 'fl_update',
                'fl_type': fl_type,
                'data': data or {},
            },
        )
        return True
    except Exception as exc:
        print(f'FL broadcast error: {exc}')
        return False


def broadcast_medicine_update(user_id, update_type, data):
    """Push a medicine-order event to ws/medicine/<user_id>/ subscribers.

    Best-effort: never raises if the channel layer is unavailable.
    """
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return False
        async_to_sync(channel_layer.group_send)(
            f'medicine_{user_id}',
            {
                'type': 'medicine_update',
                'update_type': update_type,
                'data': data or {},
            },
        )
        print(f'Medicine broadcast to {user_id}: {update_type}')
        return True
    except Exception as exc:
        print(f'Medicine broadcast error: {exc}')
        return False


def broadcast_gps(dispatch_id, lat, lng, eta_minutes=None):
    """Push a GPS update to ws/gps/<dispatch_id>/ subscribers."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return False
        async_to_sync(channel_layer.group_send)(
            f'gps_{dispatch_id}',
            {
                'type': 'gps_update',
                'lat': lat,
                'lng': lng,
                'eta_minutes': eta_minutes,
                'dispatch_id': str(dispatch_id),
            },
        )
        return True
    except Exception:
        return False
