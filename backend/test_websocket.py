"""Smoke test for FederCare WebSocket consumers.

Prerequisite: an ASGI server running on port 8000. Either:
    python manage.py runserver       (Django + Channels dev server)
or:
    daphne -b 127.0.0.1 -p 8000 federcare.asgi:application

Then run from another shell:
    python test_websocket.py
"""
import asyncio
import json
import sys

import websockets

BASE = 'ws://127.0.0.1:8000'


async def _recv_json(ws, timeout=3.0):
    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    return json.loads(raw)


async def test_notification_ws():
    url = f'{BASE}/ws/notifications/test-login-id/'
    print(f'\n[notification] Connecting to {url}')
    async with websockets.connect(url) as ws:
        # 1. Welcome / unread_count handshake
        welcome = await _recv_json(ws)
        assert welcome.get('type') == 'connected', f'unexpected: {welcome}'
        print(f'  -> connected, unread_count={welcome.get("unread_count")}')

        # 2. mark_read should be acknowledged
        await ws.send(json.dumps({'type': 'mark_read', 'notif_id': 'fake-id-not-in-db'}))
        ack = await _recv_json(ws)
        assert ack.get('type') == 'mark_read_ack', f'unexpected ack: {ack}'
        print(f'  -> mark_read_ack received: success={ack.get("success")}')
    print('[OK] Notification WebSocket working')


async def test_gps_ws():
    url = f'{BASE}/ws/gps/test-dispatch-id/'
    print(f'\n[gps] Connecting to {url}')
    async with websockets.connect(url) as ws:
        welcome = await _recv_json(ws)
        assert welcome.get('type') == 'connected', f'unexpected: {welcome}'
        print(f'  -> connected: {welcome.get("message")}')

        # Send a GPS update — server will persist (no-op if dispatch_id not real)
        # and broadcast to the group, which we ourselves are subscribed to.
        payload = {
            'type': 'gps_update',
            'lat': 8.5241,
            'lng': 76.9366,
            'dispatch_id': 'test-dispatch-id',
        }
        await ws.send(json.dumps(payload))

        echo = await _recv_json(ws)
        assert echo.get('type') == 'gps_update', f'unexpected echo: {echo}'
        assert float(echo.get('lat')) == 8.5241
        assert float(echo.get('lng')) == 76.9366
        print(f'  -> gps_update echoed: lat={echo["lat"]} lng={echo["lng"]}')
    print('[OK] GPS WebSocket working')


async def test_orders_ws():
    url = f'{BASE}/ws/orders/test-order-id/'
    print(f'\n[orders] Connecting to {url}')
    async with websockets.connect(url) as ws:
        welcome = await _recv_json(ws)
        assert welcome.get('type') == 'connected', f'unexpected: {welcome}'
        print(f'  -> connected: order_id={welcome.get("order_id")}')

        # Ask for a snapshot
        await ws.send(json.dumps({'type': 'refresh'}))
        snap = await _recv_json(ws)
        assert snap.get('type') == 'snapshot', f'unexpected snap: {snap}'
        print(f'  -> snapshot received: {snap.get("current")}')
    print('[OK] Order Status WebSocket working')


async def main():
    failures = []
    for name, coro in [
        ('notification', test_notification_ws()),
        ('gps', test_gps_ws()),
        ('orders', test_orders_ws()),
    ]:
        try:
            await coro
        except Exception as exc:
            failures.append((name, exc))
            print(f'[FAIL] {name}: {type(exc).__name__}: {exc}')

    print('\n' + '=' * 60)
    if failures:
        print(f'  {len(failures)} test(s) failed.')
        sys.exit(1)
    print('  All WebSocket smoke tests passed.')


if __name__ == '__main__':
    asyncio.run(main())
