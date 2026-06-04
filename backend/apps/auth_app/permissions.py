from rest_framework.permissions import BasePermission
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from .models import LoginCredentials


def get_login_from_token(request):
    """Decode Bearer token and return the LoginCredentials object, or None."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None
    token_str = auth_header.split(' ', 1)[1]
    try:
        token = AccessToken(token_str)
        login_id = token['login_id']
        return LoginCredentials.objects.get(login_id=login_id)
    except (InvalidToken, TokenError, KeyError, LoginCredentials.DoesNotExist):
        return None


def _role_check(request, role):
    return bool(
        request.user
        and request.user.is_authenticated
        and getattr(request.user, 'role', None) == role
    )


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        return _role_check(request, 'super_admin')


class IsHospitalAdmin(BasePermission):
    def has_permission(self, request, view):
        return _role_check(request, 'hospital_admin')


class IsDoctor(BasePermission):
    def has_permission(self, request, view):
        return _role_check(request, 'doctor')


class IsPatient(BasePermission):
    def has_permission(self, request, view):
        return _role_check(request, 'patient')


class IsPharmacist(BasePermission):
    def has_permission(self, request, view):
        return _role_check(request, 'pharmacist')


class IsLabTech(BasePermission):
    def has_permission(self, request, view):
        return _role_check(request, 'lab_tech')


class IsDriver(BasePermission):
    def has_permission(self, request, view):
        return _role_check(request, 'driver')


class IsVendor(BasePermission):
    def has_permission(self, request, view):
        return _role_check(request, 'vendor')
