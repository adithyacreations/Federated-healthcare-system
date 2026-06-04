from django.urls import path
from .views import (
    DriverDashboardView,
    ToggleAvailabilityView,
    ActiveDispatchView,
    AcceptDispatchView,
    RejectDispatchView,
    UpdateDispatchStatusView,
    UpdateGPSView,
    DispatchHistoryView,
    DriverTripStatsView,
    AllEmergencyRequestsView,
    HospitalAmbulancesView,
    IncomingPatientsView,
    MarkBedReadyView,
    AcknowledgePatientView,
)

urlpatterns = [
    path('dashboard/', DriverDashboardView.as_view()),
    path('toggle-availability/', ToggleAvailabilityView.as_view()),
    path('active-dispatch/', ActiveDispatchView.as_view()),
    path('dispatch/<uuid:dispatch_id>/accept/', AcceptDispatchView.as_view()),
    path('dispatch/<uuid:dispatch_id>/reject/', RejectDispatchView.as_view()),
    path('dispatch/<uuid:dispatch_id>/status/', UpdateDispatchStatusView.as_view()),
    path('update-gps/', UpdateGPSView.as_view()),
    path('history/', DispatchHistoryView.as_view()),
    path('driver/trip-stats/', DriverTripStatsView.as_view()),
    path('all-requests/', AllEmergencyRequestsView.as_view()),
    path('ambulances/', HospitalAmbulancesView.as_view()),
    path('incoming-patients/', IncomingPatientsView.as_view()),
    path('dispatch/<uuid:dispatch_id>/bed-ready/', MarkBedReadyView.as_view()),
    path('dispatch/<uuid:dispatch_id>/acknowledge/', AcknowledgePatientView.as_view()),
]
