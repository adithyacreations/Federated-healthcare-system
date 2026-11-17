from datetime import time, timedelta

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.auth_app.models import LoginCredentials
from apps.hospital.models import HospitalRegistration
from .models import HospitalLabConfig, LabSlot, LabTechRegistration, LabTestSlotRule


class LabAvailabilityTests(TestCase):
    def setUp(self):
        self.admin = LoginCredentials.objects.create(email='lab-admin@example.test', role='hospital_admin')
        self.patient = LoginCredentials.objects.create(email='lab-patient@example.test', role='patient')
        self.hospital = HospitalRegistration.objects.create(
            login_id=self.admin, hospital_name='Test Hospital', registration_no='lab-test-hospital',
            approval_status='approved',
        )
        self.day = timezone.localdate() + timedelta(days=1)
        self.client = APIClient()
        self.settings_url = '/api/hospital/lab-config/'
        self.slots_url = '/api/lab/slots/'
        self.payload = {
            'working_days': list(range(7)),
            'start_time': '08:00', 'end_time': '18:00',
            'lunch_break_start': '13:00', 'lunch_break_end': '14:00',
            'slot_duration_minutes': 30, 'max_patients_per_slot': 5,
        }

    def test_save_batches_month_of_slots_and_keeps_existing_slot_state(self):
        self.client.force_authenticate(user=self.admin)
        with CaptureQueriesContext(connection) as queries:
            saved = self.client.put(self.settings_url, self.payload, format='json')
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertLess(len(queries), 30)
        slots = LabSlot.objects.filter(hospital_id=self.hospital)
        self.assertEqual(slots.count(), 540)
        self.assertFalse(slots.filter(slot_date=self.day, start_time=time(13)).exists())
        slot = slots.get(slot_date=self.day, start_time=time(8))
        slots.filter(pk=slot.pk).update(booked_count=2, is_blocked=True, block_reason='Maintenance')
        repeated = self.client.put(self.settings_url, self.payload, format='json')
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertEqual(slots.count(), 540)
        slot.refresh_from_db()
        self.assertEqual(slot.booked_count, 2)
        self.assertTrue(slot.is_blocked)
        self.assertEqual(slot.block_reason, 'Maintenance')

        self.client.force_authenticate(user=self.patient)
        listing = self.client.get(self.slots_url, {
            'hospital_id': self.hospital.pk, 'date': self.day.isoformat(),
        })
        self.assertEqual(listing.status_code, 200, listing.data)
        self.assertEqual(listing.data['data'][0]['status'], 'blocked')

    def test_patient_loads_only_requested_day_and_keeps_test_restrictions(self):
        HospitalLabConfig.objects.create(hospital_id=self.hospital, working_days=list(range(7)))
        LabTestSlotRule.objects.filter(test_name_keyword__icontains='sugar').delete()
        LabTestSlotRule.objects.create(
            test_name_keyword='Blood Sugar Fasting', time_restriction='morning',
            allowed_start=time(8), allowed_end=time(9), requires_fasting=True,
        )
        self.client.force_authenticate(user=self.patient)
        params = {'hospital_id': self.hospital.pk, 'date': self.day.isoformat(), 'test_ids': 'sugar_fasting'}
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(self.slots_url, params)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertLess(len(queries), 12)
        self.assertTrue(response.data['fasting_required'])
        self.assertEqual([slot['start_time'] for slot in response.data['data']], ['08:00', '08:30', '09:00'])
        self.assertEqual(set(LabSlot.objects.values_list('slot_date', flat=True)), {self.day})
        with CaptureQueriesContext(connection) as repeat_queries:
            self.client.get(self.slots_url, params)
        self.assertFalse(any(query['sql'].lstrip().upper().startswith('INSERT') for query in repeat_queries))

    def test_hospital_list_reports_availability_without_queries_per_hospital(self):
        HospitalLabConfig.objects.create(hospital_id=self.hospital)
        tech = LoginCredentials.objects.create(email='lab-tech@example.test', role='lab_tech')
        LabTechRegistration.objects.create(
            login_id=tech, hospital_id=self.hospital, full_name='Lab Tech', approval_status='approved',
        )
        LabSlot.objects.create(
            hospital_id=self.hospital, slot_date=self.day, start_time=time(8), end_time=time(8, 30),
            max_patients=2, booked_count=2,
        )
        for index in range(7):
            login = LoginCredentials.objects.create(email=f'other-lab-{index}@example.test', role='hospital_admin')
            HospitalRegistration.objects.create(
                login_id=login, hospital_name=f'Other Hospital {index}', registration_no=f'other-lab-{index}',
                approval_status='approved',
            )
        self.client.force_authenticate(user=self.patient)
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get('/api/patient/hospitals/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertLess(len(queries), 5)
        hospitals = response.data['data']['hospitals']
        self.assertEqual(len(hospitals), 8)
        hospital = next(h for h in hospitals if h['hospital_id'] == str(self.hospital.pk))
        self.assertEqual(hospital['lab_techs_available'], 1)
        self.assertTrue(hospital['lab_configured'])
        self.assertFalse(hospital['has_available_slots'])

    def test_invalid_duration_does_not_enable_unconfigured_lab(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.put(self.settings_url, {**self.payload, 'slot_duration_minutes': -1}, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(HospitalLabConfig.objects.filter(hospital_id=self.hospital).exists())
        self.client.force_authenticate(user=self.patient)
        response = self.client.get(self.slots_url, {'hospital_id': self.hospital.pk, 'date': self.day.isoformat()})
        self.assertFalse(response.data['lab_configured'])
        self.assertFalse(LabSlot.objects.filter(hospital_id=self.hospital).exists())
