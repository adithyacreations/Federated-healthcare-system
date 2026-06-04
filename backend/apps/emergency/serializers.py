from rest_framework import serializers
from .models import (
    AmbulanceDriverRegistration,
    Ambulance,
    EmergencyRequest,
    AmbulanceDispatch,
)


class DriverProfileSerializer(serializers.ModelSerializer):
    hospital_name = serializers.CharField(source='hospital_id.hospital_name', read_only=True)

    class Meta:
        model = AmbulanceDriverRegistration
        fields = '__all__'


class AmbulanceSerializer(serializers.ModelSerializer):
    driver_name = serializers.SerializerMethodField()

    class Meta:
        model = Ambulance
        fields = [
            'ambulance_id', 'vehicle_no', 'ambulance_type',
            'equipment_list', 'is_available',
            'current_lat', 'current_lng',
            'driver_name', 'updated_at',
        ]

    def get_driver_name(self, obj):
        return obj.driver_id.full_name if obj.driver_id else None


class EmergencyRequestSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient_id.full_name', read_only=True)
    assigned_hospital = serializers.SerializerMethodField()
    assigned_bed = serializers.SerializerMethodField()

    class Meta:
        model = EmergencyRequest
        fields = [
            'emergency_id', 'patient_name',
            'patient_lat', 'patient_lng',
            'severity', 'status',
            'assigned_hospital', 'assigned_bed',
            'created_at', 'updated_at',
        ]

    def get_assigned_hospital(self, obj):
        return obj.assigned_hospital_id.hospital_name if obj.assigned_hospital_id else None

    def get_assigned_bed(self, obj):
        if not obj.assigned_bed_id:
            return None
        try:
            bed = obj.assigned_bed_id
            return {
                'bed_id': str(bed.bed_id),
                'bed_type': bed.bed_type,
                'ward_name': bed.ward_name or '',
                'status': bed.status,
            }
        except Exception as e:
            print(f"Bed serializer error: {e}")
            return None


class DispatchSerializer(serializers.ModelSerializer):
    emergency = EmergencyRequestSerializer(source='emergency_id', read_only=True)
    ambulance = AmbulanceSerializer(source='ambulance_id', read_only=True)
    hospital_name = serializers.SerializerMethodField()

    class Meta:
        model = AmbulanceDispatch
        fields = [
            'dispatch_id', 'dispatch_status', 'eta_minutes',
            'route_data', 'dispatched_at', 'arrived_at', 'completed_at',
            'emergency', 'ambulance', 'hospital_name',
        ]

    def get_hospital_name(self, obj):
        # Prefer the receiving (assigned) hospital; fall back to the ambulance's
        # home hospital so history always shows a name.
        try:
            if obj.emergency_id and obj.emergency_id.assigned_hospital_id:
                return obj.emergency_id.assigned_hospital_id.hospital_name
            if obj.ambulance_id and obj.ambulance_id.hospital_id:
                return obj.ambulance_id.hospital_id.hospital_name
        except Exception:
            pass
        return 'Unknown Hospital'


class UpdateDispatchStatusSerializer(serializers.Serializer):
    dispatch_status = serializers.ChoiceField(choices=['en_route', 'arrived', 'completed'])


class UpdateGPSSerializer(serializers.Serializer):
    current_lat = serializers.DecimalField(max_digits=9, decimal_places=6)
    current_lng = serializers.DecimalField(max_digits=9, decimal_places=6)

    def validate_current_lat(self, value):
        if not (-90 <= float(value) <= 90):
            raise serializers.ValidationError('Latitude must be between -90 and 90.')
        return value

    def validate_current_lng(self, value):
        if not (-180 <= float(value) <= 180):
            raise serializers.ValidationError('Longitude must be between -180 and 180.')
        return value
