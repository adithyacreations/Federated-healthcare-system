import json

from channels.generic.websocket import AsyncWebsocketConsumer


class NotificationConsumer(AsyncWebsocketConsumer):
    """Per-user real-time notification socket: ws/notifications/<login_id>/.

    Joins the group `notif_<login_id>`, which `utils.send_notification` (and the
    doctor-availability broadcaster) push to via channel_layer.group_send with
    type='push_notification'. Best-effort: any payload error is swallowed so the
    socket stays open.
    """

    async def connect(self):
        self.login_id = self.scope['url_route']['kwargs']['login_id']
        self.group_name = f'notif_{self.login_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def push_notification(self, event):
        await self.send(text_data=json.dumps({
            'type': 'notification',
            'title': event.get('title'),
            'message': event.get('message'),
            'notif_type': event.get('notif_type'),
            'related_id': event.get('related_id'),
        }))
