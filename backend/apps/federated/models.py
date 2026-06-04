import uuid
from django.db import models
from apps.hospital.models import HospitalRegistration

ROUND_STATUS = [
    ('pending', 'Pending'),
    ('training', 'Training'),
    ('aggregating', 'Aggregating'),
    ('completed', 'Completed'),
    ('cancelled', 'Cancelled'),
]

ALERT_LEVELS = [
    ('low', 'Low'),
    ('moderate', 'Moderate'),
    ('high', 'High'),
    ('critical', 'Critical'),
]


class FLGlobalModel(models.Model):
    model_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    version = models.CharField(max_length=20, unique=True)
    weights_file_url = models.CharField(max_length=500, blank=True)
    accuracy = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    hospitals_count = models.IntegerField(default=0)
    aggregation_algo = models.CharField(max_length=30, default='FedAvg')
    is_active = models.BooleanField(default=False)
    privacy_epsilon = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"FL Model v{self.version} — accuracy: {self.accuracy}%"

    class Meta:
        db_table = 'fl_global_models'
        ordering = ['-created_at']


class FLRound(models.Model):
    round_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    model_id = models.ForeignKey(FLGlobalModel, on_delete=models.CASCADE, related_name='rounds')
    round_number = models.IntegerField()
    status = models.CharField(max_length=15, choices=ROUND_STATUS, default='pending')
    hospitals_invited = models.IntegerField(default=0)
    hospitals_completed = models.IntegerField(default=0)
    global_loss = models.DecimalField(max_digits=8, decimal_places=6, null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    round_deadline = models.DateTimeField(null=True, blank=True)
    min_hospitals_threshold = models.IntegerField(default=1)
    auto_aggregated = models.BooleanField(default=False)
    reminder_sent = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Round {self.round_number} — {self.model_id.version} [{self.status}]"

    class Meta:
        db_table = 'fl_rounds'
        ordering = ['-created_at']


class FLHospitalWeight(models.Model):
    weight_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    round_id = models.ForeignKey(FLRound, on_delete=models.CASCADE, related_name='hospital_weights')
    hospital_id = models.ForeignKey(HospitalRegistration, on_delete=models.CASCADE, related_name='fl_weights')
    weights_file_url = models.CharField(max_length=500, blank=True)
    local_accuracy = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    local_loss = models.DecimalField(max_digits=8, decimal_places=6, null=True, blank=True)
    training_samples = models.IntegerField(default=0)
    noise_added = models.BooleanField(default=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.hospital_id.hospital_name} — Round {self.round_id.round_number}"

    class Meta:
        db_table = 'fl_hospital_weights'
        ordering = ['-submitted_at']


class EpidemicTrend(models.Model):
    trend_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    disease_name = models.CharField(max_length=200)
    region = models.CharField(max_length=150, blank=True)
    case_count = models.IntegerField(default=0)
    spike_detected = models.BooleanField(default=False)
    heatmap_data = models.JSONField(default=list, blank=True)
    alert_level = models.CharField(max_length=10, choices=ALERT_LEVELS, default='low')
    recorded_date = models.DateField()
    is_resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        'auth_app.LoginCredentials',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='resolved_epidemics',
    )
    resolution_note = models.TextField(blank=True, default='')

    def __str__(self):
        return f"{self.disease_name} — {self.region} [{self.alert_level}] {self.recorded_date}"

    class Meta:
        db_table = 'epidemic_trends'
        ordering = ['-recorded_date']
