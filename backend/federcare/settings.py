from pathlib import Path
from datetime import timedelta
import os
from urllib.parse import urlsplit
import dj_database_url
from dotenv import load_dotenv
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / '.env')

def env_list(name, default=''):
    return [item.strip() for item in os.getenv(name, default).split(',') if item.strip()]


def env_flag(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {'1', 'true', 'yes', 'on'}:
        return True
    if normalized in {'0', 'false', 'no', 'off'}:
        return False
    raise ImproperlyConfigured(f'{name} must be true or false.')


DEBUG = env_flag('DEBUG', default=True)
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY') or (
    'django-insecure-local-development-only-key-for-federcare' if DEBUG else ''
)
ALLOWED_HOSTS = env_list('ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]' if DEBUG else '')
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:3000' if DEBUG else '').strip().rstrip('/')
LOCAL_FRONTEND_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000']
FRONTEND_ORIGINS = list(dict.fromkeys(
    ([FRONTEND_URL] if FRONTEND_URL else []) + (LOCAL_FRONTEND_ORIGINS if DEBUG else [])
))
CORS_ALLOWED_ORIGINS = env_list('CORS_ALLOWED_ORIGINS', ','.join(FRONTEND_ORIGINS))
CSRF_TRUSTED_ORIGINS = env_list('CSRF_TRUSTED_ORIGINS')
WEBSOCKET_ALLOWED_ORIGINS = CORS_ALLOWED_ORIGINS
CORS_URLS_REGEX = r'^/(api|media)/'
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_SSL_REDIRECT = env_flag('SECURE_SSL_REDIRECT', default=not DEBUG)
if env_flag('TRUST_PROXY_SSL_HEADER'):
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

if not DEBUG:
    if not SECRET_KEY:
        raise ImproperlyConfigured('Set DJANGO_SECRET_KEY in production.')
    if not ALLOWED_HOSTS or any('*' in host for host in ALLOWED_HOSTS):
        raise ImproperlyConfigured('Set specific ALLOWED_HOSTS in production.')
    for name, origins in (
        ('FRONTEND_URL', [FRONTEND_URL]),
        ('CORS_ALLOWED_ORIGINS', CORS_ALLOWED_ORIGINS),
        ('CSRF_TRUSTED_ORIGINS', CSRF_TRUSTED_ORIGINS),
    ):
        for origin in origins:
            parsed = urlsplit(origin)
            if (parsed.scheme != 'https' or not parsed.hostname or '*' in parsed.netloc
                    or parsed.username is not None or parsed.path or parsed.query or parsed.fragment):
                raise ImproperlyConfigured(f'{name} must contain specific HTTPS origins in production.')

INSTALLED_APPS = [
    # 'daphne' must be first for Channels 4.x runserver to handle WebSockets
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'channels',
    'cloudinary',
    'cloudinary_storage',

    # FederCare apps
    'apps.auth_app',
    'apps.hospital',
    'apps.patient',
    'apps.doctor',
    'apps.pharmacy',
    'apps.lab',
    'apps.emergency',
    'apps.vendor',
    'apps.ai_engine',
    'apps.federated',
    'apps.payments',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'federcare.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

ASGI_APPLICATION = 'federcare.asgi.application'

redis_url = os.getenv('REDIS_URL', '').strip()
if redis_url:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [redis_url]},
        },
    }
elif DEBUG:
    CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
else:
    raise ImproperlyConfigured('Set REDIS_URL for the production Channels layer.')

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
        # Wait up to 30s for a competing writer to release the lock before
        # raising "database is locked" (SQLite is single-writer).
        'OPTIONS': {
            'timeout': 30,
        },
    }
}

# The hosted backend uses a fresh PostgreSQL database when DATABASE_URL is set.
database_url = os.getenv('DATABASE_URL', '').strip()
if database_url:
    DATABASES['default'] = dj_database_url.parse(database_url)

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'apps.auth_app.authentication.FederCareJWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_RENDERER_CLASSES': (
        'rest_framework.renderers.JSONRenderer',
    ),
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=24),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': False,
    'UPDATE_LAST_LOGIN': True,
    'ALGORITHM': 'HS256',
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# ── File storage ──────────────────────────────────────────────────────────────
# All uploads are stored on the local filesystem (MEDIA_ROOT) and served from
# MEDIA_URL. Cloudinary was dropped because the free-tier upload/transformation
# quota kept getting exhausted. Keep the config block around (unused) in case
# Cloudinary is re-enabled later.
# CLOUDINARY_STORAGE = {
#     'CLOUD_NAME': os.getenv('CLOUDINARY_CLOUD_NAME'),
#     'API_KEY': os.getenv('CLOUDINARY_API_KEY'),
#     'API_SECRET': os.getenv('CLOUDINARY_API_SECRET'),
# }
DEFAULT_FILE_STORAGE = 'django.core.files.storage.FileSystemStorage'

RAZORPAY_KEY_ID = os.getenv('RAZORPAY_KEY_ID')
RAZORPAY_KEY_SECRET = os.getenv('RAZORPAY_KEY_SECRET')

# Gemini (Google Generative Language API) — kept server-side only. The frontend
# never sees this key; it calls our /api/ai/ proxy endpoints instead.
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.gmail.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_TIMEOUT = 10
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER')
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD')
DEFAULT_FROM_EMAIL = os.getenv('EMAIL_HOST_USER')

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
MEDIA_ROOT = Path(os.getenv('DJANGO_MEDIA_ROOT') or BASE_DIR / 'media')

# Ensure local media folders exist (prescriptions are stored on disk, not Cloudinary).
os.makedirs(os.path.join(MEDIA_ROOT, 'prescriptions'), exist_ok=True)

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# ── SQLite concurrency tuning ─────────────────────────────────────────────────
# WAL lets readers and a single writer work concurrently (instead of locking the
# whole file), which is the main cure for "database is locked" under the
# WebSocket / scheduler / request load this app generates. Applied on every new
# DB connection.
from django.db.backends.signals import connection_created  # noqa: E402


def activate_wal_mode(sender, connection, **kwargs):
    if connection.vendor != 'sqlite':
        return
    try:
        cursor = connection.cursor()
        # busy_timeout MUST come first: it makes the journal_mode switch (which
        # needs a brief exclusive lock) wait for a competing connection instead
        # of instantly raising "database is locked".
        cursor.execute('PRAGMA busy_timeout=30000;')
        cursor.execute('PRAGMA journal_mode=WAL;')
        cursor.execute('PRAGMA synchronous=NORMAL;')
        cursor.execute('PRAGMA cache_size=10000;')
        cursor.execute('PRAGMA temp_store=MEMORY;')
    except Exception as exc:  # noqa: BLE001
        # A failed PRAGMA must never poison the connection — fall back to
        # defaults (the file stays in WAL once any connection has flipped it,
        # since the mode is persisted in the database file itself).
        print(f'[SQLite] WAL/pragma tuning skipped on this connection: {exc}')


connection_created.connect(activate_wal_mode)
