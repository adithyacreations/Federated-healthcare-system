from rest_framework import serializers

# Must stay in sync with payment_utils.PAYMENT_TYPES — a missing entry here
# makes VerifyPaymentView reject the request with a 400 before the payment
# is ever applied, leaving the order stuck on payment_status='pending'.
PAYMENT_TYPE_CHOICES = ('consultation', 'medicine', 'lab', 'lab_test', 'equipment')


class CreateOrderSerializer(serializers.Serializer):
    payment_type = serializers.ChoiceField(choices=PAYMENT_TYPE_CHOICES)
    object_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0.01)


class VerifyPaymentSerializer(serializers.Serializer):
    razorpay_order_id = serializers.CharField(max_length=100)
    razorpay_payment_id = serializers.CharField(max_length=100)
    razorpay_signature = serializers.CharField(max_length=200)
    payment_type = serializers.ChoiceField(choices=PAYMENT_TYPE_CHOICES)
    object_id = serializers.UUIDField()


class RefundRequestSerializer(serializers.Serializer):
    payment_type = serializers.ChoiceField(choices=PAYMENT_TYPE_CHOICES)
    object_id = serializers.UUIDField()
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')
