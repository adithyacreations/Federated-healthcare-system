from django.urls import path
from .views import (
    SymptomCheckerView,
    GetSymptomsListView,
    ClinicalDiagnosisView,
    RiskPredictionView,
    PatientRiskHistoryView,
    TriageHistoryView,
    AIStatsView,
    XRayPredictionView,
    BrainTumorPredictionView,
    ChestMultiLabelView,
    SkinDiseaseView,
    GeminiHealthSummaryView,
    GeminiChatView,
)

urlpatterns = [
    path('symptom-check/', SymptomCheckerView.as_view(), name='ai-symptom-check'),
    path('symptoms-list/', GetSymptomsListView.as_view(), name='ai-symptoms-list'),
    path('clinical-diagnosis/', ClinicalDiagnosisView.as_view(), name='ai-clinical-diagnosis'),
    path('risk-predict/', RiskPredictionView.as_view(), name='ai-risk-predict'),
    path('risk-history/', PatientRiskHistoryView.as_view(), name='ai-risk-history'),
    path('triage-history/', TriageHistoryView.as_view(), name='ai-triage-history'),
    path('stats/', AIStatsView.as_view(), name='ai-stats'),
    path('xray-predict/', XRayPredictionView.as_view(), name='ai-xray-predict'),
    path('brain-tumor/', BrainTumorPredictionView.as_view(), name='ai-brain-tumor'),
    path('chest-multilabel/', ChestMultiLabelView.as_view(), name='ai-chest-multilabel'),
    path('skin-disease/', SkinDiseaseView.as_view(), name='ai-skin-disease'),

    # Gemini proxies — keep the API key server-side (final URLs: /api/ai/...)
    path('health-summary/', GeminiHealthSummaryView.as_view(), name='ai-health-summary'),
    path('chat/', GeminiChatView.as_view(), name='ai-chat'),
]
