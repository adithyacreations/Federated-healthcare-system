from datetime import date, datetime, timezone

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.auth_app.permissions import IsDriver, IsHospitalAdmin
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
    hospitals = HospitalRegistration.objects.filter(
        approval_status='approved',
    ).exclude(hospital_id__in=exclude_hospital_ids)

    for hospital in hospitals:
        bed_count = Bed.objects.filter(hospital_id=hospital, status='available').count()
        if bed_count == 0:
            continue
        dist = calculate_distance(patient_lat, patient_lng, hospital.latitude, hospital.longitude)
        results.append({'hospital': hospital, 'distance': dist, 'bed_count': bed_count})

    results.sort(key=lambda x: x['distance'])
    return results


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


def assign_next_ambulance(emergency):
    """Reassign an emergency to the next-nearest ambulance, skipping any that
    already rejected/timed-out for this emergency. Returns the new dispatch, or
    None when no ambulance is left (patient is told to call 108)."""
    from .utils import find_nearest_ambulance

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
        try:
            dispatch = AmbulanceDispatch.objects.select_related(
                'emergency_id', 'ambulance_id', 'ambulance_id__driver_id',
            ).get(dispatch_id=dispatch_id)
            print(f'[EMERGENCY] Auto-reject triggered for dispatch {dispatch_id}')
            print(f'[EMERGENCY] Dispatch status: {dispatch.dispatch_status}')
            # Still 'dispatched' means the driver never accepted (accept moves
            # it to 'en_route'). Treat as a no-response and move on.
            if dispatch.dispatch_status != 'dispatched':
                print('[EMERGENCY] Already accepted/handled — no action.')
                return
            dispatch.dispatch_status = 'rejected'
            dispatch.save(update_fields=['dispatch_status'])
            free_ambulance(dispatch)
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


# ─── Driver Views ─────────────────────────────────────────────────────────────

class DriverDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    def get(self, request):
        driver = get_driver(request)
        if not driver:
            return err('Driver profile not found.', status_code=404)

        ambulance = get_ambulance(driver)
        today = date.today()

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
            # Explicit null so the frontend `dispatch ? …` check is falsy.
            return Response(
                {'success': True, 'message': 'No active dispatch.', 'data': None}
            )

        emergency = dispatch.emergency_id
        patient = emergency.patient_id
        hospital = emergency.assigned_hospital_id
        bed = emergency.assigned_bed_id

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

        related = (
            'emergency_id',
            'emergency_id__patient_id',
            'emergency_id__patient_id__login_id',
            'emergency_id__assigned_hospital_id',
            'ambulance_id',
        )
        try:
            dispatch = AmbulanceDispatch.objects.select_related(*related).get(
                dispatch_id=dispatch_id,
                ambulance_id__driver_id=driver,
            )
        except AmbulanceDispatch.DoesNotExist:
            dispatch = AmbulanceDispatch.objects.select_related(*related).filter(
                ambulance_id__driver_id=driver,
                dispatch_status__in=['dispatched', 'en_route', 'arrived'],
            ).first()
            if not dispatch:
                return err('No active dispatch found.', status_code=404)

        # Anchor the patient's ETA countdown to the acceptance moment (set once).
        if dispatch.dispatch_status == 'dispatched':
            dispatch.dispatch_status = 'en_route'
            if not dispatch.accepted_at:
                dispatch.accepted_at = datetime.now(tz=timezone.utc)
            dispatch.save(update_fields=['dispatch_status', 'accepted_at'])

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

        # Free this ambulance + driver so they remain eligible for others.
        free_ambulance(dispatch)

        emergency = dispatch.emergency_id
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

        if new_status == 'arrived':
            dispatch.dispatch_status = new_status
            dispatch.arrived_at = now
        elif new_status == 'completed':
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
        return ok('Dispatch status updated.', DispatchSerializer(dispatch).data)


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

        recent_trips = []
        for d in all_dispatches.order_by('-dispatched_at')[:5]:
            try:
                emergency = d.emergency_id
                hospital = (
                    emergency.assigned_hospital_id.hospital_name
                    if emergency.assigned_hospital_id
                    else ambulance.hospital_id.hospital_name
                )
                recent_trips.append({
                    'dispatch_id': str(d.dispatch_id),
                    'patient_name': emergency.patient_id.full_name,
                    'severity': emergency.severity,
                    'hospital_name': hospital,
                    'date': d.dispatched_at.strftime('%d %b %Y'),
                    'time': d.dispatched_at.strftime('%I:%M %p'),
                    'distance_km': float(getattr(d, 'distance_km', 0) or 0),
                    'completed_at': str(d.completed_at) if d.completed_at else '',
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
    """Hospital admin signals the reserved bed is prepared — notifies the driver
    that the hospital is ready to receive the patient. (Notify-only: it does not
    change the bed reservation, which stays locked until acknowledgment.)"""
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request, dispatch_id):
        try:
            dispatch = AmbulanceDispatch.objects.select_related(
                'emergency_id', 'emergency_id__assigned_hospital_id',
                'ambulance_id', 'ambulance_id__driver_id',
                'ambulance_id__driver_id__login_id',
            ).get(dispatch_id=dispatch_id)
        except AmbulanceDispatch.DoesNotExist:
            return err('Dispatch not found.', status_code=404)

        emergency = dispatch.emergency_id
        hospital_name = (
            emergency.assigned_hospital_id.hospital_name
            if emergency.assigned_hospital_id else 'the hospital'
        )

        # Persist the ready state so it survives page navigation/remounts.
        from django.utils import timezone as dj_tz
        if not dispatch.bed_ready:
            dispatch.bed_ready = True
            dispatch.bed_ready_at = dj_tz.now()
            dispatch.save(update_fields=['bed_ready', 'bed_ready_at'])

        driver = dispatch.ambulance_id.driver_id if dispatch.ambulance_id else None
        if driver:
            send_notification(
                driver.login_id, '🏥 Hospital Ready!',
                f'{hospital_name} is prepared and ready to receive the patient.',
                notif_type='emergency', related_id=str(dispatch.dispatch_id),
            )
            ws_broadcast(
                f'emergency_{driver.login_id.login_id}', 'hospital_ready',
                {'data': {
                    'dispatch_id': str(dispatch.dispatch_id),
                    'hospital_name': hospital_name,
                    'message': f'{hospital_name} is prepared and ready!',
                }},
            )

        log_audit(
            login_id=request.user, action='Hospital marked bed ready',
            module='emergency', entity_type='AmbulanceDispatch',
            entity_id=str(dispatch_id),
        )
        return ok('Hospital marked as ready. Driver notified.')


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
