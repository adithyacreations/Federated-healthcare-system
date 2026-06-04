from rest_framework import serializers
from .models import PatientRegistration, EHRRecord, Allergy, EHRConsentLog, RiskAssessment


class PatientProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = PatientRegistration
        fields = '__all__'


class EHRRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = EHRRecord
        fields = ['record_id', 'record_type', 'title', 'content', 'file_url', 'recorded_at']


class AllergySerializer(serializers.ModelSerializer):
    class Meta:
        model = Allergy
        fields = '__all__'


class EHRConsentLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = EHRConsentLog
        fields = '__all__'


class RiskAssessmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RiskAssessment
        fields = '__all__'


class BookConsultationSerializer(serializers.Serializer):
    doctor_id = serializers.UUIDField()
    slot_id = serializers.UUIDField()
    consult_type = serializers.ChoiceField(
        choices=['online', 'in_person'], default='online', required=False
    )

    def validate(self, data):
        from apps.doctor.models import DoctorRegistration, DoctorSlot

        try:
            doctor = DoctorRegistration.objects.get(
                doctor_id=data['doctor_id'], approval_status='approved'
            )
        except DoctorRegistration.DoesNotExist:
            raise serializers.ValidationError(
                {'doctor_id': 'Doctor not found or not approved.'}
            )

        try:
            slot = DoctorSlot.objects.select_related('doctor_id').get(
                slot_id=data['slot_id'], is_booked=False
            )
        except DoctorSlot.DoesNotExist:
            raise serializers.ValidationError(
                {'slot_id': 'Slot not found or already booked.'}
            )

        if str(slot.doctor_id.doctor_id) != str(data['doctor_id']):
            raise serializers.ValidationError(
                {'slot_id': 'Slot does not belong to this doctor.'}
            )

        data['_doctor'] = doctor
        data['_slot'] = slot
        return data


class EmergencyRequestSerializer(serializers.Serializer):
    patient_lat = serializers.DecimalField(max_digits=9, decimal_places=6)
    patient_lng = serializers.DecimalField(max_digits=9, decimal_places=6)
    severity = serializers.ChoiceField(choices=['critical', 'high', 'moderate', 'low'])

    def validate_patient_lat(self, value):
        if not (-90 <= float(value) <= 90):
            raise serializers.ValidationError('Latitude must be between -90 and 90.')
        return value

    def validate_patient_lng(self, value):
        if not (-180 <= float(value) <= 180):
            raise serializers.ValidationError('Longitude must be between -180 and 180.')
        return value


class MedicineOrderSerializer(serializers.Serializer):
    pharmacist_id = serializers.UUIDField()
    medicines = serializers.ListField(child=serializers.DictField(), min_length=1)
    delivery_address = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_pharmacist_id(self, value):
        from apps.pharmacy.models import PharmacistRegistration
        try:
            PharmacistRegistration.objects.get(pharmacist_id=value, approval_status='approved')
        except PharmacistRegistration.DoesNotExist:
            raise serializers.ValidationError('Pharmacist not found or not approved.')
        return value

    def validate_medicines(self, value):
        for med in value:
            if not all(k in med for k in ['name', 'qty', 'price']):
                raise serializers.ValidationError(
                    'Each medicine must have name, qty, and price.'
                )
        return value
