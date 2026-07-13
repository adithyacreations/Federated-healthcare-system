import uuid
from django.db import models
from django.core.files.storage import FileSystemStorage
from apps.auth_app.models import LoginCredentials
from apps.patient.models import PatientRegistration
from apps.doctor.models import Prescription

APPROVAL_STATUS = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]

ORDER_STATUS = [
    ('pending', 'Pending'),
    ('prescription_required', 'Prescription Required'),
    ('awaiting_prescription', 'Awaiting Prescription'),
    ('prescription_uploaded', 'Prescription Uploaded'),
    ('prescription_approved', 'Prescription Approved'),
    ('verified', 'Verified'),
    ('payment_pending', 'Payment Pending'),
    ('confirmed', 'Confirmed'),
    ('dispatched', 'Dispatched'),
    ('delivered', 'Delivered'),
    ('wrong_product', 'Wrong Product Reported'),
    ('resolved', 'Resolved'),
    ('refunded', 'Refunded'),
    ('cancelled', 'Cancelled'),
]

PAYMENT_STATUS = [
    ('pending', 'Pending'),
    ('paid', 'Paid'),
    ('failed', 'Failed'),
    ('refunded', 'Refunded'),
]

# Force local disk storage — the project default storage is Cloudinary, but
# medicine images (like prescriptions) are kept on the local filesystem.
local_media_storage = FileSystemStorage()

# ════════════════════════════════════════════════════════════════════════════
#  Drivers
# ════════════════════════════════════════════════════════════════════════════

class PharmacyDriver(models.Model):
    driver_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pharmacist = models.ForeignKey('PharmacistRegistration', on_delete=models.CASCADE, related_name='drivers')
    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=15)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.phone})"

    class Meta:
        db_table = 'pharmacy_drivers'


class PharmacistRegistration(models.Model):
    pharmacist_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.OneToOneField(LoginCredentials, on_delete=models.CASCADE, related_name='pharmacist_profile')
    pharmacy_name = models.CharField(max_length=200)
    license_no = models.CharField(max_length=100, unique=True)
    full_name = models.CharField(max_length=120)
    address = models.TextField(blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    approval_status = models.CharField(max_length=10, choices=APPROVAL_STATUS, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.pharmacy_name} — {self.full_name}"

    class Meta:
        db_table = 'pharmacist_registrations'


class MedicineOrder(models.Model):
    med_order_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='medicine_orders')
    pharmacist_id = models.ForeignKey(
        PharmacistRegistration, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='orders'
    )
    prescription_id = models.ForeignKey(
        Prescription, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='medicine_orders'
    )
    medicines = models.JSONField(default=list)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    payment_status = models.CharField(max_length=10, choices=PAYMENT_STATUS, default='pending')
    razorpay_order_id = models.CharField(max_length=100, blank=True)
    razorpay_payment_id = models.CharField(max_length=100, blank=True)
    razorpay_signature = models.CharField(max_length=200, blank=True)
    delivery_address = models.TextField(blank=True)
    delivery_phone = models.CharField(max_length=15, blank=True, help_text='Contact number for delivery')
    order_status = models.CharField(max_length=30, choices=ORDER_STATUS, default='pending')
    tracking_info = models.TextField(blank=True)
    # ─── Prescription handling ───────────────────────────────────────────
    prescription_url = models.URLField(blank=True)
    prescription_file = models.FileField(upload_to='prescriptions/', null=True, blank=True)
    prescription_local_url = models.CharField(max_length=500, blank=True)
    prescription_verified = models.BooleanField(default=False)
    prescription_rejection_reason = models.TextField(blank=True)
    requires_prescription = models.BooleanField(default=False)
    payment_enabled = models.BooleanField(default=False)
    # ─── Delivery OTP system ─────────────────────────────────────────────
    delivery_otp = models.CharField(max_length=6, blank=True)
    otp_expiry = models.DateTimeField(null=True, blank=True)
    otp_verified = models.BooleanField(default=False)
    estimated_delivery_days = models.IntegerField(default=2)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    driver = models.ForeignKey('PharmacyDriver', on_delete=models.SET_NULL, null=True, blank=True, related_name='deliveries')
    driver_name = models.CharField(max_length=120, blank=True)
    driver_phone = models.CharField(max_length=15, blank=True)
    issue_reported = models.BooleanField(default=False)
    issue_type = models.CharField(max_length=50, blank=True)
    patient_desired_resolution = models.CharField(max_length=20, blank=True, choices=[('refund', 'Refund'), ('redeliver', 'Redeliver')])
    final_resolution = models.CharField(max_length=20, blank=True, choices=[('refunded', 'Refunded'), ('redelivered', 'Redelivered')])
    status_history = models.JSONField(default=list)
    # ─── Stock reservation (BookMyShow-style 10-min hold) ────────────────
    stock_reserved = models.BooleanField(default=False, help_text='Stock held pending payment')
    reserved_at = models.DateTimeField(null=True, blank=True, help_text='When stock was reserved')
    reservation_expires_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Auto-release deadline (10 min after reserved_at; unset for Rx orders)',
    )
    ordered_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Order {self.med_order_id} — {self.patient_id.full_name} [{self.order_status}]"

    class Meta:
        db_table = 'medicine_orders'
        ordering = ['-ordered_at']


class PharmacyInventory(models.Model):
    CATEGORY_CHOICES = [
        ('tablet', 'Tablet'),
        ('syrup', 'Syrup'),
        ('injection', 'Injection'),
        ('cream', 'Cream/Ointment'),
        ('drops', 'Drops'),
        ('capsule', 'Capsule'),
        ('other', 'Other'),
    ]

    inventory_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pharmacy_id = models.ForeignKey(
        PharmacistRegistration, on_delete=models.CASCADE, related_name='inventory'
    )
    medicine_name = models.CharField(max_length=200)
    generic_name = models.CharField(max_length=200, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='tablet')
    description = models.TextField(blank=True)
    price_per_unit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    unit = models.CharField(max_length=20, default='tablet')
    stock_quantity = models.IntegerField(default=0)
    reserved_quantity = models.PositiveIntegerField(default=0)
    reorder_level = models.IntegerField(default=10)
    requires_prescription = models.BooleanField(default=False)
    medicine_image = models.ImageField(
        upload_to='medicine_images/', storage=local_media_storage,
        null=True, blank=True,
    )
    manufacturer = models.CharField(max_length=200, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    is_available = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def available_quantity(self):
        """Stock that can still be ordered (total minus reserved)."""
        return max(0, self.stock_quantity - self.reserved_quantity)

    def __str__(self):
        return f"{self.medicine_name} — {self.pharmacy_id.pharmacy_name}"

    class Meta:
        db_table = 'pharmacy_inventory'
        ordering = ['medicine_name']
