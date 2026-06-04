import uuid
from django.db import models
from apps.auth_app.models import LoginCredentials
from apps.hospital.models import HospitalRegistration, Bed
from apps.patient.models import PatientRegistration

APPROVAL_STATUS = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]

AMBULANCE_TYPES = [
    ('basic', 'Basic'),
    ('advanced', 'Advanced'),
    ('neonatal', 'Neonatal'),
]

SEVERITY = [
    ('critical', 'Critical'),
    ('high', 'High'),
    ('moderate', 'Moderate'),
    ('low', 'Low'),
]

EMERGENCY_STATUS = [
    ('pending', 'Pending'),
    ('dispatched', 'Dispatched'),
    ('no_drivers', 'No Drivers Available'),
    ('completed', 'Completed'),
]

DISPATCH_STATUS = [
    ('dispatched', 'Dispatched'),
    ('en_route', 'En Route'),
    ('arrived', 'Arrived'),
    ('pending_acknowledgment', 'Pending Acknowledgment'),
    ('completed', 'Completed'),
    ('rejected', 'Rejected'),
]


class AmbulanceDriverRegistration(models.Model):
    driver_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.OneToOneField(LoginCredentials, on_delete=models.CASCADE, related_name='driver_profile')
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='drivers')
    full_name = models.CharField(max_length=120)
    license_no = models.CharField(max_length=50, unique=True)
    phone = models.CharField(max_length=15)
    is_available = models.BooleanField(default=True)
    approval_status = models.CharField(max_length=10, choices=APPROVAL_STATUS, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.full_name} — {self.hospital_id.hospital_name}"

    class Meta:
        db_table = 'ambulance_driver_registrations'


class Ambulance(models.Model):
    ambulance_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='ambulances')
    driver_id = models.ForeignKey(
        AmbulanceDriverRegistration, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='ambulance'
    )
    vehicle_no = models.CharField(max_length=20, unique=True)
    ambulance_type = models.CharField(max_length=10, choices=AMBULANCE_TYPES, default='basic')
    equipment_list = models.JSONField(default=list)
    is_available = models.BooleanField(default=True)
    current_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    current_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.vehicle_no} ({self.ambulance_type}) — {self.hospital_id.hospital_name}"

    class Meta:
        db_table = 'ambulances'


class EmergencyRequest(models.Model):
    emergency_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='emergency_requests')
    triage_id = models.ForeignKey(
        'ai_engine.TriageSession', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='emergency_requests'
    )
    patient_lat = models.DecimalField(max_digits=9, decimal_places=6)
    patient_lng = models.DecimalField(max_digits=9, decimal_places=6)
    severity = models.CharField(max_length=10, choices=SEVERITY)
    status = models.CharField(max_length=15, choices=EMERGENCY_STATUS, default='pending')
    assigned_hospital_id = models.ForeignKey(
        HospitalRegistration, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='emergency_requests'
    )
    assigned_bed_id = models.ForeignKey(
        Bed, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='emergency_requests'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Emergency {self.emergency_id} — {self.patient_id.full_name} [{self.severity}]"

    class Meta:
        db_table = 'emergency_requests'
        ordering = ['-created_at']


class AmbulanceDispatch(models.Model):
    dispatch_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    emergency_id = models.ForeignKey(EmergencyRequest, on_delete=models.CASCADE, related_name='dispatches')
    ambulance_id = models.ForeignKey(Ambulance, on_delete=models.CASCADE, related_name='dispatches')
    dispatch_status = models.CharField(max_length=25, choices=DISPATCH_STATUS, default='dispatched')
    eta_minutes = models.IntegerField(null=True, blank=True)
    route_data = models.JSONField(default=list)
    dispatched_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # Set when the bed monitor re-routes a dispatch to another hospital because
    # its reserved bed was taken mid-trip. (Destination itself lives on the
    # EmergencyRequest: assigned_hospital_id / assigned_bed_id.)
    rerouted = models.BooleanField(default=False)
    reroute_count = models.IntegerField(default=0)
    # Set when the receiving hospital signals the reserved bed is prepared, so
    # the "Mark Bed Ready" state persists across page navigation/remounts.
    bed_ready = models.BooleanField(default=False)
    bed_ready_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Dispatch {self.dispatch_id} — {self.ambulance_id.vehicle_no} [{self.dispatch_status}]"

    class Meta:
        db_table = 'ambulance_dispatch'
        ordering = ['-dispatched_at']
