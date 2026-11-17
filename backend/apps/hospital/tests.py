from datetime import time, timedelta
from unittest.mock import patch

from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.auth_app.models import LoginCredentials
from apps.doctor.models import DoctorSchedule, DoctorRegistration, DoctorSlot
from apps.doctor.utils import WEEKDAY_NAMES
from .models import HospitalRegistration


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class DoctorScheduleTests(TestCase):
    url = '/api/hospital/doctor-schedules/'

    def setUp(self):
        self.admin = LoginCredentials.objects.create(
            email='hospital@example.test', role='hospital_admin', is_active=True, is_approved=True,
        )
        hospital = HospitalRegistration.objects.create(
            login_id=self.admin, hospital_name='Test Hospital', registration_no='test-hospital',
            approval_status='approved',
        )
        self.doctor_login = LoginCredentials.objects.create(
            email='doctor@example.test', role='doctor', is_active=True, is_approved=True,
        )
        self.doctor = DoctorRegistration.objects.create(
            login_id=self.doctor_login, hospital_id=hospital, full_name='Test Doctor',
            specialization='General', license_no='test-doctor', approval_status='approved',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self.payload = {
            'doctor_id': str(self.doctor.pk),
            'working_days': WEEKDAY_NAMES,
            'start_time': '09:00',
            'end_time': '17:00',
            'slot_duration_minutes': 30,
            'consultation_type': 'both',
            'consultation_fee': '500.00',
            'days_ahead': 30,
        }

    def test_create_edit_and_read_back_slots_without_per_slot_queries(self):
        with CaptureQueriesContext(connection) as create_queries:
            response = self.client.post(self.url, self.payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertGreater(response.data['data']['slot_generation']['created'], 400)
        self.assertLess(len(create_queries), 70)
        schedule = response.data['data']['schedule']

        day = timezone.localdate() + timedelta(days=1)
        slots = DoctorSlot.objects.filter(schedule_id=schedule['schedule_id'], slot_date=day)
        booked = slots.get(start_time=time(9))
        slots.filter(pk=booked.pk).update(is_booked=True, status='booked')
        blocked = slots.get(start_time=time(10))
        slots.filter(pk=blocked.pk).update(is_blocked=True, status='blocked', block_reason='On leave')

        with CaptureQueriesContext(connection) as edit_queries:
            response = self.client.patch(f"{self.url}{schedule['schedule_id']}/", {
                'start_time': '10:00',
                'consultation_fee': '550.00',
            }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['data']['schedule']['start_time'], '10:00:00')
        self.assertLess(len(edit_queries), 70)
        self.assertEqual(slots.get(pk=booked.pk).status, 'booked')
        self.assertEqual(slots.get(pk=blocked.pk).block_reason, 'On leave')
        self.assertFalse(slots.filter(start_time=time(9, 30)).exists())

        board = self.client.get('/api/hospital/doctor-schedule/', {'date': day.isoformat()})
        self.assertEqual(board.status_code, 200, board.data)
        self.assertEqual(board.data['data'][0]['total_slots'], 15)
        self.client.force_authenticate(user=self.doctor_login)
        doctor_schedules = self.client.get('/api/doctor/schedules/')
        self.assertEqual(doctor_schedules.status_code, 200, doctor_schedules.data)
        self.assertEqual(doctor_schedules.data['data'][0]['start_time'], '10:00:00')

    def test_failed_slot_generation_rolls_back_schedule(self):
        with patch('apps.doctor.utils.generate_slots_for_schedule', side_effect=ValueError('Generation failed')):
            response = self.client.post(self.url, self.payload, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(DoctorSchedule.objects.filter(doctor=self.doctor).exists())
