from django.urls import path
from .views import (
    PatientDashboardView,
    EHRWalletView,
    GenerateQRTokenView,
    BrowseDoctorsView,
    DoctorSlotsView,
    BookConsultationView,
    ConsultationPaymentFailureView,
    PatientConsultationsView,
    PatientPrescriptionsView,
    EmergencySOSView,
    TrackEmergencyView,
    OrderMedicineView,
    PatientOrdersView,
    GetRiskReportView,
    AddAllergyView,
    PatientHealthDataView,
)
from .views_extra import (
    SubmitComplaintView,
    ListComplaintsView,
    AdminListComplaintsView,
    ReplyComplaintView,
    FollowupComplaintView,
    PlaceMedicineOrderView,
    UploadPrescriptionView,
    ListMedicineOrdersView,
    MonthlyMedicineUsageView,
    ConfirmMedicineDeliveryView,
    BookLabTestView,
    ListLabOrdersView,
    GetLabTestCatalogView,
    UploadLabPrescriptionView,
    BookedLabSlotsView,
    QRCodeView,
    EmergencyHistoryView,
    UploadEHRImageView,
    ListEHRImagesView,
    PharmacyListView,
    HospitalListView,
    VendorListView,
)

urlpatterns = [
    path('dashboard/', PatientDashboardView.as_view()),
    path('ehr-wallet/', EHRWalletView.as_view()),
    path('qr-token/', GenerateQRTokenView.as_view()),
    path('doctors/', BrowseDoctorsView.as_view()),
    path('doctor-slots/<uuid:doctor_id>/', DoctorSlotsView.as_view()),
    path('book-consultation/', BookConsultationView.as_view()),
    path('consultation-payment-failed/', ConsultationPaymentFailureView.as_view()),
    path('consultations/', PatientConsultationsView.as_view()),
    path('prescriptions/', PatientPrescriptionsView.as_view()),
    path('emergency/', EmergencySOSView.as_view()),
    path('emergency/history/', EmergencyHistoryView.as_view()),
    path('emergency/<uuid:emergency_id>/', TrackEmergencyView.as_view()),
    path('order-medicine/', OrderMedicineView.as_view()),
    path('orders/', PatientOrdersView.as_view()),
    path('risk-report/', GetRiskReportView.as_view()),
    path('add-allergy/', AddAllergyView.as_view()),
    path('health-data/', PatientHealthDataView.as_view()),

    # ─── Complaints ───────────────────────────────────────────────
    path('complaints/submit/', SubmitComplaintView.as_view()),
    path('complaints/', ListComplaintsView.as_view()),
    path('complaints/all/', AdminListComplaintsView.as_view()),
    path('complaints/<uuid:complaint_id>/reply/', ReplyComplaintView.as_view()),
    path('complaints/<uuid:complaint_id>/followup/', FollowupComplaintView.as_view()),

    # ─── Medicine orders ──────────────────────────────────────────
    path('medicine/order/', PlaceMedicineOrderView.as_view()),
    path('medicine/upload-prescription/', UploadPrescriptionView.as_view()),
    path('medicine/orders/', ListMedicineOrdersView.as_view()),
    path('medicine/monthly-usage/', MonthlyMedicineUsageView.as_view()),
    path('medicine/confirm-delivery/', ConfirmMedicineDeliveryView.as_view()),

    # ─── Lab tests ────────────────────────────────────────────────
    path('lab/book/', BookLabTestView.as_view()),
    path('lab/orders/', ListLabOrdersView.as_view()),
    path('lab/catalog/', GetLabTestCatalogView.as_view()),
    path('lab/upload-prescription/', UploadLabPrescriptionView.as_view()),
    path('lab/booked-slots/', BookedLabSlotsView.as_view()),

    # ─── QR code (public, no auth) ────────────────────────────────
    path('qr-info/<str:token>/', QRCodeView.as_view()),

    # ─── EHR images ───────────────────────────────────────────────
    path('ehr/upload-image/', UploadEHRImageView.as_view()),
    path('ehr/images/', ListEHRImagesView.as_view()),

    # ─── Directory lookups ────────────────────────────────────────
    path('pharmacies/', PharmacyListView.as_view()),
    path('hospitals/', HospitalListView.as_view()),
    path('vendors/', VendorListView.as_view()),
]
