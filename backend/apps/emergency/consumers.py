"""WebSocket consumers for FederCare real-time channels.

Three consumers:
  * GPSConsumer          — driver pushes coords, patient sees live ambulance position
  * NotificationConsumer — server pushes per-user notifications, client can mark-read
  * OrderStatusConsumer  — pharmacy/lab/equipment order status streamed to subscribers
"""
import json
import logging
from datetime import datetime, timezone

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


# ─── Sync DB helpers (wrapped via sync_to_async on call) ────────────────────

@sync_to_async
def _persist_gps(dispatch_id, lat, lng):
    """Save the latest GPS coords on the ambulance for this dispatch. Returns ETA.

    Returns None when the dispatch_id is unknown or malformed — the consumer still
    broadcasts the GPS update either way so subscribers get live coords.
    """
    from apps.emergency.models import AmbulanceDispatch
    try:
        dispatch = AmbulanceDispatch.objects.select_related('ambulance_id').get(dispatch_id=dispatch_id)
    except (AmbulanceDispatch.DoesNotExist, ValueError, TypeError):
        return None
    except Exception as exc:
        logger.warning('GPS persist failed: %s', exc)
        return None
    ambulance = dispatch.ambulance_id
    ambulance.current_lat = lat
    ambulance.current_lng = lng
    ambulance.save(update_fields=['current_lat', 'current_lng'])
    return dispatch.eta_minutes


@sync_to_async
def _unread_notification_count(login_id):
    from apps.auth_app.models import Notification
    try:
        return Notification.objects.filter(login_id=login_id, is_read=False).count()
    except Exception as exc:
        logger.warning('unread count failed: %s', exc)
        return 0


@sync_to_async
def _mark_notification_read(notification_id, login_id):
    from apps.auth_app.models import Notification
    try:
        Notification.objects.filter(notif_id=notification_id, login_id=login_id).update(is_read=True)
        return True
    except Exception as exc:
        logger.warning('mark_read failed: %s', exc)
        return False


@sync_to_async
def _resolve_order_status(order_id):
    """Best-effort lookup of an order's current status across the 3 order models."""
    try:
        from apps.pharmacy.models import MedicineOrder
        m = MedicineOrder.objects.filter(med_order_id=order_id).first()
        if m:
            return {'kind': 'medicine', 'status': m.order_status, 'payment_status': m.payment_status}
    except Exception:
        pass
    try:
        from apps.lab.models import LabOrder
        l = LabOrder.objects.filter(order_id=order_id).first()
        if l:
            return {'kind': 'lab', 'status': l.status, 'payment_status': l.payment_status}
    except Exception:
        pass
    try:
        from apps.vendor.models import EquipmentOrder
        e = EquipmentOrder.objects.filter(eq_order_id=order_id).first()
        if e:
            return {'kind': 'equipment', 'status': e.order_status, 'payment_status': e.payment_status}
    except Exception:
        pass
    return None


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ─── 1. GPSConsumer ─────────────────────────────────────────────────────────

class GPSConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.dispatch_id = self.scope['url_route']['kwargs']['dispatch_id']
        self.group_name = f'gps_{self.dispatch_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'message': 'GPS tracking started',
            'dispatch_id': str(self.dispatch_id),
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            await self.send(text_data=json.dumps({'type': 'error', 'message': 'Invalid JSON'}))
            return

        msg_type = data.get('type')
        if msg_type != 'gps_update':
            return

        lat = data.get('lat')
        lng = data.get('lng')
        if lat is None or lng is None:
            await self.send(text_data=json.dumps({'type': 'error', 'message': 'Missing lat/lng'}))
            return

        eta = await _persist_gps(self.dispatch_id, lat, lng)

        await self.channel_layer.group_send(self.group_name, {
            'type': 'gps_update',
            'lat': lat,
            'lng': lng,
            'eta_minutes': eta,
            'dispatch_id': str(self.dispatch_id),
        })

    async def gps_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'gps_update',
            'lat': event.get('lat'),
            'lng': event.get('lng'),
            'eta_minutes': event.get('eta_minutes'),
            'dispatch_id': event.get('dispatch_id'),
            'timestamp': _now_iso(),
        }))


# ─── 2. NotificationConsumer ────────────────────────────────────────────────

class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.login_id = self.scope['url_route']['kwargs']['login_id']
        self.group_name = f'notif_{self.login_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        unread = await _unread_notification_count(self.login_id)
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'unread_count': unread,
            'login_id': str(self.login_id),
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return

        if data.get('type') == 'mark_read':
            notif_id = data.get('notif_id')
            if not notif_id:
                return
            ok = await _mark_notification_read(notif_id, self.login_id)
            unread = await _unread_notification_count(self.login_id)
            await self.send(text_data=json.dumps({
                'type': 'mark_read_ack',
                'notif_id': str(notif_id),
                'success': bool(ok),
                'unread_count': unread,
            }))

    async def push_notification(self, event):
        await self.send(text_data=json.dumps({
            'type': 'notification',
            'title': event.get('title', ''),
            'message': event.get('message', ''),
            'notif_type': event.get('notif_type', 'alert'),
            'related_id': event.get('related_id'),
            'created_at': _now_iso(),
        }))


# ─── 3. OrderStatusConsumer ─────────────────────────────────────────────────

class OrderStatusConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.order_id = self.scope['url_route']['kwargs']['order_id']
        self.group_name = f'order_{self.order_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        snapshot = await _resolve_order_status(self.order_id)
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'order_id': str(self.order_id),
            'current': snapshot,
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return
        # Clients can request a fresh status snapshot
        if data.get('type') == 'refresh':
            snapshot = await _resolve_order_status(self.order_id)
            await self.send(text_data=json.dumps({
                'type': 'snapshot',
                'order_id': str(self.order_id),
                'current': snapshot,
            }))

    async def order_status_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'order_update',
            'order_id': event.get('order_id', str(self.order_id)),
            'status': event.get('status', ''),
            'message': event.get('message', ''),
            'timestamp': _now_iso(),
        }))


# ─── 4. FLConsumer ──────────────────────────────────────────────────────────

class FLConsumer(AsyncWebsocketConsumer):
    """Broadcasts FL lifecycle events (round_started / weight_submitted /
    model_updated) to every subscriber of the 'fl_global' group."""

    async def connect(self):
        self.group_name = 'fl_global'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'message': 'FL WebSocket connected',
            'timestamp': _now_iso(),
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        # FL updates are server-pushed only; ignore inbound payloads.
        return

    async def fl_update(self, event):
        await self.send(text_data=json.dumps({
            'type': event.get('fl_type', 'fl_event'),
            'data': event.get('data', {}),
            'timestamp': _now_iso(),
        }))


# ─── 5. MedicineOrderConsumer ───────────────────────────────────────────────

class MedicineOrderConsumer(AsyncWebsocketConsumer):
    """Per-user channel for live medicine-order events (new order, prescription
    uploaded/approved/rejected, payment received, dispatched)."""

    async def connect(self):
        self.user_id = self.scope['url_route']['kwargs']['user_id']
        self.group_name = f'medicine_{self.user_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'message': 'Medicine order updates connected',
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        # Medicine updates are server-pushed only; ignore inbound payloads.
        return

    async def medicine_update(self, event):
        await self.send(text_data=json.dumps({
            'type': event['update_type'],
            'data': event['data'],
            'timestamp': _now_iso(),
        }))


# ─── 6. EmergencyConsumer ───────────────────────────────────────────────────

class EmergencyConsumer(AsyncWebsocketConsumer):
    """Per-user channel for live emergency events. A driver subscribes with
    their login_id and receives an `emergency_dispatch` push the moment an
    SOS is auto-assigned to them; dispatch status changes are pushed too."""

    async def connect(self):
        self.user_id = self.scope['url_route']['kwargs']['user_id']
        self.group_name = f'emergency_{self.user_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'message': 'Emergency WebSocket connected',
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        # Emergency events are server-pushed only; ignore inbound payloads.
        return

    async def emergency_dispatch(self, event):
        await self.send(text_data=json.dumps({
            'type': 'emergency_dispatch',
            'data': event['data'],
            'timestamp': _now_iso(),
        }))

    async def emergency_status_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'status_update',
            'status': event.get('status', ''),
            'message': event.get('message', ''),
            'timestamp': _now_iso(),
        }))

    async def bed_reroute(self, event):
        # Pushed when the bed monitor re-routes the dispatch to a new hospital.
        await self.send(text_data=json.dumps({
            'type': 'bed_reroute',
            'data': event['data'],
            'timestamp': _now_iso(),
        }))

    async def hospital_ready(self, event):
        # Pushed when the receiving hospital marks the bed prepared.
        await self.send(text_data=json.dumps({
            'type': 'hospital_ready',
            'data': event['data'],
            'timestamp': _now_iso(),
        }))


class ConsultationChatConsumer(AsyncWebsocketConsumer):
    """Live chat for a video consultation. Doctor and patient join the same
    room (`chat_<consultation_id>`); text and image payloads are relayed
    verbatim to every other member. The sender renders its own message
    locally, so we only broadcast — no persistence needed for the demo."""

    async def connect(self):
        self.consultation_id = self.scope['url_route']['kwargs']['consultation_id']
        self.group_name = f'chat_{self.consultation_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data)
        except (TypeError, ValueError):
            return
        # Relay to the rest of the room. The sender already shows its own copy,
        # so skip echoing back to the originating socket.
        await self.channel_layer.group_send(
            self.group_name,
            {'type': 'chat_message', 'message': data, 'sender_channel': self.channel_name},
        )

    async def chat_message(self, event):
        if event.get('sender_channel') == self.channel_name:
            return
        await self.send(text_data=json.dumps(event['message']))
