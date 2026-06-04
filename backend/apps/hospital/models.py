import uuid
from datetime import date
from django.db import models
from apps.auth_app.models import LoginCredentials

APPROVAL_STATUS = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]

BED_TYPES = [
    ('general', 'General'),
    ('icu', 'ICU'),
    ('ventilator', 'Ventilator'),
]

BED_STATUS = [
    ('available', 'Available'),
    ('occupied', 'Occupied'),
    ('reserved', 'Reserved'),
]

# Hospital inventory tracks EQUIPMENT ONLY — medicines belong to pharmacy stock.
CATEGORY = [
    ('medical_equipment', 'Medical Equipment'),
    ('diagnostic', 'Diagnostic Equipment'),
    ('surgical', 'Surgical Equipment'),
    ('monitoring', 'Monitoring Equipment'),
    ('emergency', 'Emergency Equipment'),
    ('laboratory', 'Laboratory Equipment'),
    ('imaging', 'Imaging Equipment'),
    ('therapy', 'Therapy Equipment'),
    ('furniture', 'Furniture'),
    ('other', 'Other'),
]

GENDER_CHOICES = [
    ('male', 'Male'),
    ('female', 'Female'),
    ('other', 'Other'),
]

EQUIPMENT_CONDITION = [
    ('good', 'Good'),
    ('fair', 'Fair'),
    ('poor', 'Poor'),
    ('needs_repair', 'Needs Repair'),
    ('out_of_service', 'Out of Service'),
]


class HospitalRegistration(models.Model):
    hospital_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.OneToOneField(LoginCredentials, on_delete=models.CASCADE, related_name='hospital_profile')
    hospital_name = models.CharField(max_length=200)
    registration_no = models.CharField(max_length=100, unique=True)
    address = models.TextField()
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=100, default='Kerala')
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    contact_phone = models.CharField(max_length=15, blank=True)
    contact_email = models.EmailField(blank=True)
    doc_url = models.CharField(max_length=500, blank=True)
    telemedicine_enabled = models.BooleanField(default=False)
    approval_status = models.CharField(max_length=10, choices=APPROVAL_STATUS, default='pending')
    profile_photo = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.hospital_name

    class Meta:
        db_table = 'hospital_registrations'


class Department(models.Model):
    dept_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='departments')
    dept_name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.dept_name} — {self.hospital_id.hospital_name}"

    class Meta:
        db_table = 'departments'


class Bed(models.Model):
    bed_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='beds')
    bed_type = models.CharField(max_length=15, choices=BED_TYPES)
    ward_name = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=BED_STATUS, default='available')
    reserved_for = models.ForeignKey(
        'patient.PatientRegistration',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reserved_beds',
    )
    # Set when a bed is held for an active emergency — lets the bed monitor
    # detect if the reservation was lost (bed taken by someone else).
    emergency_id = models.ForeignKey(
        'emergency.EmergencyRequest',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='emergency_reserved_beds',
    )
    reserved_at = models.DateTimeField(null=True, blank=True)
    admitted_at = models.DateTimeField(null=True, blank=True)
    # When the bed was locked for an emergency, and the minimum days the hospital
    # admin must wait before they can force-unlock it.
    emergency_locked_at = models.DateTimeField(null=True, blank=True)
    minimum_lock_days = models.IntegerField(default=3)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def is_emergency_locked(self):
        return self.emergency_id_id is not None

    def __str__(self):
        return f"{self.bed_type} bed — {self.hospital_id.hospital_name} [{self.status}]"

    class Meta:
        db_table = 'beds'


class HospitalInventory(models.Model):
    inventory_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='inventory')
    item_name = models.CharField(max_length=200)
    category = models.CharField(max_length=30, choices=CATEGORY, default='medical_equipment')
    quantity = models.IntegerField(default=0)
    unit = models.CharField(max_length=30, blank=True)
    reorder_level = models.IntegerField(default=10)
    condition = models.CharField(max_length=20, choices=EQUIPMENT_CONDITION, default='good')
    image_url = models.CharField(max_length=500, blank=True, default='')
    last_restocked = models.DateTimeField(null=True, blank=True)
    maintenance_due = models.DateField(null=True, blank=True)

    def __str__(self):
        return f"{self.item_name} ({self.hospital_id.hospital_name})"

    class Meta:
        db_table = 'hospital_inventory'


class EquipmentStockMovement(models.Model):
    """Audit trail for every stock change on a HospitalInventory (equipment) item.
    Replaces direct count editing — every +/- is recorded with reason, who, when,
    and the running stock_before/stock_after balance."""

    MOVEMENT_TYPES = [
        ('in', 'Stock In'),
        ('out', 'Stock Out'),
    ]

    # Stock IN reasons + Stock OUT reasons (combined; the UI filters by type).
    MOVEMENT_REASONS = [
        ('purchase', 'New Purchase'),
        ('transfer_in', 'Transfer In'),
        ('donation', 'Donation'),
        ('repair_return', 'Returned from Repair'),
        ('used', 'Used/Consumed'),
        ('damaged', 'Damaged'),
        ('repair_out', 'Sent for Repair'),
        ('disposed', 'Disposed/Expired'),
        ('transfer_out', 'Transferred Out'),
        ('lost', 'Lost/Missing'),
    ]

    movement_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Note: the real equipment model is HospitalInventory (no separate
    # HospitalEquipment table) — equipment_id points at it.
    equipment_id = models.ForeignKey(
        'HospitalInventory',
        on_delete=models.CASCADE,
        related_name='stock_movements',
    )
    movement_type = models.CharField(max_length=10, choices=MOVEMENT_TYPES)
    quantity = models.IntegerField()
    reason = models.CharField(max_length=50, choices=MOVEMENT_REASONS)
    vendor_name = models.CharField(max_length=200, null=True, blank=True, help_text='For purchase movements')
    invoice_number = models.CharField(max_length=100, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    performed_by = models.ForeignKey(
        'auth_app.LoginCredentials',
        on_delete=models.SET_NULL,
        null=True,
        related_name='stock_movements',
    )
    stock_before = models.IntegerField(help_text='Stock count before movement')
    stock_after = models.IntegerField(help_text='Stock count after movement')
    movement_date = models.DateField(default=date.today)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'equipment_stock_movements'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.movement_type}: {self.quantity} {self.equipment_id.item_name}"


class HospitalPatient(models.Model):
    patient_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='hospital_patients')
    added_by = models.ForeignKey(LoginCredentials, on_delete=models.SET_NULL, null=True)
    full_name = models.CharField(max_length=120)
    age = models.IntegerField()
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES)
    blood_group = models.CharField(max_length=5, blank=True)
    symptoms = models.JSONField(default=list)
    diagnosis = models.CharField(max_length=200)
    visit_date = models.DateField(auto_now_add=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'hospital_patients'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.full_name} - {self.diagnosis}"
