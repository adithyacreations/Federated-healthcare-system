from django.contrib import admin
from .models import PatientRegistration, EHRRecord, Allergy, EHRConsentLog, RiskAssessment

admin.site.register(PatientRegistration)
admin.site.register(EHRRecord)
admin.site.register(Allergy)
admin.site.register(EHRConsentLog)
admin.site.register(RiskAssessment)
