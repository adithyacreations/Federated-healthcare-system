from uuid import UUID

from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from .models import LoginCredentials


def session_stamp(account):
    return salted_hmac(
        'federcare.auth.session',
        f'{account.pk}:{account.password_hash}:{account.sessions_revoked_at}',
        algorithm='sha256',
    ).hexdigest()


class FederCareJWTAuthentication(JWTAuthentication):
    """Custom JWT backend that returns LoginCredentials instead of Django User."""

    def get_user(self, validated_token):
        try:
            login_id = UUID(validated_token['login_id'])
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise InvalidToken('Invalid account token') from exc
        try:
            user = LoginCredentials.objects.get(
                login_id=login_id, role=validated_token.get('role'),
                is_active=True, is_approved=True,
            )
        except LoginCredentials.DoesNotExist as exc:
            raise InvalidToken('Account is unavailable') from exc
        if not constant_time_compare(validated_token.get('session', ''), session_stamp(user)):
            raise InvalidToken('Session has been revoked')
        return user


class FederCareTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        refresh = self.token_class(attrs['refresh'])
        FederCareJWTAuthentication().get_user(refresh)
        return super().validate(attrs)
