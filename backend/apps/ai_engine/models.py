import uuid
from django.db import models
from apps.patient.models import PatientRegistration

SEVERITY = [
    ('low', 'Low'),
    ('moderate', 'Moderate'),
    ('high', 'High'),
    ('critical', 'Critical'),
]


class TriageSession(models.Model):
    triage_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.ForeignKey(PatientRegistration, on_delete=models.CASCADE, related_name='triage_sessions')
    symptoms_input = models.JSONField(default=list)
    predicted_diseases = models.JSONField(default=list)
    confidence_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    severity = models.CharField(max_length=10, choices=SEVERITY, blank=True)
    model_version = models.CharField(max_length=20, blank=True)
    emergency_triggered = models.BooleanField(default=False)
    recommendation = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Triage — {self.patient_id.full_name} [{self.severity}]"

    class Meta:
        db_table = 'triage_sessions'
        ordering = ['-created_at']
