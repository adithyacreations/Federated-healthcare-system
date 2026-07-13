from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.auth_app.permissions import IsHospitalAdmin
from billing_utils import (
    bill_pdf_response,
    billable_payment_status,
    decimal_value,
    format_datetime,
)


def err(message, errors=None, status=400):
    return Response(
        {'success': False, 'message': message, 'errors': errors if errors is not None else {}},
        status=status,
    )


def get_hospital(request):
    return request.user.hospital_profile


class EquipmentOrderBillView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request, order_id):
        from apps.vendor.models import EquipmentOrder

        hospital = get_hospital(request)
        try:
            order = EquipmentOrder.objects.select_related(
                'hospital_id', 'hospital_id__login_id', 'vendor_id', 'vendor_id__login_id',
                'product_id',
            ).get(eq_order_id=order_id, hospital_id=hospital)
        except EquipmentOrder.DoesNotExist:
            return err('Equipment order not found.', status=404)

        if not billable_payment_status(order.payment_status):
            return err('Bill is available after payment.', status=400)

        product = order.product_id
        vendor = order.vendor_id
        unit_price = (
            decimal_value(order.total_price) / decimal_value(order.quantity)
            if order.quantity else decimal_value(product.price)
        )
        bill_no = f'EQP-{str(order.eq_order_id)[:8].upper()}'
        return bill_pdf_response(
            title='Hospital Product Purchase Bill',
            bill_no=bill_no,
            billed_to={
                'name': hospital.hospital_name,
                'address': hospital.address,
                'contact': hospital.contact_email or hospital.contact_phone,
            },
            provider={
                'name': vendor.company_name,
                'address': '',
                'contact': vendor.login_id.email if vendor.login_id else vendor.phone,
            },
            rows=[{
                'description': product.product_name,
                'qty': order.quantity,
                'unit_price': unit_price,
                'amount': order.total_price,
            }],
            total_amount=order.total_price,
            payment_status=order.payment_status,
            meta_rows=[
                ('Order ID', str(order.eq_order_id)),
                ('Order Date', format_datetime(order.ordered_at)),
                ('Category', product.category),
                ('Order Status', order.order_status.replace('_', ' ').title()),
                ('Razorpay Order ID', order.razorpay_order_id),
                ('Razorpay Payment ID', order.razorpay_payment_id),
            ],
            notes='Keep this bill for hospital purchase, inventory, and vendor reference.',
        )
