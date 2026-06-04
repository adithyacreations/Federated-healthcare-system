import re
from datetime import date, datetime

from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from django.contrib.auth.hashers import check_password
from .models import LoginCredentials

# ─── Shared validation helpers (mirror frontend src/utils/validation.js) ───────

NAME_RE = re.compile(r"^[a-zA-Z\s.'-]+$")
PHONE_RE = re.compile(r'^[6-9]\d{9}$')
EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
GST_RE = re.compile(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$')
VEHICLE_RE = re.compile(r'^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$', re.IGNORECASE)
VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']


def validate_name_value(value):
    name = (value or '').strip()
    if len(name) < 3:
        raise serializers.ValidationError('Name must be at least 3 characters')
    if len(name) > 100:
        raise serializers.ValidationError('Name too long')
    if not NAME_RE.match(name):
        raise serializers.ValidationError("Name can only contain letters, spaces and . ' -")
    return name


def validate_phone_value(value):
    cleaned = (value or '').replace(' ', '')
    if not PHONE_RE.match(cleaned):
        raise serializers.ValidationError(
            'Enter valid 10-digit Indian mobile number (starting with 6-9)'
        )
    return cleaned


def validate_strong_password(value):
    if len(value) < 8:
        raise serializers.ValidationError('Password must be at least 8 characters')
    if not re.search(r'[A-Z]', value):
        raise serializers.ValidationError('Password must have at least one uppercase letter')
    if not re.search(r'[a-z]', value):
        raise serializers.ValidationError('Password must have at least one lowercase letter')
    if not re.search(r'[0-9]', value):
        raise serializers.ValidationError('Password must have at least one number')
    return value


def validate_dob_value(value):
    # value is already a date object (DateField). Guard range.
    today = date.today()
    if value > today:
        raise serializers.ValidationError('Date of birth cannot be in the future')
    age = today.year - value.year - ((today.month, today.day) < (value.month, value.day))
    if age < 1 or age > 120:
        raise serializers.ValidationError('Invalid date of birth')
    return value


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        try:
            user = LoginCredentials.objects.get(email=data['email'].lower())
        except LoginCredentials.DoesNotExist:
            raise AuthenticationFailed('Invalid credentials')

        if not check_password(data['password'], user.password_hash):
            raise AuthenticationFailed('Invalid credentials')

        if not user.is_approved:
            raise PermissionDenied('Account pending approval')

        if not user.is_active:
            raise PermissionDenied('Account is deactivated')

        data['user'] = user
        return data


class PatientRegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    full_name = serializers.CharField(max_length=120)
    dob = serializers.DateField()
    gender = serializers.ChoiceField(
        choices=['male', 'female', 'other'], required=False, default=''
    )
    blood_group = serializers.CharField(max_length=5, required=False, default='')
    height_cm = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True, default=None
    )
    weight_kg = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True, default=None
    )
    address = serializers.CharField(required=False, default='')
    emergency_contact = serializers.CharField(max_length=15, required=False, default='')
    phone = serializers.CharField(max_length=15)

    def validate_email(self, value):
        if LoginCredentials.objects.filter(email=value.lower()).exists():
            raise serializers.ValidationError('An account with this email already exists')
        return value.lower()

    def validate_password(self, value):
        return validate_strong_password(value)

    def validate_full_name(self, value):
        return validate_name_value(value)

    def validate_phone(self, value):
        return validate_phone_value(value)

    def validate_dob(self, value):
        return validate_dob_value(value)

    def validate_blood_group(self, value):
        if value and value not in VALID_BLOOD_GROUPS:
            raise serializers.ValidationError('Invalid blood group')
        return value


class HospitalRegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    hospital_name = serializers.CharField(max_length=200)
    registration_no = serializers.CharField(max_length=100)
    address = serializers.CharField()
    city = serializers.CharField(max_length=100)
    state = serializers.CharField(max_length=100, required=False, default='Kerala')
    contact_phone = serializers.CharField(max_length=15, required=False, default='')
    contact_email = serializers.EmailField(required=False, default='')
    latitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, required=False, allow_null=True, default=None
    )
    longitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, required=False, allow_null=True, default=None
    )

    def validate_email(self, value):
        if LoginCredentials.objects.filter(email=value.lower()).exists():
            raise serializers.ValidationError('An account with this email already exists')
        return value.lower()

    def validate_password(self, value):
        return validate_strong_password(value)

    def validate_contact_phone(self, value):
        if value:
            return validate_phone_value(value)
        return value

    def validate_latitude(self, value):
        if value is not None and not (-90 <= float(value) <= 90):
            raise serializers.ValidationError('Latitude must be between -90 and 90')
        return value

    def validate_longitude(self, value):
        if value is not None and not (-180 <= float(value) <= 180):
            raise serializers.ValidationError('Longitude must be between -180 and 180')
        return value

    def validate_registration_no(self, value):
        from apps.hospital.models import HospitalRegistration
        if HospitalRegistration.objects.filter(registration_no=value).exists():
            raise serializers.ValidationError(
                'A hospital with this registration number already exists'
            )
        return value


class PharmacistRegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    pharmacy_name = serializers.CharField(max_length=200)
    license_no = serializers.CharField(max_length=100)
    full_name = serializers.CharField(max_length=120)
    phone = serializers.CharField(max_length=15, required=False, default='')
    address = serializers.CharField(required=False, default='')

    def validate_email(self, value):
        if LoginCredentials.objects.filter(email=value.lower()).exists():
            raise serializers.ValidationError('An account with this email already exists')
        return value.lower()

    def validate_password(self, value):
        return validate_strong_password(value)

    def validate_full_name(self, value):
        return validate_name_value(value)

    def validate_phone(self, value):
        if value:
            return validate_phone_value(value)
        return value

    def validate_license_no(self, value):
        from apps.pharmacy.models import PharmacistRegistration
        if len((value or '').strip()) < 5:
            raise serializers.ValidationError('Enter a valid license number')
        if PharmacistRegistration.objects.filter(license_no=value).exists():
            raise serializers.ValidationError(
                'A pharmacist with this license number already exists'
            )
        return value


class VendorRegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    company_name = serializers.CharField(max_length=200)
    tax_id = serializers.CharField(max_length=50)
    contact_name = serializers.CharField(max_length=120)
    phone = serializers.CharField(max_length=15, required=False, default='')

    def validate_email(self, value):
        if LoginCredentials.objects.filter(email=value.lower()).exists():
            raise serializers.ValidationError('An account with this email already exists')
        return value.lower()

    def validate_password(self, value):
        return validate_strong_password(value)

    def validate_contact_name(self, value):
        return validate_name_value(value)

    def validate_phone(self, value):
        if value:
            return validate_phone_value(value)
        return value

    def validate_tax_id(self, value):
        from apps.vendor.models import VendorRegistration
        # tax_id is the GST number — validate format when it looks like one.
        if value and not GST_RE.match(value.upper()):
            raise serializers.ValidationError('Enter valid GST number (e.g. 32ABCDE1234F1Z5)')
        if VendorRegistration.objects.filter(tax_id=value).exists():
            raise serializers.ValidationError('A vendor with this tax ID already exists')
        return value
