import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
import apps.emergency.routing
import apps.vendor.routing
import apps.auth_app.routing
import apps.pharmacy.routing
import apps.doctor.routing

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'federcare.settings')

django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': AuthMiddlewareStack(
        URLRouter(
            apps.emergency.routing.websocket_urlpatterns
            + apps.vendor.routing.websocket_urlpatterns
            + apps.auth_app.routing.websocket_urlpatterns
            + apps.pharmacy.routing.websocket_urlpatterns
            + apps.doctor.routing.websocket_urlpatterns
        )
    ),
})
