from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from .models import LoginCredentials


class FederCareJWTAuthentication(JWTAuthentication):
    """Custom JWT backend that returns LoginCredentials instead of Django User."""

    def get_user(self, validated_token):
        try:
            login_id = validated_token['login_id']
        except KeyError:
            raise InvalidToken('Token contained no recognizable user identification')
        try:
            return LoginCredentials.objects.get(login_id=login_id)
        except LoginCredentials.DoesNotExist:
            raise InvalidToken('User not found')
