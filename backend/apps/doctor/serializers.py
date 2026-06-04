from datetime import date, datetime, timedelta
from django.utils import timezone
from rest_framework import serializers
from .models import DoctorRegistration, DoctorSlot, Consultation, Prescription


class DoctorProfileSerializer(serializers.ModelSerializer):
    hospital_name = serializers.CharField(source='hospital_id.hospital_name', read_only=True)
    dept_name = serializers.SerializerMethodField()

    class Meta:
        model = DoctorRegistration
        fields = '__all__'

    def get_dept_name(self, obj):
        return obj.dept_id.dept_name if obj.dept_id else None


class DoctorSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorSlot
        fields = '__all__'


class ConsultationSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient_id.full_name', read_only=True)
    doctor_name = serializers.CharField(source='doctor_id.full_name', read_only=True)
    patient_uuid = serializers.UUIDField(source='patient_id.patient_id', read_only=True)
    doctor_uuid = serializers.UUIDField(source='doctor_id.doctor_id', read_only=True)
    slot_date = serializers.SerializerMethodField()
    slot_time = serializers.SerializerMethodField()
    start_time = serializers.SerializerMethodField()
    end_time = serializers.SerializerMethodField()
    consult_type = serializers.SerializerMethodField()
    blood_group = serializers.CharField(source='patient_id.blood_group', read_only=True)
    gender = serializers.CharField(source='patient_id.gender', read_only=True)
    patient_age = serializers.SerializerMethodField()

    class Meta:
        model = Consultation
        fields = [
            'consultation_id', 'patient_name', 'doctor_name',
            'patient_uuid', 'doctor_uuid',
            'slot_date', 'slot_time', 'start_time', 'end_time',
            'consult_type', 'consult_mode', 'jitsi_room_id', 'status',
            'ai_suggestions', 'doctor_notes', 'final_diagnosis',
            'blood_group', 'gender', 'patient_age',
            'payment_status', 'razorpay_order_id', 'started_at', 'created_at',
        ]

    # ── Date / time: from the slot when online, else derived from started_at
    #    (offline physical visits have no slot) so the UI always has both times.
    def get_slot_date(self, obj):
        if obj.slot_id:
            return obj.slot_id.slot_date.isoformat()
        if obj.started_at:
            return obj.started_at.date().isoformat()
        return None

    def get_start_time(self, obj):
        if obj.slot_id:
            return obj.slot_id.start_time.strftime('%H:%M')
        if obj.started_at:
            return obj.started_at.strftime('%H:%M')
        return ''

    def get_end_time(self, obj):
        if obj.slot_id:
            return obj.slot_id.end_time.strftime('%H:%M')
        if obj.started_at:
            # Physical visits have no slot — give them a 2-hour window.
            return (obj.started_at + timedelta(hours=2)).strftime('%H:%M')
        return ''

    def get_slot_time(self, obj):
        # Back-compat alias for the patient pages (start time only).
        return self.get_start_time(obj)

    def get_consult_type(self, obj):
        return obj.slot_id.consult_type if obj.slot_id else 'online'

    def get_patient_age(self, obj):
        dob = getattr(obj.patient_id, 'dob', None)
        if not dob:
            return None
        return date.today().year - dob.year - (
            (date.today().month, date.today().day) < (dob.month, dob.day)
        )


class PrescriptionSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient_id.full_name', read_only=True)
    doctor_name = serializers.CharField(source='doctor_id.full_name', read_only=True)

    class Meta:
        model = Prescription
        fields = [
            'prescription_id', 'patient_name', 'doctor_name',
            'medicines', 'diagnosis', 'instructions',
            'valid_until', 'pdf_url', 'is_verified', 'created_at',
        ]


class CreateSlotSerializer(serializers.Serializer):
    slot_date = serializers.DateField()
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()
    consult_type = serializers.ChoiceField(
        choices=['online', 'in_person'], default='online', required=False
    )

    def validate_slot_date(self, value):
        if value < date.today():
            raise serializers.ValidationError('Slot date cannot be in the past.')
        return value

    def validate(self, data):
        slot_date = data['slot_date']
        start_time = data['start_time']
        end_time = data['end_time']

        if end_time <= start_time:
            raise serializers.ValidationError(
                {'end_time': 'End time must be after start time.'}
            )

        # Block past times when the slot is for today.
        if slot_date == date.today():
            now = timezone.localtime(timezone.now()).time()
            if start_time <= now:
                raise serializers.ValidationError(
                    {'start_time': (
                        'Cannot create slot for a past time! '
                        f'Current time is {now.strftime("%I:%M %p")}.'
                    )}
                )

        # Enforce duration bounds: at least 15 minutes, at most 2 hours.
        start_dt = datetime.combine(slot_date, start_time)
        end_dt = datetime.combine(slot_date, end_time)
        duration_minutes = int((end_dt - start_dt).total_seconds() // 60)

        if duration_minutes > 120:
            raise serializers.ValidationError(
                {'end_time': (
                    'Slot duration cannot exceed 2 hours! '
                    f'Current duration: {duration_minutes} minutes.'
                )}
            )
        if duration_minutes < 15:
            raise serializers.ValidationError(
                {'end_time': 'Slot duration must be at least 15 minutes!'}
            )

        return data


class CreatePrescriptionSerializer(serializers.Serializer):
    consultation_id = serializers.UUIDField()
    medicines = serializers.ListField(child=serializers.DictField(), min_length=1)
    diagnosis = serializers.CharField(required=False, allow_blank=True, default='')
    instructions = serializers.CharField(required=False, allow_blank=True, default='')
    valid_until = serializers.DateField(required=False, allow_null=True)

    def validate_medicines(self, value):
        for med in value:
            if 'name' not in med:
                raise serializers.ValidationError(
                    'Each medicine entry must include a name.'
                )
        return value

    def validate(self, data):
        from apps.doctor.models import Consultation

        doctor = self.context.get('doctor')
        try:
            consultation = Consultation.objects.select_related(
                'doctor_id', 'patient_id'
            ).get(consultation_id=data['consultation_id'])
        except Consultation.DoesNotExist:
            raise serializers.ValidationError(
                {'consultation_id': 'Consultation not found.'}
            )
        if doctor and str(consultation.doctor_id.doctor_id) != str(doctor.doctor_id):
            raise serializers.ValidationError(
                {'consultation_id': 'This consultation does not belong to you.'}
            )
        if consultation.status not in ('ongoing', 'completed'):
            raise serializers.ValidationError(
                {'consultation_id': 'Prescription can only be written for ongoing or completed consultations.'}
            )
        data['_consultation'] = consultation
        return data


class CreateLabOrderSerializer(serializers.Serializer):
    patient_id = serializers.UUIDField()
    tests_ordered = serializers.ListField(child=serializers.CharField(), min_length=1)
    priority = serializers.ChoiceField(
        choices=['normal', 'urgent', 'stat'], default='normal', required=False
    )
    notes = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_patient_id(self, value):
        from apps.patient.models import PatientRegistration
        try:
            PatientRegistration.objects.get(patient_id=value)
        except PatientRegistration.DoesNotExist:
            raise serializers.ValidationError('Patient not found.')
        return value
