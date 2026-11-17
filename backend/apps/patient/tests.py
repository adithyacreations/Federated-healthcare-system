from datetime import datetime, time
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.auth_app.models import LoginCredentials
from apps.doctor.models import Consultation, DoctorRegistration, DoctorSchedule, DoctorSlot
from apps.hospital.models import HospitalRegistration
from .models import PatientRegistration


class OnlineDoctorAvailabilityTests(TestCase):
    def setUp(self):
        self.now = timezone.make_aware(datetime(2030, 6, 10, 10))
        self.clock = patch('django.utils.timezone.now', return_value=self.now)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        hospital_login = LoginCredentials.objects.create(
            email='available-hospital@example.test', role='hospital_admin', is_active=True, is_approved=True,
        )
        hospital = HospitalRegistration.objects.create(
            login_id=hospital_login, hospital_name='Test Hospital', registration_no='available-hospital',
            approval_status='approved',
        )
        self.login = LoginCredentials.objects.create(
            email='available-doctor@example.test', role='doctor', is_active=True, is_approved=True,
        )
        self.doctor = DoctorRegistration.objects.create(
            login_id=self.login, hospital_id=hospital, full_name='Test Doctor',
            license_no='available-doctor', approval_status='approved', is_online=True,
        )
        self.schedule = DoctorSchedule.objects.create(
            doctor=self.doctor, hospital=hospital, working_days=['monday'],
            start_time=time(9), end_time=time(12), slot_duration_minutes=30, consultation_fee=500,
        )
        self.patient_login = LoginCredentials.objects.create(
            email='available-patient@example.test', role='patient', is_active=True, is_approved=True,
        )
        PatientRegistration.objects.create(
            login_id=self.patient_login, full_name='Test Patient', dob='1990-01-01',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.patient_login)

    def doctors(self):
        response = self.client.get('/api/patient/doctors/')
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['data']['doctors']

    def test_only_online_doctor_with_future_slots_today_is_listed(self):
        self.assertEqual(len(self.doctors()), 1)
        self.assertEqual(self.doctors()[0]['available_slots_count'], 3)
        DoctorRegistration.objects.filter(pk=self.doctor.pk).update(is_online=False)
        self.assertEqual(self.doctors(), [])
        slots = self.client.get(f'/api/patient/doctor-slots/{self.doctor.pk}/')
        self.assertEqual(slots.status_code, 200)
        self.assertEqual(slots.data['data']['slots'], [])

    def test_future_working_day_does_not_count_as_available_today(self):
        self.schedule.working_days = ['tuesday']
        self.schedule.save()
        self.assertEqual(self.doctors(), [])

    def test_booked_blocked_and_past_slots_do_not_make_doctor_available(self):
        self.doctors()
        today_slots = DoctorSlot.objects.filter(schedule=self.schedule, slot_date=self.now.date())
        today_slots.filter(start_time=time(10, 30)).update(is_booked=True, status='booked')
        today_slots.filter(start_time__gte=time(11)).update(is_blocked=True, status='blocked', block_reason='Leave')
        self.assertEqual(self.doctors(), [])

    def test_doctor_going_offline_rejects_stale_booking_and_broadcasts_refresh(self):
        self.doctors()
        slot = DoctorSlot.objects.get(schedule=self.schedule, slot_date=self.now.date(), start_time=time(11))
        self.client.force_authenticate(self.login)
        with patch('apps.doctor.views.broadcast_new_slots_to_patients') as broadcast:
            response = self.client.put('/api/doctor/toggle-online/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['data']['is_online'])
        broadcast.assert_called_once_with(doctor_id=self.doctor.pk, availability_changed=True)
        self.client.force_authenticate(self.patient_login)
        response = self.client.post('/api/patient/book-consultation/', {
            'doctor_id': str(self.doctor.pk), 'slot_id': str(slot.pk), 'consult_type': 'online',
        }, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('offline', str(response.data).lower())
        self.assertFalse(Consultation.objects.exists())
        slot.refresh_from_db()
        self.assertFalse(slot.is_booked)
