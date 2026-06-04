from django.contrib import admin
from .models import VendorRegistration, EquipmentCatalog, EquipmentOrder

admin.site.register(VendorRegistration)
admin.site.register(EquipmentCatalog)
admin.site.register(EquipmentOrder)
