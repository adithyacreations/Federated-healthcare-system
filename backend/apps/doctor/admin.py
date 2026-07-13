from django.contrib import admin
from .models import DoctorRegistration, DoctorSchedule, DoctorSlot, Consultation, Prescription

admin.site.register(DoctorRegistration)
admin.site.register(DoctorSchedule)
admin.site.register(DoctorSlot)
admin.site.register(Consultation)
admin.site.register(Prescription)
