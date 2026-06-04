"""Emergency module helpers — distance maths and nearest-ambulance lookup."""
import math

# Dispatch statuses that mean an ambulance is mid-trip and must NOT be picked
# for a new emergency — even if its is_available flag is stale. Includes
# pending_acknowledgment (trip done, hospital hasn't confirmed handover yet).
ACTIVE_DISPATCH_STATUSES = [
    'dispatched', 'en_route', 'arrived', 'pending_acknowledgment',
]


def calculate_distance(lat1, lng1, lat2, lng2):
    """Great-circle distance between two GPS points, in kilometres (Haversine).

    Returns float('inf') when any coordinate is missing or invalid so callers
    can safely use it in a `min()` comparison.
    """
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return float('inf')
    try:
        lat1, lng1, lat2, lng2 = (
            float(lat1), float(lng1), float(lat2), float(lng2),
        )
        radius_km = 6371
        dlat = math.radians(lat2 - lat1)
        dlng = math.radians(lng2 - lng1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlng / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return radius_km * c
    except (TypeError, ValueError) as exc:
        print(f'Distance calc error: {exc}')
        return float('inf')


def find_nearest_ambulance(patient_lat, patient_lng, exclude_ids=None):
    """Return (ambulance, distance_km) for the closest available ambulance.

    An ambulance's position is its live GPS if known, otherwise its hospital's
    GPS. `exclude_ids` skips ambulances already tried (e.g. rejected/timed out).
    Returns (None, None) when no available ambulance can be located.
    """
    from apps.emergency.models import Ambulance, AmbulanceDispatch

    # An ambulance is eligible only if it's marked available AND has no active
    # dispatch in flight. Checking active dispatches (not just the is_available
    # flag) makes assignment robust against stale flags and stops a busy
    # ambulance — including one in pending_acknowledgment — being double-booked.
    busy_ids = AmbulanceDispatch.objects.filter(
        dispatch_status__in=ACTIVE_DISPATCH_STATUSES,
    ).values_list('ambulance_id', flat=True)

    ambulances = Ambulance.objects.filter(is_available=True).exclude(
        ambulance_id__in=list(busy_ids),
    ).select_related('hospital_id', 'driver_id', 'driver_id__login_id')
    if exclude_ids:
        ambulances = ambulances.exclude(ambulance_id__in=exclude_ids)

    nearest = None
    min_distance = float('inf')

    for amb in ambulances:
        amb_lat = amb.current_lat if amb.current_lat is not None else (
            amb.hospital_id.latitude if amb.hospital_id else None
        )
        amb_lng = amb.current_lng if amb.current_lng is not None else (
            amb.hospital_id.longitude if amb.hospital_id else None
        )
        distance = calculate_distance(patient_lat, patient_lng, amb_lat, amb_lng)
        print(f'Ambulance {amb.vehicle_no}: {distance:.2f} km')
        if distance < min_distance:
            min_distance = distance
            nearest = amb

    if nearest is None:
        print('No available ambulance found!')
        return None, None

    print(f'Nearest ambulance: {nearest.vehicle_no} at {min_distance:.2f} km')
    return nearest, min_distance
