from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.auth_app.models import LoginCredentials
from apps.auth_app.views import make_tokens
from apps.patient.models import EHRConsentLog, EHRImage, PatientRegistration


class SecurityControlsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()
        self.login = LoginCredentials.objects.create(
            email='patient@example.test', role='patient', is_active=True, is_approved=True,
        )
        self.patient = PatientRegistration.objects.create(
            login_id=self.login, full_name='Example Patient', dob='1990-01-01',
        )

    def test_suspension_blocks_access_and_refresh(self):
        access, refresh = make_tokens(self.login)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        self.assertEqual(self.client.get('/api/auth/profile/').status_code, 200)
        self.assertEqual(self.client.post(
            '/api/auth/token/refresh/', {'refresh': refresh}, format='json',
        ).status_code, 200)
        self.login.set_account_active(False)
        self.assertEqual(self.client.get('/api/auth/profile/').status_code, 401)
        self.assertEqual(self.client.post(
            '/api/auth/token/refresh/', {'refresh': refresh}, format='json',
        ).status_code, 401)
        self.login.set_account_active(True)
        self.login.refresh_from_db()
        self.assertEqual(self.client.get('/api/auth/profile/').status_code, 401)
        new_access, _ = make_tokens(self.login)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {new_access}')
        self.assertEqual(self.client.get('/api/auth/profile/').status_code, 200)
        self.login.set_password('New-account-password-1')
        self.login.save(update_fields=['password_hash'])
        self.assertEqual(self.client.get('/api/auth/profile/').status_code, 401)

    def test_login_limits_attempts_by_normalized_email(self):
        path = '/api/auth/login/'
        for _ in range(10):
            self.assertEqual(self.client.post(
                path, {'email': self.login.email, 'password': 'wrong-password'}, format='json',
            ).status_code, 401)
        self.assertEqual(self.client.post(
            path, {'email': self.login.email.upper(), 'password': 'wrong-password'}, format='json',
        ).status_code, 429)

    def test_password_verification_is_limited_across_both_entry_points(self):
        payload = {'email': self.login.email, 'otp': '111111', 'new_password': 'Example-new-4'}
        cache.set(f'password_reset_otp_{self.login.email}', '123456', timeout=600)
        for _ in range(5):
            self.assertEqual(self.client.post(
                '/api/auth/password-reset/verify/', payload, format='json',
            ).status_code, 400)
        self.client.force_authenticate(self.login)
        self.assertEqual(self.client.post(
            '/api/auth/password-reset/authenticated/',
            {**payload, 'action': 'verify_and_reset'}, format='json',
        ).status_code, 429)

    @patch('apps.ai_engine.views._call_gemini', return_value=('Example summary', None))
    def test_health_summary_uses_only_callers_record_and_omits_name(self, provider):
        self.client.force_authenticate(self.login)
        path = '/api/ai/health-summary/'
        self.assertEqual(self.client.post(
            path, {'patient_id': str(self.login.pk)}, format='json',
        ).status_code, 404)
        provider.assert_not_called()
        response = self.client.post(path, {'patient_id': str(self.patient.pk)}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('Example Patient', str(provider.call_args))
        self.assertIn('no-store', response.headers['Cache-Control'])

    def test_private_media_requires_authorized_link_even_with_debug_disabled(self):
        url = '/media/ehr_images/test.png'
        EHRImage.objects.create(patient_id=self.patient, image_url=url, title='Test image')
        with TemporaryDirectory() as folder, override_settings(DEBUG=False, MEDIA_ROOT=Path(folder)):
            file = Path(folder) / 'ehr_images' / 'test.png'
            file.parent.mkdir()
            file.write_bytes(b'test data')

            self.assertEqual(self.client.get(url).status_code, 404)
            self.client.force_authenticate(self.login)
            images = self.client.get('/api/patient/ehr/images/').json()['data']['images']
            link = urlsplit(images[0]['image_url'])
            signed_url = f'{link.path}?{link.query}'
            self.client.force_authenticate(None)
            response = self.client.get(signed_url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(b''.join(response.streaming_content), b'test data')
            self.assertIn('no-store', response.headers['Cache-Control'])
            response.close()

            self.login.set_account_active(False)
            self.assertEqual(self.client.get(signed_url).status_code, 404)
            self.login.set_account_active(True)
            self.assertEqual(self.client.get(signed_url).status_code, 404)

            doctor = LoginCredentials.objects.create(
                email='doctor@example.test', role='doctor', is_active=True, is_approved=True,
            )
            self.client.force_authenticate(doctor)
            list_url = f'/api/patient/ehr/images/?patient_id={self.patient.pk}'
            self.assertEqual(self.client.get(list_url).status_code, 403)
            consent = EHRConsentLog.objects.create(
                patient_id=self.patient, accessed_by=doctor, consent_given=True,
                expires_at=timezone.now() + timedelta(minutes=5),
            )
            images = self.client.get(list_url).json()['data']['images']
            link = urlsplit(images[0]['image_url'])
            signed_url = f'{link.path}?{link.query}'
            response = self.client.get(signed_url)
            self.assertEqual(response.status_code, 200)
            response.close()
            consent.delete()
            self.assertEqual(self.client.get(signed_url).status_code, 404)
