import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';
import EquipmentOrdersPage from './EquipmentOrdersPage';

jest.mock('../../api/axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);
jest.mock('../../components/chat/HospitalChatWindow', () => () => null);
jest.mock('../../components/common/Modal', () => ({ isOpen, children }) => isOpen ? <div role="dialog">{children}</div> : null);
jest.mock('../../hooks/useApi', () => ({ __esModule: true, default: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  delete window.Razorpay;
  useApi.mockImplementation((url) => ({
  data: url === '/api/vendor/catalog/' ? [{
    product_id: 'product-1', product_name: 'Demo Monitor', category: 'Diagnostic',
    price: '100.00', stock_qty: 20, max_order_qty: 1, vendor_name: 'Demo Vendor',
  }] : [],
  loading: false, refetch: jest.fn(),
  }));
});

test('hospital quantity control respects limit 1 even when 20 units are in stock', async () => {
  API.post.mockResolvedValue({ data: { success: true, data: { eq_order_id: 'order-1' } } });
  render(<EquipmentOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Order Now' }));
  const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
  expect(quantity).toHaveAttribute('max', '1');
  expect(screen.getByRole('button', { name: '+' })).toBeDisabled();
  fireEvent.change(quantity, { target: { value: '20' } });
  expect(quantity).toHaveValue(1);
  fireEvent.click(screen.getByRole('button', { name: 'Place Order & Pay' }));
  await waitFor(() => expect(API.post).toHaveBeenCalledWith('/api/vendor/place-order/', {
    product_id: 'product-1', quantity: 1,
  }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('hospital can confirm cancellation from My Orders', async () => {
  const refetch = jest.fn();
  useApi.mockImplementation((url) => ({ data: url === '/api/vendor/catalog/' ? [] : [{
    eq_order_id: 'order-1', product_name: 'Demo Monitor', vendor_name: 'Demo Vendor', quantity: 1,
    total_price: '100.00', payment_status: 'paid', order_status: 'confirmed', can_cancel: true,
  }], loading: false, refetch }));
  API.post.mockResolvedValue({ data: { message: 'Order cancelled.' } });
  render(<EquipmentOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: /My Orders/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Order' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Cancellation' }));
  await waitFor(() => expect(API.post).toHaveBeenCalledWith('/api/vendor/orders/order-1/cancel/'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(refetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'My Orders (0)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelled / Refunded (1)' }));
  expect(screen.getByText('Order Cancelled')).toBeInTheDocument();
  expect(screen.getByText('Awaiting vendor refund.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Track Order' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancel Order' })).toBeNull();
});

test('saved cancelled and refunded orders stay in their section after remounting', () => {
  const entries = [
    { eq_order_id: 'active', product_name: 'Active Monitor', order_status: 'confirmed', payment_status: 'paid' },
    { eq_order_id: 'cancelled', product_name: 'Cancelled Monitor', order_status: 'cancelled', payment_status: 'pending' },
    { eq_order_id: 'refunded', product_name: 'Refunded Monitor', order_status: 'refunded', payment_status: 'refunded' },
  ].map((order) => ({ ...order, vendor_name: 'Demo Vendor', quantity: 1, total_price: 100 }));
  useApi.mockImplementation((url) => ({ data: url === '/api/vendor/catalog/' ? [] : entries, loading: false, refetch: jest.fn() }));
  const page = render(<EquipmentOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: 'My Orders (1)' }));
  expect(screen.getByText('Active Monitor')).toBeInTheDocument();
  expect(screen.queryByText('Cancelled Monitor')).toBeNull();
  expect(screen.queryByText('Refunded Monitor')).toBeNull();
  page.unmount();

  render(<EquipmentOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelled / Refunded (2)' }));
  expect(screen.getByText('Order Cancelled')).toBeInTheDocument();
  expect(screen.getByText('Order Refunded')).toBeInTheDocument();
  expect(screen.queryByText('Active Monitor')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Track Order' })).toBeNull();
});

const unpaidOrder = {
  eq_order_id: 'order-1', product_name: 'Demo Monitor', vendor_name: 'Demo Vendor',
  quantity: 1, total_price: '100.00', payment_status: 'pending', order_status: 'pending',
};
const paymentDetails = { razorpay_order_id: 'order_gateway', key_id: 'test_key', amount: 10000 };

const showUnpaidOrder = () => {
  const refetch = jest.fn();
  useApi.mockImplementation((url) => ({
    data: url === '/api/vendor/catalog/' ? [] : [unpaidOrder], loading: false, refetch,
  }));
  window.Razorpay = jest.fn(() => ({ open: jest.fn() }));
  render(<EquipmentOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: /My Orders/i }));
  return refetch;
};

test('Pay Now pays the saved order, verifies it and refreshes without placing another order', async () => {
  API.post.mockImplementation((url) => Promise.resolve({ data: {
    success: true, data: url.includes('create-order') ? paymentDetails : {},
  } }));
  const refetch = showUnpaidOrder();
  fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
  await waitFor(() => expect(window.Razorpay).toHaveBeenCalledTimes(1));
  expect(API.post).toHaveBeenCalledWith('/api/payment/create-order/', {
    payment_type: 'equipment', object_id: 'order-1', amount: '100.00',
  });
  expect(screen.getByRole('button', { name: 'Opening Payment…' })).toBeDisabled();
  const checkout = window.Razorpay.mock.calls[0][0];
  expect(checkout).toMatchObject({ order_id: 'order_gateway', amount: 10000, key: 'test_key' });
  await act(async () => checkout.handler({
    razorpay_order_id: 'order_gateway', razorpay_payment_id: 'pay_test', razorpay_signature: 'signature',
  }));
  expect(API.post).toHaveBeenCalledWith('/api/payment/verify/', {
    payment_type: 'equipment', object_id: 'order-1',
    razorpay_order_id: 'order_gateway', razorpay_payment_id: 'pay_test', razorpay_signature: 'signature',
  });
  expect(API.post).not.toHaveBeenCalledWith('/api/vendor/place-order/', expect.anything());
  expect(refetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Payment Successful!')).toBeInTheDocument();
});

test('closing checkout leaves Pay Now available for the same pending order', async () => {
  API.post.mockResolvedValue({ data: { success: true, data: paymentDetails } });
  showUnpaidOrder();
  fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
  await waitFor(() => expect(window.Razorpay).toHaveBeenCalledTimes(1));
  await act(async () => window.Razorpay.mock.calls[0][0].modal.ondismiss());
  expect(screen.getByRole('button', { name: 'Pay Now' })).toBeEnabled();
  expect(screen.queryByText('Payment Successful!')).toBeNull();
});

test('gateway error restores Pay Now without starting checkout or placing an order', async () => {
  API.post.mockRejectedValue({ response: { data: { message: 'Payments unavailable.' } } });
  showUnpaidOrder();
  fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pay Now' })).toBeEnabled());
  expect(window.Razorpay).not.toHaveBeenCalled();
  expect(API.post).toHaveBeenCalledTimes(1);
});

test('Razorpay amount limit rejection stays visible on the unpaid order card', async () => {
  const message = 'This order total exceeds the Razorpay transaction limit for this account.';
  API.post.mockRejectedValue({ response: { status: 422, data: { message, errors: { code: 'payment_amount_limit' } } } });
  showUnpaidOrder();
  fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
  expect(screen.getByRole('button', { name: 'Pay Now' })).toBeEnabled();
  expect(window.Razorpay).not.toHaveBeenCalled();
  expect(screen.queryByText('Payment Successful!')).toBeNull();
});
