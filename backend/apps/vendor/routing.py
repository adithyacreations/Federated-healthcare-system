from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # /ws/chat/<vendor|hospital>/<login_id>/ — per-user chat channel.
    re_path(
        r'ws/chat/(?P<user_type>\w+)/(?P<user_id>[^/]+)/$',
        consumers.VendorChatConsumer.as_asgi(),
    ),
]
