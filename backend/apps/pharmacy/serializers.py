from rest_framework import serializers
from .models import PharmacistRegistration, MedicineOrder


class PharmacistProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = PharmacistRegistration
        fields = '__all__'


class MedicineOrderSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient_id.full_name', read_only=True)
    # Stored as relative paths (e.g. /media/prescriptions/rx_xyz.pdf); return
    # absolute URLs so the frontend can open them directly. Falls back to the
    # raw path when no request is in context.
    prescription_url = serializers.SerializerMethodField()
    prescription_local_url = serializers.SerializerMethodField()

    class Meta:
        model = MedicineOrder
        fields = [
            'med_order_id', 'patient_name', 'medicines',
            'total_amount', 'order_status', 'payment_status',
            'delivery_address', 'delivery_phone', 'tracking_info',
            'requires_prescription', 'prescription_url', 'prescription_local_url',
            'prescription_verified', 'prescription_rejection_reason', 'payment_enabled',
            'status_history', 'estimated_delivery_days',
            'razorpay_order_id', 'ordered_at', 'updated_at',
        ]

    def _absolute(self, path):
        if not path:
            return None
        path = str(path)
        if path.startswith('http'):
            return path
        request = self.context.get('request')
        return request.build_absolute_uri(path) if request is not None else path

    def get_prescription_url(self, obj):
        return self._absolute(obj.prescription_url)

    def get_prescription_local_url(self, obj):
        return self._absolute(obj.prescription_local_url)


class UpdateOrderStatusSerializer(serializers.Serializer):
    order_status = serializers.ChoiceField(choices=['confirmed', 'dispatched', 'delivered'])
    tracking_info = serializers.CharField(required=False, allow_blank=True, default='')


class VerifyPaymentSerializer(serializers.Serializer):
    razorpay_order_id = serializers.CharField()
    razorpay_payment_id = serializers.CharField()
    razorpay_signature = serializers.CharField()
