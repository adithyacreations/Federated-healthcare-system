from rest_framework import serializers
from .models import LabTechRegistration, LabOrder, LabReport


class LabTechProfileSerializer(serializers.ModelSerializer):
    hospital_name = serializers.CharField(source='hospital_id.hospital_name', read_only=True)

    class Meta:
        model = LabTechRegistration
        fields = '__all__'


class LabOrderSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient_id.full_name', read_only=True)
    doctor_name = serializers.CharField(source='doctor_id.full_name', read_only=True)

    class Meta:
        model = LabOrder
        fields = [
            'order_id', 'patient_name', 'doctor_name',
            'tests_ordered', 'priority', 'status',
            'payment_status', 'notes', 'ordered_at', 'updated_at',
        ]


class LabReportSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient_id.full_name', read_only=True)

    class Meta:
        model = LabReport
        fields = [
            'report_id', 'patient_name', 'results',
            'abnormal_flags', 'ai_analysis',
            'report_file_url', 'saved_to_ehr', 'uploaded_at',
        ]


class UploadReportSerializer(serializers.Serializer):
    order_id = serializers.UUIDField()
    results = serializers.DictField(child=serializers.DictField())
    report_file_url = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_results(self, value):
        for test_name, test_data in value.items():
            if 'value' not in test_data:
                raise serializers.ValidationError(
                    f'Test "{test_name}" must include a "value" key.'
                )
        return value

    def validate(self, data):
        lab_tech = self.context.get('lab_tech')
        try:
            order = LabOrder.objects.select_related(
                'patient_id', 'doctor_id'
            ).get(order_id=data['order_id'])
        except LabOrder.DoesNotExist:
            raise serializers.ValidationError({'order_id': 'Lab order not found.'})

        if lab_tech and order.lab_tech_id and str(order.lab_tech_id.lab_tech_id) != str(lab_tech.lab_tech_id):
            raise serializers.ValidationError(
                {'order_id': 'This order is not assigned to you.'}
            )
        if order.status not in ('pending', 'processing'):
            raise serializers.ValidationError(
                {'order_id': 'Report can only be uploaded for pending or processing orders.'}
            )
        data['_order'] = order
        return data


class UpdateOrderStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['processing', 'completed'])
