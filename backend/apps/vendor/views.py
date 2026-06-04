import hmac
import hashlib
import random
import string
from datetime import datetime, timezone, timedelta

import payment_utils
from django.conf import settings
from django.db.models import Case, When, IntegerField, Sum
from django.utils import timezone as dj_tz
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.auth_app.permissions import IsVendor, IsHospitalAdmin
from utils import log_audit, send_notification
from .models import (
    VendorRegistration, EquipmentCatalog, EquipmentOrder,
    VendorHospitalChat, VendorChatMessage,
)
from .serializers import (
    VendorProfileSerializer,
    EquipmentCatalogSerializer,
    EquipmentOrderSerializer,
    CreateProductSerializer,
    UpdateOrderStatusSerializer,
    VerifyPaymentSerializer,
)


def ok(message, data=None, status_code=200):
    return Response(
        {'success': True, 'message': message, 'data': data if data is not None else {}},
        status=status_code,
    )


def err(message, errors=None, status_code=400):
    return Response(
        {'success': False, 'message': message, 'errors': errors or {}},
        status=status_code,
    )


def get_vendor(request):
    try:
        return VendorRegistration.objects.select_related('login_id').get(login_id=request.user)
    except VendorRegistration.DoesNotExist:
        return None


def create_razorpay_order(amount_rupees):
    try:
        import razorpay
        client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
        order = client.order.create({
            'amount': int(float(amount_rupees) * 100),
            'currency': 'INR',
            'payment_capture': 1,
        })
        return order['id']
    except Exception:
        return ''


def generate_otp():
    return ''.join(random.choices(string.digits, k=6))


def pending_first_qs(qs):
    return qs.annotate(
        priority=Case(
            When(order_status='pending', then=0),
            When(order_status='confirmed', then=1),
            When(order_status='dispatched', then=2),
            When(order_status='delivered', then=3),
            default=4,
            output_field=IntegerField(),
        )
    ).order_by('priority', '-ordered_at')


# ─── Vendor Views ─────────────────────────────────────────────────────────────

class VendorDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def get(self, request):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        orders = EquipmentOrder.objects.filter(vendor_id=vendor)
        print(f'[VendorDashboard] {vendor.company_name}: total_orders={orders.count()}')
        revenue_agg = orders.filter(order_status='delivered').aggregate(
            total=Sum('total_price')
        )
        total_revenue = float(revenue_agg['total'] or 0)

        recent_orders = orders.select_related('hospital_id', 'product_id').order_by('-ordered_at')[:5]
        low_stock = EquipmentCatalog.objects.filter(vendor_id=vendor, stock_qty__lte=10)

        return ok('Vendor dashboard loaded.', {
            'company_name': vendor.company_name,
            'total_products': EquipmentCatalog.objects.filter(vendor_id=vendor).count(),
            'total_orders': orders.count(),
            'pending_orders': orders.filter(order_status='confirmed').count(),
            'confirmed_orders': orders.filter(order_status='confirmed').count(),
            'dispatched_orders': orders.filter(order_status='dispatched').count(),
            'delivered_orders': orders.filter(order_status='delivered').count(),
            'total_revenue': total_revenue,
            'recent_orders': EquipmentOrderSerializer(recent_orders, many=True).data,
            'low_stock_products': EquipmentCatalogSerializer(low_stock, many=True).data,
        })


class ListProductsView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def get(self, request):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        qs = EquipmentCatalog.objects.filter(vendor_id=vendor).order_by('-listed_at')
        category = request.query_params.get('category')
        if category:
            qs = qs.filter(category__iexact=category)

        return ok('Products retrieved.', EquipmentCatalogSerializer(qs, many=True).data)


class CreateProductView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def post(self, request):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        ser = CreateProductSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        d = ser.validated_data
        product = EquipmentCatalog.objects.create(
            vendor_id=vendor,
            product_name=d['product_name'],
            category=d.get('category', ''),
            specifications=d.get('specifications', {}),
            price=d['price'],
            stock_qty=d.get('stock_qty', 0),
            image_url=d.get('image_url', ''),
        )

        log_audit(
            login_id=request.user,
            action='Vendor created product',
            module='vendor',
            entity_type='EquipmentCatalog',
            entity_id=str(product.product_id),
        )
        return ok('Product created.', EquipmentCatalogSerializer(product).data, status_code=201)


class UpdateProductView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def put(self, request, product_id):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        try:
            product = EquipmentCatalog.objects.get(product_id=product_id, vendor_id=vendor)
        except EquipmentCatalog.DoesNotExist:
            return err('Product not found.', status_code=404)

        updatable = ['product_name', 'category', 'specifications', 'price', 'stock_qty', 'image_url']
        for field in updatable:
            if field in request.data:
                setattr(product, field, request.data[field])
        product.save()

        log_audit(
            login_id=request.user,
            action='Vendor updated product',
            module='vendor',
            entity_type='EquipmentCatalog',
            entity_id=str(product_id),
        )
        return ok('Product updated.', EquipmentCatalogSerializer(product).data)

    def delete(self, request, product_id):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        try:
            product = EquipmentCatalog.objects.get(product_id=product_id, vendor_id=vendor)
        except EquipmentCatalog.DoesNotExist:
            return err('Product not found.', status_code=404)

        has_pending = EquipmentOrder.objects.filter(
            product_id=product,
            order_status__in=['pending', 'confirmed', 'dispatched'],
        ).exists()
        if has_pending:
            return err('Cannot delete product with active pending orders.')

        log_audit(
            login_id=request.user,
            action='Vendor deleted product',
            module='vendor',
            entity_type='EquipmentCatalog',
            entity_id=str(product_id),
        )
        product.delete()
        return ok('Product deleted successfully.')


class ListOrdersView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def get(self, request):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        print(f'[ListOrders] Vendor: {vendor.company_name} (vendor_id={vendor.vendor_id})')
        qs = EquipmentOrder.objects.filter(vendor_id=vendor).select_related('hospital_id', 'product_id', 'vendor_id')
        print(f'[ListOrders] Total orders found: {qs.count()}')

        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(order_status=status_filter)
            print(f'[ListOrders] After status filter ({status_filter}): {qs.count()}')

        qs = pending_first_qs(qs)
        return ok('Orders retrieved.', EquipmentOrderSerializer(qs, many=True).data)


class GetOrderDetailView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def get(self, request, order_id):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        try:
            order = EquipmentOrder.objects.select_related(
                'hospital_id', 'product_id', 'vendor_id'
            ).get(eq_order_id=order_id, vendor_id=vendor)
        except EquipmentOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        data = EquipmentOrderSerializer(order).data
        data['hospital_contact'] = {
            'phone': order.hospital_id.contact_phone,
            'email': order.hospital_id.contact_email,
            'address': order.hospital_id.address,
            'city': order.hospital_id.city,
        }
        return ok('Order details retrieved.', data)


class UpdateOrderStatusView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def put(self, request, order_id):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        try:
            order = EquipmentOrder.objects.select_related(
                'hospital_id', 'product_id'
            ).get(eq_order_id=order_id, vendor_id=vendor)
        except EquipmentOrder.DoesNotExist:
            return err('Order not found.', status_code=404)

        ser = UpdateOrderStatusSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        d = ser.validated_data
        order.order_status = d['order_status']
        if d.get('tracking_info'):
            order.tracking_info = d['tracking_info']

        if d['order_status'] == 'delivered':
            order.installed_at = datetime.now(tz=timezone.utc)
            _update_hospital_inventory(order)

        order.save()

        status_messages = {
            'confirmed': 'Your equipment order has been confirmed and is being prepared.',
            'dispatched': 'Your equipment order has been dispatched.',
            'delivered': 'Your equipment order has been delivered. Inventory updated.',
        }
        send_notification(
            login_id=order.hospital_id.login_id,
            title=f'Equipment Order {d["order_status"].capitalize()}',
            message=status_messages.get(d['order_status'], 'Order status updated.'),
            notif_type='info',
            related_id=str(order_id),
        )

        log_audit(
            login_id=request.user,
            action=f'Equipment order status updated to {d["order_status"]}',
            module='vendor',
            entity_type='EquipmentOrder',
            entity_id=str(order_id),
        )
        return ok('Order status updated.', EquipmentOrderSerializer(order).data)


def _update_hospital_inventory(order):
    from apps.hospital.models import HospitalInventory
    from django.utils import timezone as dj_tz

    existing = HospitalInventory.objects.filter(
        hospital_id=order.hospital_id,
        item_name__iexact=order.product_id.product_name,
    ).first()

    if existing:
        existing.quantity += order.quantity
        existing.last_restocked = dj_tz.now()
        existing.save(update_fields=['quantity', 'last_restocked'])
    else:
        HospitalInventory.objects.create(
            hospital_id=order.hospital_id,
            item_name=order.product_id.product_name,
            category='medical_equipment',
            quantity=order.quantity,
            unit='unit',
            reorder_level=1,
            last_restocked=dj_tz.now(),
        )


class VerifyPaymentView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def post(self, request):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        ser = VerifyPaymentSerializer(data=request.data)
        if not ser.is_valid():
            return err('Validation failed.', errors=ser.errors)

        d = ser.validated_data
        razorpay_order_id = d['razorpay_order_id']
        razorpay_payment_id = d['razorpay_payment_id']
        razorpay_signature = d['razorpay_signature']

        try:
            order = EquipmentOrder.objects.select_related('hospital_id').get(
                razorpay_order_id=razorpay_order_id,
                vendor_id=vendor,
            )
        except EquipmentOrder.DoesNotExist:
            return err('Order not found for this Razorpay order ID.', status_code=404)

        expected_sig = hmac.new(
            settings.RAZORPAY_KEY_SECRET.encode(),
            f'{razorpay_order_id}|{razorpay_payment_id}'.encode(),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(expected_sig, razorpay_signature):
            order.payment_status = 'failed'
            order.save(update_fields=['payment_status'])
            return err('Payment signature verification failed.', status_code=400)

        order.razorpay_payment_id = razorpay_payment_id
        order.razorpay_signature = razorpay_signature
        order.payment_status = 'paid'
        order.order_status = 'confirmed'
        order.save(update_fields=[
            'razorpay_payment_id', 'razorpay_signature',
            'payment_status', 'order_status',
        ])

        send_notification(
            login_id=order.hospital_id.login_id,
            title='Equipment Payment Confirmed',
            message=f'Payment confirmed. {vendor.company_name} will process your order.',
            notif_type='success',
            related_id=str(order.eq_order_id),
        )

        log_audit(
            login_id=request.user,
            action='Equipment order payment verified',
            module='vendor',
            entity_type='EquipmentOrder',
            entity_id=str(order.eq_order_id),
        )
        return ok('Payment verified successfully.', {
            'eq_order_id': str(order.eq_order_id),
            'payment_status': order.payment_status,
            'order_status': order.order_status,
        })


# ─── Hospital Admin Views ─────────────────────────────────────────────────────

class BrowseCatalogView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def get(self, request):
        qs = EquipmentCatalog.objects.filter(
            vendor_id__approval_status='approved',
            stock_qty__gt=0,
        ).select_related('vendor_id').order_by('-listed_at')

        category = request.query_params.get('category')
        vendor_id = request.query_params.get('vendor_id')
        max_price = request.query_params.get('max_price')

        if category:
            qs = qs.filter(category__iexact=category)
        if vendor_id:
            qs = qs.filter(vendor_id__vendor_id=vendor_id)
        if max_price:
            try:
                qs = qs.filter(price__lte=float(max_price))
            except ValueError:
                return err('max_price must be a valid number.')

        data = []
        for p in qs:
            data.append({
                'product_id': str(p.product_id),
                'product_name': p.product_name,
                'category': p.category,
                'specifications': p.specifications,
                'price': str(p.price),
                'stock_qty': p.stock_qty,
                'image_url': p.image_url,
                'vendor_id': str(p.vendor_id.vendor_id),
                'vendor_name': p.vendor_id.company_name,
                'vendor_phone': p.vendor_id.phone,
                'listed_at': p.listed_at.isoformat() if p.listed_at else None,
            })
        print(f'[BrowseCatalog] Returning {len(data)} products')
        return ok('Catalog retrieved.', data)


class PlaceEquipmentOrderView(APIView):
    permission_classes = [IsAuthenticated, IsHospitalAdmin]

    def post(self, request):
        from apps.hospital.models import HospitalRegistration

        try:
            hospital = HospitalRegistration.objects.get(login_id=request.user)
        except HospitalRegistration.DoesNotExist:
            return err('Hospital profile not found.', status_code=404)

        product_id = request.data.get('product_id')
        quantity = request.data.get('quantity', 1)

        if not product_id:
            return err('product_id is required.')
        try:
            quantity = int(quantity)
            if quantity < 1:
                raise ValueError
        except (ValueError, TypeError):
            return err('quantity must be a positive integer.')

        try:
            product = EquipmentCatalog.objects.select_related('vendor_id').get(
                product_id=product_id,
                vendor_id__approval_status='approved',
            )
        except EquipmentCatalog.DoesNotExist:
            return err('Product not found or vendor not approved.', status_code=404)

        if product.stock_qty < quantity:
            return err(
                f'Insufficient stock. Available: {product.stock_qty}, Requested: {quantity}.'
            )

        total_price = product.price * quantity
        print(f'[PlaceOrder] Hospital: {hospital.hospital_name}, Product: {product.product_name}, Qty: {quantity}, Total: {total_price}')
        rz = payment_utils.create_razorpay_order(float(total_price), receipt=str(hospital.hospital_id)[:40])
        razorpay_order_id = rz['order_id'] if rz.get('success') else ''
        print(f'[PlaceOrder] Razorpay order created: {razorpay_order_id} (success={rz.get("success")})')

        order = EquipmentOrder.objects.create(
            hospital_id=hospital,
            vendor_id=product.vendor_id,
            product_id=product,
            quantity=quantity,
            total_price=total_price,
            razorpay_order_id=razorpay_order_id,
            status_history=[{
                'status': 'pending',
                'timestamp': dj_tz.now().strftime('%Y-%m-%d %H:%M'),
                'note': 'Order placed',
            }],
        )

        # Reserve stock
        product.stock_qty -= quantity
        product.save(update_fields=['stock_qty'])

        send_notification(
            login_id=product.vendor_id.login_id,
            title='New Equipment Order',
            message=f'{hospital.hospital_name} placed an order for {quantity}x {product.product_name}.',
            notif_type='alert',
            related_id=str(order.eq_order_id),
        )

        # Order confirmation emails to hospital and vendor.
        try:
            from email_utils import (
                send_equipment_order_hospital_email,
                send_equipment_order_vendor_email,
            )
            send_equipment_order_hospital_email(
                to_email=hospital.login_id.email,
                hospital_name=hospital.hospital_name,
                product_name=product.product_name,
                quantity=quantity,
                total_price=total_price,
                vendor_name=product.vendor_id.company_name,
                order_id=order.eq_order_id,
                estimated_days=order.estimated_delivery_days,
            )
            send_equipment_order_vendor_email(
                to_email=product.vendor_id.login_id.email,
                hospital_name=hospital.hospital_name,
                product_name=product.product_name,
                quantity=quantity,
                total_price=total_price,
            )
        except Exception as e:
            print(f'Order email error: {e}')

        log_audit(
            login_id=request.user,
            action='Hospital placed equipment order',
            module='vendor',
            entity_type='EquipmentOrder',
            entity_id=str(order.eq_order_id),
        )
        print(f'[PlaceOrder] Order created: eq_order_id={order.eq_order_id}')
        return ok('Equipment order placed.', {
            **EquipmentOrderSerializer(order).data,
            'razorpay_order_id': razorpay_order_id,
            'razorpay_key': rz.get('key_id', getattr(settings, 'RAZORPAY_KEY_ID', '')),
        }, status_code=201)


# ─── Dispatch & OTP ────────────────────────────────────────────────────────────

class DispatchOrderView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def put(self, request, order_id):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        try:
            order = EquipmentOrder.objects.select_related(
                'hospital_id', 'product_id', 'vendor_id'
            ).get(eq_order_id=order_id, vendor_id=vendor, order_status='confirmed')
        except EquipmentOrder.DoesNotExist:
            return err('Confirmed order not found.', status_code=404)

        estimated_days = int(request.data.get('estimated_delivery_days', 3))
        tracking_info = request.data.get('tracking_info', '').strip()

        otp = generate_otp()
        otp_expiry = dj_tz.now() + timedelta(days=estimated_days)

        history = list(order.status_history or [])
        history.append({
            'status': 'dispatched',
            'timestamp': dj_tz.now().strftime('%Y-%m-%d %H:%M'),
            'note': f'Dispatched. ETA: {estimated_days} days' + (f' | Tracking: {tracking_info}' if tracking_info else ''),
        })

        order.order_status = 'dispatched'
        order.delivery_otp = otp
        order.otp_expiry = otp_expiry
        order.estimated_delivery_days = estimated_days
        order.tracking_info = tracking_info
        order.dispatched_at = dj_tz.now()
        order.status_history = history
        order.save(update_fields=[
            'order_status', 'delivery_otp', 'otp_expiry',
            'estimated_delivery_days', 'tracking_info',
            'dispatched_at', 'status_history',
        ])

        hospital_email = order.hospital_id.login_id.email
        hospital_name = order.hospital_id.hospital_name

        try:
            from email_utils import send_dispatch_email
            send_dispatch_email(
                to_email=hospital_email,
                hospital_name=hospital_name,
                product_name=order.product_id.product_name,
                quantity=order.quantity,
                vendor_name=vendor.company_name,
                otp=otp,
                estimated_days=estimated_days,
                otp_expiry_str=otp_expiry.strftime('%d %b %Y %I:%M %p'),
                tracking_info=tracking_info,
            )
        except Exception as e:
            print(f'Dispatch email error: {e}')

        send_notification(
            login_id=order.hospital_id.login_id,
            title='Order Dispatched!',
            message=f'{order.product_id.product_name} dispatched by {vendor.company_name}. Check email for delivery OTP. ETA: {estimated_days} days.',
            notif_type='order',
            related_id=str(order_id),
        )

        log_audit(
            login_id=request.user,
            action=f'Dispatched order {order_id}',
            module='vendor',
            entity_type='EquipmentOrder',
            entity_id=str(order_id),
        )

        return ok(f'Order dispatched! OTP sent to {hospital_name}.', {
            'order_status': 'dispatched',
            'otp_expiry': otp_expiry.isoformat(),
            'estimated_days': estimated_days,
        })


class ResendOTPView(APIView):
    permission_classes = [IsAuthenticated, IsVendor]

    def post(self, request, order_id):
        vendor = get_vendor(request)
        if not vendor:
            return err('Vendor profile not found.', status_code=404)

        try:
            order = EquipmentOrder.objects.select_related(
                'hospital_id', 'product_id'
            ).get(eq_order_id=order_id, vendor_id=vendor, order_status='dispatched')
        except EquipmentOrder.DoesNotExist:
            return err('Dispatched order not found.', status_code=404)

        new_days = int(request.data.get('estimated_delivery_days', order.estimated_delivery_days or 3))
        new_otp = generate_otp()
        new_expiry = dj_tz.now() + timedelta(days=new_days)

        history = list(order.status_history or [])
        history.append({
            'status': 'otp_resent',
            'timestamp': dj_tz.now().strftime('%Y-%m-%d %H:%M'),
            'note': f'OTP resent. New ETA: {new_days} days',
        })

        order.delivery_otp = new_otp
        order.otp_expiry = new_expiry
        order.estimated_delivery_days = new_days
        order.status_history = history
        order.save(update_fields=[
            'delivery_otp', 'otp_expiry', 'estimated_delivery_days', 'status_history',
        ])

        hospital_email = order.hospital_id.login_id.email
        hospital_name = order.hospital_id.hospital_name

        try:
            from email_utils import send_otp_resend_email
            send_otp_resend_email(
                to_email=hospital_email,
                hospital_name=hospital_name,
                product_name=order.product_id.product_name,
                otp=new_otp,
                otp_expiry_str=new_expiry.strftime('%d %b %Y %I:%M %p'),
            )
        except Exception as e:
            print(f'OTP resend email error: {e}')

        send_notification(
            login_id=order.hospital_id.login_id,
            title='New Delivery OTP Sent',
            message=f'New OTP for {order.product_id.product_name} sent to your email. Valid for {new_days} days.',
            notif_type='order',
            related_id=str(order_id),
        )

        log_audit(
            login_id=request.user,
            action=f'Resent OTP for order {order_id}',
            module='vendor',
            entity_type='EquipmentOrder',
            entity_id=str(order_id),
        )

        return ok('New OTP sent to hospital email!', {})


# ─── Vendor ↔ Hospital Real-Time Chat ──────────────────────────────────────

def _ws_push(target_group, payload):
    """Best-effort push to a chat group on the channel layer (no Redis: in-memory)."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        layer = get_channel_layer()
        async_to_sync(layer.group_send)(target_group, {
            'type': 'chat_message',
            'data': payload,
        })
    except Exception as exc:
        print(f'[Chat WS] {exc}')


class GetOrCreateChatView(APIView):
    """Open (or reuse) the unique chat thread between this user's role and the
    other party. Either party can initiate; the role on the JWT decides the
    direction. Returns chat_id along with both display names."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from apps.hospital.models import HospitalRegistration

        login = request.user
        vendor_id = request.data.get('vendor_id')
        hospital_id = request.data.get('hospital_id')
        order_id = request.data.get('order_id')

        if login.role == 'vendor':
            try:
                vendor = VendorRegistration.objects.get(login_id=login)
            except VendorRegistration.DoesNotExist:
                return err('Vendor profile not found.', status_code=404)
            if not hospital_id:
                return err('hospital_id is required.')
            try:
                hospital = HospitalRegistration.objects.get(hospital_id=hospital_id)
            except HospitalRegistration.DoesNotExist:
                return err('Hospital not found.', status_code=404)
        elif login.role == 'hospital_admin':
            try:
                hospital = HospitalRegistration.objects.get(login_id=login)
            except HospitalRegistration.DoesNotExist:
                return err('Hospital profile not found.', status_code=404)
            if not vendor_id:
                return err('vendor_id is required.')
            try:
                vendor = VendorRegistration.objects.get(vendor_id=vendor_id)
            except VendorRegistration.DoesNotExist:
                return err('Vendor not found.', status_code=404)
        else:
            return err('Only vendors and hospital admins can use chat.', status_code=403)

        chat, created = VendorHospitalChat.objects.get_or_create(
            vendor_id=vendor, hospital_id=hospital,
        )

        # Pin to the order it was opened from (so the UI can display "Re: Order #…").
        if order_id:
            try:
                order = EquipmentOrder.objects.get(eq_order_id=order_id)
                if chat.order_id_id != order.eq_order_id:
                    chat.order_id = order
                    chat.save(update_fields=['order_id'])
            except EquipmentOrder.DoesNotExist:
                pass

        return ok('Chat ready.', {
            'chat_id': str(chat.chat_id),
            'vendor_id': str(vendor.vendor_id),
            'vendor_name': vendor.company_name,
            'hospital_id': str(hospital.hospital_id),
            'hospital_name': hospital.hospital_name,
            'created': created,
        })


class ChatMessagesView(APIView):
    """GET: fetch a chat's messages (and auto-mark incoming as read).
    POST: send a new message + push it to the other party over WebSocket."""
    permission_classes = [IsAuthenticated]

    def _get_chat(self, request, chat_id):
        try:
            return VendorHospitalChat.objects.select_related(
                'vendor_id', 'vendor_id__login_id',
                'hospital_id', 'hospital_id__login_id',
            ).get(chat_id=chat_id)
        except VendorHospitalChat.DoesNotExist:
            return None

    def _authorized(self, login, chat):
        if login.role == 'vendor':
            return chat.vendor_id.login_id_id == login.login_id
        if login.role == 'hospital_admin':
            return chat.hospital_id.login_id_id == login.login_id
        return False

    def get(self, request, chat_id):
        login = request.user
        chat = self._get_chat(request, chat_id)
        if not chat:
            return err('Chat not found.', status_code=404)
        if not self._authorized(login, chat):
            return err('Not authorized for this chat.', status_code=403)

        messages = VendorChatMessage.objects.filter(chat_id=chat).order_by('sent_at')

        # The user reading this view marks the *other* side's messages as read.
        if login.role == 'vendor':
            messages.filter(sender_type='hospital', is_read=False).update(is_read=True)
        else:
            messages.filter(sender_type='vendor', is_read=False).update(is_read=True)

        data = [{
            'message_id': str(m.message_id),
            'sender_type': m.sender_type,
            'message': m.message,
            'is_read': m.is_read,
            'sent_at': m.sent_at.isoformat(),
        } for m in messages]
        return ok('Messages retrieved.', data)

    def post(self, request, chat_id):
        login = request.user
        text = (request.data.get('message') or '').strip()
        if not text:
            return err('Message cannot be empty.')

        chat = self._get_chat(request, chat_id)
        if not chat:
            return err('Chat not found.', status_code=404)
        if not self._authorized(login, chat):
            return err('Not authorized for this chat.', status_code=403)

        sender_type = 'vendor' if login.role == 'vendor' else 'hospital'
        msg = VendorChatMessage.objects.create(
            chat_id=chat, sender_type=sender_type,
            sender_login=login, message=text, is_read=False,
        )
        chat.last_message_at = dj_tz.now()
        chat.save(update_fields=['last_message_at'])

        # Push to the *other* party's per-user chat group.
        if sender_type == 'vendor':
            target = f'chat_hospital_{chat.hospital_id.login_id.login_id}'
        else:
            target = f'chat_vendor_{chat.vendor_id.login_id.login_id}'

        payload = {
            'chat_id': str(chat.chat_id),
            'message_id': str(msg.message_id),
            'sender_type': sender_type,
            'message': text,
            'sent_at': msg.sent_at.isoformat(),
        }
        _ws_push(target, payload)

        return ok('Message sent.', {
            'message_id': str(msg.message_id),
            'message': text,
            'sender_type': sender_type,
            'sent_at': msg.sent_at.isoformat(),
        })


class VendorChatsListView(APIView):
    """List every chat thread for the current user (vendor or hospital admin)
    with the last message preview + unread count + optional order reference."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.hospital.models import HospitalRegistration

        login = request.user
        data = []

        if login.role == 'vendor':
            try:
                vendor = VendorRegistration.objects.get(login_id=login)
            except VendorRegistration.DoesNotExist:
                return err('Vendor profile not found.', status_code=404)

            chats = VendorHospitalChat.objects.filter(
                vendor_id=vendor,
            ).select_related('hospital_id', 'order_id').order_by('-last_message_at')

            for chat in chats:
                last_msg = VendorChatMessage.objects.filter(
                    chat_id=chat,
                ).order_by('-sent_at').first()
                unread = VendorChatMessage.objects.filter(
                    chat_id=chat, sender_type='hospital', is_read=False,
                ).count()
                data.append({
                    'chat_id': str(chat.chat_id),
                    'hospital_name': chat.hospital_id.hospital_name,
                    'hospital_id': str(chat.hospital_id.hospital_id),
                    'last_message': last_msg.message if last_msg else '',
                    'last_message_time': last_msg.sent_at.isoformat() if last_msg else '',
                    'unread_count': unread,
                    'order_ref': str(chat.order_id.eq_order_id)[:8] if chat.order_id else '',
                })

        elif login.role == 'hospital_admin':
            try:
                hospital = HospitalRegistration.objects.get(login_id=login)
            except HospitalRegistration.DoesNotExist:
                return err('Hospital profile not found.', status_code=404)

            chats = VendorHospitalChat.objects.filter(
                hospital_id=hospital,
            ).select_related('vendor_id', 'order_id').order_by('-last_message_at')

            for chat in chats:
                last_msg = VendorChatMessage.objects.filter(
                    chat_id=chat,
                ).order_by('-sent_at').first()
                unread = VendorChatMessage.objects.filter(
                    chat_id=chat, sender_type='vendor', is_read=False,
                ).count()
                data.append({
                    'chat_id': str(chat.chat_id),
                    'vendor_name': chat.vendor_id.company_name,
                    'vendor_id': str(chat.vendor_id.vendor_id),
                    'last_message': last_msg.message if last_msg else '',
                    'last_message_time': last_msg.sent_at.isoformat() if last_msg else '',
                    'unread_count': unread,
                    'order_ref': str(chat.order_id.eq_order_id)[:8] if chat.order_id else '',
                })
        else:
            return err('Chat is only available for vendors and hospital admins.', status_code=403)

        return Response({
            'success': True,
            'message': 'Chats retrieved.',
            'data': data,
            'total_unread': sum(d['unread_count'] for d in data),
        })
