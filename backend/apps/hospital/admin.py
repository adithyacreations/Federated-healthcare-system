from django.contrib import admin
from .models import HospitalRegistration, Department, Bed, HospitalInventory, HospitalPatient

admin.site.register(HospitalRegistration)
admin.site.register(Department)
admin.site.register(Bed)
admin.site.register(HospitalInventory)
admin.site.register(HospitalPatient)
