import logging

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

import payment_utils
from apps.auth_app.permissions import IsHospitalAdmin, IsVendor
from utils import log_audit
from .models import EquipmentCatalog, EquipmentOrder
from .serializers import EquipmentOrderSerializer

logger = logging.getLogger(__name__)


def release_order_stock(order):
    if not order.stock_released:
        EquipmentCatalog.objects.filter(pk=order.product_id_id).update(stock_qty=F('stock_qty') + order.quantity)
        order.stock_released = True


class CancelEquipmentOrderView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request, order_id):
        from .views import err, ok

        with transaction.atomic():
            order = EquipmentOrder.objects.select_for_update(of=('self',)).filter(
                pk=order_id, hospital_id__login_id=request.user,
            ).first()
            if not order:
                return err('Order not found.', status_code=404)
            if order.order_status == 'cancelled':
                return ok('Order already cancelled.', EquipmentOrderSerializer(order).data)
            if not order.can_cancel:
                return err('Only orders that have not been dispatched can be cancelled.', status_code=409)
            order.order_status = 'cancelled'
            release_order_stock(order)
            order.status_history = [*(order.status_history or []), {
                'status': 'cancelled', 'timestamp': timezone.now().isoformat(),
                'note': 'Cancelled by hospital. A paid order remains eligible for a vendor refund.',
            }]
            order.save(update_fields=['order_status', 'stock_released', 'status_history', 'updated_at'])
            log_audit(request.user, 'equipment_order_cancelled', module='vendor',
                      entity_type='EquipmentOrder', entity_id=order.pk)
        return ok('Order cancelled. The vendor can refund any captured payment.', EquipmentOrderSerializer(order).data)


class RefundEquipmentOrderView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def post(self, request, order_id):
        from apps.hospital.models import HospitalInventory
        from .views import err, ok

        with transaction.atomic():
            order = EquipmentOrder.objects.select_for_update(of=('self',)).filter(
                pk=order_id, vendor_id__login_id=request.user,
            ).first()
            if not order:
                return err('Order not found.', status_code=404)
            if order.payment_status == 'refunded':
                return ok('Order already refunded.', EquipmentOrderSerializer(order).data)
            pending = order.refund_status == 'pending'
            if not pending and not order.can_refund:
                return err('Refunds require a paid cancelled order or a return within 7 days of delivery.', status_code=400)
            if not order.razorpay_payment_id:
                return err('This order has no captured payment reference. Check its payment in Razorpay.', status_code=400)
            returned = bool(order.delivered_at or order.installed_at)
            if returned and not pending and request.data.get('return_received') is not True:
                return err('Confirm that the returned product has been received.', status_code=400)
            inventory = None
            if returned and not order.stock_released and not order.return_inventory_reserved:
                inventory = HospitalInventory.objects.select_for_update().filter(
                    hospital_id=order.hospital_id_id, item_name__iexact=order.product_id.product_name,
                ).first()
                if not inventory or inventory.quantity < order.quantity:
                    return err('Hospital inventory does not contain the full quantity being returned.', status_code=409)
                inventory.quantity -= order.quantity
                inventory.save(update_fields=['quantity'])
                order.return_inventory_reserved = True

            order.refund_status = 'pending'
            if not order.refund_requested_at:
                order.refund_requested_at = timezone.now()
            order.save(update_fields=['refund_status', 'refund_requested_at', 'return_inventory_reserved'])
            try:
                client = payment_utils.get_razorpay_client()
                if order.refund_id:
                    refund = client.payment.fetch_refund_id(order.razorpay_payment_id, order.refund_id, timeout=15)
                else:
                    refund = client.payment.refund(
                        order.razorpay_payment_id, {'amount': int(order.total_price * 100)},
                        headers={'X-Refund-Idempotency': f'equipment-{order.pk}'}, timeout=15,
                    )
                if refund.get('payment_id') != order.razorpay_payment_id or refund.get('amount') != int(order.total_price * 100):
                    raise ValueError('Refund response does not match the order.')
                order.refund_id = refund['id']
                refund_status = refund.get('status')
            except Exception as exc:
                logger.warning('Equipment refund awaiting reconciliation (%s)', type(exc).__name__)
                return ok('Refund status could not be confirmed. Use Check Refund Status to retry safely.',
                          EquipmentOrderSerializer(order).data, status_code=202)

            if refund_status != 'processed':
                order.refund_status = 'failed' if refund_status == 'failed' else 'pending'
                if refund_status == 'failed' and order.return_inventory_reserved:
                    returned_inventory = HospitalInventory.objects.select_for_update().filter(
                        hospital_id=order.hospital_id_id, item_name__iexact=order.product_id.product_name,
                    ).first()
                    if returned_inventory:
                        returned_inventory.quantity += order.quantity
                        returned_inventory.save(update_fields=['quantity'])
                    order.return_inventory_reserved = False
                order.save(update_fields=['refund_status', 'refund_id', 'return_inventory_reserved'])
                message = 'The payment provider reported a failed refund. Contact support.' if refund_status == 'failed' else 'Refund submitted. Use Check Refund Status to confirm completion.'
                return ok(message, EquipmentOrderSerializer(order).data, status_code=202)

            release_order_stock(order)
            order.refund_status = 'processed'
            order.payment_status = 'refunded'
            order.order_status = 'refunded'
            order.final_resolution = 'refund'
            order.status_history = [*(order.status_history or []), {
                'status': 'refunded', 'timestamp': timezone.now().isoformat(),
                'note': 'Full refund processed by the payment provider.',
            }]
            order.save(update_fields=[
                'refund_id', 'refund_status', 'payment_status', 'order_status', 'final_resolution',
                'stock_released', 'status_history', 'updated_at',
            ])
            log_audit(request.user, 'equipment_order_refunded', module='vendor',
                      entity_type='EquipmentOrder', entity_id=order.pk)
        return ok('Full refund processed.', EquipmentOrderSerializer(order).data)
