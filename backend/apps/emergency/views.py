import threading
from datetime import date, datetime, timezone

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.auth_app.permissions import IsDriver, IsHospitalAdmin, IsPatient
from utils import log_audit, send_notification
from .models import (
    AmbulanceDriverRegistration,
    Ambulance,
    EmergencyRequest,
    AmbulanceDispatch,
)
from .serializers import (
    DriverProfileSerializer,
    AmbulanceSerializer,
    EmergencyRequestSerializer,
    DispatchSerializer,
    UpdateDispatchStatusSerializer,
    UpdateGPSSerializer,
)


# ─── Dispatch timeout-timer registry ────────────────────────────────────────
# Each un-accepted dispatch gets a threading.Timer that auto-reassigns it after
# the severity timeout. We keep a handle to every live timer (keyed by dispatch
# id) so it can be cancelled the instant the dispatch is resolved — driver
# accepts, patient cancels, or the trip completes — instead of waking up later
# just to bail. Guarded by a lock since timers fire on their own threads.
_dispatch_timers = {}
_dispatch_timers_lock = threading.Lock()


def _register_dispatch_timer(dispatch_id, timer):
    with _dispatch_timers_lock:
        _dispatch_timers[str(dispatch_id)] = timer


def cancel_dispatch_timer(dispatch_id, reason=''):
    """Cancel + forget the pending timeout timer for one dispatch (if any)."""
    key = str(dispatch_id)
    with _dispatch_timers_lock:
        timer = _dispatch_timers.pop(key, None)
    if timer is not None:
        try:
            timer.cancel()
        except Exception:  # noqa: BLE001
            pass
        print(f'[TIMER] Cancelled timer for dispatch {key}'
              f'{f" — {reason}" if reason else ""}')
        return True
    print(f'[TIMER] No live timer for dispatch {key}')
    return False


def cancel_emergency_timers(emergency, reason=''):
    """Cancel the timeout timers of every dispatch belonging to `emergency` —
    used on patient cancel / I'm-safe / driver report so no stale timer reroutes."""
    for d_id in AmbulanceDispatch.objects.filter(
        emergency_id=emergency,
    ).values_list('dispatch_id', flat=True):
        cancel_dispatch_timer(d_id, reason)


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


def get_driver(request):
    try:
        return AmbulanceDriverRegistration.objects.select_related(
            'hospital_id', 'login_id'
        ).get(login_id=request.user)
    except AmbulanceDriverRegistration.DoesNotExist:
        return None


def get_ambulance(driver):
    return Ambulance.objects.filter(driver_id=driver).first()


def free_ambulance(dispatch):
    """Mark a dispatch's ambulance (and its driver) available again — called on
    completion, rejection, and timeout so a freed unit can take new emergencies."""
    try:
        ambulance = dispatch.ambulance_id
        if not ambulance:
            return
        ambulance.is_available = True
        ambulance.save(update_fields=['is_available'])
        print(f'[EMERGENCY] Freed ambulance: {ambulance.vehicle_no}')
        driver = ambulance.driver_id
        if driver:
            driver.is_available = True
            driver.save(update_fields=['is_available'])
            print(f'[EMERGENCY] Freed driver: {driver.full_name}')
    except Exception as exc:
        print(f'[EMERGENCY] Ambulance free error: {exc}')


# ─── Bed availability + real-time rerouting (Option B) ──────────────────────
# Destination state lives on the EmergencyRequest (assigned_hospital_id /
# assigned_bed_id). A reserved Bed is linked back to its emergency so the
# monitor can detect if the bed was taken by someone else mid-trip.

def find_nearest_hospital_with_beds(patient_lat, patient_lng, exclude_hospital_ids=None):
    """Distance-sorted list of approved hospitals that have a free bed."""
    from apps.hospital.models import HospitalRegistration, Bed
    from .utils import calculate_distance

    exclude_hospital_ids = exclude_hospital_ids or []
    results = []
    # Only approved AND active (not admin-suspended) hospitals may receive a
    # rerouted emergency patient.
    hospitals = HospitalRegistration.objects.filter(
        approval_status='approved',
        login_id__is_active=True,
    ).select_related('login_id').exclude(hospital_id__in=exclude_hospital_ids)

    for hospital in hospitals:
        bed_count = Bed.objects.filter(hospital_id=hospital, status='available').count()
        if bed_count == 0:
            continue
        dist = calculate_distance(patient_lat, patient_lng, hospital.latitude, hospital.longitude)
        results.append({'hospital': hospital, 'distance': dist, 'bed_count': bed_count})

    results.sort(key=lambda x: x['distance'])
    return results


# A dispatch in any of these states means a driver has ALREADY accepted and is
# actively handling (or has delivered) the patient — so the emergency must never
# be re-dispatched to another driver, even if EmergencyRequest.status still reads
# 'dispatched' (it only flips to 'completed' on hospital acknowledgment).
ACCEPTED_DISPATCH_STATUSES = ('en_route', 'arrived', 'pending_acknowledgment', 'completed')


def should_reroute(emergency, dispatch=None):
    """Single source of truth for "may this emergency still be (re)dispatched?".

    Returns False once the patient has cancelled / been marked safe, the trip has
    ended, OR a driver has already accepted it — so no timeout, rejection, or
    bed-monitor path can ever send a phantom request to a second driver after the
    emergency is already being handled or is done.

    Everything is re-read fresh from the DB so a background thread holding a stale
    in-memory copy can't slip past the guard. The optional `dispatch` is the one
    that just failed (rejected/timed-out) — passing it lets us also rule out a
    dispatch that completed in the meantime.
    """
    if not emergency:
        return False
    try:
        emergency.refresh_from_db()
    except EmergencyRequest.DoesNotExist:
        return False

    # ── Emergency-level terminal states ──
    if emergency.status in ('cancelled', 'completed', 'resolved', 'no_drivers'):
        print(f'[REROUTE] STOP: emergency status={emergency.status}')
        return False
    if getattr(emergency, 'cancelled_by', None):
        print(f'[REROUTE] STOP: cancelled_by={emergency.cancelled_by}')
        return False
    if getattr(emergency, 'patient_safe', False):
        print('[REROUTE] STOP: patient_safe=True')
        return False

    # ── The just-failed dispatch must not itself have completed/cancelled ──
    if dispatch is not None:
        try:
            dispatch.refresh_from_db()
            if dispatch.dispatch_status in ('completed', 'cancelled'):
                print(f'[REROUTE] STOP: dispatch={dispatch.dispatch_status}')
                return False
            if dispatch.completed_at:
                print('[REROUTE] STOP: dispatch completed_at is set')
                return False
        except AmbulanceDispatch.DoesNotExist:
            pass

    # ── A driver is already on it (accepted → delivered) ──
    # This is the key loop-stopper: once any dispatch for this emergency is
    # en_route/arrived/pending_acknowledgment/completed, no other driver may be
    # rerouted — closes the window where emergency.status still reads 'dispatched'
    # during an active accepted trip or pending hospital acknowledgment.
    if AmbulanceDispatch.objects.filter(
        emergency_id=emergency,
        dispatch_status__in=ACCEPTED_DISPATCH_STATUSES,
    ).exists():
        print('[REROUTE] STOP: an accepted/active dispatch already exists')
        return False

    print('[REROUTE] OK to reroute.')
    return True


def emergency_ended(emergency):
    """True once the emergency is cancelled / completed / patient-safe.

    Used by the bed monitor, which legitimately re-routes the *hospital* for an
    already-accepted trip (same driver, new destination) — so it must NOT use
    should_reroute()'s "an accepted dispatch exists" guard, only the terminal
    checks. Re-reads fresh from the DB."""
    if not emergency:
        return True
    try:
        emergency.refresh_from_db()
    except EmergencyRequest.DoesNotExist:
        return True
    if emergency.status in ('cancelled', 'completed', 'resolved'):
        return True
    if getattr(emergency, 'cancelled_by', None):
        return True
    if getattr(emergency, 'patient_safe', False):
        return True
    return False


def count_available_beds(hospital):
    """How many beds are free right now at `hospital`. Used both at dispatch and
    again when the ambulance arrives, so the driver/hospital can react if the
    last free bed was taken mid-trip. (Bed has only a `status` field — no
    `is_available` — so 'available' is the single source of truth.)"""
    if not hospital:
        return 0
    try:
        from apps.hospital.models import Bed
        return Bed.objects.filter(hospital_id=hospital, status='available').count()
    except Exception as exc:  # noqa: BLE001
        print(f'[BEDS] Count error: {exc}')
        return 0


def get_preferred_bed_types(severity):
    """Bed types to try (best-first) for a given emergency severity.
    Critical → ICU, High → HDU/Semi-ICU (falls back to general), Moderate/Low →
    general ward. Matched against Bed.bed_type via icontains so label variants
    ('ICU', 'Intensive Care', …) still resolve."""
    mapping = {
        'critical': ['icu', 'ICU', 'Intensive Care', 'intensive'],
        'high': ['semi_icu', 'HDU', 'hdu', 'semi-icu', 'High Dependency', 'general'],
        'moderate': ['general', 'ward', 'General Ward', 'normal'],
        'low': ['general', 'ward', 'normal', 'basic'],
        'non_urgent': ['general', 'ward', 'normal', 'basic'],
    }
    return mapping.get(str(severity or '').lower(), ['general', 'ward', 'normal'])


def reserve_bed_for_emergency(hospital, emergency):
    """Reserve a free bed at `hospital` for `emergency`, preferring the bed type
    that matches the emergency's severity (status → reserved, linked to the
    emergency + patient). Falls back to any available bed if no preferred type
    is free."""
    from apps.hospital.models import Bed
    from django.utils import timezone as dj_tz

    preferred_types = get_preferred_bed_types(emergency.severity)

    # Try the severity-preferred bed types first (best match wins).
    bed = None
    for bed_type in preferred_types:
        bed = Bed.objects.filter(
            hospital_id=hospital,
            status='available',
            emergency_id__isnull=True,
            bed_type__icontains=bed_type,
        ).first()
        if bed:
            print(f'[BED] Found {bed.bed_type} bed for {emergency.severity} '
                  f'severity at {hospital.hospital_name}')
            break

    # Fallback: any free bed when no preferred type is available.
    if not bed:
        bed = Bed.objects.filter(
            hospital_id=hospital,
            status='available',
            emergency_id__isnull=True,
        ).first()
        if bed:
            print(f'[BED] Fallback: using {bed.bed_type} bed '
                  f'(no preferred type available)')
        else:
            print(f'[BED] No beds available at {hospital.hospital_name}')
            return None

    bed.status = 'reserved'
    bed.reserved_at = dj_tz.now()
    bed.emergency_locked_at = dj_tz.now()
    bed.emergency_id = emergency
    bed.reserved_for = emergency.patient_id
    bed.save(update_fields=[
        'status', 'reserved_at', 'emergency_locked_at', 'emergency_id', 'reserved_for', 'updated_at',
    ])
    print(f'[BED] Reserved {bed.bed_type} bed {bed.bed_id} for '
          f'{emergency.severity} emergency at {hospital.hospital_name}')
    return bed


def get_severity_bed_label(severity, bed_type=''):
    """Human-readable, color-coded label of the bed reserved for a severity."""
    sev = str(severity or '').lower()
    if sev == 'critical':
        return '🔴 ICU Bed Reserved'
    if sev == 'high':
        return '🟠 HDU Bed Reserved'
    if sev == 'moderate':
        return '🟡 General Bed Reserved'
    return '🟢 Normal Bed Reserved'


def release_bed_reservation(bed):
    if not bed:
        return
    try:
        bed.status = 'available'
        bed.reserved_at = None
        bed.emergency_id = None
        bed.reserved_for = None
        bed.emergency_locked_at = None
        bed.save(update_fields=['status', 'reserved_at', 'emergency_id', 'reserved_for', 'emergency_locked_at', 'updated_at'])
        print(f'[BED] Released bed {bed.bed_id}')
    except Exception as exc:
        print(f'[BED] Release error: {exc}')


def _reroute_emergency_bed(dispatch, emergency):
    """Reserve a bed at the next-nearest hospital and update the destination."""
    # A bed reroute keeps the SAME (already-accepted) driver and only changes the
    # destination hospital — so it uses emergency_ended() (terminal checks only),
    # NOT should_reroute() which would block any trip a driver has accepted.
    if emergency_ended(emergency):
        print('[BED] Emergency ended — skipping bed reroute.')
        return

    excluded = []
    if emergency.assigned_hospital_id:
        excluded.append(emergency.assigned_hospital_id.hospital_id)

    options = find_nearest_hospital_with_beds(
        float(emergency.patient_lat), float(emergency.patient_lng),
        exclude_hospital_ids=excluded,
    )
    if not options:
        send_notification(
            emergency.patient_id.login_id, '⚠️ Hospital Beds Full',
            'All nearby hospitals are at capacity. Emergency services have been notified.',
            notif_type='emergency', related_id=str(emergency.emergency_id),
        )
        print('[BED] Reroute failed — no hospital with free beds.')
        return

    new_hospital = options[0]['hospital']
    new_bed = reserve_bed_for_emergency(new_hospital, emergency)
    emergency.assigned_hospital_id = new_hospital
    emergency.assigned_bed_id = new_bed
    emergency.save(update_fields=['assigned_hospital_id', 'assigned_bed_id'])
    dispatch.rerouted = True
    dispatch.reroute_count += 1
    dispatch.save(update_fields=['rerouted', 'reroute_count'])

    driver = dispatch.ambulance_id.driver_id
    if driver:
        ws_broadcast(f'emergency_{driver.login_id.login_id}', 'bed_reroute', {'data': {
            'message': f'Bed taken! Rerouting to {new_hospital.hospital_name}',
            'new_hospital_name': new_hospital.hospital_name,
            'new_hospital_lat': str(new_hospital.latitude or ''),
            'new_hospital_lon': str(new_hospital.longitude or ''),
            'bed_info': f'New bed reserved at {new_hospital.hospital_name}',
            'reroute_count': dispatch.reroute_count,
        }})
    send_notification(
        emergency.patient_id.login_id, '🏥 Hospital Updated',
        f'Due to bed availability, you are now being taken to {new_hospital.hospital_name}.',
        notif_type='emergency', related_id=str(emergency.emergency_id),
    )
    print(f'[BED] Rerouted emergency {emergency.emergency_id} → {new_hospital.hospital_name} '
          f'(reroute #{dispatch.reroute_count})')


def start_bed_monitor(dispatch_id, emergency_id, check_interval=30):
    """Every `check_interval`s, verify the emergency's reserved bed is still
    held for it; if it was taken, reroute to the next-nearest hospital. Runs in
    a daemon thread and stops once the trip ends."""
    import threading

    def _check():
        from django.db import connection
        try:
            dispatch = AmbulanceDispatch.objects.select_related(
                'emergency_id', 'emergency_id__assigned_hospital_id',
                'emergency_id__assigned_bed_id', 'emergency_id__patient_id',
                'emergency_id__patient_id__login_id',
                'ambulance_id', 'ambulance_id__driver_id', 'ambulance_id__driver_id__login_id',
            ).get(dispatch_id=dispatch_id)

            # Stop once the trip is effectively over.
            if dispatch.dispatch_status in (
                'completed', 'rejected', 'cancelled', 'pending_acknowledgment',
            ):
                print(f'[BED] Monitor stopped for {dispatch_id} ({dispatch.dispatch_status})')
                return

            emergency = dispatch.emergency_id
            bed = emergency.assigned_bed_id
            if bed is not None:
                still_ours = (
                    bed.status == 'reserved'
                    and str(getattr(bed, 'emergency_id_id', '')) == str(emergency.emergency_id)
                )
                if not still_ours:
                    print(f'[BED] Bed {bed.bed_id} lost for emergency {emergency.emergency_id} — rerouting')
                    _reroute_emergency_bed(dispatch, emergency)

            # Reschedule the next check while the trip is active.
            timer = threading.Timer(check_interval, _check)
            timer.daemon = True
            timer.start()
        except AmbulanceDispatch.DoesNotExist:
            pass
        except Exception as exc:
            print(f'[BED] Monitor error: {exc}')
            import traceback
            traceback.print_exc()
        finally:
            connection.close()

    timer = threading.Timer(check_interval, _check)
    timer.daemon = True
    timer.start()
    print(f'[BED] Monitor started for dispatch {dispatch_id} (every {check_interval}s)')


def _eta_minutes_for(distance_km):
    # Average ambulance speed ≈ 40 km/h.
    return max(1, int((float(distance_km) / 40) * 60))


# How long a driver has to accept before we auto-reassign — less urgent cases
# give the driver more time before moving on.
SEVERITY_TIMEOUTS = {
    'critical': 60,
    'high': 60,
    'moderate': 180,
    'low': 300,
    'non_urgent': 300,
}


def get_timeout_seconds(severity):
    return SEVERITY_TIMEOUTS.get(str(severity or '').lower(), 60)


# Grace period (seconds) added on top of the severity timeout before an
# un-accepted dispatch is treated as orphaned by the on-read sweep below.
_STALE_DISPATCH_GRACE = 30


def reap_stale_dispatches(driver=None):
    """Lazily reject + free any un-accepted 'dispatched' dispatch that outlived
    its accept window.

    The auto-reassign timer is an in-memory threading.Timer (see
    `_dispatch_timers`), so it does NOT survive a server restart / autoreload —
    and an interrupted run or a patient closing the tab leaves the same orphan.
    A dispatch stuck in 'dispatched' is still surfaced as "active" by
    ActiveDispatchView / DriverDashboardView, so it shows a phantom patient card
    on that driver's screen forever — and once a fresh SOS goes to another
    driver, *two* drivers appear to hold the patient.

    This on-read sweep is the durable backstop (mirrors the lab no-show sweep):
    if a dispatch sat in 'dispatched' past its severity timeout + grace and
    nobody accepted it, treat it as a no-response, mark it rejected, and free the
    ambulance so it drops out of every "active" query. Scoped to `driver` when
    given so a dashboard poll only sweeps its own rows. Returns the count swept.
    """
    from django.utils import timezone as dj_tz
    from datetime import timedelta

    qs = AmbulanceDispatch.objects.select_related(
        'emergency_id', 'ambulance_id', 'ambulance_id__driver_id',
    ).filter(dispatch_status='dispatched')
    if driver is not None:
        qs = qs.filter(ambulance_id__driver_id=driver)

    now = dj_tz.now()
    swept = 0
    for dispatch in qs:
        severity = dispatch.emergency_id.severity if dispatch.emergency_id else None
        max_age = get_timeout_seconds(severity) + _STALE_DISPATCH_GRACE
        if not dispatch.dispatched_at:
            continue
        if dispatch.dispatched_at <= now - timedelta(seconds=max_age):
            dispatch.dispatch_status = 'rejected'
            dispatch.save(update_fields=['dispatch_status'])
            free_ambulance(dispatch)
            cancel_dispatch_timer(dispatch.dispatch_id, 'orphaned — swept on read')
            swept += 1
            print(f'[SWEEP] Orphaned dispatch {dispatch.dispatch_id} '
                  f'(> {max_age}s un-accepted) auto-rejected + ambulance freed')
    return swept


def assign_next_ambulance(emergency):
    """Reassign an emergency to the next-nearest ambulance, skipping any that
    already rejected/timed-out for this emergency. Returns the new dispatch, or
    None when no ambulance is left (patient is told to call 108)."""
    from .utils import find_nearest_ambulance

    # Never reassign an emergency the patient already cancelled (or that has
    # otherwise ended). should_reroute() re-reads fresh from the DB so a timeout
    # thread holding a stale in-memory copy can't resurrect a dead emergency by
    # dispatching to a new driver (the "phantom re-dispatch").
    if not should_reroute(emergency):
        print('[REROUTE] Emergency not active — no reassignment.')
        return None

    tried_ids = list(
        AmbulanceDispatch.objects.filter(
            emergency_id=emergency, dispatch_status='rejected',
        ).values_list('ambulance_id', flat=True)
    )
    nearest, distance = find_nearest_ambulance(
        float(emergency.patient_lat), float(emergency.patient_lng),
        exclude_ids=tried_ids,
    )

    patient_group = f'emergency_{emergency.patient_id.login_id.login_id}'
    timeout_seconds = get_timeout_seconds(emergency.severity)

    if not nearest:
        print('[EMERGENCY] No more ambulances available — notifying patient to call 108.')
        emergency.status = 'no_drivers'
        emergency.save(update_fields=['status'])
        send_notification(
            emergency.patient_id.login_id,
            '❌ No Ambulance Available!',
            'All nearby drivers are unavailable. Please call 108 immediately for emergency help!',
            notif_type='emergency', related_id=str(emergency.emergency_id),
        )
        ws_broadcast(patient_group, 'emergency_status_update',
                     {'status': 'no_drivers', 'message': 'No ambulance available! Please call 108!'})
        return None

    eta = _eta_minutes_for(distance)
    dispatch = AmbulanceDispatch.objects.create(
        emergency_id=emergency, ambulance_id=nearest,
        dispatch_status='dispatched', eta_minutes=eta,
    )
    nearest.is_available = False
    nearest.save(update_fields=['is_available'])

    driver = nearest.driver_id
    if driver:
        driver.is_available = False
        driver.save(update_fields=['is_available'])
        send_notification(
            driver.login_id, '🚨 Emergency Dispatch!',
            f'Pick up {emergency.patient_id.full_name}. '
            f'Severity: {emergency.severity.upper()}. Respond within 60 seconds!',
            notif_type='emergency', related_id=str(emergency.emergency_id),
        )
        ws_broadcast(
            f'emergency_{driver.login_id.login_id}', 'emergency_dispatch',
            {'data': {
                'emergency_id': str(emergency.emergency_id),
                'dispatch_id': str(dispatch.dispatch_id),
                'patient_name': emergency.patient_id.full_name,
                'patient_phone': emergency.patient_id.emergency_contact,
                'patient_lat': float(emergency.patient_lat),
                'patient_lng': float(emergency.patient_lng),
                'severity': emergency.severity.upper(),
                'eta_minutes': eta,
                'distance_km': round(distance, 2),
                'hospital_name': (
                    emergency.assigned_hospital_id.hospital_name
                    if emergency.assigned_hospital_id else 'Nearest Hospital'
                ),
                'timeout_seconds': timeout_seconds,
                'message': f'Emergency dispatch! {emergency.patient_id.full_name} needs help.',
            }},
        )

    ws_broadcast(patient_group, 'emergency_status_update',
                 {'status': 'reassigning', 'message': 'Finding the next nearest ambulance…'})
    schedule_dispatch_timeout(dispatch.dispatch_id, timeout_seconds)
    return dispatch


def schedule_dispatch_timeout(dispatch_id, seconds=None):
    """If a dispatch is still un-accepted after `seconds`, auto-reject it and
    reassign to the next-nearest ambulance. `seconds` defaults to the severity-
    based timeout. Runs in a daemon thread so it never blocks the request;
    closes its DB connection when done."""
    import threading

    def _timeout():
        from django.db import connection
        # This timer has now fired — drop its registry handle so a later cancel
        # is a harmless no-op.
        with _dispatch_timers_lock:
            _dispatch_timers.pop(str(dispatch_id), None)
        try:
            dispatch = AmbulanceDispatch.objects.select_related(
                'emergency_id', 'ambulance_id', 'ambulance_id__driver_id',
            ).get(dispatch_id=dispatch_id)
            print(f'[EMERGENCY] Auto-reject triggered for dispatch {dispatch_id}')
            print(f'[EMERGENCY] Dispatch status: {dispatch.dispatch_status}')
            # If the patient cancelled, a driver already accepted, or the trip
            # otherwise ended while this timer was pending, stand down — do NOT
            # auto-reject + reroute, or we'd dispatch a new driver to a trip
            # that's already handled.
            if not should_reroute(dispatch.emergency_id, dispatch):
                print('[EMERGENCY] Emergency not reroutable — aborting auto-reject/reroute.')
                return
            # Still 'dispatched' means the driver never accepted (accept moves
            # it to 'en_route'). Treat as a no-response and move on.
            if dispatch.dispatch_status != 'dispatched':
                print('[EMERGENCY] Already accepted/handled — no action.')
                return
            dispatch.dispatch_status = 'rejected'
            dispatch.save(update_fields=['dispatch_status'])
            free_ambulance(dispatch)
            # Dismiss the timed-out driver's popup so they don't keep seeing an
            # emergency that's now being offered to someone else.
            push_dispatch_cancelled(
                dispatch,
                'Response time expired — this emergency was reassigned to another driver.',
                reason='timeout',
            )
            print('[EMERGENCY] Looking for next driver…')
            assign_next_ambulance(dispatch.emergency_id)
        except AmbulanceDispatch.DoesNotExist:
            pass
        except Exception as exc:
            print(f'[EMERGENCY] Auto-reject error: {exc}')
            import traceback
            traceback.print_exc()
        finally:
            connection.close()

    if seconds is None:
        try:
            severity = AmbulanceDispatch.objects.select_related('emergency_id').get(
                dispatch_id=dispatch_id
            ).emergency_id.severity
            seconds = get_timeout_seconds(severity)
        except AmbulanceDispatch.DoesNotExist:
            seconds = 60

    print(f'[EMERGENCY] Timer started: {seconds}s for dispatch {dispatch_id}')
    timer = threading.Timer(float(seconds), _timeout)
    timer.daemon = True
    timer.start()
    # Store the handle so the timer can be cancelled the moment the dispatch is
    # accepted / cancelled / completed (instead of waking up later to bail).
    _register_dispatch_timer(dispatch_id, timer)
    print(f'[TIMER] Started for dispatch {dispatch_id}')


def ws_broadcast(group_name, message_type, payload):
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(group_name, {
            'type': message_type,
            **payload,
        })
    except Exception:
        pass


def push_dispatch_cancelled(dispatch, message='Emergency handled by another driver.',
                            reason='reassigned'):
    """Tell a dispatch's driver to dismiss their incoming-request popup because
    the dispatch is no longer theirs — it timed out and was reassigned, or
    another driver accepted the same emergency. Sent to the driver's per-user
    `emergency_<login_id>` channel (the same one the dispatch alert arrives on)."""
    try:
        driver = dispatch.ambulance_id.driver_id if dispatch.ambulance_id else None
        if not driver or not driver.login_id:
            return
        ws_broadcast(
            f'emergency_{driver.login_id.login_id}', 'dispatch_cancelled',
            {'data': {
                'dispatch_id': str(dispatch.dispatch_id),
                'emergency_id': str(dispatch.emergency_id_id),
                'message': message,
                'reason': reason,
                'action': 'remove',
            }},
        )
        print(f'[DISPATCH] Asked driver to dismiss popup (dispatch {dispatch.dispatch_id}, {reason})')
    except Exception as exc:  # noqa: BLE001
        print(f'[DISPATCH] dispatch_cancelled push error: {exc}')


# ─── Driver Views ─────────────────────────────────────────────────────────────

class DriverDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    def get(self, request):
        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        ambulance = get_ambulance(driver)
        today = date.today()

        # Reap orphaned 'dispatched' rows so the dashboard's active-dispatch
        # card reflects reality after a restart / interrupted run.
        reap_stale_dispatches(driver)

        dispatches = AmbulanceDispatch.objects.filter(
            ambulance_id__driver_id=driver
        )
        completed_today = dispatches.filter(
            dispatch_status='completed',
            completed_at__date=today,
        ).count()
        total_trips = dispatches.filter(dispatch_status='completed').count()

        active_dispatch = dispatches.select_related(
            'emergency_id', 'emergency_id__patient_id',
            'emergency_id__assigned_hospital_id',
            'emergency_id__assigned_bed_id',
            'ambulance_id',
        ).filter(
            dispatch_status__in=['dispatched', 'en_route', 'arrived', 'pending_acknowledgment']
        ).first()

        return ok('Driver dashboard loaded.', {
            'driver_name': driver.full_name,
            'vehicle_no': ambulance.vehicle_no if ambulance else None,
            'ambulance_type': ambulance.ambulance_type if ambulance else None,
            'is_available': driver.is_available,
            'active_dispatch': DispatchSerializer(active_dispatch).data if active_dispatch else None,
            'todays_trips': completed_today,
            'total_trips': total_trips,
            'current_location': {
                'lat': float(ambulance.current_lat) if ambulance and ambulance.current_lat else None,
                'lng': float(ambulance.current_lng) if ambulance and ambulance.current_lng else None,
            },
        })


class ToggleAvailabilityView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    def put(self, request):
        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        ambulance = get_ambulance(driver)
        # Honour an explicit target if the client sends one (keeps UI + backend
        # in sync even if the stored flag drifted); otherwise just flip.
        requested = request.data.get('is_available')
        new_status = bool(requested) if requested is not None else (not driver.is_available)

        driver.is_available = new_status
        driver.save(update_fields=['is_available'])

        if ambulance:
            ambulance.is_available = new_status
            ambulance.save(update_fields=['is_available'])

        state = 'available' if new_status else 'unavailable'
        log_audit(
            login_id=request.user,
            action=f'Driver toggled availability to {state}',
            module='emergency',
            entity_type='AmbulanceDriverRegistration',
            entity_id=str(driver.driver_id),
        )
        return ok(f'You are now marked as {state}.', {'is_available': new_status})


class ActiveDispatchView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    def get(self, request):
        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        # Drop any orphaned 'dispatched' rows (timer lost to a restart, etc.)
        # before reading, so a phantom patient card never lingers on this driver.
        reap_stale_dispatches(driver)

        dispatch = AmbulanceDispatch.objects.select_related(
            'emergency_id',
            'emergency_id__patient_id',
            'emergency_id__assigned_hospital_id',
            'emergency_id__assigned_bed_id',
            'ambulance_id',
        ).filter(
            ambulance_id__driver_id=driver,
            dispatch_status__in=['dispatched', 'en_route', 'arrived', 'pending_acknowledgment'],
        ).first()

        if not dispatch:
            # If the driver's most recent dispatch was just cancelled (patient
            # cancelled / marked safe / driver report), surface that so the UI
            # can show a "cancelled" screen — and so a mid-trip refresh doesn't
            # leave the driver stuck on a stale active dispatch.
            from django.utils import timezone as dj_tz
            from datetime import timedelta

            recent = AmbulanceDispatch.objects.select_related('emergency_id').filter(
                ambulance_id__driver_id=driver, dispatch_status='cancelled',
            ).order_by('-dispatched_at').first()
            em = recent.emergency_id if recent else None
            if em and em.status == 'cancelled' and em.updated_at >= dj_tz.now() - timedelta(minutes=3):
                return Response({
                    'success': True,
                    'cancelled': True,
                    'patient_safe': em.patient_safe,
                    'message': em.cancellation_reason or 'Emergency cancelled by patient',
                    'data': None,
                })
            # Explicit null so the frontend `dispatch ? …` check is falsy.
            return Response(
                {'success': True, 'message': 'No active dispatch.', 'data': None, 'cancelled': False}
            )

        emergency = dispatch.emergency_id
        patient = emergency.patient_id
        hospital = emergency.assigned_hospital_id
        bed = emergency.assigned_bed_id

        # Distance + accept window, so a poll-driven popup (the backstop for a
        # missed emergency_dispatch WS push) carries the same info the live event
        # would have. Ambulance position is its live GPS, else its hospital's.
        from .utils import calculate_distance
        amb = dispatch.ambulance_id
        amb_lat = amb.current_lat if amb.current_lat is not None else (
            amb.hospital_id.latitude if amb.hospital_id else None
        )
        amb_lng = amb.current_lng if amb.current_lng is not None else (
            amb.hospital_id.longitude if amb.hospital_id else None
        )
        distance_km = None
        if emergency.patient_lat is not None and amb_lat is not None:
            d_km = calculate_distance(
                emergency.patient_lat, emergency.patient_lng, amb_lat, amb_lng,
            )
            distance_km = round(d_km, 2) if d_km != float('inf') else None

        return ok('Active dispatch retrieved.', {
            'id': str(dispatch.dispatch_id),
            'dispatch_id': str(dispatch.dispatch_id),
            'emergency_id': str(emergency.emergency_id),
            'patient_name': patient.full_name,
            'patient_phone': patient.emergency_contact,
            'patient_lat': float(emergency.patient_lat) if emergency.patient_lat is not None else None,
            'patient_lng': float(emergency.patient_lng) if emergency.patient_lng is not None else None,
            'severity': emergency.severity.upper(),
            'status': dispatch.dispatch_status,
            'distance_km': distance_km,
            'timeout_seconds': get_timeout_seconds(emergency.severity),
            'eta_minutes': dispatch.eta_minutes,
            'hospital_name': hospital.hospital_name if hospital else None,
            'assigned_hospital': {
                'name': hospital.hospital_name,
                'address': hospital.address or '',
                'lat': str(hospital.latitude or ''),
                'lon': str(hospital.longitude or ''),
            } if hospital else None,
            'bed_info': (
                f'Bed reserved at {hospital.hospital_name}'
                if bed and hospital else 'No bed reserved'
            ),
            'rerouted': dispatch.rerouted,
            'reroute_count': dispatch.reroute_count,
            'dispatch_status': dispatch.dispatch_status,
            'emergency_status': emergency.status,
            'bed_ready': dispatch.bed_ready,
            'bed_ready_at': dispatch.bed_ready_at.isoformat() if dispatch.bed_ready_at else None,
            'bed_ward': (bed.ward_name or '') if bed else '',
            'bed_type': (bed.bed_type or '') if bed else '',
        })


class AcceptDispatchView(APIView):
    """Driver accepts an assigned dispatch from the emergency alert popup.

    Transitions the dispatch `dispatched` → `en_route` and notifies the patient.
    Falls back to the driver's latest active dispatch if the given id is stale.
    """
    permission_classes = [IsAuthenticated, IsDriver]

    def post(self, request, dispatch_id):
        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        from django.db import transaction

        related = (
            'emergency_id',
            'emergency_id__patient_id',
            'emergency_id__patient_id__login_id',
            'emergency_id__assigned_hospital_id',
            'ambulance_id',
        )

        # Resolve which dispatch this accept refers to (fall back to the driver's
        # latest live dispatch if the id is stale), then lock + validate + claim
        # it atomically so two drivers can't both win the same emergency.
        with transaction.atomic():
            locked = AmbulanceDispatch.objects.select_for_update().filter(
                dispatch_id=dispatch_id, ambulance_id__driver_id=driver,
            ).first()
            if not locked:
                locked = AmbulanceDispatch.objects.select_for_update().filter(
                    ambulance_id__driver_id=driver,
                    dispatch_status__in=['dispatched', 'en_route', 'arrived'],
                ).order_by('-dispatched_at').first()
            if not locked:
                return err('No active dispatch found.', status_code=404)

            # Stale-acceptance guard: a dispatch that was reassigned (rejected),
            # cancelled, or completed can NOT be accepted. Only a still-pending
            # 'dispatched' one (or one this same driver already moved past, for
            # idempotent re-taps) is acceptable.
            if locked.dispatch_status not in ('dispatched', 'en_route', 'arrived'):
                return err(
                    'This emergency has already been handled by another driver.',
                    status_code=409,
                )

            first_accept = locked.dispatch_status == 'dispatched'
            if first_accept:
                locked.dispatch_status = 'en_route'
                if not locked.accepted_at:
                    locked.accepted_at = datetime.now(tz=timezone.utc)
                locked.save(update_fields=['dispatch_status', 'accepted_at'])

                # Driver accepted → kill this dispatch's auto-reassign timer so it
                # can never fire and offer the emergency to the next driver.
                cancel_dispatch_timer(locked.dispatch_id, 'driver accepted')

                # Claim the emergency: cancel every OTHER live dispatch for it and
                # tell those drivers to drop their popup. (Normally none exist —
                # this closes the reassign-window race where a stale dispatch is
                # still showing on another driver's screen.)
                others = AmbulanceDispatch.objects.select_for_update().select_related(
                    'ambulance_id', 'ambulance_id__driver_id',
                    'ambulance_id__driver_id__login_id',
                ).filter(
                    emergency_id=locked.emergency_id,
                    dispatch_status__in=['dispatched', 'pending_acknowledgment'],
                ).exclude(dispatch_id=locked.dispatch_id)
                cancelled_count = 0
                for other in others:
                    other.dispatch_status = 'cancelled'
                    other.save(update_fields=['dispatch_status'])
                    free_ambulance(other)
                    cancel_dispatch_timer(other.dispatch_id, 'superseded by accept')
                    push_dispatch_cancelled(other)
                    cancelled_count += 1
                if cancelled_count:
                    print(f'[ACCEPT] Cancelled {cancelled_count} other dispatch(es) '
                          f'for emergency {locked.emergency_id_id}')

        # Reload with related rows for the response/notifications.
        dispatch = AmbulanceDispatch.objects.select_related(*related).get(
            dispatch_id=locked.dispatch_id,
        )
        emergency = dispatch.emergency_id
        patient = emergency.patient_id
        ambulance = dispatch.ambulance_id

        # Lock the ambulance for the duration of the active trip so it
        # cannot be dispatched to a second emergency.
        ambulance.is_available = False
        ambulance.save(update_fields=['is_available'])
        driver.is_available = False
        driver.save(update_fields=['is_available'])
        print(f"Ambulance {ambulance.vehicle_no} set UNAVAILABLE")

        send_notification(
            login_id=patient.login_id,
            title='Ambulance Accepted',
            message=(
                f'Driver {driver.full_name} accepted your emergency. '
                f'Ambulance {ambulance.vehicle_no} is on the way!'
            ),
            notif_type='emergency',
            related_id=str(emergency.emergency_id),
        )

        # Best-effort live push to the patient's emergency channel.
        ws_broadcast(
            f'emergency_{patient.login_id.login_id}',
            'emergency_status_update',
            {
                'status': 'en_route',
                'message': f'Ambulance is on the way! Driver: {driver.full_name}',
                'accepted_at': dispatch.accepted_at.isoformat() if dispatch.accepted_at else None,
                'eta_minutes': dispatch.eta_minutes,
                'driver_name': driver.full_name,
            },
        )

        log_audit(
            login_id=request.user,
            action='Driver accepted dispatch',
            module='emergency',
            entity_type='AmbulanceDispatch',
            entity_id=str(dispatch.dispatch_id),
        )
        return ok('Dispatch accepted.', DispatchSerializer(dispatch).data)


class RejectDispatchView(APIView):
    """Driver declines a pending dispatch — frees this ambulance and reassigns
    the emergency to the next-nearest ambulance."""
    permission_classes = [IsAuthenticated, IsDriver]

    def post(self, request, dispatch_id):
        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        try:
            dispatch = AmbulanceDispatch.objects.select_related(
                'emergency_id', 'emergency_id__patient_id',
                'emergency_id__patient_id__login_id',
                'ambulance_id', 'ambulance_id__driver_id',
            ).get(dispatch_id=dispatch_id, ambulance_id__driver_id=driver)
        except AmbulanceDispatch.DoesNotExist:
            return err('Dispatch not found.', status_code=404)

        if dispatch.dispatch_status != 'dispatched':
            return err('This dispatch can no longer be rejected.', status_code=400)

        dispatch.dispatch_status = 'rejected'
        dispatch.save(update_fields=['dispatch_status'])

        # Driver rejected this one → cancel its timer (reassignment below starts
        # a fresh timer for the next driver).
        cancel_dispatch_timer(dispatch.dispatch_id, 'driver rejected')

        # Free this ambulance + driver so they remain eligible for others.
        free_ambulance(dispatch)

        emergency = dispatch.emergency_id

        # If the patient already cancelled, or another driver already accepted
        # this emergency, a reject here must NOT trigger a reroute.
        if not should_reroute(emergency, dispatch):
            return ok('Dispatch rejected. Emergency no longer reroutable — no reassignment.')

        send_notification(
            emergency.patient_id.login_id,
            '🔄 Reassigning Ambulance…',
            'The nearest driver was unavailable. Finding the next closest ambulance.',
            notif_type='emergency', related_id=str(emergency.emergency_id),
        )

        next_dispatch = assign_next_ambulance(emergency)

        log_audit(
            login_id=request.user, action='Driver rejected dispatch',
            module='emergency', entity_type='AmbulanceDispatch',
            entity_id=str(dispatch_id),
        )
        if next_dispatch:
            return ok('Dispatch rejected. Next nearest ambulance notified.')
        return ok('Dispatch rejected. No more ambulances available.')


class UpdateDispatchStatusView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    def put(self, request, dispatch_id):
        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        try:
            dispatch = AmbulanceDispatch.objects.select_related(
                'emergency_id',
                'emergency_id__patient_id',
                'emergency_id__assigned_hospital_id',
                'emergency_id__assigned_hospital_id__login_id',
                'emergency_id__assigned_bed_id',
                'ambulance_id',
                'ambulance_id__driver_id',
            ).get(
                dispatch_id=dispatch_id,
                ambulance_id__driver_id=driver,
            )
        except AmbulanceDispatch.DoesNotExist:
            return err('Dispatch not found.', status_code=404)

        # The frontend sends `status`; accept it or the canonical `dispatch_status`.
        ser = UpdateDispatchStatusSerializer(data={
            'dispatch_status': request.data.get(
                'dispatch_status', request.data.get('status')
            ),
        })
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        new_status = ser.validated_data['dispatch_status']
        now = datetime.now(tz=timezone.utc)
        ambulance = dispatch.ambulance_id
        emergency = dispatch.emergency_id

        # Bug-1: real-time bed status at the destination hospital, recomputed at
        # the moment the driver arrives. Surfaced to the driver UI so they know
        # whether to wait / contact the hospital if the last bed was taken.
        beds_available = None
        bed_warning = False

        if new_status == 'arrived':
            dispatch.dispatch_status = new_status
            dispatch.arrived_at = now

            hospital = emergency.assigned_hospital_id
            beds_available = count_available_beds(hospital)
            # Only a problem if this patient does NOT already hold a reserved bed
            # AND nothing else is free — then the hospital genuinely can't take
            # them right now.
            has_reserved_bed = emergency.assigned_bed_id is not None
            bed_warning = (not has_reserved_bed) and beds_available == 0

            if bed_warning and hospital and hospital.login_id:
                # Re-alert the hospital that an ambulance is on its doorstep with
                # no bed to receive the patient.
                try:
                    send_notification(
                        hospital.login_id,
                        '🚨 Ambulance ARRIVED — No Beds!',
                        f'Ambulance {ambulance.vehicle_no} has arrived with '
                        f'{emergency.patient_id.full_name} but NO beds are available. '
                        f'Please make arrangements immediately.',
                        notif_type='emergency',
                        related_id=str(emergency.emergency_id),
                    )
                except Exception as exc:  # noqa: BLE001
                    print(f'[BED ALERT] Arrival no-bed alert error: {exc}')
        elif new_status == 'completed':
            # Strict trip order: a trip can only be completed once the driver has
            # marked arrival at the destination — never straight from en_route.
            # Guards against a direct API call (or a stale UI) skipping the step.
            if dispatch.dispatch_status != 'arrived':
                return err('Please mark the ambulance as arrived first.', status_code=400)
            # Driver finished the trip, but the ambulance stays UNAVAILABLE
            # until the receiving hospital acknowledges the patient arrival.
            dispatch.dispatch_status = 'pending_acknowledgment'
            dispatch.completed_at = now
            print(f"Dispatch {dispatch.dispatch_id} -> pending_acknowledgment "
                  f"(ambulance {ambulance.vehicle_no} stays UNAVAILABLE)")

            hospital = emergency.assigned_hospital_id
            if hospital and hospital.login_id:
                send_notification(
                    login_id=hospital.login_id,
                    title='🚑 Patient Arriving!',
                    message=(
                        f'Ambulance {ambulance.vehicle_no} delivering '
                        f'{emergency.patient_id.full_name}. '
                        f'Severity: {emergency.severity.upper()}. Please prepare!'
                    ),
                    notif_type='emergency',
                    related_id=str(dispatch.dispatch_id),
                )

            send_notification(
                login_id=emergency.patient_id.login_id,
                title='✅ Almost There!',
                message='Ambulance is arriving at hospital. You will be safe soon!',
                notif_type='emergency',
                related_id=str(emergency.emergency_id),
            )
        else:
            dispatch.dispatch_status = new_status

        dispatch.save()

        status_messages = {
            'en_route': 'Ambulance is on the way to you.',
            'arrived': 'Ambulance has arrived at your location.',
            'completed': 'Ambulance is arriving at hospital. You will be safe soon!',
        }
        send_notification(
            login_id=dispatch.emergency_id.patient_id.login_id,
            title=f'Ambulance {new_status.replace("_", " ").title()}',
            message=status_messages.get(new_status, 'Dispatch status updated.'),
            notif_type='alert',
            related_id=str(dispatch_id),
        )

        log_audit(
            login_id=request.user,
            action=f'Dispatch status updated to {new_status}',
            module='emergency',
            entity_type='AmbulanceDispatch',
            entity_id=str(dispatch_id),
        )
        data = DispatchSerializer(dispatch).data
        if beds_available is not None:
            data['beds_available'] = beds_available
            data['bed_warning'] = bed_warning
        return ok('Dispatch status updated.', data)


class UpdateGPSView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    def put(self, request):
        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        ambulance = get_ambulance(driver)
        if not ambulance:
            return err('No ambulance assigned to this driver.', status_code=404)

        # Accept either {current_lat,current_lng} or the shorter {lat,lng}.
        ser = UpdateGPSSerializer(data={
            'current_lat': request.data.get('current_lat', request.data.get('lat')),
            'current_lng': request.data.get('current_lng', request.data.get('lng')),
        })
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        d = ser.validated_data
        ambulance.current_lat = d['current_lat']
        ambulance.current_lng = d['current_lng']
        ambulance.save(update_fields=['current_lat', 'current_lng', 'updated_at'])

        active_dispatch = AmbulanceDispatch.objects.filter(
            ambulance_id=ambulance,
            dispatch_status__in=['dispatched', 'en_route'],
        ).first()

        if active_dispatch:
            ws_broadcast(
                f'gps_{active_dispatch.dispatch_id}',
                'gps_update',
                {
                    'lat': float(d['current_lat']),
                    'lng': float(d['current_lng']),
                    'eta_minutes': active_dispatch.eta_minutes or 0,
                },
            )

        return ok('GPS location updated.', {
            'current_lat': float(d['current_lat']),
            'current_lng': float(d['current_lng']),
        })


class DispatchHistoryView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    def get(self, request):
        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        dispatches = AmbulanceDispatch.objects.select_related(
            'emergency_id',
            'emergency_id__patient_id',
            'emergency_id__assigned_hospital_id',
            'ambulance_id',
        ).filter(
            ambulance_id__driver_id=driver,
            dispatch_status='completed',
        ).order_by('-completed_at')

        return ok('Dispatch history retrieved.', DispatchSerializer(dispatches, many=True).data)


class DriverTripStatsView(APIView):
    """Aggregated trip statistics for the logged-in driver — powers the Trip
    History page (totals, weekly bar chart, severity mix, recent trips)."""
    permission_classes = [IsAuthenticated, IsDriver]

    def get(self, request):
        from datetime import timedelta, date

        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        ambulance = get_ambulance(driver)
        if not ambulance:
            return ok('No ambulance assigned.', {
                'total_trips': 0,
                'today_trips': 0,
                'weekly_trips': 0,
                'monthly_trips': 0,
                'avg_response_time': 0,
                'total_km': 0,
                'daily_breakdown': [
                    {
                        'date': str(date.today() - timedelta(days=i)),
                        'day': (date.today() - timedelta(days=i)).strftime('%a'),
                        'trips': 0,
                    }
                    for i in range(6, -1, -1)
                ],
                'severity_breakdown': {},
                'recent_trips': [],
                'driver_name': driver.full_name,
                'vehicle_no': '',
                'ambulance_type': '',
            })

        today = date.today()
        week_start = today - timedelta(days=7)
        month_start = today - timedelta(days=30)

        all_dispatches = AmbulanceDispatch.objects.select_related(
            'emergency_id',
            'emergency_id__patient_id',
            'emergency_id__assigned_hospital_id',
            'ambulance_id__hospital_id',
        ).filter(
            ambulance_id=ambulance,
            dispatch_status='completed',
        )

        total_trips = all_dispatches.count()
        today_trips = all_dispatches.filter(dispatched_at__date=today).count()
        weekly_trips = all_dispatches.filter(dispatched_at__date__gte=week_start).count()
        monthly_trips = all_dispatches.filter(dispatched_at__date__gte=month_start).count()

        # Avg response time — dispatched_at → arrived_at (clamped to ≤2 h to
        # skip the obvious outliers / forgotten "arrived" taps).
        response_times = []
        for d in all_dispatches.filter(
            dispatched_at__isnull=False,
            arrived_at__isnull=False,
        )[:50]:
            try:
                diff = (d.arrived_at - d.dispatched_at).total_seconds() / 60
                if 0 < diff < 120:
                    response_times.append(diff)
            except Exception:
                pass
        avg_response_time = round(
            sum(response_times) / len(response_times) if response_times else 0, 1
        )

        # AmbulanceDispatch has no distance_km column — use getattr so this stays
        # safe if the field is added later.
        total_km = round(sum(
            float(getattr(d, 'distance_km', 0) or 0) for d in all_dispatches
        ), 1)

        daily_data = []
        for i in range(6, -1, -1):
            day = today - timedelta(days=i)
            daily_data.append({
                'date': str(day),
                'day': day.strftime('%a'),
                'trips': all_dispatches.filter(dispatched_at__date=day).count(),
            })

        severity_data = {}
        for d in all_dispatches:
            try:
                sev = d.emergency_id.severity or 'unknown'
                severity_data[sev] = severity_data.get(sev, 0) + 1
            except Exception:
                pass

        # Recent trips list INCLUDES cancelled dispatches (completed-only counts
        # above stay as performance metrics). Driver "patient not found" reports
        # are surfaced as their own status for the history filter tabs.
        STATUS_DISPLAY = {
            'completed': '✅ Completed',
            'cancelled': '❌ Cancelled by Patient',
            'patient_not_found': '👤 Patient Not Found',
        }
        history_qs = AmbulanceDispatch.objects.select_related(
            'emergency_id',
            'emergency_id__patient_id',
            'emergency_id__assigned_hospital_id',
            'ambulance_id__hospital_id',
        ).filter(
            ambulance_id=ambulance,
            dispatch_status__in=['completed', 'cancelled'],
        ).order_by('-dispatched_at')[:20]

        recent_trips = []
        for d in history_qs:
            try:
                emergency = d.emergency_id
                hospital = (
                    emergency.assigned_hospital_id.hospital_name
                    if emergency.assigned_hospital_id
                    else ambulance.hospital_id.hospital_name
                )
                disp_status = d.dispatch_status
                if (disp_status == 'cancelled' and emergency
                        and emergency.cancelled_by == 'driver'
                        and emergency.driver_report_type == 'patient_not_found'):
                    disp_status = 'patient_not_found'
                recent_trips.append({
                    'dispatch_id': str(d.dispatch_id),
                    'patient_name': emergency.patient_id.full_name,
                    'severity': emergency.severity,
                    'hospital_name': hospital,
                    'date': d.dispatched_at.strftime('%d %b %Y'),
                    'time': d.dispatched_at.strftime('%I:%M %p'),
                    'distance_km': float(getattr(d, 'distance_km', 0) or 0),
                    'completed_at': str(d.completed_at) if d.completed_at else '',
                    'status': disp_status,
                    'status_display': STATUS_DISPLAY.get(disp_status, disp_status),
                    'cancellation_reason': (emergency.cancellation_reason if emergency else None),
                    'patient_safe': (emergency.patient_safe if emergency else False),
                })
            except Exception as e:
                print(f'Trip data error: {e}')

        return ok('Trip stats retrieved.', {
            'total_trips': total_trips,
            'today_trips': today_trips,
            'weekly_trips': weekly_trips,
            'monthly_trips': monthly_trips,
            'avg_response_time': avg_response_time,
            'total_km': total_km,
            'daily_breakdown': daily_data,
            'severity_breakdown': severity_data,
            'recent_trips': recent_trips,
            'driver_name': driver.full_name,
            'vehicle_no': ambulance.vehicle_no,
            'ambulance_type': ambulance.ambulance_type,
        })


# ─── Hospital Admin Views ─────────────────────────────────────────────────────

class AllEmergencyRequestsView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        from apps.hospital.models import HospitalRegistration
        try:
            hospital = HospitalRegistration.objects.get(login_id=request.user)
        except HospitalRegistration.DoesNotExist:
            return err('Hospital profile not found.', status_code=404)

        qs = EmergencyRequest.objects.select_related(
            'patient_id', 'assigned_hospital_id', 'assigned_bed_id'
        ).filter(assigned_hospital_id=hospital)

        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        return ok('Emergency requests retrieved.', EmergencyRequestSerializer(qs, many=True).data)


class HospitalAmbulancesView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        from apps.hospital.models import HospitalRegistration
        try:
            hospital = HospitalRegistration.objects.get(login_id=request.user)
        except HospitalRegistration.DoesNotExist:
            return err('Hospital profile not found.', status_code=404)

        ambulances = Ambulance.objects.select_related(
            'driver_id', 'hospital_id'
        ).filter(hospital_id=hospital)

        return ok('Ambulances retrieved.', AmbulanceSerializer(ambulances, many=True).data)


class IncomingPatientsView(APIView):
    """Dispatches pending hospital acknowledgment for the admin's hospital."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        from apps.hospital.models import HospitalRegistration
        try:
            hospital = HospitalRegistration.objects.get(login_id=request.user)
        except HospitalRegistration.DoesNotExist:
            return err('Hospital profile not found.', status_code=404)

        active_statuses = ['arrived', 'pending_acknowledgment']
        related = (
            'emergency_id',
            'emergency_id__patient_id',
            'emergency_id__assigned_bed_id',
            'ambulance_id',
            'ambulance_id__driver_id',
        )

        # Show a patient ONLY to the hospital ASSIGNED to receive them (it holds
        # the reserved bed). The ambulance's home hospital must NOT see a patient
        # routed elsewhere.
        incoming = AmbulanceDispatch.objects.select_related(*related).filter(
            emergency_id__assigned_hospital_id=hospital,
            dispatch_status__in=active_statuses,
        ).distinct()

        # Fallback: only when no hospital was assigned (no bed reserved at SOS),
        # let the ambulance's own hospital handle it.
        if not incoming.exists():
            incoming = AmbulanceDispatch.objects.select_related(*related).filter(
                ambulance_id__hospital_id=hospital,
                emergency_id__assigned_hospital_id__isnull=True,
                dispatch_status__in=active_statuses,
            ).distinct()

        data = []
        for dispatch in incoming:
            emergency = dispatch.emergency_id
            ambulance = dispatch.ambulance_id
            driver = ambulance.driver_id
            patient = emergency.patient_id
            bed = emergency.assigned_bed_id
            data.append({
                'dispatch_id': str(dispatch.dispatch_id),
                'emergency_id': str(emergency.emergency_id),
                'patient_name': patient.full_name,
                'patient_phone': getattr(patient, 'emergency_contact', '') or '',
                'blood_group': getattr(patient, 'blood_group', '') or '',
                'patient_age': '',
                'severity': emergency.severity,
                'ambulance_no': ambulance.vehicle_no,
                'vehicle_no': ambulance.vehicle_no,
                'driver_name': driver.full_name if driver else '',
                'driver_phone': driver.phone if driver else '',
                'arrived_at': str(dispatch.arrived_at or dispatch.dispatched_at),
                'dispatched_at': str(dispatch.dispatched_at),
                'eta_minutes': dispatch.eta_minutes,
                'status': dispatch.dispatch_status,
                'reserved_bed': str(bed.bed_id) if bed else None,
                'bed_ward': (bed.ward_name or '') if bed else '',
                'bed_type': (bed.bed_type or '') if bed else '',
                'bed_ready': dispatch.bed_ready,
                'bed_ready_at': str(dispatch.bed_ready_at) if dispatch.bed_ready_at else None,
                'bed_severity_label': get_severity_bed_label(
                    emergency.severity, bed.bed_type if bed else ''
                ),
            })

        return Response({'success': True, 'data': data, 'count': len(data)})


class MarkBedReadyView(APIView):
    """Hospital admin confirms a bed is prepared for an incoming emergency, then
    notifies the driver.

    Validated + logical:
      * If a bed is already reserved for this emergency (the usual flow, where a
        bed is auto-reserved at SOS) → just confirm it ready.
      * If NO bed is reserved yet (e.g. the SOS no-beds fallback), the admin must
        pass `bed_id` for a bed that is actually `available` at their hospital —
        which is then reserved + linked to the emergency.
      * If no `bed_id` and beds are free → ask the admin to pick one.
      * If no `bed_id` and zero beds free → tell them to free one first.
    """
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request, dispatch_id):
        from django.utils import timezone as dj_tz
        from apps.hospital.models import Bed
        from apps.hospital.views import get_hospital, bed_display_label

        try:
            dispatch = AmbulanceDispatch.objects.select_related(
                'emergency_id', 'emergency_id__assigned_hospital_id',
                'emergency_id__assigned_bed_id', 'emergency_id__patient_id',
                'ambulance_id', 'ambulance_id__driver_id',
                'ambulance_id__driver_id__login_id',
            ).get(dispatch_id=dispatch_id)
        except AmbulanceDispatch.DoesNotExist:
            return err('Dispatch not found.', status_code=404)

        emergency = dispatch.emergency_id
        hospital = get_hospital(request)  # the admin's own hospital owns the beds
        bed_id = request.data.get('bed_id')
        existing_bed = emergency.assigned_bed_id
        bed = existing_bed

        # ── Explicit bed selection (covers the no-bed fallback or a re-pick) ──
        if bed_id and (not existing_bed or str(existing_bed.bed_id) != str(bed_id)):
            try:
                chosen = Bed.objects.get(bed_id=bed_id, hospital_id=hospital)
            except Bed.DoesNotExist:
                return err('Bed not found at your hospital.', status_code=404)
            if chosen.status != 'available':
                return Response({
                    'success': False,
                    'message': 'This bed is not available! Please select an available bed.',
                    'available_beds': count_available_beds(hospital),
                }, status=400)
            # Release any previously-reserved bed before switching.
            if existing_bed and str(existing_bed.bed_id) != str(chosen.bed_id):
                release_bed_reservation(existing_bed)
            chosen.status = 'reserved'
            chosen.reserved_for = emergency.patient_id
            chosen.emergency_id = emergency
            chosen.reserved_at = dj_tz.now()
            chosen.emergency_locked_at = dj_tz.now()
            chosen.save(update_fields=[
                'status', 'reserved_for', 'emergency_id', 'reserved_at',
                'emergency_locked_at', 'updated_at',
            ])
            emergency.assigned_bed_id = chosen
            if not emergency.assigned_hospital_id:
                emergency.assigned_hospital_id = hospital
            emergency.save(update_fields=['assigned_bed_id', 'assigned_hospital_id', 'updated_at'])
            bed = chosen

        # ── No bed_id AND none reserved yet → guide the admin ──
        elif not existing_bed:
            available = count_available_beds(hospital)
            if available > 0:
                return Response({
                    'success': False,
                    'message': 'Please select a specific bed to prepare.',
                    'available_beds': available,
                    'requires_bed_selection': True,
                }, status=400)
            return Response({
                'success': False,
                'message': 'No beds available! Please free a bed first from Bed Management.',
                'available_beds': 0,
                'no_beds': True,
            }, status=400)

        hospital_name = (
            emergency.assigned_hospital_id.hospital_name
            if emergency.assigned_hospital_id else hospital.hospital_name
        )

        # Persist the ready state so it survives page navigation/remounts.
        if not dispatch.bed_ready:
            dispatch.bed_ready = True
            dispatch.bed_ready_at = dj_tz.now()
            dispatch.save(update_fields=['bed_ready', 'bed_ready_at'])

        bed_label = bed_display_label(bed) if bed else 'ready'
        driver = dispatch.ambulance_id.driver_id if dispatch.ambulance_id else None
        if driver:
            send_notification(
                driver.login_id, '🛏️ Bed Ready!',
                f'{hospital_name} has prepared {bed_label} for your patient.',
                notif_type='emergency', related_id=str(dispatch.dispatch_id),
            )
            bed_payload = {
                'dispatch_id': str(dispatch.dispatch_id),
                'hospital_name': hospital_name,
                'bed_number': bed_label,
                'ward': (bed.ward_name or '') if bed else '',
                'bed_type': (bed.bed_type or '') if bed else '',
                'message': f'{hospital_name} prepared {bed_label} for the patient.',
            }
            # New richer `bed_ready` event (driver shows a bed banner); keep the
            # older `hospital_ready` event for backward compatibility.
            ws_broadcast(f'emergency_{driver.login_id.login_id}', 'bed_ready', {'data': bed_payload})
            ws_broadcast(f'emergency_{driver.login_id.login_id}', 'hospital_ready', {'data': bed_payload})

        log_audit(
            login_id=request.user, action='Hospital marked bed ready',
            module='emergency', entity_type='AmbulanceDispatch',
            entity_id=str(dispatch_id),
        )
        return ok('Bed prepared. Driver notified.', {
            'bed_number': bed_label,
            'bed_ready': True,
            'bed_ready_at': dispatch.bed_ready_at.isoformat() if dispatch.bed_ready_at else None,
        })


class AcknowledgePatientView(APIView):
    """Hospital admin acknowledges patient arrival — frees the ambulance."""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request, dispatch_id):
        try:
            dispatch = AmbulanceDispatch.objects.select_related(
                'emergency_id',
                'emergency_id__patient_id',
                'emergency_id__patient_id__login_id',
                'emergency_id__assigned_hospital_id',
                'ambulance_id',
                'ambulance_id__driver_id',
                'ambulance_id__driver_id__login_id',
            ).get(dispatch_id=dispatch_id)
        except AmbulanceDispatch.DoesNotExist:
            return err('Dispatch not found.', status_code=404)

        # Only acknowledge once the driver has delivered the patient to the
        # hospital (Complete Trip → pending_acknowledgment). An 'arrived'
        # dispatch is still at the patient's pickup point.
        if dispatch.dispatch_status != 'pending_acknowledgment':
            return err(
                'This patient has not arrived at the hospital yet.',
                status_code=400,
            )

        # Mark fully completed.
        dispatch.dispatch_status = 'completed'
        if not dispatch.completed_at:
            dispatch.completed_at = datetime.now(tz=timezone.utc)
        dispatch.save(update_fields=['dispatch_status', 'completed_at'])

        # Belt-and-suspenders: drop any lingering timer for this trip.
        cancel_dispatch_timer(dispatch.dispatch_id, 'trip complete')

        emergency = dispatch.emergency_id
        emergency.status = 'completed'
        emergency.save(update_fields=['status'])

        # The reserved bed is now occupied by the arrived patient.
        bed = emergency.assigned_bed_id
        if bed:
            bed.status = 'occupied'
            bed.admitted_at = datetime.now(tz=timezone.utc)
            bed.emergency_id = None
            bed.reserved_at = None
            bed.emergency_locked_at = None
            bed.save(update_fields=['status', 'admitted_at', 'emergency_id', 'reserved_at', 'emergency_locked_at', 'updated_at'])
            print(f'[BED] Bed {bed.bed_id} now OCCUPIED (patient admitted).')

        # Free the ambulance and driver.
        ambulance = dispatch.ambulance_id
        free_ambulance(dispatch)

        driver = ambulance.driver_id if ambulance else None
        if driver:
            send_notification(
                login_id=driver.login_id,
                title='✅ Trip Completed!',
                message=(
                    f'Hospital acknowledged patient {emergency.patient_id.full_name}. '
                    f'You are now available for new emergencies.'
                ),
                notif_type='emergency',
                related_id=str(dispatch.dispatch_id),
            )
            ws_broadcast(
                f'emergency_{driver.login_id.login_id}',
                'emergency_status_update',
                {
                    'status': 'completed',
                    'message': 'Hospital acknowledged! Trip completed. You are available again.',
                },
            )

        send_notification(
            login_id=emergency.patient_id.login_id,
            title='🏥 Safely Arrived!',
            message=(
                f'You have been safely delivered to '
                f'{emergency.assigned_hospital_id.hospital_name if emergency.assigned_hospital_id else "hospital"}. '
                f'Get well soon!'
            ),
            notif_type='emergency',
            related_id=str(emergency.emergency_id),
        )

        log_audit(
            login_id=request.user,
            action=f'Acknowledged patient arrival for dispatch {dispatch_id}',
            module='emergency',
            entity_type='AmbulanceDispatch',
            entity_id=str(dispatch_id),
        )

        return Response({
            'success': True,
            'message': 'Patient acknowledged! Ambulance is now available.',
            'data': {
                'dispatch_id': str(dispatch_id),
                'ambulance': ambulance.vehicle_no,
                'patient': emergency.patient_id.full_name,
                'completed_at': str(dispatch.completed_at),
            },
        })


# ─── SOS Safety: Cancel / I'm Safe / Driver Report ────────────────────────────

def _cancel_active_dispatches(emergency, message):
    """End an emergency's in-flight dispatches: mark them cancelled, free each
    ambulance + driver, release the reserved bed, and push a cancel event to
    every assigned driver (notification + WebSocket)."""
    release_bed_reservation(emergency.assigned_bed_id)

    # Kill every pending auto-reassign timer for this emergency first, so none
    # can fire mid-teardown and dispatch a fresh driver to a cancelled SOS.
    cancel_emergency_timers(emergency, 'emergency cancelled')

    dispatches = AmbulanceDispatch.objects.select_related(
        'ambulance_id', 'ambulance_id__driver_id', 'ambulance_id__driver_id__login_id',
    ).filter(
        emergency_id=emergency,
        dispatch_status__in=['dispatched', 'en_route', 'arrived', 'pending_acknowledgment'],
    )
    for dispatch in dispatches:
        dispatch.dispatch_status = 'cancelled'
        dispatch.save(update_fields=['dispatch_status'])
        free_ambulance(dispatch)

        driver = dispatch.ambulance_id.driver_id if dispatch.ambulance_id else None
        if driver and driver.login_id:
            send_notification(
                driver.login_id, '✅ Emergency Cancelled', message,
                notif_type='emergency', related_id=str(emergency.emergency_id),
            )
            ws_broadcast(
                f'emergency_{driver.login_id.login_id}', 'emergency_cancelled',
                {'data': {
                    'emergency_id': str(emergency.emergency_id),
                    'message': message,
                    'patient_safe': True,
                }},
            )


def check_false_alarms(patient, increment=False):
    """Count a patient's cancelled SOS alerts in the last 30 days. Warn (email +
    notification) at 3, suspend the account at 5. `increment` adds one for a
    driver-confirmed fake/not-found report that isn't itself a patient cancel."""
    from datetime import timedelta
    from django.utils import timezone as dj_tz

    month_ago = dj_tz.now() - timedelta(days=30)
    false_alarms = EmergencyRequest.objects.filter(
        patient_id=patient,
        status='cancelled',
        cancelled_by='patient',
        created_at__gte=month_ago,
    ).count()
    if increment:
        false_alarms += 1

    if false_alarms == 3:
        try:
            send_notification(
                patient.login_id, '⚠️ Emergency SOS Warning',
                f'You have triggered {false_alarms} false emergencies this month. '
                'Repeated false alarms may result in account suspension.',
                notif_type='emergency',
            )
            from email_utils import send_email
            send_email(
                to_email=patient.login_id.email,
                subject='FederCare — Emergency SOS Warning',
                html_content=f"""
                <div style="font-family:Arial;max-width:600px;margin:0 auto;">
                    <div style="background:#F97316;padding:24px;text-align:center;border-radius:12px 12px 0 0;">
                        <h1 style="color:white;margin:0;font-size:20px;">⚠️ Emergency SOS Warning</h1>
                    </div>
                    <div style="background:#FAF7F2;padding:28px;border-radius:0 0 12px 12px;">
                        <p style="color:#333;font-size:15px;">Dear <b>{patient.full_name}</b>,</p>
                        <div style="background:white;border-radius:12px;padding:16px;border-left:4px solid #F97316;margin:0 0 16px;">
                            <p style="color:#666;font-size:14px;line-height:1.6;margin:0;">
                                You have triggered <b style="color:#F97316;">{false_alarms} false emergency alerts</b>
                                this month. Emergency services are reserved for real emergencies.
                                <br><br>
                                Continued false alarms may result in your account being <b>suspended</b>.
                            </p>
                        </div>
                        <p style="color:#9CA3AF;font-size:12px;text-align:center;">FederCare Health Network</p>
                    </div>
                </div>
                """,
            )
        except Exception as exc:  # noqa: BLE001
            print(f'[WARN] false-alarm warn error: {exc}')

    if false_alarms >= 5:
        try:
            login = patient.login_id
            login.is_active = False
            login.save(update_fields=['is_active', 'updated_at'])
            send_notification(
                login, '🚫 Account Suspended',
                'Your account has been suspended due to repeated false emergency alerts. '
                'Please contact support if you believe this is an error.',
                notif_type='emergency',
            )
        except Exception as exc:  # noqa: BLE001
            print(f'[SUSPEND] false-alarm suspend error: {exc}')


class CancelSOSView(APIView):
    """Patient cancels their own emergency (with a reason). Frees the ambulance,
    releases the reserved bed, notifies the driver, and runs the false-alarm
    check so abuse is tracked."""
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request, emergency_id):
        reason = (request.data.get('reason') or 'Patient cancelled').strip()
        try:
            emergency = EmergencyRequest.objects.select_related(
                'patient_id', 'patient_id__login_id', 'assigned_bed_id',
            ).get(emergency_id=emergency_id, patient_id__login_id=request.user)
        except EmergencyRequest.DoesNotExist:
            return err('Emergency not found!', status_code=404)

        if emergency.status in ('completed', 'cancelled'):
            return err('Cannot cancel this emergency!', status_code=400)

        emergency.status = 'cancelled'
        emergency.cancelled_by = 'patient'
        emergency.cancellation_reason = reason[:200]
        emergency.patient_safe = True
        emergency.save(update_fields=[
            'status', 'cancelled_by', 'cancellation_reason', 'patient_safe', 'updated_at',
        ])

        _cancel_active_dispatches(
            emergency, f'Emergency cancelled by patient. Reason: {reason}',
        )
        check_false_alarms(emergency.patient_id)

        log_audit(
            login_id=request.user, action='Patient cancelled emergency',
            module='emergency', entity_type='EmergencyRequest',
            entity_id=str(emergency.emergency_id),
        )
        return ok('Emergency cancelled. Stay safe!')


class ImSafeView(APIView):
    """Patient marks themselves safe during an active emergency (e.g. they got
    another vehicle). Same teardown as cancel, with a reassuring driver message."""
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request, emergency_id):
        try:
            emergency = EmergencyRequest.objects.select_related(
                'patient_id', 'patient_id__login_id', 'assigned_bed_id',
            ).get(emergency_id=emergency_id, patient_id__login_id=request.user)
        except EmergencyRequest.DoesNotExist:
            return err('Emergency not found!', status_code=404)

        if emergency.status in ('completed', 'cancelled'):
            return err('Cannot cancel this emergency!', status_code=400)

        emergency.status = 'cancelled'
        emergency.cancelled_by = 'patient'
        emergency.cancellation_reason = 'Patient is safe - got another vehicle'
        emergency.patient_safe = True
        emergency.save(update_fields=[
            'status', 'cancelled_by', 'cancellation_reason', 'patient_safe', 'updated_at',
        ])

        _cancel_active_dispatches(
            emergency, '✅ Patient is safe! They got another vehicle. You can return.',
        )
        check_false_alarms(emergency.patient_id)

        log_audit(
            login_id=request.user, action='Patient marked safe (emergency cancelled)',
            module='emergency', entity_type='EmergencyRequest',
            entity_id=str(emergency.emergency_id),
        )
        return ok('Glad you are safe! Emergency cancelled.')


class DriverReportView(APIView):
    """Assigned driver reports an incident at the scene (patient not found /
    already left / fake / wrong location). Closes the emergency, frees the
    ambulance, alerts super admins, and penalises fake/not-found via the
    false-alarm counter."""
    permission_classes = [IsAuthenticated, IsDriver]

    def post(self, request, emergency_id):
        report_type = request.data.get('report_type')
        description = (request.data.get('description') or '').strip()
        valid_types = [c[0] for c in EmergencyRequest._meta.get_field('driver_report_type').choices]
        if report_type not in valid_types:
            return err('Invalid report type!', status_code=400)

        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        try:
            emergency = EmergencyRequest.objects.select_related(
                'patient_id', 'patient_id__login_id', 'assigned_bed_id',
            ).get(emergency_id=emergency_id)
        except EmergencyRequest.DoesNotExist:
            return err('Emergency not found!', status_code=404)

        # Only a driver actually assigned to this emergency may report on it.
        if not AmbulanceDispatch.objects.filter(
            emergency_id=emergency, ambulance_id__driver_id=driver,
        ).exists():
            return err('You are not assigned to this emergency.', status_code=403)

        emergency.driver_report = description
        emergency.driver_report_type = report_type
        emergency.status = 'cancelled'
        emergency.cancelled_by = 'driver'
        emergency.cancellation_reason = report_type
        emergency.save(update_fields=[
            'driver_report', 'driver_report_type', 'status',
            'cancelled_by', 'cancellation_reason', 'updated_at',
        ])

        _cancel_active_dispatches(
            emergency, f'Emergency closed — driver report: {report_type.replace("_", " ")}.',
        )

        # Fake / patient-not-found counts against the patient's SOS abuse score.
        if report_type in ('fake_emergency', 'patient_not_found'):
            check_false_alarms(emergency.patient_id, increment=True)

        # Notify super admins of the incident.
        try:
            from apps.auth_app.models import LoginCredentials
            for admin in LoginCredentials.objects.filter(role='super_admin', is_active=True):
                send_notification(
                    admin, '⚠️ Emergency Incident Report',
                    f'Driver reported "{report_type.replace("_", " ")}" for emergency '
                    f'#{str(emergency.emergency_id)[:8]}.',
                    notif_type='emergency', related_id=str(emergency.emergency_id),
                )
        except Exception as exc:  # noqa: BLE001
            print(f'[REPORT] admin notify error: {exc}')

        try:
            send_notification(
                emergency.patient_id.login_id, '🚑 Emergency Closed',
                'The responding driver reported they could not complete this emergency. '
                'If this was a mistake, please trigger SOS again or call 108.',
                notif_type='emergency', related_id=str(emergency.emergency_id),
            )
        except Exception:  # noqa: BLE001
            pass

        log_audit(
            login_id=request.user, action=f'Driver report: {report_type}',
            module='emergency', entity_type='EmergencyRequest',
            entity_id=str(emergency.emergency_id),
        )
        return ok('Report submitted successfully!')
