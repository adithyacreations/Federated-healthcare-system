"""WebSocket consumer for vendor↔hospital real-time chat.

Each user (vendor OR hospital_admin) connects to /ws/chat/<user_type>/<user_id>/
where user_id is their LoginCredentials primary key. Outgoing messages are
pushed by ChatMessagesView via channel_layer.group_send with type='chat_message'.
"""
import json

from channels.generic.websocket import AsyncWebsocketConsumer


class VendorChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user_id = self.scope['url_route']['kwargs']['user_id']
        self.user_type = self.scope['url_route']['kwargs']['user_type']
        # Group naming mirrors ChatMessagesView's push target.
        self.group_name = f'chat_{self.user_type}_{self.user_id}'

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'message': f'Chat connected as {self.user_type}',
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        # Messages are persisted + pushed by the HTTP API; nothing to do here.
        return

    async def chat_message(self, event):
        # The HTTP view sends {'type':'chat_message','data':{…}} — forward the payload.
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            **event.get('data', {}),
        }))
