from django.contrib import admin
from .models import PharmacistRegistration, MedicineOrder

admin.site.register(PharmacistRegistration)
admin.site.register(MedicineOrder)
