import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'federcare.settings')
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.urls import path

from apps.doctor.consumers import ConsultationChatConsumer
from apps.emergency import consumers as emergency
from apps.pharmacy.consumers import PharmacyBroadcastConsumer
from apps.vendor.consumers import VendorChatConsumer
from federcare.websocket import protected_socket

websocket_routes = [
    path('ws/gps/<str:dispatch_id>/', protected_socket(emergency.GPSConsumer.as_asgi(), 'gps')),
    path('ws/notifications/<str:login_id>/', protected_socket(emergency.NotificationConsumer.as_asgi(), 'notifications')),
    path('ws/orders/<str:order_id>/', protected_socket(emergency.OrderStatusConsumer.as_asgi(), 'order')),
    path('ws/fl/global/', protected_socket(emergency.FLConsumer.as_asgi(), 'fl')),
    path('ws/medicine/<str:user_id>/', protected_socket(emergency.MedicineOrderConsumer.as_asgi(), 'medicine')),
    path('ws/emergency/<str:user_id>/', protected_socket(emergency.EmergencyConsumer.as_asgi(), 'emergency')),
    path('ws/consultation/<str:consultation_id>/chat/', protected_socket(ConsultationChatConsumer.as_asgi(), 'consultation')),
    path('ws/chat/<str:user_type>/<str:user_id>/', protected_socket(VendorChatConsumer.as_asgi(), 'vendor_chat')),
    path('ws/pharmacy/', protected_socket(PharmacyBroadcastConsumer.as_asgi(), 'pharmacy')),
]

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': OriginValidator(URLRouter(websocket_routes), settings.WEBSOCKET_ALLOWED_ORIGINS),
})
