from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.auth_app.models import LoginCredentials
from apps.hospital.models import HospitalRegistration

from .models import FLGlobalModel, FLHospitalWeight, FLRound


class FLHospitalEligibilityTests(TestCase):
    def setUp(self):
        self.admin = LoginCredentials.objects.create(
            email='fl-admin@example.test', role='super_admin', is_active=True, is_approved=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self.active_hospitals = [self.make_hospital('active-1'), self.make_hospital('active-2')]
        self.disabled_hospitals = [
            self.make_hospital('terminated-1', is_active=False),
            self.make_hospital('terminated-2', is_active=False),
        ]
        self.make_hospital('unapproved-login', is_approved=False)
        self.make_hospital('pending-profile', approval_status='pending')

    def make_hospital(self, name, *, is_active=True, is_approved=True, approval_status='approved'):
        login = LoginCredentials.objects.create(
            email=f'{name}@example.test', role='hospital_admin', is_active=is_active, is_approved=is_approved,
        )
        return HospitalRegistration.objects.create(
            login_id=login, hospital_name=name, registration_no=name, approval_status=approval_status,
        )

    def dashboard_count(self, client):
        response = client.get('/api/federated/dashboard/')
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['data']['participating_hospitals']

    @patch('email_utils.send_platform_action_email', return_value=True)
    def test_dashboard_reflects_termination_in_a_new_session(self, _email):
        self.assertEqual(self.dashboard_count(self.client), 2)
        hospital = self.active_hospitals[0]
        response = self.client.post(
            f'/api/admin/platform/hospital/{hospital.login_id_id}/action/',
            {'action': 'terminate'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        hospital.refresh_from_db()
        self.assertEqual(hospital.approval_status, 'approved')
        reconnected = APIClient()
        reconnected.force_authenticate(user=self.admin)
        self.assertEqual(self.dashboard_count(reconnected), 1)

    @patch('apps.federated.views.broadcast_fl_update')
    @patch('apps.federated.views.send_notification')
    def test_new_round_invites_only_eligible_hospitals(self, notify, _broadcast):
        FLGlobalModel.objects.create(version='1', is_active=True)

        response = self.client.post('/api/federated/start-round/')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['data']['round']['hospitals_invited'], 2)
        self.assertEqual(response.data['data']['min_threshold'], 2)
        self.assertCountEqual(
            [entry.args[0].pk for entry in notify.call_args_list],
            [h.login_id_id for h in self.active_hospitals],
        )

    @patch('email_utils.send_fl_reminder_email')
    @patch('apps.federated.views.send_notification')
    def test_pending_and_reminders_exclude_inactive_hospitals_and_keep_past_weights(self, notify, email):
        model = FLGlobalModel.objects.create(version='1', is_active=True)
        round_obj = FLRound.objects.create(
            model_id=model, round_number=1, status='training', hospitals_invited=4, hospitals_completed=1,
        )
        FLHospitalWeight.objects.create(round_id=round_obj, hospital_id=self.active_hospitals[0])
        completed_round = FLRound.objects.create(model_id=model, round_number=2, status='completed', hospitals_invited=4)
        past = FLHospitalWeight.objects.create(round_id=completed_round, hospital_id=self.disabled_hospitals[0])

        pending = self.client.get(f'/api/federated/rounds/{round_obj.pk}/').data['data']
        self.assertEqual(pending['pending_count'], 1)
        self.assertEqual(pending['pending_hospitals'][0]['hospital_id'], str(self.active_hospitals[1].pk))
        reminded = self.client.post('/api/federated/send-reminder/')
        self.assertEqual(reminded.status_code, 200, reminded.data)
        self.assertEqual(reminded.data['data']['pending_hospitals'], [self.active_hospitals[1].hospital_name])
        self.assertEqual(notify.call_args.args[0].pk, self.active_hospitals[1].login_id_id)
        email.assert_called_once()

        history = self.client.get(f'/api/federated/rounds/{completed_round.pk}/').data['data']
        self.assertEqual(history['round']['hospitals_invited'], 4)
        self.assertEqual(history['submissions'][0]['weight_id'], str(past.pk))
