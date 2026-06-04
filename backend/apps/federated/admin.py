from django.contrib import admin
from .models import FLGlobalModel, FLRound, FLHospitalWeight, EpidemicTrend

admin.site.register(FLGlobalModel)
admin.site.register(FLRound)
admin.site.register(FLHospitalWeight)
admin.site.register(EpidemicTrend)
