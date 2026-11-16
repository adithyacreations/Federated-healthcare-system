import asyncio
import time
from uuid import UUID

from channels.db import database_sync_to_async
from django.db.models import Q
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

from apps.auth_app.authentication import FederCareJWTAuthentication
from apps.doctor.models import Consultation
from apps.emergency.models import AmbulanceDispatch
from apps.lab.models import LabOrder
from apps.patient.models import LabTestOrder
from apps.pharmacy.models import MedicineOrder
from apps.vendor.models import EquipmentOrder


def order_belongs_to(order_id, login_id):
    return (
        MedicineOrder.objects.filter(pk=order_id).filter(
            Q(patient_id__login_id=login_id) | Q(pharmacist_id__login_id=login_id)
        ).exists()
        or EquipmentOrder.objects.filter(pk=order_id).filter(
            Q(hospital_id__login_id=login_id) | Q(vendor_id__login_id=login_id)
        ).exists()
        or LabOrder.objects.filter(pk=order_id).filter(
            Q(patient_id__login_id=login_id) | Q(doctor_id__login_id=login_id)
            | Q(lab_tech_id__login_id=login_id)
        ).exists()
        or LabTestOrder.objects.filter(pk=order_id, patient_id__login_id=login_id).exists()
    )


@database_sync_to_async
def authorize_socket(token, channel, kwargs):
    try:
        claims = AccessToken(token)
        user = FederCareJWTAuthentication().get_user(claims)
        login_id = user.pk
        ids = {
            key: UUID(value) for key, value in kwargs.items()
            if key != 'user_type'
        }
    except (InvalidToken, TokenError, KeyError, ValueError, TypeError, AttributeError):
        return None

    if user.force_password_change:
        return None

    role = user.role
    if channel == 'notifications':
        allowed = ids['login_id'] == login_id
    elif channel == 'emergency':
        allowed = ids['user_id'] == login_id and role in {'driver', 'patient', 'hospital_admin'}
    elif channel == 'medicine':
        allowed = ids['user_id'] == login_id and role in {'patient', 'pharmacist'}
    elif channel == 'pharmacy':
        allowed = role in {'patient', 'pharmacist'}
    elif channel == 'vendor_chat':
        allowed = ids['user_id'] == login_id and {
            'vendor': 'vendor', 'hospital': 'hospital_admin',
        }.get(kwargs['user_type']) == role
    elif channel == 'fl':
        allowed = role in {'super_admin', 'hospital_admin'}
    elif channel == 'consultation':
        allowed = Consultation.objects.filter(pk=ids['consultation_id']).filter(
            Q(doctor_id__login_id=login_id) | Q(patient_id__login_id=login_id)
        ).exists()
    elif channel == 'gps':
        allowed = AmbulanceDispatch.objects.filter(pk=ids['dispatch_id']).filter(
            Q(ambulance_id__driver_id__login_id=login_id)
            | Q(emergency_id__patient_id__login_id=login_id)
            | Q(emergency_id__assigned_hospital_id__login_id=login_id)
        ).exists()
    elif channel == 'order':
        allowed = order_belongs_to(ids['order_id'], login_id)
    else:
        allowed = False

    return (user, claims['exp']) if allowed else None


def protected_socket(consumer, channel):
    # Browsers cannot set Authorization headers on WebSocket handshakes.
    # Offer the access token as a subprotocol, and only echo the protocol name.
    async def application(scope, receive, send):
        protocols = scope.get('subprotocols', [])
        if len(protocols) != 2 or protocols[0] != 'federcare.jwt':
            await send({'type': 'websocket.close', 'code': 4401})
            return
        kwargs = scope['url_route']['kwargs']
        auth = await authorize_socket(protocols[1], channel, kwargs)
        if auth is None:
            await send({'type': 'websocket.close', 'code': 4403})
            return
        user, expires = auth
        route = {**scope['url_route'], 'kwargs': {
            key: value if key == 'user_type' else str(UUID(value))
            for key, value in kwargs.items()
        }}
        terminated = False

        async def send_message(message):
            nonlocal terminated
            if terminated:
                return
            if message['type'] == 'websocket.accept':
                message = {**message, 'subprotocol': 'federcare.jwt'}
            await send(message)

        async def monitor_authorization():
            nonlocal terminated
            while expires > time.time():
                await asyncio.sleep(min(30, max(0, expires - time.time())))
                if expires <= time.time() or not await authorize_socket(protocols[1], channel, kwargs):
                    break
            terminated = True
            await send({'type': 'websocket.close', 'code': 4401})

        expiry_task = asyncio.create_task(monitor_authorization())
        try:
            await consumer({**scope, 'user': user, 'url_route': route}, receive, send_message)
        finally:
            expiry_task.cancel()

    return application
