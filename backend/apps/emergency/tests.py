from datetime import date
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.auth_app.models import AuditLog, LoginCredentials, Notification
from apps.hospital.models import HospitalRegistration
from apps.patient.models import PatientRegistration

from .models import Ambulance, AmbulanceDispatch, AmbulanceDriverRegistration, EmergencyRequest
from .views import reject_pending_dispatch


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class EmergencyDispatchResponseTests(TestCase):
    def setUp(self):
        hospital_login = LoginCredentials.objects.create(email='dispatch-hospital@example.test', role='hospital_admin')
        self.hospital = HospitalRegistration.objects.create(
            login_id=hospital_login, hospital_name='Test Dispatch Hospital', registration_no='dispatch-hospital',
        )
        self.driver_login = LoginCredentials.objects.create(email='dispatch-driver@example.test', role='driver')
        self.driver = AmbulanceDriverRegistration.objects.create(
            login_id=self.driver_login, hospital_id=self.hospital, full_name='Test Driver', license_no='DRIVER01',
        )
        self.ambulance = Ambulance.objects.create(
            hospital_id=self.hospital, driver_id=self.driver, vehicle_no='AMB01', is_available=False,
        )
        self.patient_login = LoginCredentials.objects.create(email='dispatch-patient@example.test', role='patient')
        patient = PatientRegistration.objects.create(
            login_id=self.patient_login, full_name='Test Patient', dob=date(1990, 1, 1),
        )
        self.emergency = EmergencyRequest.objects.create(
            patient_id=patient, patient_lat='8.500000', patient_lng='76.900000',
            severity='high', status='dispatched', assigned_hospital_id=self.hospital,
        )
        self.dispatch = AmbulanceDispatch.objects.create(
            emergency_id=self.emergency, ambulance_id=self.ambulance, eta_minutes=8,
        )
        self.url = f'/api/emergency/dispatch/{self.dispatch.pk}/'
        self.client = APIClient()
        self.client.force_authenticate(user=self.driver_login)

    def test_accept_with_optional_driver_join_and_retry(self):
        other_ambulance = Ambulance.objects.create(
            hospital_id=self.hospital, vehicle_no='AMB02', is_available=False,
        )
        other = AmbulanceDispatch.objects.create(emergency_id=self.emergency, ambulance_id=other_ambulance)
        with patch('apps.emergency.views.cancel_dispatch_timer') as cancel_timer:
            accepted = self.client.post(self.url + 'accept/')
            repeated = self.client.post(self.url + 'accept/')
        self.assertEqual(accepted.status_code, 200, accepted.data)
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertEqual(accepted.data['data']['dispatch_status'], 'en_route')
        self.assertEqual(accepted.data['data']['eta_minutes'], 8)
        self.assertEqual(cancel_timer.call_count, 2)

        # A timeout that read the old dispatch before the accept cannot reject it.
        self.assertFalse(reject_pending_dispatch(self.dispatch))
        self.dispatch.refresh_from_db()
        self.driver.refresh_from_db()
        self.ambulance.refresh_from_db()
        other.refresh_from_db()
        other_ambulance.refresh_from_db()
        self.assertEqual(self.dispatch.dispatch_status, 'en_route')
        self.assertIsNotNone(self.dispatch.accepted_at)
        self.assertFalse(self.driver.is_available)
        self.assertFalse(self.ambulance.is_available)
        self.assertEqual(other.dispatch_status, 'cancelled')
        self.assertTrue(other_ambulance.is_available)
        self.assertEqual(Notification.objects.filter(login_id=self.patient_login, title='Ambulance Accepted').count(), 1)
        self.assertEqual(AuditLog.objects.filter(entity_id=self.dispatch.pk, action='Driver accepted dispatch').count(), 1)

    def test_cannot_accept_if_another_driver_has_already_delivered_patient(self):
        other_ambulance = Ambulance.objects.create(hospital_id=self.hospital, vehicle_no='AMB02')
        other = AmbulanceDispatch.objects.create(
            emergency_id=self.emergency, ambulance_id=other_ambulance, dispatch_status='pending_acknowledgment',
        )
        response = self.client.post(self.url + 'accept/')
        self.assertEqual(response.status_code, 409, response.data)
        other.refresh_from_db()
        self.dispatch.refresh_from_db()
        self.assertEqual(other.dispatch_status, 'pending_acknowledgment')
        self.assertEqual(self.dispatch.dispatch_status, 'dispatched')

    def test_reject_still_frees_ambulance_and_reroutes(self):
        with patch('apps.emergency.views.assign_next_ambulance', return_value=None) as reroute:
            response = self.client.post(self.url + 'reject/')
        self.assertEqual(response.status_code, 200, response.data)
        reroute.assert_called_once_with(self.emergency)
        self.dispatch.refresh_from_db()
        self.ambulance.refresh_from_db()
        self.assertEqual(self.dispatch.dispatch_status, 'rejected')
        self.assertTrue(self.ambulance.is_available)
        self.assertEqual(self.client.post(self.url + 'accept/').status_code, 409)

    def test_cancelled_emergency_cannot_be_accepted(self):
        EmergencyRequest.objects.filter(pk=self.emergency.pk).update(status='cancelled')
        response = self.client.post(self.url + 'accept/')
        self.assertEqual(response.status_code, 409, response.data)
        self.dispatch.refresh_from_db()
        self.assertIsNone(self.dispatch.accepted_at)
