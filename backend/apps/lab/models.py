import uuid
from datetime import time
from django.db import models
from apps.auth_app.models import LoginCredentials
from apps.hospital.models import HospitalRegistration
from apps.patient.models import PatientRegistration
from apps.doctor.models import DoctorRegistration

APPROVAL_STATUS = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]

PRIORITY = [
    ('normal', 'Normal'),
    ('urgent', 'Urgent'),
    ('stat', 'STAT'),
]

ORDER_STATUS = [
    ('pending', 'Pending'),
    ('processing', 'Processing'),
    ('completed', 'Completed'),
]

PAYMENT_STATUS = [
    ('pending', 'Pending'),
    ('paid', 'Paid'),
    ('failed', 'Failed'),
]


class LabTechRegistration(models.Model):
    lab_tech_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.OneToOneField(LoginCredentials, on_delete=models.CASCADE, related_name='lab_tech_profile')
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='lab_technicians')
    full_name = models.CharField(max_length=120)
    qualification = models.CharField(max_length=150, blank=True)
    specialization = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=15, blank=True)
    approval_status = models.CharField(max_length=10, choices=APPROVAL_STATUS, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.full_name} — {self.hospital_id.hospital_name}"

    class Meta:
        db_table = 'lab_tech_registrations'


class LabOrder(models.Model):
    order_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    doctor_id = models.ForeignKey(DoctorRegistration, on_delete=models.CASCADE, related_name='lab_orders')
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='lab_orders')
    lab_tech_id = models.ForeignKey(
        LabTechRegistration, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='assigned_orders'
    )
    tests_ordered = models.JSONField(default=list)
    priority = models.CharField(max_length=10, choices=PRIORITY, default='normal')
    status = models.CharField(max_length=15, choices=ORDER_STATUS, default='pending')
    notes = models.TextField(blank=True)
    razorpay_order_id = models.CharField(max_length=100, blank=True)
    razorpay_payment_id = models.CharField(max_length=100, blank=True)
    razorpay_signature = models.CharField(max_length=200, blank=True)
    payment_status = models.CharField(max_length=10, choices=PAYMENT_STATUS, default='pending')
    ordered_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"LabOrder {self.order_id} — {self.patient_id.full_name} [{self.priority}]"

    class Meta:
        db_table = 'lab_orders'
        ordering = ['-ordered_at']


class LabReport(models.Model):
    report_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_id = models.ForeignKey(LabOrder, on_delete=models.CASCADE, related_name='reports')
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='lab_reports')
    results = models.JSONField(default=dict)
    report_file_url = models.CharField(max_length=500, blank=True)
    abnormal_flags = models.JSONField(default=list)
    ai_analysis = models.TextField(blank=True)
    saved_to_ehr = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Report {self.report_id} — {self.patient_id.full_name}"

    class Meta:
        db_table = 'lab_reports'
        ordering = ['-uploaded_at']


# ─── Lab slot booking system (Option B+) ────────────────────────────────────

class HospitalLabConfig(models.Model):
    """Per-hospital lab availability config used to auto-generate LabSlots."""
    config_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital_id = models.OneToOneField(
        HospitalRegistration, on_delete=models.CASCADE, related_name='lab_config'
    )
    working_days = models.JSONField(default=list, help_text='List of days: [0=Mon,1=Tue...]')
    start_time = models.TimeField(default=time(8, 0))
    end_time = models.TimeField(default=time(18, 0))
    slot_duration_minutes = models.IntegerField(default=30)
    max_patients_per_slot = models.IntegerField(default=5)
    lunch_break_start = models.TimeField(null=True, blank=True, default=time(13, 0))
    lunch_break_end = models.TimeField(null=True, blank=True, default=time(14, 0))
    is_active = models.BooleanField(default=True)
    advance_booking_days = models.IntegerField(
        default=30, help_text='How many days ahead to generate'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hospital_lab_configs'

    def __str__(self):
        return f"Lab Config - {self.hospital_id.hospital_name}"


class LabSlot(models.Model):
    slot_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital_id = models.ForeignKey(
        HospitalRegistration, on_delete=models.CASCADE, related_name='lab_slots'
    )
    slot_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    max_patients = models.IntegerField(default=5)
    booked_count = models.IntegerField(default=0)
    is_blocked = models.BooleanField(default=False)
    block_reason = models.CharField(max_length=200, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'lab_slots'
        unique_together = ['hospital_id', 'slot_date', 'start_time']
        ordering = ['slot_date', 'start_time']

    @property
    def is_available(self):
        return not self.is_blocked and self.booked_count < self.max_patients

    @property
    def availability_status(self):
        if self.is_blocked:
            return 'blocked'
        remaining = self.max_patients - self.booked_count
        if remaining <= 0:
            return 'full'
        if remaining <= 2:
            return 'filling_fast'
        return 'available'

    def __str__(self):
        return f"{self.hospital_id.hospital_name} - {self.slot_date} {self.start_time}"


class LabTestSlotRule(models.Model):
    """Per-test timing/fasting rules matched against test names by keyword."""
    TIME_RESTRICTION = [
        ('any', 'Any Time'),
        ('morning', 'Morning Only'),
        ('specific', 'Specific Window'),
    ]
    rule_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    test_name_keyword = models.CharField(max_length=100, help_text='Keyword to match test name')
    time_restriction = models.CharField(max_length=20, choices=TIME_RESTRICTION, default='any')
    allowed_start = models.TimeField(null=True, blank=True, default=time(8, 0))
    allowed_end = models.TimeField(null=True, blank=True, default=time(11, 0))
    requires_fasting = models.BooleanField(default=False)
    fasting_hours = models.IntegerField(default=0)
    preparation_note = models.CharField(max_length=300, null=True, blank=True)

    class Meta:
        db_table = 'lab_test_slot_rules'

    def __str__(self):
        return f"Rule: {self.test_name_keyword}"
