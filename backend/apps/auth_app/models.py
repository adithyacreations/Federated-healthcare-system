import uuid
from django.db import models
from django.contrib.auth.hashers import make_password

ROLE_CHOICES = [
    ('super_admin', 'Super Admin'),
    ('hospital_admin', 'Hospital Admin'),
    ('doctor', 'Doctor'),
    ('patient', 'Patient'),
    ('pharmacist', 'Pharmacist'),
    ('lab_tech', 'Lab Technician'),
    ('driver', 'Ambulance Driver'),
    ('vendor', 'Equipment Vendor'),
]

NOTIF_TYPES = [
    ('approval', 'Approval'),
    ('alert', 'Alert'),
    ('reminder', 'Reminder'),
    ('order', 'Order'),
    ('emergency', 'Emergency'),
    ('report', 'Report Ready'),
    ('payment', 'Payment'),
]


class LoginCredentials(models.Model):
    # Required by DRF's IsAuthenticated permission check
    is_authenticated = True
    is_anonymous = False

    login_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    phone_number = models.CharField(max_length=15, blank=True, default='', db_index=True)
    password_hash = models.CharField(max_length=128)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    is_active = models.BooleanField(default=False)
    is_approved = models.BooleanField(default=False)
    last_login = models.DateTimeField(null=True, blank=True)
    login_attempts = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def set_password(self, raw_password):
        self.password_hash = make_password(raw_password)

    def __str__(self):
        return f"{self.email} ({self.role})"

    class Meta:
        db_table = 'login_credentials'
        verbose_name = 'Login Credential'


class SuperAdmin(models.Model):
    admin_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.OneToOneField(LoginCredentials, on_delete=models.CASCADE, related_name='super_admin_profile')
    full_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=15, blank=True)
    profile_photo = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.full_name

    class Meta:
        db_table = 'super_admin'


class RolePermissions(models.Model):
    permission_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    module = models.CharField(max_length=100)
    can_read = models.BooleanField(default=False)
    can_write = models.BooleanField(default=False)
    can_delete = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.role} - {self.module}"

    class Meta:
        db_table = 'role_permissions'
        unique_together = ['role', 'module']


class LoginSession(models.Model):
    session_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.ForeignKey(LoginCredentials, on_delete=models.CASCADE, related_name='sessions')
    jwt_token_hash = models.CharField(max_length=300)
    device_info = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Session for {self.login_id.email}"

    class Meta:
        db_table = 'login_sessions'


class AuditLog(models.Model):
    log_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.ForeignKey(LoginCredentials, on_delete=models.SET_NULL, null=True, related_name='audit_logs')
    action = models.CharField(max_length=200)
    module = models.CharField(max_length=100, blank=True)
    entity_type = models.CharField(max_length=50, blank=True)
    entity_id = models.UUIDField(null=True, blank=True)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    logged_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.action} by {self.login_id}"

    class Meta:
        db_table = 'audit_logs'
        ordering = ['-logged_at']


class Notification(models.Model):
    notif_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    login_id = models.ForeignKey(LoginCredentials, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=200)
    message = models.TextField(blank=True)
    notif_type = models.CharField(max_length=20, choices=NOTIF_TYPES)
    is_read = models.BooleanField(default=False)
    related_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} → {self.login_id.email}"

    class Meta:
        db_table = 'notifications'
        ordering = ['-created_at']


class Developer(models.Model):
    """Team member shown on the public landing page; managed by Super Admin."""
    developer_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    role = models.CharField(max_length=100, help_text='e.g. Full Stack Developer')
    department = models.CharField(
        max_length=100, null=True, blank=True, help_text='e.g. MCA Final Year'
    )
    college = models.CharField(max_length=200, default='MIIT')
    photo = models.ImageField(upload_to='developers/', null=True, blank=True)
    github_url = models.URLField(null=True, blank=True)
    linkedin_url = models.URLField(null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    order = models.IntegerField(default=0, help_text='Display order')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'developers'
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class ProjectFeature(models.Model):
    """Feature/showcase card shown on the public landing page; managed by Super Admin."""
    feature_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    photo = models.ImageField(upload_to='features/', null=True, blank=True)
    icon = models.CharField(max_length=10, null=True, blank=True, help_text='Emoji icon e.g. 🧠')
    category = models.CharField(
        max_length=100, null=True, blank=True, help_text='e.g. AI, Emergency, Lab'
    )
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'project_features'
        ordering = ['order', 'title']

    def __str__(self):
        return self.title
