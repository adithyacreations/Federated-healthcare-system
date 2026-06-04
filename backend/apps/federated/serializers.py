from rest_framework import serializers
from .models import FLGlobalModel, FLRound, FLHospitalWeight, EpidemicTrend


class FLGlobalModelSerializer(serializers.ModelSerializer):
    class Meta:
        model = FLGlobalModel
        fields = '__all__'


class FLRoundSerializer(serializers.ModelSerializer):
    model_version = serializers.CharField(source='model_id.version', read_only=True)

    class Meta:
        model = FLRound
        fields = [
            'round_id', 'model_id', 'model_version', 'round_number', 'status',
            'hospitals_invited', 'hospitals_completed', 'global_loss',
            'started_at', 'completed_at', 'round_deadline',
            'min_hospitals_threshold', 'auto_aggregated', 'reminder_sent',
            'created_at',
        ]


class FLHospitalWeightSerializer(serializers.ModelSerializer):
    hospital_name = serializers.CharField(source='hospital_id.hospital_name', read_only=True)
    round_number = serializers.IntegerField(source='round_id.round_number', read_only=True)

    class Meta:
        model = FLHospitalWeight
        fields = [
            'weight_id', 'round_id', 'round_number', 'hospital_id', 'hospital_name',
            'weights_file_url', 'local_accuracy', 'local_loss',
            'training_samples', 'noise_added', 'submitted_at',
        ]


class EpidemicTrendSerializer(serializers.ModelSerializer):
    class Meta:
        model = EpidemicTrend
        fields = '__all__'


class InitializeModelSerializer(serializers.Serializer):
    MODEL_TYPES = ['symptom_checker', 'clinical_diagnosis', 'risk_predictor']
    model_type = serializers.ChoiceField(choices=MODEL_TYPES)
    version = serializers.CharField(max_length=20)


class SubmitWeightsSerializer(serializers.Serializer):
    # round_id is optional — if omitted the view auto-detects the active training round
    round_id = serializers.UUIDField(required=False, allow_null=True)


class AggregateSerializer(serializers.Serializer):
    round_id = serializers.UUIDField()


class CreateEpidemicSerializer(serializers.Serializer):
    disease_name = serializers.CharField(max_length=200)
    region = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    case_count = serializers.IntegerField(min_value=0)
    spike_detected = serializers.BooleanField(default=False)
    alert_level = serializers.ChoiceField(choices=['low', 'moderate', 'high', 'critical'])
    heatmap_data = serializers.ListField(required=False, default=list)
    recorded_date = serializers.DateField()
