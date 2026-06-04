from rest_framework import serializers
from .models import HospitalRegistration, Department, Bed, HospitalInventory


class HospitalProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = HospitalRegistration
        fields = '__all__'


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = '__all__'


class BedSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bed
        fields = ['bed_id', 'bed_type', 'ward_name', 'status', 'updated_at']


class HospitalInventorySerializer(serializers.ModelSerializer):
    is_low_stock = serializers.SerializerMethodField()

    class Meta:
        model = HospitalInventory
        fields = '__all__'

    def get_is_low_stock(self, obj):
        return obj.quantity <= obj.reorder_level


class AddDoctorSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=120)
    specialization = serializers.CharField(max_length=150)
    license_no = serializers.CharField(max_length=100)
    experience_years = serializers.IntegerField(default=0, required=False)
    consultation_fee = serializers.DecimalField(
        max_digits=8, decimal_places=2, default=0, required=False
    )
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=15, required=False, allow_blank=True)

    def validate_email(self, value):
        from apps.auth_app.models import LoginCredentials
        if LoginCredentials.objects.filter(email=value).exists():
            raise serializers.ValidationError('Email already registered.')
        return value

    def validate_license_no(self, value):
        from apps.doctor.models import DoctorRegistration
        if DoctorRegistration.objects.filter(license_no=value).exists():
            raise serializers.ValidationError('License number already exists.')
        return value


class AddLabTechSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=120)
    qualification = serializers.CharField(max_length=150, required=False, allow_blank=True)
    specialization = serializers.CharField(max_length=100, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=15, required=False, allow_blank=True)
    email = serializers.EmailField()

    def validate_email(self, value):
        from apps.auth_app.models import LoginCredentials
        if LoginCredentials.objects.filter(email=value).exists():
            raise serializers.ValidationError('Email already registered.')
        return value


class AddDriverSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=120)
    license_no = serializers.CharField(max_length=50)
    phone = serializers.CharField(max_length=15)
    email = serializers.EmailField()
    vehicle_no = serializers.CharField(max_length=20)
    ambulance_type = serializers.ChoiceField(
        choices=['basic', 'advanced', 'neonatal'], default='basic', required=False
    )

    def validate_email(self, value):
        from apps.auth_app.models import LoginCredentials
        if LoginCredentials.objects.filter(email=value).exists():
            raise serializers.ValidationError('Email already registered.')
        return value

    def validate_license_no(self, value):
        from apps.emergency.models import AmbulanceDriverRegistration
        if AmbulanceDriverRegistration.objects.filter(license_no=value).exists():
            raise serializers.ValidationError('Driver license already registered.')
        return value

    def validate_vehicle_no(self, value):
        from apps.emergency.models import Ambulance
        if Ambulance.objects.filter(vehicle_no=value).exists():
            raise serializers.ValidationError('Vehicle number already registered.')
        return value
