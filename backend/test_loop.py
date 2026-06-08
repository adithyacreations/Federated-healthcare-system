import django, os
os.environ['DJANGO_SETTINGS_MODULE'] = 'federcare.settings'
django.setup()

from apps.patient.models import PatientRegistration
from apps.emergency.models import EmergencyRequest, Ambulance, AmbulanceDispatch
from apps.emergency.views import assign_next_ambulance
from apps.emergency import utils

# Monkey patch radius to 100 for testing
original_find = utils.find_nearest_ambulance
def patched_find(patient_lat, patient_lng, exclude_ids=None, radius_km=1000):
    return original_find(patient_lat, patient_lng, exclude_ids=exclude_ids, radius_km=radius_km)
utils.find_nearest_ambulance = patched_find

patient = PatientRegistration.objects.first()
amb1 = Ambulance.objects.filter(is_available=True).first()
amb2 = Ambulance.objects.filter(is_available=True).exclude(ambulance_id=amb1.ambulance_id).first()

print(f"Ambulance 1: {amb1.vehicle_no}")
print(f"Ambulance 2: {amb2.vehicle_no}")

e = EmergencyRequest.objects.create(
    patient_id=patient,
    patient_lat=amb1.hospital_id.latitude,
    patient_lng=amb1.hospital_id.longitude,
    severity='critical',
    status='pending',
)

print('\n--- First assignment ---')
d1 = assign_next_ambulance(e)
if d1:
    print(f'Assigned to {d1.ambulance_id.vehicle_no}')
    d1.dispatch_status = 'rejected'
    d1.save()
    d1.ambulance_id.is_available = True
    d1.ambulance_id.save()

print('\n--- Second assignment ---')
d2 = assign_next_ambulance(e)
if d2:
    print(f'Assigned to {d2.ambulance_id.vehicle_no}')
    d2.dispatch_status = 'rejected'
    d2.save()
    d2.ambulance_id.is_available = True
    d2.ambulance_id.save()

print('\n--- Third assignment ---')
d3 = assign_next_ambulance(e)
if d3:
    print(f'Assigned to {d3.ambulance_id.vehicle_no}')
else:
    print('No more drivers! (Expected)')

# Clean up
e.delete()
