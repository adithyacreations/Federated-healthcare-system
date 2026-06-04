from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(
        r'ws/medicine/(?P<user_id>[^/]+)/$',
        consumers.MedicineConsumer.as_asgi(),
    ),
    re_path(
        r'ws/pharmacy/$',
        consumers.PharmacyBroadcastConsumer.as_asgi(),
    ),
]
