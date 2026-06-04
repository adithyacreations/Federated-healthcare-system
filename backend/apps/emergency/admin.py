from django.contrib import admin
from .models import AmbulanceDriverRegistration, Ambulance, EmergencyRequest, AmbulanceDispatch

admin.site.register(AmbulanceDriverRegistration)
admin.site.register(Ambulance)
admin.site.register(EmergencyRequest)
admin.site.register(AmbulanceDispatch)
