from rest_framework import serializers
from .models import VendorRegistration, EquipmentCatalog, EquipmentOrder


class VendorProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = VendorRegistration
        fields = '__all__'


class EquipmentCatalogSerializer(serializers.ModelSerializer):
    vendor_name = serializers.CharField(source='vendor_id.company_name', read_only=True)

    class Meta:
        model = EquipmentCatalog
        fields = '__all__'


class CreateProductSerializer(serializers.Serializer):
    product_name = serializers.CharField(max_length=200)
    category = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    specifications = serializers.DictField(required=False, default=dict)
    price = serializers.DecimalField(max_digits=12, decimal_places=2)
    stock_qty = serializers.IntegerField(default=0)
    image_url = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError('Price must be greater than 0.')
        return value

    def validate_stock_qty(self, value):
        if value < 0:
            raise serializers.ValidationError('Stock quantity cannot be negative.')
        return value


class EquipmentOrderSerializer(serializers.ModelSerializer):
    hospital_name = serializers.CharField(source='hospital_id.hospital_name', read_only=True)
    # UUIDs of both parties, so the frontend can open a chat directly.
    hospital_id = serializers.UUIDField(source='hospital_id.hospital_id', read_only=True)
    vendor_id = serializers.UUIDField(source='vendor_id.vendor_id', read_only=True)
    vendor_email = serializers.CharField(source='vendor_id.login_id.email', read_only=True)
    vendor_phone = serializers.CharField(source='vendor_id.phone', read_only=True)
    product_name = serializers.CharField(source='product_id.product_name', read_only=True)
    vendor_name = serializers.CharField(source='vendor_id.company_name', read_only=True)

    class Meta:
        model = EquipmentOrder
        fields = [
            'eq_order_id', 'hospital_id', 'hospital_name',
            'vendor_id', 'vendor_name', 'vendor_email', 'vendor_phone',
            'product_name',
            'quantity', 'total_price', 'order_status',
            'payment_status', 'razorpay_order_id', 'tracking_info',
            'estimated_delivery_days', 'otp_expiry',
            'dispatched_at', 'delivered_at', 'status_history',
            'ordered_at', 'updated_at',
        ]


class UpdateOrderStatusSerializer(serializers.Serializer):
    order_status = serializers.ChoiceField(choices=['confirmed', 'dispatched', 'delivered'])
    tracking_info = serializers.CharField(required=False, allow_blank=True, default='')


class VerifyPaymentSerializer(serializers.Serializer):
    razorpay_order_id = serializers.CharField()
    razorpay_payment_id = serializers.CharField()
    razorpay_signature = serializers.CharField()
