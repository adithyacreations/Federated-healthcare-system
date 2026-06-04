from django.urls import path
from .views import (
    LoginView,
    LogoutView,
    GetProfileView,
    UpdateProfileView,
    UploadProfilePhotoView,
    PatientRegisterView,
    HospitalRegisterView,
    PharmacistRegisterView,
    VendorRegisterView,
    CheckPhoneView,
    GetPendingApprovalsView,
    ApproveEntityView,
    RejectEntityView,
    ChangePasswordView,
    PasswordResetRequestView,
    PasswordResetVerifyView,
    AuthenticatedPasswordResetView,
    # Super Admin
    SuperAdminDashboardView,
    SystemAuditLogsView,
    AllUsersView,
    RolePermissionsView,
    NotificationsView,
    MarkNotificationReadView,
    SystemStatsView,
)

urlpatterns = [
    # Auth
    path('login/', LoginView.as_view()),
    path('logout/', LogoutView.as_view()),
    path('profile/', GetProfileView.as_view()),
    path('profile/update/', UpdateProfileView.as_view()),
    path('profile/upload-photo/', UploadProfilePhotoView.as_view()),
    path('change-password/', ChangePasswordView.as_view()),
    path('password-reset/request/', PasswordResetRequestView.as_view()),
    path('password-reset/send-otp/', PasswordResetRequestView.as_view()),
    path('password-reset/verify/', PasswordResetVerifyView.as_view()),
    path('password-reset/authenticated/', AuthenticatedPasswordResetView.as_view()),

    # Registration
    path('register/patient/', PatientRegisterView.as_view()),
    path('register/hospital/', HospitalRegisterView.as_view()),
    path('register/pharmacist/', PharmacistRegisterView.as_view()),
    path('register/vendor/', VendorRegisterView.as_view()),
    path('check-phone/', CheckPhoneView.as_view()),

    # Approvals
    path('pending-approvals/', GetPendingApprovalsView.as_view()),
    path('approve/<uuid:login_id>/', ApproveEntityView.as_view()),
    path('reject/<uuid:login_id>/', RejectEntityView.as_view()),

    # Super Admin dashboard & management
    path('admin-dashboard/', SuperAdminDashboardView.as_view()),
    path('audit-logs/', SystemAuditLogsView.as_view()),
    path('users/', AllUsersView.as_view()),
    path('role-permissions/', RolePermissionsView.as_view()),
    path('system-stats/', SystemStatsView.as_view()),

    # Notifications (all authenticated users)
    path('notifications/', NotificationsView.as_view()),
    path('notifications/<uuid:notif_id>/read/', MarkNotificationReadView.as_view()),
]
