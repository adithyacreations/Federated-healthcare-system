import uuid
from django.db import models
from apps.auth_app.models import LoginCredentials

GENDER = [
    ('male', 'Male'),
    ('female', 'Female'),
    ('other', 'Other'),
]

RECORD_TYPES = [
    ('diagnosis', 'Diagnosis'),
    ('lab', 'Lab'),
    ('prescription', 'Prescription'),
    ('history', 'History'),
    ('allergy', 'Allergy'),
]

SEVERITY = [
    ('mild', 'Mild'),
    ('moderate', 'Moderate'),
    ('severe', 'Severe'),
]

ACCESS_TYPES = [
    ('qr_scan', 'QR Scan'),
    ('manual', 'Manual'),
    ('emergency', 'Emergency'),
]

RISK_LEVELS = [
    ('low', 'Low'),
    ('moderate', 'Moderate'),
    ('high', 'High'),
]


class PatientRegistration(models.Model):
    patient_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.OneToOneField(LoginCredentials, on_delete=models.CASCADE, related_name='patient_profile')
    full_name = models.CharField(max_length=120)
    dob = models.DateField()
    gender = models.CharField(max_length=10, choices=GENDER, blank=True)
    blood_group = models.CharField(max_length=5, blank=True)
    height_cm = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    bmi = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    address = models.TextField(blank=True)
    emergency_contact = models.CharField(max_length=15, blank=True)
    qr_code_url = models.CharField(max_length=500, blank=True)
    lifestyle_data = models.JSONField(default=dict, blank=True)
    reminder_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.full_name

    class Meta:
        db_table = 'patient_registrations'


class EHRRecord(models.Model):
    record_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='ehr_records')
    added_by = models.ForeignKey(LoginCredentials, on_delete=models.SET_NULL, null=True, related_name='added_records')
    record_type = models.CharField(max_length=20, choices=RECORD_TYPES)
    title = models.CharField(max_length=200, blank=True)
    content = models.TextField(blank=True)
    file_url = models.CharField(max_length=500, blank=True)
    is_sensitive = models.BooleanField(default=False)
    recorded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.record_type} — {self.patient_id.full_name}"

    class Meta:
        db_table = 'ehr_records'
        ordering = ['-recorded_at']


class Allergy(models.Model):
    allergy_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='allergies')
    allergen = models.CharField(max_length=200)
    reaction = models.TextField(blank=True)
    severity = models.CharField(max_length=10, choices=SEVERITY, blank=True)
    noted_by = models.ForeignKey(
        'doctor.DoctorRegistration',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='noted_allergies',
    )
    noted_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.allergen} — {self.patient_id.full_name}"

    class Meta:
        db_table = 'allergies'


class EHRConsentLog(models.Model):
    consent_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='consent_logs')
    accessed_by = models.ForeignKey(LoginCredentials, on_delete=models.CASCADE, related_name='ehr_accesses')
    access_type = models.CharField(max_length=15, choices=ACCESS_TYPES)
    data_shared = models.JSONField(default=list, blank=True)
    consent_given = models.BooleanField(default=False)
    short_code = models.CharField(max_length=6, blank=True, default='')
    expires_at = models.DateTimeField(null=True, blank=True)
    accessed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.access_type} — {self.patient_id.full_name}"

    class Meta:
        db_table = 'ehr_consent_log'
        ordering = ['-accessed_at']


class RiskAssessment(models.Model):
    risk_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='risk_assessments')
    diabetes_risk = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    heart_risk = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    hypertension_risk = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    risk_level = models.CharField(max_length=10, choices=RISK_LEVELS, blank=True)
    recommendations = models.TextField(blank=True)
    alert_sent = models.BooleanField(default=False)
    assessed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.risk_level} risk — {self.patient_id.full_name}"

    class Meta:
        db_table = 'risk_assessments'
        ordering = ['-assessed_at']


# ─── Complaints ───────────────────────────────────────────────────────────────

class Complaint(models.Model):
    COMPLAINT_TYPES = [
        ('doctor', 'Doctor Complaint'),
        ('vendor', 'Vendor Complaint'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('reviewed', 'Under Review'),
        ('resolved', 'Resolved'),
        ('dismissed', 'Dismissed'),
    ]

    complaint_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(
        PatientRegistration, on_delete=models.CASCADE,
        related_name='complaints', null=True, blank=True,
    )
    # Set when a hospital admin (not a patient) files the complaint — e.g. a
    # vendor complaint raised from the Equipment Orders page.
    filed_by_hospital = models.ForeignKey(
        'hospital.HospitalRegistration', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='filed_complaints',
    )
    complaint_type = models.CharField(max_length=20, choices=COMPLAINT_TYPES)
    doctor_id = models.ForeignKey(
        'doctor.DoctorRegistration', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='complaints',
    )
    hospital_id = models.ForeignKey(
        'hospital.HospitalRegistration', on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    vendor_id = models.ForeignKey(
        'vendor.VendorRegistration', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='complaints',
    )
    subject = models.CharField(max_length=200)
    description = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    admin_response = models.TextField(blank=True)
    admin_replied = models.BooleanField(default=False)
    hospital_response = models.TextField(blank=True, default='')
    hospital_replied = models.BooleanField(default=False)
    patient_followup = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.complaint_type} complaint — {self.subject}"

    class Meta:
        db_table = 'patient_complaints'
        ordering = ['-created_at']


# ─── Lab Test Orders ──────────────────────────────────────────────────────────

class LabTestOrder(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('confirmed', 'Confirmed'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
        ('no_show', 'No Show'),
    ]

    PRESCRIPTION_STATUS_CHOICES = [
        ('not_required', 'Not Required'),
        ('pending', 'Pending Verification'),
        ('verified', 'Verified'),
        ('rejected', 'Rejected'),
        ('doctor_referred', 'Doctor Referred'),
    ]

    order_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(
        PatientRegistration, on_delete=models.CASCADE, related_name='lab_test_orders'
    )
    hospital_id = models.ForeignKey(
        'hospital.HospitalRegistration', on_delete=models.SET_NULL, null=True
    )
    doctor_id = models.ForeignKey(
        'doctor.DoctorRegistration', on_delete=models.SET_NULL, null=True, blank=True
    )
    tests = models.JSONField(default=list)
    total_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    appointment_date = models.DateField(null=True, blank=True)
    appointment_time = models.TimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    payment_status = models.CharField(max_length=20, default='pending')
    razorpay_order_id = models.CharField(max_length=100, blank=True)
    razorpay_payment_id = models.CharField(max_length=100, blank=True)
    razorpay_signature = models.CharField(max_length=200, blank=True)
    report_url = models.URLField(blank=True)
    report_results = models.JSONField(default=dict)
    abnormal_flags = models.JSONField(default=list)
    notes = models.TextField(blank=True)
    # ─── Prescription handling (Option C — hybrid) ───────────────────────
    prescription_required = models.BooleanField(default=False)
    prescription_verified = models.BooleanField(default=False)
    prescription_image = models.CharField(max_length=500, blank=True)
    prescription_status = models.CharField(
        max_length=20, choices=PRESCRIPTION_STATUS_CHOICES, default='not_required'
    )
    # ─── Slot booking (Option B+) ────────────────────────────────────────
    slot_id = models.ForeignKey(
        'lab.LabSlot', on_delete=models.SET_NULL, null=True, blank=True, related_name='bookings'
    )
    reminder_sent = models.BooleanField(default=False)
    # ─── No-show tracking ────────────────────────────────────────────────
    reminder_30min_sent = models.BooleanField(default=False)
    no_show_at = models.DateTimeField(null=True, blank=True)
    no_show_marked_by = models.CharField(
        max_length=20, blank=True, default='', help_text="'auto' or 'lab_tech'"
    )
    ordered_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"LabTestOrder {self.order_id} — {self.patient_id.full_name}"

    class Meta:
        db_table = 'lab_test_orders'
        ordering = ['-ordered_at']


# ─── EHR Images ───────────────────────────────────────────────────────────────

class EHRImage(models.Model):
    IMAGE_TYPES = [
        ('xray', 'X-Ray'),
        ('mri', 'MRI Scan'),
        ('skin', 'Skin Photo'),
        ('ct_scan', 'CT Scan'),
        ('ultrasound', 'Ultrasound'),
        ('lab_report', 'Lab Report'),
        ('other', 'Other'),
    ]

    image_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(
        PatientRegistration, on_delete=models.CASCADE, related_name='ehr_images'
    )
    image_type = models.CharField(max_length=20, choices=IMAGE_TYPES)
    image_url = models.URLField()
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    hospital_name = models.CharField(max_length=200, blank=True)
    scan_date = models.DateField(null=True, blank=True)
    uploaded_by = models.ForeignKey(
        LoginCredentials, on_delete=models.SET_NULL, null=True
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.image_type} — {self.title}"

    class Meta:
        db_table = 'ehr_images'
        ordering = ['-uploaded_at']
