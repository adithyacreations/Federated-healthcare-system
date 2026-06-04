import uuid
from django.db import models
from apps.auth_app.models import LoginCredentials
from apps.hospital.models import HospitalRegistration, Department
from apps.patient.models import PatientRegistration

APPROVAL_STATUS = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]

CONSULT_TYPES = [
    ('online', 'Online'),
    ('in_person', 'In Person'),
]

CONSULT_MODES = [
    ('online', 'Online Video Call'),
    ('offline', 'Physical Visit'),
]

CONSULTATION_STATUS = [
    ('scheduled', 'Scheduled'),
    ('ongoing', 'Ongoing'),
    ('completed', 'Completed'),
    ('cancelled', 'Cancelled'),
]

PAYMENT_STATUS = [
    ('pending', 'Pending'),
    ('paid', 'Paid'),
    ('failed', 'Failed'),
]


class DoctorRegistration(models.Model):
    doctor_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.OneToOneField(LoginCredentials, on_delete=models.CASCADE, related_name='doctor_profile')
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='doctors')
    dept_id = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='doctors')
    full_name = models.CharField(max_length=120)
    specialization = models.CharField(max_length=150)
    license_no = models.CharField(max_length=100, unique=True)
    experience_years = models.IntegerField(default=0)
    consultation_fee = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    profile_photo = models.CharField(max_length=500, blank=True)
    is_online = models.BooleanField(default=False)
    approval_status = models.CharField(max_length=10, choices=APPROVAL_STATUS, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Dr. {self.full_name} — {self.specialization}"

    class Meta:
        db_table = 'doctor_registrations'


class DoctorSlot(models.Model):
    slot_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    doctor_id = models.ForeignKey(DoctorRegistration, on_delete=models.CASCADE, related_name='slots')
    slot_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    consult_type = models.CharField(max_length=10, choices=CONSULT_TYPES, default='online')
    is_booked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.doctor_id.full_name} — {self.slot_date} {self.start_time} ({self.consult_type})"

    class Meta:
        db_table = 'doctor_slots'


class Consultation(models.Model):
    consultation_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='consultations')
    doctor_id = models.ForeignKey(DoctorRegistration, on_delete=models.CASCADE, related_name='consultations')
    slot_id = models.ForeignKey(DoctorSlot, on_delete=models.SET_NULL, null=True, blank=True, related_name='consultation')
    jitsi_room_id = models.CharField(max_length=200, blank=True)
    consult_mode = models.CharField(max_length=20, choices=CONSULT_MODES, default='online')
    status = models.CharField(max_length=15, choices=CONSULTATION_STATUS, default='scheduled')
    ai_suggestions = models.JSONField(default=dict, blank=True)
    doctor_notes = models.TextField(blank=True)
    final_diagnosis = models.TextField(blank=True)
    to_emergency = models.BooleanField(default=False)
    razorpay_order_id = models.CharField(max_length=100, blank=True)
    razorpay_payment_id = models.CharField(max_length=100, blank=True)
    razorpay_signature = models.CharField(max_length=200, blank=True)
    payment_status = models.CharField(max_length=10, choices=PAYMENT_STATUS, default='pending')
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.patient_id.full_name} — Dr. {self.doctor_id.full_name} [{self.status}]"

    class Meta:
        db_table = 'consultations'
        ordering = ['-created_at']


class Prescription(models.Model):
    prescription_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    doctor_id = models.ForeignKey(DoctorRegistration, on_delete=models.CASCADE, related_name='prescriptions')
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='prescriptions')
    consultation_id = models.ForeignKey(Consultation, on_delete=models.SET_NULL, null=True, blank=True, related_name='prescription')
    medicines = models.JSONField(default=list)
    diagnosis = models.TextField(blank=True)
    instructions = models.TextField(blank=True)
    is_verified = models.BooleanField(default=False)
    valid_until = models.DateField(null=True, blank=True)
    pdf_url = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Rx — {self.patient_id.full_name} by Dr. {self.doctor_id.full_name}"

    class Meta:
        db_table = 'prescriptions'
        ordering = ['-created_at']


class ConsultationChat(models.Model):
    """Persisted chat messages for a consultation (in-call and pre-call).

    Survives tab switches / reloads because both sides load history from the DB
    and the live socket only carries new messages. Text goes through the REST API
    (which writes here then broadcasts); images/X-ray frames stay ephemeral.
    """
    SENDER_TYPES = [('patient', 'Patient'), ('doctor', 'Doctor')]

    chat_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    consultation_id = models.ForeignKey(
        Consultation, on_delete=models.CASCADE, related_name='chat_messages'
    )
    sender_type = models.CharField(max_length=20, choices=SENDER_TYPES)
    sender_name = models.CharField(max_length=100)
    message = models.TextField()
    sent_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.sender_type}: {self.message[:50]}"

    class Meta:
        db_table = 'consultation_chats'
        ordering = ['sent_at']
