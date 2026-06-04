from pathlib import Path
from datetime import timedelta
import os
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / '.env')

SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'django-insecure-fallback-key')
DEBUG = True
ALLOWED_HOSTS = ['*']

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

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
    },
}

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

CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

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
MEDIA_ROOT = BASE_DIR / 'media'

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
