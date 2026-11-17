from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.auth_app.models import LoginCredentials
from apps.hospital.models import HospitalRegistration
from .models import EquipmentCatalog, EquipmentOrder, VendorRegistration


class EquipmentOrderLimitTests(TestCase):
    def setUp(self):
        hospital_login = LoginCredentials.objects.create(email='order-hospital@example.test', role='hospital_admin')
        HospitalRegistration.objects.create(
            login_id=hospital_login, hospital_name='Test Hospital', registration_no='order-hospital',
        )
        self.vendor_login = LoginCredentials.objects.create(email='order-vendor@example.test', role='vendor')
        self.vendor = VendorRegistration.objects.create(
            login_id=self.vendor_login, company_name='Test Vendor', tax_id='order-vendor', approval_status='approved',
        )
        self.product = EquipmentCatalog.objects.create(
            vendor_id=self.vendor, product_name='Test Monitor', price='100.00', stock_qty=20, max_order_qty=1,
        )
        self.client = APIClient()
        self.client.force_authenticate(hospital_login)

    def test_hospital_catalog_includes_vendor_order_limit(self):
        response = self.client.get('/api/vendor/catalog/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['data'][0]['max_order_qty'], 1)
        self.assertEqual(response.data['data'][0]['stock_qty'], 20)

    @patch('payment_utils.create_razorpay_order')
    def test_above_limit_and_fractional_quantities_never_reserve_stock_or_start_payment(self, payment):
        for quantity in (2, 20, 1.5, 0, -1, True):
            with self.subTest(quantity=quantity):
                response = self.client.post('/api/vendor/place-order/', {
                    'product_id': str(self.product.pk), 'quantity': quantity,
                }, format='json')
                self.assertEqual(response.status_code, 400, response.data)
                if quantity in (2, 20):
                    self.assertIn('maximum of 1 units per order', response.data['message'])
        payment.assert_not_called()
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_qty, 20)
        self.assertFalse(EquipmentOrder.objects.exists())

    @patch('email_utils.send_equipment_order_vendor_email')
    @patch('email_utils.send_equipment_order_hospital_email')
    @patch('apps.vendor.views.send_notification')
    @patch('payment_utils.create_razorpay_order', return_value={'success': True, 'order_id': 'test-order'})
    def test_exact_limit_reserves_only_that_quantity(self, payment, _notify, _hospital_email, _vendor_email):
        response = self.client.post('/api/vendor/place-order/', {
            'product_id': str(self.product.pk), 'quantity': 1,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(EquipmentOrder.objects.get().quantity, 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_qty, 19)
        payment.assert_called_once()

    def test_vendor_cannot_set_nonpositive_limit_on_create_or_edit(self):
        self.client.force_authenticate(self.vendor_login)
        for limit in (0, -1):
            response = self.client.post('/api/vendor/products/create/', {
                'product_name': 'Another Monitor', 'price': '100.00', 'max_order_qty': limit,
            }, format='json')
            self.assertEqual(response.status_code, 400, response.data)
            response = self.client.put(f'/api/vendor/products/{self.product.pk}/', {
                'max_order_qty': limit,
            }, format='json')
            self.assertEqual(response.status_code, 400, response.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.max_order_qty, 1)
