from datetime import date
from uuid import uuid4

from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings
from rest_framework_simplejwt.tokens import AccessToken

from apps.auth_app.models import LoginCredentials
from apps.doctor.models import Consultation, DoctorRegistration
from apps.emergency.models import Ambulance, AmbulanceDispatch, AmbulanceDriverRegistration, EmergencyRequest
from apps.hospital.models import HospitalRegistration
from apps.patient.models import PatientRegistration
from federcare.asgi import application

ORIGIN = b'http://localhost:3000'


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class SocketAuthorizationTests(TransactionTestCase):
    def setUp(self):
        self.patient = self.account('patient')
        self.admin = self.account('super_admin')
        self.inactive = self.account('doctor', active=False)

    def account(self, role, active=True):
        return LoginCredentials.objects.create(
            email=f'{role}@example.test', role=role, is_active=active, is_approved=True,
        )

    def socket(self, path, user=None, *, origin=ORIGIN, token=None):
        if user:
            jwt = AccessToken()
            jwt['login_id'] = str(user.pk)
            jwt['role'] = user.role
            token = str(jwt)
        return WebsocketCommunicator(
            application, path, headers=[(b'origin', origin)],
            subprotocols=['federcare.jwt', token] if token is not None else [],
        )

    async def assert_denied(self, socket):
        accepted, _ = await socket.connect()
        self.assertFalse(accepted)
        await socket.disconnect()

    async def test_notification_socket_requires_own_active_account_and_allowed_origin(self):
        path = f'/ws/notifications/{self.patient.pk}/'
        await self.assert_denied(self.socket(path))
        await self.assert_denied(self.socket(path, token='invalid'))
        await self.assert_denied(self.socket(path, self.admin))
        await self.assert_denied(self.socket(path, self.patient, origin=b'https://other.example'))
        await self.assert_denied(self.socket(f'/ws/notifications/{self.inactive.pk}/', self.inactive))
        socket = self.socket(path, self.patient)
        self.assertEqual(await socket.connect(), (True, 'federcare.jwt'))
        self.assertEqual((await socket.receive_json_from())['type'], 'connected')
        await socket.disconnect()

    async def test_role_and_membership_rules(self):
        await self.assert_denied(self.socket('/ws/fl/global/', self.patient))
        await self.assert_denied(self.socket(f'/ws/gps/{uuid4()}/', self.patient))
        await self.assert_denied(self.socket(f'/ws/consultation/{uuid4()}/chat/', self.patient))
        await self.assert_denied(self.socket(f'/ws/chat/vendor/{self.patient.pk}/', self.patient))
        await self.assert_denied(self.socket(f'/ws/medicine/{self.admin.pk}/', self.admin))
        for path, user in [('/ws/fl/global/', self.admin), ('/ws/pharmacy/', self.patient)]:
            socket = self.socket(path, user)
            self.assertEqual(await socket.connect(), (True, 'federcare.jwt'))
            await socket.disconnect()

    def test_consultation_and_dispatch_participants(self):
        from asgiref.sync import async_to_sync

        hospital = HospitalRegistration.objects.create(
            login_id=self.account('hospital_admin'), hospital_name='Test Hospital', registration_no='TEST',
        )
        patient = PatientRegistration.objects.create(login_id=self.patient, full_name='Patient', dob=date(2000, 1, 1))
        doctor = DoctorRegistration.objects.create(
            login_id=self.inactive, hospital_id=hospital, full_name='Doctor', license_no='TEST-D',
        )
        consultation = Consultation.objects.create(patient_id=patient, doctor_id=doctor)
        driver = AmbulanceDriverRegistration.objects.create(
            login_id=self.account('driver'), hospital_id=hospital, license_no='TEST-A',
        )
        ambulance = Ambulance.objects.create(hospital_id=hospital, driver_id=driver, vehicle_no='TEST')
        emergency = EmergencyRequest.objects.create(patient_id=patient, patient_lat=0, patient_lng=0)
        dispatch = AmbulanceDispatch.objects.create(emergency_id=emergency, ambulance_id=ambulance)

        @async_to_sync
        async def exercise():
            chat = self.socket(f'/ws/consultation/{consultation.pk}/chat/', self.patient)
            self.assertEqual(await chat.connect(), (True, 'federcare.jwt'))
            await chat.send_json_to({'type': 'image', 'sender': 'doctor'})
            self.assertEqual((await chat.receive_json_from())['sender'], 'patient')
            await chat.disconnect()

            path = f'/ws/gps/{dispatch.pk}/'
            patient_socket = self.socket(path, self.patient)
            driver_socket = self.socket(path, driver.login_id)
            for socket in (patient_socket, driver_socket):
                self.assertEqual(await socket.connect(), (True, 'federcare.jwt'))
                await socket.receive_json_from()
            frame = {'type': 'gps_update', 'lat': 8.5, 'lng': 76.9}
            await patient_socket.send_json_to(frame)
            self.assertTrue(await driver_socket.receive_nothing())
            await driver_socket.send_json_to(frame)
            self.assertEqual((await patient_socket.receive_json_from())['lat'], 8.5)
            await driver_socket.disconnect()
            await patient_socket.disconnect()

        exercise()
        ambulance.refresh_from_db()
        self.assertEqual(float(ambulance.current_lat), 8.5)
