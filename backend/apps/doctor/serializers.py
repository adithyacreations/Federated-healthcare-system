from datetime import date, datetime, timedelta
from decimal import Decimal
from django.utils import timezone
from rest_framework import serializers
from .models import DoctorRegistration, DoctorSchedule, DoctorSlot, Consultation, Prescription
from .utils import normalize_working_days


class DoctorProfileSerializer(serializers.ModelSerializer):
    hospital_name = serializers.CharField(source='hospital_id.hospital_name', read_only=True)
    dept_name = serializers.SerializerMethodField()

    class Meta:
        model = DoctorRegistration
        fields = '__all__'

    def get_dept_name(self, obj):
        return obj.dept_id.dept_name if obj.dept_id else None


class DoctorScheduleSerializer(serializers.ModelSerializer):
    hospital_name = serializers.CharField(source='hospital.hospital_name', read_only=True)
    doctor_name = serializers.CharField(source='doctor.full_name', read_only=True)
    specialization = serializers.CharField(source='doctor.specialization', read_only=True)

    class Meta:
        model = DoctorSchedule
        fields = [
            'schedule_id', 'hospital', 'hospital_name', 'doctor', 'doctor_name',
            'specialization', 'working_days', 'start_time', 'end_time',
            'slot_duration_minutes', 'consultation_type', 'consultation_fee',
            'is_active', 'created_at', 'updated_at',
        ]


class DoctorScheduleWriteSerializer(serializers.Serializer):
    doctor_id = serializers.UUIDField()
    working_days = serializers.ListField(
        child=serializers.CharField(max_length=20),
        allow_empty=False,
    )
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()
    slot_duration_minutes = serializers.IntegerField(min_value=1)
    consultation_type = serializers.ChoiceField(choices=['online', 'offline', 'both'])
    consultation_fee = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=Decimal('0'))
    is_active = serializers.BooleanField(required=False, default=True)
    days_ahead = serializers.IntegerField(required=False, min_value=1, max_value=180, default=30)

    def validate_working_days(self, value):
        try:
            return normalize_working_days(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))

    def validate(self, data):
        if data['end_time'] <= data['start_time']:
            raise serializers.ValidationError(
                {'end_time': 'End time must be greater than start time.'}
            )

        hospital = self.context.get('hospital')
        try:
            doctor = DoctorRegistration.objects.get(
                doctor_id=data['doctor_id'],
                approval_status='approved',
            )
        except DoctorRegistration.DoesNotExist:
            raise serializers.ValidationError({'doctor_id': 'Doctor not found.'})

        if hospital and doctor.hospital_id_id != hospital.hospital_id:
            raise serializers.ValidationError(
                {'doctor_id': 'Doctor must belong to the selected hospital.'}
            )

        data['_doctor'] = doctor
        return data


class DoctorSlotSerializer(serializers.ModelSerializer):
    doctor = serializers.UUIDField(source='doctor_id.doctor_id', read_only=True)
    doctor_name = serializers.CharField(source='doctor_id.full_name', read_only=True)
    hospital_name = serializers.CharField(source='hospital.hospital_name', read_only=True)
    schedule_id = serializers.UUIDField(source='schedule.schedule_id', read_only=True)
    date = serializers.DateField(source='slot_date', read_only=True)
    consultation_type = serializers.CharField(source='consult_type', read_only=True)
    availability_status = serializers.CharField(source='status', read_only=True)

    class Meta:
        model = DoctorSlot
        fields = [
            'slot_id', 'doctor_id', 'doctor', 'doctor_name',
            'hospital', 'hospital_name', 'schedule', 'schedule_id',
            'slot_date', 'date', 'start_time', 'end_time',
            'consult_type', 'consultation_type', 'consultation_fee',
            'status', 'availability_status', 'is_booked', 'is_blocked',
            'blocked_by', 'block_reason', 'created_at', 'updated_at',
        ]


class BlockDoctorSlotSerializer(serializers.Serializer):
    block_reason = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        default='Unavailable',
    )


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
        choices=['online', 'offline', 'both', 'in_person'], default='online', required=False
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
