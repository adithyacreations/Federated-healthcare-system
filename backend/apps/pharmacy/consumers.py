import json

from channels.generic.websocket import AsyncWebsocketConsumer


class MedicineConsumer(AsyncWebsocketConsumer):
    """Per-user medicine-order socket: ws/medicine/<user_id>/.

    Joins the group `medicine_<user_id>` (user_id = the login UUID). Both
    pharmacists and patients connect with their own login_id:

      - Pharmacist receives `new_order` / `payment_received` events so their
        pending-orders list refreshes the instant a patient orders.
      - Patient receives `prescription_approved` / `prescription_rejected` /
        `order_dispatched` events for their own orders.

    `utils.broadcast_medicine_update(user_id, update_type, data)` pushes here via
    channel_layer.group_send with type='medicine_update'. Best-effort: any
    payload error is swallowed so the socket stays open.
    """

    async def connect(self):
        self.user_id = self.scope['url_route']['kwargs']['user_id']
        self.group_name = f'medicine_{self.user_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def medicine_update(self, event):
        # Flatten to the shape the frontend expects: { type: <update_type>, data }
        await self.send(text_data=json.dumps({
            'type': event.get('update_type'),
            'data': event.get('data', {}),
        }))


class PharmacyBroadcastConsumer(AsyncWebsocketConsumer):
    """Shared catalog socket: ws/pharmacy/ (no auth needed — read-only).

    Every patient browsing medicines joins the 'pharmacy_updates' group and
    receives `medicine_updated` events (visibility changes, out-of-stock,
    stock changes) pushed by `utils.broadcast_pharmacy_update`, so their list
    updates live without polling.
    """
    group_name = 'pharmacy_updates'

    async def connect(self):
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def medicine_updated(self, event):
        await self.send(text_data=json.dumps({
            'type': 'medicine_updated',
            'data': event.get('data', {}),
        }))
