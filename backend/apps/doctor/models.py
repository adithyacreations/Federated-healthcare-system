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
    ('offline', 'Offline'),
    ('both', 'Both'),
    ('in_person', 'In Person (Legacy)'),
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

SLOT_STATUS = [
    ('available', 'Available'),
    ('booked', 'Booked'),
    ('blocked', 'Blocked'),
]

BLOCKED_BY = [
    ('hospital_admin', 'Hospital Admin'),
    ('doctor', 'Doctor'),
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


class DoctorSchedule(models.Model):
    schedule_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='doctor_schedules')
    doctor = models.ForeignKey(DoctorRegistration, on_delete=models.CASCADE, related_name='schedules')
    working_days = models.JSONField(default=list)
    start_time = models.TimeField()
    end_time = models.TimeField()
    slot_duration_minutes = models.PositiveIntegerField()
    consultation_type = models.CharField(
        max_length=10,
        choices=[('online', 'Online'), ('offline', 'Offline'), ('both', 'Both')],
        default='both',
    )
    consultation_fee = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        from django.core.exceptions import ValidationError

        errors = {}
        if not self.working_days:
            errors['working_days'] = 'Working days cannot be empty.'
        if self.end_time and self.start_time and self.end_time <= self.start_time:
            errors['end_time'] = 'End time must be greater than start time.'
        if not self.slot_duration_minutes or self.slot_duration_minutes <= 0:
            errors['slot_duration_minutes'] = 'Slot duration must be positive.'
        if self.consultation_fee is not None and self.consultation_fee < 0:
            errors['consultation_fee'] = 'Consultation fee must be zero or greater.'
        if self.doctor_id and self.hospital_id and self.doctor.hospital_id_id != self.hospital_id:
            errors['doctor'] = 'Doctor must belong to the selected hospital.'
        if self.is_active and self.doctor_id and self.hospital_id:
            duplicate = type(self).objects.filter(
                hospital_id=self.hospital_id,
                doctor_id=self.doctor_id,
                is_active=True,
            )
            if self.pk:
                duplicate = duplicate.exclude(pk=self.pk)
            if duplicate.exists():
                errors['doctor'] = 'Doctor already has an active schedule.'
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.doctor.full_name} schedule ({self.hospital.hospital_name})"

    class Meta:
        db_table = 'doctor_schedules'
        ordering = ['doctor__full_name', 'start_time']


class DoctorSlot(models.Model):
    slot_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    doctor_id = models.ForeignKey(DoctorRegistration, on_delete=models.CASCADE, related_name='slots')
    hospital = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='doctor_slots', null=True, blank=True)
    schedule = models.ForeignKey(DoctorSchedule, on_delete=models.CASCADE, related_name='slots', null=True, blank=True)
    slot_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    consult_type = models.CharField(max_length=10, choices=CONSULT_TYPES, default='online')
    consultation_fee = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    status = models.CharField(max_length=15, choices=SLOT_STATUS, default='available')
    is_booked = models.BooleanField(default=False)
    is_blocked = models.BooleanField(default=False)
    blocked_by = models.CharField(max_length=20, choices=BLOCKED_BY, null=True, blank=True)
    block_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def date(self):
        return self.slot_date

    @property
    def doctor(self):
        return self.doctor_id

    @property
    def consultation_type(self):
        return self.consult_type

    def __str__(self):
        return f"{self.doctor_id.full_name} — {self.slot_date} {self.start_time} ({self.consult_type})"

    class Meta:
        db_table = 'doctor_slots'
        indexes = [
            models.Index(fields=['doctor_id', 'slot_date', 'start_time', 'end_time'], name='doctor_slot_lookup_idx'),
            models.Index(fields=['hospital', 'slot_date', 'status'], name='doctor_slot_board_idx'),
        ]


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
    payment_hold_expires_at = models.DateTimeField(null=True, blank=True)
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
