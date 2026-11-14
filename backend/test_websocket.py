"""Read-only notification handshake smoke test against a running ASGI server.

Set WS_SMOKE_ACCESS_TOKEN and WS_SMOKE_LOGIN_ID for the same active account.
For a hosted test also set WS_SMOKE_URL and WS_SMOKE_ORIGIN.
For isolated access and GPS tests run:
    python manage.py test apps.auth_app.test_websocket_access
"""
import asyncio
import json
import os
from uuid import UUID

import websockets


async def main():
    base = os.getenv('WS_SMOKE_URL', 'ws://127.0.0.1:8000').rstrip('/')
    origin = os.getenv('WS_SMOKE_ORIGIN', 'http://localhost:3000')
    token = os.getenv('WS_SMOKE_ACCESS_TOKEN')
    login_id = os.getenv('WS_SMOKE_LOGIN_ID')
    if not token or not login_id:
        raise SystemExit('Set WS_SMOKE_ACCESS_TOKEN and WS_SMOKE_LOGIN_ID before running this check.')

    try:
        async with websockets.connect(
            f'{base}/ws/notifications/{UUID(login_id)}/',
            origin=origin,
            subprotocols=['federcare.jwt', token],
            open_timeout=5,
        ) as socket:
            welcome = json.loads(await asyncio.wait_for(socket.recv(), timeout=5))
            if socket.subprotocol != 'federcare.jwt' or welcome.get('type') != 'connected':
                raise ValueError('Unexpected handshake response.')
    except Exception as exc:
        raise SystemExit(f'Notification WebSocket check failed ({type(exc).__name__}).') from None
    print('Authenticated notification WebSocket connected.')


if __name__ == '__main__':
    asyncio.run(main())
