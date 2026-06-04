from django.contrib import admin
from .models import LabTechRegistration, LabOrder, LabReport

admin.site.register(LabTechRegistration)
admin.site.register(LabOrder)
admin.site.register(LabReport)
