"""Run a startup command and report failures without exposing settings."""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import logging
import os
import re
import sys

import django
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.management.base import SystemCheckError
from django.db import DatabaseError


CONFIG_MESSAGES = {
    'Set DJANGO_SECRET_KEY in production.': 'Set DJANGO_SECRET_KEY on the Render backend.',
    'Set specific ALLOWED_HOSTS in production.': 'Set ALLOWED_HOSTS to the backend hostname.',
    'Set REDIS_URL for the production Channels layer.': 'Set REDIS_URL on the Render backend.',
    'Set a PostgreSQL DATABASE_URL in production.': 'Set DATABASE_URL to the Neon PostgreSQL URL.',
}
for key in ('FRONTEND_URL', 'CORS_ALLOWED_ORIGINS', 'CSRF_TRUSTED_ORIGINS'):
    CONFIG_MESSAGES[f'{key} must contain specific HTTPS origins in production.'] = (
        f'Check {key}. Use HTTPS origins without a trailing slash or path.'
    )
for key in ('DEBUG', 'SECURE_SSL_REDIRECT', 'TRUST_PROXY_SSL_HEADER'):
    CONFIG_MESSAGES[f'{key} must be true or false.'] = f'Set {key} to True or False.'


def explain_error(error):
    if isinstance(error, ImproperlyConfigured):
        return CONFIG_MESSAGES.get(str(error), 'Django configuration is invalid.')
    if isinstance(error, SystemCheckError):
        codes = sorted(set(re.findall(r'\b\(([a-z_]+\.[EW]\d{3})\)', str(error))))
        return 'Django system check failed.' + (f' Codes: {", ".join(codes)}.' if codes else '')
    if isinstance(error, DatabaseError):
        sqlstate = getattr(error.__cause__, 'sqlstate', '') or ''
        if sqlstate == '28P01' or 'password authentication failed' in str(error).lower():
            return 'PostgreSQL rejected the credentials in DATABASE_URL.'
        if sqlstate == '42501':
            return 'The PostgreSQL role lacks permission to apply the migration (SQLSTATE 42501).'
        if re.fullmatch(r'[A-Z0-9]{5}', sqlstate):
            return f'PostgreSQL reported SQLSTATE {sqlstate}.'
        return f'Database access failed ({type(error).__name__}). Check DATABASE_URL and database reachability.'
    return f'Django raised {type(error).__name__}.'


def main(command):
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'federcare.settings')
    try:
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            logging.disable(logging.CRITICAL)
            django.setup()
            call_command(command, interactive=False, skip_checks=False)
    except Exception as error:
        print(explain_error(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
