from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/gps/(?P<dispatch_id>[^/]+)/$', consumers.GPSConsumer.as_asgi()),
    re_path(r'ws/notifications/(?P<login_id>[^/]+)/$', consumers.NotificationConsumer.as_asgi()),
    re_path(r'ws/orders/(?P<order_id>[^/]+)/$', consumers.OrderStatusConsumer.as_asgi()),
    re_path(r'ws/fl/global/$', consumers.FLConsumer.as_asgi()),
    re_path(r'ws/medicine/(?P<user_id>[^/]+)/$', consumers.MedicineOrderConsumer.as_asgi()),
    re_path(r'ws/emergency/(?P<user_id>[^/]+)/$', consumers.EmergencyConsumer.as_asgi()),
    re_path(r'ws/consultation/(?P<consultation_id>[^/]+)/chat/$', consumers.ConsultationChatConsumer.as_asgi()),
]
