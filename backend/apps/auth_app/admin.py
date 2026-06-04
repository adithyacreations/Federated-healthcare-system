from django.contrib import admin
from .models import LoginCredentials, SuperAdmin, RolePermissions, LoginSession, AuditLog, Notification

admin.site.register(LoginCredentials)
admin.site.register(SuperAdmin)
admin.site.register(RolePermissions)
admin.site.register(LoginSession)
admin.site.register(AuditLog)
admin.site.register(Notification)
