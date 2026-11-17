from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.hospital.models import HospitalRegistration
from .models import AuditLog, LoginCredentials
from .views import make_tokens


class HospitalDirectoryTests(TestCase):
    def setUp(self):
        self.admin = LoginCredentials.objects.create(
            email='directory-admin@example.test', role='super_admin', is_active=True, is_approved=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def hospital(self, name, *, active=True, approved=True, status='approved'):
        login = LoginCredentials.objects.create(
            email=f'{name}@example.test', role='hospital_admin', is_active=active, is_approved=approved,
        )
        return HospitalRegistration.objects.create(
            login_id=login, hospital_name=name, registration_no=name, approval_status=status,
        )

    def rows(self, client=None):
        response = (client or self.client).get('/api/auth/users/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['data']['total'], len(response.data['data']['hospital_admins']))
        return response.data['data']['hospital_admins']

    def audit(self, hospital, action):
        AuditLog.objects.create(
            login_id=self.admin, action=f'hospital_{action}', entity_type='LoginCredentials',
            entity_id=hospital.login_id_id,
        )

    @patch('email_utils.send_platform_action_email', return_value=True)
    def test_termination_stays_hidden_with_a_new_jwt_session(self, _email):
        active = self.hospital('active')
        removed = self.hospital('removed')
        self.assertEqual(len(self.rows()), 2)
        response = self.client.post(
            f'/api/admin/platform/hospital/{removed.login_id_id}/action/',
            {'action': 'terminate'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        new_session = APIClient()
        access, _ = make_tokens(self.admin)
        new_session.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        self.assertEqual([row['login_id'] for row in self.rows(new_session)], [str(active.login_id_id)])
        self.assertTrue(HospitalRegistration.objects.filter(pk=removed.pk).exists())

    def test_rejected_pending_and_previously_terminated_profiles_are_excluded(self):
        active = self.hospital('active')
        self.hospital('rejected', active=False, approved=False, status='rejected')
        self.hospital('pending', active=False, approved=False, status='pending')
        terminated = self.hospital('old-termination', active=False)
        self.audit(terminated, 'terminate')
        self.assertEqual([row['login_id'] for row in self.rows()], [str(active.login_id_id)])

    @patch('email_utils.send_platform_action_email', return_value=True)
    @patch('apps.auth_app.views.PlatformActionView._send_resume_email', return_value=True)
    def test_suspended_hospitals_remain_resumable(self, _resume, _email):
        hospital = self.hospital('suspended')
        url = f'/api/admin/platform/hospital/{hospital.login_id_id}/action/'
        self.assertEqual(self.client.post(url, {'action': 'suspend'}, format='json').status_code, 200)
        self.assertFalse(self.rows()[0]['is_active'])
        self.assertEqual(self.client.post(url, {'action': 'resume'}, format='json').status_code, 200)
        self.assertTrue(self.rows()[0]['is_active'])

    def test_latest_action_takes_precedence_over_old_termination(self):
        hospital = self.hospital('reactivated')
        self.audit(hospital, 'terminate')
        self.audit(hospital, 'resume')
        self.assertEqual(len(self.rows()), 1)
