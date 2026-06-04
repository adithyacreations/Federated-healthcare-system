from rest_framework import serializers
from apps.patient.models import PatientRegistration
from .models import TriageSession


class TriageSessionSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient_id.full_name', read_only=True)

    class Meta:
        model = TriageSession
        fields = [
            'triage_id', 'patient_id', 'patient_name',
            'symptoms_input', 'predicted_diseases',
            'confidence_score', 'severity', 'model_version',
            'emergency_triggered', 'recommendation', 'created_at',
        ]


class SymptomCheckSerializer(serializers.Serializer):
    symptoms = serializers.ListField(
        child=serializers.CharField(allow_blank=False, max_length=80),
        min_length=1,
        max_length=15,
    )

    def validate_symptoms(self, value):
        cleaned = [s.strip().lower().replace(' ', '_') for s in value if s and s.strip()]
        if not cleaned:
            raise serializers.ValidationError('At least one valid symptom is required.')
        return cleaned


class ClinicalDiagnosisSerializer(serializers.Serializer):
    symptoms = serializers.ListField(
        child=serializers.CharField(allow_blank=False, max_length=80),
        min_length=1,
        max_length=15,
    )
    patient_id = serializers.UUIDField()
    consultation_id = serializers.UUIDField(required=False)

    def validate_symptoms(self, value):
        cleaned = [s.strip().lower().replace(' ', '_') for s in value if s and s.strip()]
        if not cleaned:
            raise serializers.ValidationError('At least one valid symptom is required.')
        return cleaned

    def validate_patient_id(self, value):
        if not PatientRegistration.objects.filter(patient_id=value).exists():
            raise serializers.ValidationError('Patient not found.')
        return value


class RiskPredictionSerializer(serializers.Serializer):
    age = serializers.IntegerField(min_value=1, max_value=120)
    bmi = serializers.FloatField(required=False, default=0, min_value=0, max_value=80)
    blood_pressure_systolic = serializers.FloatField(required=False, default=0, min_value=0, max_value=300)
    blood_pressure_diastolic = serializers.FloatField(required=False, default=0, min_value=0, max_value=200)
    glucose_level = serializers.FloatField(required=False, default=0, min_value=0, max_value=500)
    cholesterol = serializers.FloatField(required=False, default=0, min_value=0, max_value=600)
    smoking = serializers.BooleanField(required=False, default=False)
    exercise = serializers.BooleanField(required=False, default=False)
    family_history_diabetes = serializers.BooleanField(required=False, default=False)
    family_history_heart = serializers.BooleanField(required=False, default=False)
