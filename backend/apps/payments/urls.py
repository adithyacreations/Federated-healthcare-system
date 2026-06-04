from django.urls import path
from .views import (
    CreatePaymentOrderView,
    VerifyPaymentView,
    PaymentHistoryView,
    RefundRequestView,
)

urlpatterns = [
    path('create-order/', CreatePaymentOrderView.as_view(), name='payment-create-order'),
    path('verify/', VerifyPaymentView.as_view(), name='payment-verify'),
    path('history/', PaymentHistoryView.as_view(), name='payment-history'),
    path('refund/', RefundRequestView.as_view(), name='payment-refund'),
]
