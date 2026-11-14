import os
from io import StringIO
from secrets import token_urlsafe
from unittest.mock import patch

from django.contrib.auth.hashers import check_password
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from .models import LoginCredentials, SuperAdmin


class PlatformAdminBootstrapTests(TestCase):
    def setUp(self):
        self.email = 'platform@example.test'
        self.password = token_urlsafe(24)
        self.env = {
            'FEDERCARE_ADMIN_EMAIL': self.email.upper(),
            'FEDERCARE_ADMIN_PASSWORD': self.password,
        }

    def bootstrap(self, **overrides):
        with patch.dict(os.environ, {**self.env, **overrides}):
            call_command('bootstrap_platform_admin', stdout=StringIO())

    def test_bootstrap_preserves_existing_password_and_creates_one_profile(self):
        self.bootstrap()
        admin = LoginCredentials.objects.get(email=self.email)
        original_hash = admin.password_hash
        self.assertTrue(check_password(self.password, original_hash))
        self.assertTrue(admin.is_active and admin.is_approved)
        self.assertFalse(admin.force_password_change)
        self.assertIsNone(admin.temp_password)
        self.bootstrap(FEDERCARE_ADMIN_PASSWORD=token_urlsafe(24))
        admin.refresh_from_db()
        self.assertEqual(admin.password_hash, original_hash)
        self.assertEqual(SuperAdmin.objects.filter(login_id=admin).count(), 1)
        with self.assertRaises(CommandError):
            self.bootstrap(FEDERCARE_ADMIN_EMAIL='other-admin@example.test')
        self.assertEqual(LoginCredentials.objects.filter(role='super_admin').count(), 1)

    def test_rejects_conflicts_and_missing_password(self):
        with self.assertRaises(CommandError):
            self.bootstrap(FEDERCARE_ADMIN_PASSWORD='')
        LoginCredentials.objects.create(email=self.email, role='patient')
        with self.assertRaises(CommandError):
            self.bootstrap()
        self.assertEqual(LoginCredentials.objects.get(email=self.email).role, 'patient')
        self.assertFalse(SuperAdmin.objects.exists())

    def test_refuses_to_run_with_pending_migrations(self):
        path = 'apps.auth_app.management.commands.bootstrap_platform_admin.MigrationExecutor'
        with patch(path) as executor:
            executor.return_value.migration_plan.return_value = [object()]
            with self.assertRaises(CommandError):
                self.bootstrap()
        self.assertFalse(LoginCredentials.objects.exists())

    def test_admin_and_patient_login_claims_and_permissions(self):
        self.bootstrap()
        patient = LoginCredentials(
            email='patient@example.test', role='patient', is_active=True, is_approved=True,
        )
        patient.set_password(self.password)
        patient.save()
        client = APIClient()

        for email, role, admin_status in (
            (self.email, 'super_admin', 200),
            (patient.email, 'patient', 403),
        ):
            client.credentials()
            response = client.post('/api/auth/login/', {'email': email, 'password': self.password}, format='json')
            self.assertEqual(response.status_code, 200)
            data = response.data['data']
            self.assertEqual(data['role'], role)
            for token in (AccessToken(data['access_token']), RefreshToken(data['refresh_token'])):
                self.assertEqual(token['role'], role)
                self.assertEqual(token['login_id'], data['login_id'])
            client.credentials(HTTP_AUTHORIZATION='Bearer ' + data['access_token'])
            self.assertEqual(client.get('/api/auth/profile/').data['data']['role'], role)
            self.assertEqual(client.get('/api/auth/users/').status_code, admin_status)

        client.credentials()
        self.assertEqual(client.post('/api/auth/login/', {
            'email': self.email, 'password': token_urlsafe(24),
        }, format='json').status_code, 401)
