from django.urls import path
from .views import (
    VendorDashboardView,
    ListProductsView,
    CreateProductView,
    UpdateProductView,
    ListOrdersView,
    GetOrderDetailView,
    UpdateOrderStatusView,
    VerifyPaymentView,
    BrowseCatalogView,
    PlaceEquipmentOrderView,
    DispatchOrderView,
    ResendOTPView,
    GetOrCreateChatView,
    ChatMessagesView,
    VendorChatsListView,
)

urlpatterns = [
    path('dashboard/', VendorDashboardView.as_view()),
    path('products/', ListProductsView.as_view()),
    path('products/create/', CreateProductView.as_view()),
    path('products/<uuid:product_id>/', UpdateProductView.as_view()),
    path('orders/', ListOrdersView.as_view()),
    path('orders/<uuid:order_id>/', GetOrderDetailView.as_view()),
    path('orders/<uuid:order_id>/status/', UpdateOrderStatusView.as_view()),
    path('orders/<uuid:order_id>/dispatch/', DispatchOrderView.as_view()),
    path('orders/<uuid:order_id>/resend-otp/', ResendOTPView.as_view()),
    path('verify-payment/', VerifyPaymentView.as_view()),
    path('catalog/', BrowseCatalogView.as_view()),
    path('place-order/', PlaceEquipmentOrderView.as_view()),

    # Real-time chat between vendor and hospital admin.
    path('chat/get-or-create/', GetOrCreateChatView.as_view()),
    path('chat/<uuid:chat_id>/messages/', ChatMessagesView.as_view()),
    path('chats/', VendorChatsListView.as_view()),
]
