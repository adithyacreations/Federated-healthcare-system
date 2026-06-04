import uuid
from django.db import models
from apps.auth_app.models import LoginCredentials
from apps.hospital.models import HospitalRegistration

APPROVAL_STATUS = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]

ORDER_STATUS = [
    ('pending', 'Pending'),
    ('confirmed', 'Confirmed'),
    ('dispatched', 'Dispatched'),
    ('delivered', 'Delivered'),
]

PAYMENT_STATUS = [
    ('pending', 'Pending'),
    ('paid', 'Paid'),
    ('failed', 'Failed'),
]


class VendorRegistration(models.Model):
    vendor_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.OneToOneField(LoginCredentials, on_delete=models.CASCADE, related_name='vendor_profile')
    company_name = models.CharField(max_length=200)
    tax_id = models.CharField(max_length=50, unique=True)
    contact_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=15, blank=True)
    business_license_url = models.CharField(max_length=500, blank=True)
    certifications = models.JSONField(default=list, blank=True)
    approval_status = models.CharField(max_length=10, choices=APPROVAL_STATUS, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.company_name} — {self.contact_name}"

    class Meta:
        db_table = 'vendor_registrations'


class EquipmentCatalog(models.Model):
    product_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vendor_id = models.ForeignKey(VendorRegistration, on_delete=models.CASCADE, related_name='products')
    product_name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, blank=True)
    specifications = models.JSONField(default=dict, blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    stock_qty = models.IntegerField(default=0)
    image_url = models.CharField(max_length=500, blank=True)
    listed_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.product_name} — {self.vendor_id.company_name}"

    class Meta:
        db_table = 'equipment_catalog'


class EquipmentOrder(models.Model):
    eq_order_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='equipment_orders')
    vendor_id = models.ForeignKey(VendorRegistration, on_delete=models.CASCADE, related_name='orders')
    product_id = models.ForeignKey(EquipmentCatalog, on_delete=models.CASCADE, related_name='orders')
    quantity = models.IntegerField(default=1)
    total_price = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    order_status = models.CharField(max_length=15, choices=ORDER_STATUS, default='pending')
    razorpay_order_id = models.CharField(max_length=100, blank=True)
    razorpay_payment_id = models.CharField(max_length=100, blank=True)
    razorpay_signature = models.CharField(max_length=200, blank=True)
    payment_status = models.CharField(max_length=10, choices=PAYMENT_STATUS, default='pending')
    tracking_info = models.TextField(blank=True)
    installed_at = models.DateTimeField(null=True, blank=True)
    delivery_otp = models.CharField(max_length=6, blank=True, default='')
    otp_expiry = models.DateTimeField(null=True, blank=True)
    otp_verified = models.BooleanField(default=False)
    estimated_delivery_days = models.IntegerField(default=3)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    delivery_notes = models.TextField(blank=True)
    status_history = models.JSONField(default=list)
    ordered_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Order {self.eq_order_id} — {self.product_id.product_name} [{self.order_status}]"

    class Meta:
        db_table = 'equipment_orders'
        ordering = ['-ordered_at']


# ─── Real-time chat between hospitals and vendors ───────────────────────────
# One thread per (vendor, hospital) pair; optionally pinned to a specific order.

class VendorHospitalChat(models.Model):
    chat_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vendor_id = models.ForeignKey(
        VendorRegistration, on_delete=models.CASCADE, related_name='chats'
    )
    hospital_id = models.ForeignKey(
        HospitalRegistration, on_delete=models.CASCADE, related_name='vendor_chats'
    )
    # Most recent order the thread is tied to (helps display "Re: Order #…").
    order_id = models.ForeignKey(
        EquipmentOrder, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='chats',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_message_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Chat {self.chat_id} — {self.vendor_id.company_name} ↔ {self.hospital_id.hospital_name}"

    class Meta:
        db_table = 'vendor_hospital_chats'
        unique_together = [('vendor_id', 'hospital_id')]
        ordering = ['-last_message_at']


SENDER_TYPES = [('vendor', 'Vendor'), ('hospital', 'Hospital')]


class VendorChatMessage(models.Model):
    message_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat_id = models.ForeignKey(
        VendorHospitalChat, on_delete=models.CASCADE, related_name='messages'
    )
    sender_type = models.CharField(max_length=20, choices=SENDER_TYPES)
    sender_login = models.ForeignKey(
        LoginCredentials, on_delete=models.CASCADE, related_name='vendor_chat_messages',
    )
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    sent_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"[{self.sender_type}] {self.message[:40]}"

    class Meta:
        db_table = 'vendor_chat_messages'
        ordering = ['sent_at']
