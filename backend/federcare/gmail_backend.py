"""Django email transport for the Gmail API."""

import base64
from time import monotonic

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend


TOKEN_URL = 'https://oauth2.googleapis.com/token'
SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'


class GmailAPIError(Exception):
    """An email or token request failed without exposing credentials or message data."""


class GmailAPIBackend(BaseEmailBackend):
    def __init__(self, timeout=None, **kwargs):
        super().__init__(**kwargs)
        self.timeout = settings.EMAIL_TIMEOUT if timeout is None else timeout
        self.session = None
        self.token = ''
        self.token_expires_at = 0

    def open(self):
        if self.session is not None:
            return False
        self.session = requests.Session()
        return True

    def close(self):
        if self.session is not None:
            self.session.close()
            self.session = None

    def _post(self, url, operation, **kwargs):
        try:
            return self.session.post(url, timeout=self.timeout, allow_redirects=False, **kwargs)
        except requests.RequestException as error:
            raise GmailAPIError(f'Gmail {operation} connection failed ({type(error).__name__}).') from None

    def _refresh_access_token(self):
        client_id = settings.GMAIL_CLIENT_ID
        client_secret = settings.GMAIL_CLIENT_SECRET
        refresh_token = settings.GMAIL_REFRESH_TOKEN
        if not all((client_id, client_secret, refresh_token)):
            raise GmailAPIError('Gmail API OAuth credentials are missing.')

        response = self._post(TOKEN_URL, 'token', data={
            'grant_type': 'refresh_token',
            'client_id': client_id,
            'client_secret': client_secret,
            'refresh_token': refresh_token,
        })
        if response.status_code != 200:
            raise GmailAPIError(f'Gmail OAuth token request rejected (HTTP {response.status_code}).')

        try:
            payload = response.json()
            token = payload['access_token']
            expires_in = int(payload['expires_in'])
        except (KeyError, TypeError, ValueError):
            raise GmailAPIError('Gmail OAuth returned an invalid token response.') from None
        if not isinstance(token, str) or not token or expires_in <= 0:
            raise GmailAPIError('Gmail OAuth returned an invalid access token.')
        self.token = token
        self.token_expires_at = monotonic() + max(0, expires_in - 60)

    def _send_message(self, email):
        mime = email.message()
        if email.bcc:
            mime['Bcc'] = ', '.join(email.bcc)
        raw = base64.urlsafe_b64encode(mime.as_bytes(linesep='\r\n')).decode('ascii')

        if not self.token or monotonic() >= self.token_expires_at:
            self._refresh_access_token()
        response = self._post(SEND_URL, 'send', headers={'Authorization': f'Bearer {self.token}'}, json={'raw': raw})
        if response.status_code == 401:
            self._refresh_access_token()
            response = self._post(SEND_URL, 'send', headers={'Authorization': f'Bearer {self.token}'}, json={'raw': raw})
        if response.status_code != 200:
            raise GmailAPIError(f'Gmail API rejected the message (HTTP {response.status_code}).')

    def send_messages(self, email_messages):
        if not email_messages:
            return 0

        sent = 0
        opened = self.open()
        try:
            for email in email_messages:
                if not email.recipients():
                    continue
                try:
                    self._send_message(email)
                except GmailAPIError:
                    if not self.fail_silently:
                        raise
                else:
                    sent += 1
        finally:
            if opened:
                self.close()
        return sent
