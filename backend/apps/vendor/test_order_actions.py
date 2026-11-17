from datetime import timedelta
from unittest.mock import Mock, patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.auth_app.models import LoginCredentials
from apps.hospital.models import HospitalInventory, HospitalRegistration
from payment_utils import process_payment_success
from .models import EquipmentCatalog, EquipmentOrder, VendorDriver, VendorRegistration


@override_settings(RAZORPAY_KEY_ID='test_key', RAZORPAY_KEY_SECRET='test_secret')
class EquipmentOrderActionsTests(TestCase):
    def setUp(self):
        self.hospital_login = LoginCredentials.objects.create(email='actions-hospital@example.test', role='hospital_admin')
        self.hospital = HospitalRegistration.objects.create(
            login_id=self.hospital_login, hospital_name='Test Hospital', registration_no='actions-hospital',
        )
        self.vendor_login = LoginCredentials.objects.create(email='actions-vendor@example.test', role='vendor')
        vendor = VendorRegistration.objects.create(
            login_id=self.vendor_login, company_name='Test Vendor', tax_id='actions-vendor', approval_status='approved',
        )
        self.driver = VendorDriver.objects.create(vendor_id=vendor, name='Demo Driver', phone='9876543210')
        self.product = EquipmentCatalog.objects.create(vendor_id=vendor, product_name='Demo Monitor', stock_qty=8, price=100)
        self.order = EquipmentOrder.objects.create(
            hospital_id=self.hospital, vendor_id=vendor, product_id=self.product, quantity=2,
            total_price=200, order_status='confirmed', payment_status='paid', razorpay_payment_id='pay_demo',
        )
        self.base = f'/api/vendor/orders/{self.order.pk}/'
        self.client = APIClient()
        self.client.force_authenticate(self.hospital_login)
        self.gateway = Mock()
        self.gateway.payment.refund.return_value = self.refund_response('processed')
        self.gateway_patch = patch('payment_utils.get_razorpay_client', return_value=self.gateway)
        self.gateway_patch.start()
        self.addCleanup(self.gateway_patch.stop)
        self.checkout_gateway_patch = patch('apps.payments.views.get_razorpay_client', return_value=self.gateway)
        self.checkout_gateway_patch.start()
        self.addCleanup(self.checkout_gateway_patch.stop)

    def refund_response(self, status):
        return {'id': 'rfnd_demo', 'status': status, 'payment_id': 'pay_demo', 'amount': 20000}

    def delivered(self, days=2):
        self.order.order_status = 'delivered'
        self.order.delivered_at = timezone.now() - timedelta(days=days)
        self.order.save()
        HospitalInventory.objects.create(
            hospital_id=self.hospital, item_name=self.product.product_name, quantity=2,
        )

    def test_cancel_is_scoped_idempotent_and_keeps_payment_for_refund(self):
        response = self.client.post(self.base + 'cancel/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.post(self.base + 'cancel/').status_code, 200)
        self.order.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(self.order.order_status, 'cancelled')
        self.assertEqual(self.order.payment_status, 'paid')
        self.assertEqual(self.product.stock_qty, 10)
        self.assertTrue(self.order.can_refund)
        listing = self.client.get('/api/hospital/equipment-orders/')
        self.assertFalse(listing.data['data'][0]['can_cancel'])

    def test_cannot_cancel_dispatched_or_other_hospital_order(self):
        self.order.order_status = 'dispatched'
        self.order.save()
        self.assertEqual(self.client.post(self.base + 'cancel/').status_code, 409)
        outsider = LoginCredentials.objects.create(email='other-hospital@example.test', role='hospital_admin')
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.post(self.base + 'cancel/').status_code, 404)

    def test_unpaid_order_dispatch_explains_why_it_is_unavailable(self):
        self.order.order_status = 'pending'
        self.order.payment_status = 'pending'
        self.order.save()
        self.client.force_authenticate(self.vendor_login)
        response = self.client.put(self.base + 'dispatch/', {'driver_id': str(self.driver.pk)}, format='json')
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIn('paid', response.data['message'])
        self.order.refresh_from_db()
        self.driver.refresh_from_db()
        self.assertEqual(self.order.order_status, 'pending')
        self.assertTrue(self.driver.is_available)

    @patch('apps.vendor.views.send_notification')
    @patch('email_utils.send_dispatch_email')
    def test_dispatch_paid_pending_order_assigns_driver_and_cannot_repeat(self, _email, _notify):
        self.order.order_status = 'pending'
        self.order.save()
        self.client.force_authenticate(self.vendor_login)
        response = self.client.put(self.base + 'dispatch/', {'driver_id': str(self.driver.pk)}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.order.refresh_from_db()
        self.driver.refresh_from_db()
        self.assertEqual(self.order.order_status, 'dispatched')
        self.assertIsNotNone(self.order.dispatched_at)
        self.assertFalse(self.driver.is_available)
        self.assertEqual(self.client.put(self.base + 'dispatch/', {'driver_id': str(self.driver.pk)}).status_code, 404)

    def test_cancelled_order_refund_calls_gateway_once_and_never_double_restocks(self):
        self.client.post(self.base + 'cancel/')
        self.client.force_authenticate(self.vendor_login)
        response = self.client.post(self.base + 'refund/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.post(self.base + 'refund/').status_code, 200)
        self.gateway.payment.refund.assert_called_once_with(
            'pay_demo', {'amount': 20000},
            headers={'X-Refund-Idempotency': f'equipment-{self.order.pk}'}, timeout=15,
        )
        self.product.refresh_from_db()
        self.order.refresh_from_db()
        self.assertEqual(self.product.stock_qty, 10)
        self.assertEqual(self.order.payment_status, 'refunded')

    def test_delivered_return_requires_confirmation_and_updates_both_inventories(self):
        self.delivered()
        self.client.force_authenticate(self.vendor_login)
        self.assertEqual(self.client.post(self.base + 'refund/').status_code, 400)
        response = self.client.post(self.base + 'refund/', {'return_received': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(HospitalInventory.objects.get().quantity, 0)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_qty, 10)

    def test_expired_return_is_rejected_on_all_refund_entry_points(self):
        self.delivered(days=8)
        self.assertFalse(self.order.can_refund)
        response = self.client.post('/api/payment/refund/', {
            'payment_type': 'equipment', 'object_id': str(self.order.pk),
        }, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.client.force_authenticate(self.vendor_login)
        self.assertEqual(self.client.post(self.base + 'refund/', {'return_received': True}, format='json').status_code, 400)
        self.gateway.payment.refund.assert_not_called()

    def test_seven_day_boundary_expires_exactly_and_other_vendor_is_denied(self):
        self.delivered()
        deadline = self.order.return_deadline
        with patch('django.utils.timezone.now', return_value=deadline - timedelta(seconds=1)):
            self.assertTrue(self.order.can_refund)
        with patch('django.utils.timezone.now', return_value=deadline):
            self.assertFalse(self.order.can_refund)
        other = LoginCredentials.objects.create(email='other-vendor@example.test', role='vendor')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.post(self.base + 'refund/', {'return_received': True}, format='json').status_code, 404)

    def test_pending_provider_refund_is_reconciled_without_new_payment_request(self):
        self.client.post(self.base + 'cancel/')
        self.client.force_authenticate(self.vendor_login)
        self.gateway.payment.refund.return_value = self.refund_response('pending')
        self.assertEqual(self.client.post(self.base + 'refund/').status_code, 202)
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, 'paid')
        self.assertEqual(self.order.refund_status, 'pending')
        self.gateway.payment.fetch_refund_id.return_value = self.refund_response('processed')
        response = self.client.post(self.base + 'refund/')
        self.assertEqual(response.status_code, 200, response.data)
        self.gateway.payment.refund.assert_called_once()
        self.gateway.payment.fetch_refund_id.assert_called_once_with('pay_demo', 'rfnd_demo', timeout=15)

    def test_provider_timeout_keeps_refund_pending_and_reuses_idempotency_key(self):
        self.client.post(self.base + 'cancel/')
        self.client.force_authenticate(self.vendor_login)
        self.gateway.payment.refund.side_effect = [TimeoutError(), self.refund_response('processed')]
        self.assertEqual(self.client.post(self.base + 'refund/').status_code, 202)
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, 'paid')
        self.assertEqual(self.order.refund_status, 'pending')
        self.assertEqual(self.client.post(self.base + 'refund/').status_code, 200)
        calls = self.gateway.payment.refund.call_args_list
        self.assertEqual(calls[0], calls[1])

    def test_return_inventory_is_reserved_once_and_pending_refund_can_finish_after_deadline(self):
        self.delivered(days=6)
        self.client.force_authenticate(self.vendor_login)
        self.gateway.payment.refund.return_value = self.refund_response('pending')
        response = self.client.post(self.base + 'refund/', {'return_received': True}, format='json')
        self.assertEqual(response.status_code, 202, response.data)
        self.assertEqual(HospitalInventory.objects.get().quantity, 0)
        self.gateway.payment.fetch_refund_id.return_value = self.refund_response('processed')
        with patch('django.utils.timezone.now', return_value=timezone.now() + timedelta(days=2)):
            response = self.client.post(self.base + 'refund/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(HospitalInventory.objects.get().quantity, 0)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_qty, 10)

    def test_provider_failure_does_not_mark_paid_order_refunded(self):
        self.delivered()
        self.client.force_authenticate(self.vendor_login)
        self.gateway.payment.refund.return_value = self.refund_response('failed')
        response = self.client.post(self.base + 'refund/', {'return_received': True}, format='json')
        self.assertEqual(response.status_code, 202, response.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, 'paid')
        self.assertEqual(self.order.refund_status, 'failed')
        self.assertEqual(HospitalInventory.objects.get().quantity, 2)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_qty, 8)

    def test_repeated_payment_does_not_reopen_dispatched_order(self):
        self.order.order_status = 'dispatched'
        self.order.save()
        result = process_payment_success('equipment', self.order.pk, 'pay_demo')
        self.assertTrue(result['success'])
        self.order.refresh_from_db()
        self.assertEqual(self.order.order_status, 'dispatched')

    def test_late_payment_confirmation_does_not_reopen_cancelled_order(self):
        self.order.payment_status = 'pending'
        self.order.save()
        self.client.post(self.base + 'cancel/')
        response = process_payment_success('equipment', self.order.pk, 'pay_demo')
        self.assertTrue(response['success'])
        self.order.refresh_from_db()
        self.assertEqual(self.order.order_status, 'cancelled')
        self.assertEqual(self.order.payment_status, 'paid')
        self.assertTrue(self.order.can_refund)

    def pending_checkout(self):
        self.order.order_status = 'pending'
        self.order.payment_status = 'pending'
        self.order.razorpay_payment_id = ''
        self.order.save()
        self.gateway.order.create.return_value = {
            'id': 'order_demo', 'status': 'created', 'amount': 20000, 'currency': 'INR', 'amount_paid': 0,
        }
        self.gateway.order.fetch.return_value = self.gateway.order.create.return_value.copy()
        return {'payment_type': 'equipment', 'object_id': str(self.order.pk), 'amount': '0.01'}

    def test_checkout_uses_saved_total_and_reuses_gateway_order_without_reserving_stock_again(self):
        payload = self.pending_checkout()
        first = self.client.post('/api/payment/create-order/', payload, format='json')
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data['data']['amount'], 20000)
        second = self.client.post('/api/payment/create-order/', payload, format='json')
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data['data']['razorpay_order_id'], 'order_demo')
        self.gateway.order.create.assert_called_once()
        self.assertEqual(self.gateway.order.create.call_args.args[0]['amount'], 20000)
        self.gateway.order.fetch.assert_called_once_with('order_demo', timeout=15)
        self.product.refresh_from_db()
        self.order.refresh_from_db()
        self.assertEqual(self.product.stock_qty, 8)
        self.assertEqual(EquipmentOrder.objects.count(), 1)
        self.assertEqual(self.order.payment_status, 'pending')

    def test_checkout_rejects_other_hospital_cancelled_paid_and_captured_orders(self):
        payload = self.pending_checkout()
        outsider = LoginCredentials.objects.create(email='outsider-pay@example.test', role='hospital_admin')
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.post('/api/payment/create-order/', payload).status_code, 404)
        self.client.force_authenticate(self.hospital_login)
        for status, payment in [('cancelled', 'pending'), ('confirmed', 'paid'), ('refunded', 'refunded')]:
            self.order.order_status, self.order.payment_status = status, payment
            self.order.save()
            self.assertEqual(self.client.post('/api/payment/create-order/', payload).status_code, 409)
        self.gateway.order.create.assert_not_called()
        self.pending_checkout()
        self.order.razorpay_order_id = 'order_demo'
        self.order.save()
        self.gateway.order.fetch.return_value['status'] = 'paid'
        self.gateway.order.fetch.return_value['amount_paid'] = 20000
        self.assertEqual(self.client.post('/api/payment/create-order/', payload).status_code, 409)
        self.gateway.order.create.assert_not_called()

    @override_settings(RAZORPAY_KEY_ID='', RAZORPAY_KEY_SECRET='')
    def test_checkout_missing_credentials_leaves_saved_order_unpaid(self):
        payload = self.pending_checkout()
        self.assertEqual(self.client.post('/api/payment/create-order/', payload).status_code, 503)
        self.gateway.order.create.assert_not_called()
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, 'pending')

    def test_checkout_gateway_failure_keeps_order_available_for_retry(self):
        payload = self.pending_checkout()
        self.gateway.order.create.side_effect = TimeoutError('provider timeout')
        self.assertEqual(self.client.post('/api/payment/create-order/', payload).status_code, 502)
        self.order.refresh_from_db()
        self.assertEqual(self.order.razorpay_order_id, '')
        self.assertEqual(self.order.payment_status, 'pending')

    @patch('apps.payments.views.verify_razorpay_payment', return_value=True)
    @patch('utils.send_notification')
    def test_checkout_verification_checks_owner_and_provider_order_then_confirms(self, _notify, verify):
        payload = self.pending_checkout()
        self.assertEqual(self.client.post('/api/payment/create-order/', payload).status_code, 200)
        payment = {
            'payment_type': 'equipment', 'object_id': str(self.order.pk),
            'razorpay_order_id': 'different_order', 'razorpay_payment_id': 'pay_verified',
            'razorpay_signature': 'mock_signature',
        }
        self.assertEqual(self.client.post('/api/payment/verify/', payment).status_code, 400)
        verify.assert_not_called()
        payment['razorpay_order_id'] = 'order_demo'
        self.client.force_authenticate(self.vendor_login)
        self.assertEqual(self.client.post('/api/payment/verify/', payment).status_code, 404)
        self.client.force_authenticate(self.hospital_login)
        response = self.client.post('/api/payment/verify/', payment)
        self.assertEqual(response.status_code, 200, response.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.order_status, 'confirmed')
        self.assertEqual(self.order.payment_status, 'paid')
        verify.assert_called_once()

    def test_checkout_amount_limit_explains_rejection_without_changing_order_or_stock(self):
        from razorpay.errors import BadRequestError
        payload = self.pending_checkout()
        self.order.total_price = 40000000
        self.order.save()
        self.gateway.order.create.side_effect = BadRequestError('Amount exceeds maximum amount allowed. private_gateway_debug')
        response = self.client.post('/api/payment/create-order/', payload)
        self.assertEqual(response.status_code, 422, response.data)
        self.assertEqual(response.data['errors']['code'], 'payment_amount_limit')
        self.assertIn('transaction limit', response.data['message'])
        self.assertNotIn('private_gateway_debug', str(response.data))
        self.order.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(self.order.total_price, 40000000)
        self.assertEqual(self.order.payment_status, 'pending')
        self.assertEqual(self.order.razorpay_order_id, '')
        self.assertEqual(self.product.stock_qty, 8)

    @patch('email_utils.send_equipment_order_vendor_email')
    @patch('email_utils.send_equipment_order_hospital_email')
    @patch('apps.vendor.views.send_notification')
    def test_new_order_returns_safe_gateway_rejection_for_checkout(self, _notify, _hospital_email, _vendor_email):
        from razorpay.errors import BadRequestError
        self.product.price = 40000000
        self.product.save()
        self.gateway.order.create.side_effect = BadRequestError('Amount exceeds maximum amount allowed.')
        response = self.client.post('/api/vendor/place-order/', {
            'product_id': str(self.product.pk), 'quantity': 1,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['data']['payment_error_code'], 'payment_amount_limit')
        self.assertIn('transaction limit', response.data['data']['payment_error'])
        self.assertEqual(response.data['data']['payment_status'], 'pending')
