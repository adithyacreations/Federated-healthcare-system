from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.auth_app.models import LoginCredentials
from apps.patient.models import PatientRegistration


class PatientMeasurementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.payload = {
            'email': 'demo-registration@example.test',
            'full_name': 'Demo Patient',
            'password': 'ExamplePassword9',
            'dob': '1995-05-08',
            'phone': '9876543210',
        }

    def register(self, **measurements):
        return self.client.post(
            '/api/auth/register/patient/', {**self.payload, **measurements}, format='json',
        )

    def test_measurements_outside_limits_cannot_create_account(self):
        for field, value in (
            ('height_cm', '39.99'),
            ('height_cm', '275.01'),
            ('weight_kg', '0'),
            ('weight_kg', '-5'),
            ('weight_kg', '650.01'),
        ):
            with self.subTest(field=field, value=value):
                response = self.register(**{field: value})
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data['errors'])
        self.assertFalse(LoginCredentials.objects.filter(email=self.payload['email']).exists())

    @patch('apps.auth_app.views.generate_qr_code', return_value='')
    def test_measurements_are_optional(self, _qr):
        self.assertEqual(self.register().status_code, 201)
        patient = PatientRegistration.objects.get(login_id__email=self.payload['email'])
        self.assertIsNone(patient.height_cm)
        self.assertIsNone(patient.weight_kg)
        self.assertIsNone(patient.bmi)

    @patch('apps.auth_app.views.generate_qr_code', return_value='')
    def test_valid_measurements_are_saved_even_if_bmi_is_too_large_to_store(self, _qr):
        self.assertEqual(self.register(height_cm='40', weight_kg='650').status_code, 201)
        patient = PatientRegistration.objects.get(login_id__email=self.payload['email'])
        self.assertEqual(patient.height_cm, Decimal('40'))
        self.assertEqual(patient.weight_kg, Decimal('650'))
        self.assertIsNone(patient.bmi)
