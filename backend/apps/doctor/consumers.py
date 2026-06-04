import json

from channels.generic.websocket import AsyncWebsocketConsumer


class ConsultationChatConsumer(AsyncWebsocketConsumer):
    """Live consultation chat socket: ws/consultation/<consultation_id>/chat/.

    Both doctor and patient join the group `consultation_chat_<id>`.

      - Persisted TEXT messages are written + broadcast by the REST API
        (`ConsultationChatView`) and delivered here via `chat_message`.
      - Ephemeral frames (images / X-ray results) are sent straight over the
        socket; `receive` relays them to the whole group via `chat_relay`. Each
        carries a `client_id` so every client (including the sender) can dedupe.

    Best-effort: malformed frames are ignored so the socket stays open.
    """

    async def connect(self):
        self.consultation_id = self.scope['url_route']['kwargs']['consultation_id']
        self.group_name = f'consultation_chat_{self.consultation_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            payload = json.loads(text_data)
        except Exception:
            return
        await self.channel_layer.group_send(
            self.group_name,
            {'type': 'chat_relay', 'payload': payload},
        )

    async def chat_relay(self, event):
        # Ephemeral image / X-ray frame relayed to the whole group.
        await self.send(text_data=json.dumps(event['payload']))

    async def chat_message(self, event):
        # Persisted text message pushed from the REST API.
        await self.send(text_data=json.dumps(event['data']))
