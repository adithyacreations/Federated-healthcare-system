import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';
import VendorOrdersPage from './VendorOrdersPage';

jest.mock('../../api/axios', () => ({ __esModule: true, default: { post: jest.fn(), put: jest.fn() } }));
jest.mock('../../hooks/useApi', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);
jest.mock('../../components/common/Modal', () => ({ isOpen, children }) => isOpen ? <div role="dialog">{children}</div> : null);

const base = {
  eq_order_id: 'order-1', product_name: 'Demo Monitor', hospital_name: 'Demo Hospital',
  quantity: 1, total_price: 100, payment_status: 'paid', order_status: 'confirmed',
};

beforeEach(() => jest.clearAllMocks());

test('vendor dispatches a paid pending order through the driver form', async () => {
  useApi.mockImplementation((url) => ({
    data: url.endsWith('/drivers/') ? [{ driver_id: 'driver-1', name: 'Demo Driver', phone: '9876543210', is_available: true }]
      : [{ ...base, order_status: 'pending' }], refetch: jest.fn(),
  }));
  API.put.mockResolvedValue({ data: { message: 'Dispatched.' } });
  render(<VendorOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));
  const modal = within(screen.getByRole('dialog'));
  const driverOption = modal.getByRole('option', { name: /Demo Driver/ });
  fireEvent.change(driverOption.parentElement, { target: { value: 'driver-1' } });
  fireEvent.click(modal.getByRole('button', { name: 'Dispatch & Send OTP' }));
  await waitFor(() => expect(API.put).toHaveBeenCalledWith('/api/vendor/orders/order-1/dispatch/', expect.objectContaining({
    driver_id: 'driver-1',
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('pending unpaid order shows Dispatch with the reason it is disabled', () => {
  useApi.mockImplementation((url) => ({
    data: url.endsWith('/drivers/') ? [] : [{ ...base, order_status: 'pending', payment_status: 'pending' }],
    refetch: jest.fn(),
  }));
  render(<VendorOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: /Pending/i }));
  expect(screen.getByRole('button', { name: 'Dispatch' })).toBeDisabled();
  expect(screen.getByText('Awaiting payment before dispatch.')).toBeInTheDocument();
  expect(API.put).not.toHaveBeenCalled();
});

test('refund button disables at exactly seven days while cancelled paid orders remain eligible', () => {
  jest.useFakeTimers();
  try {
    const deadline = Date.now() + 1000;
    useApi.mockImplementation((url) => ({
      data: url.endsWith('/drivers/') ? [] : [
        { ...base, order_status: 'delivered', return_deadline: new Date(deadline).toISOString() },
        { ...base, eq_order_id: 'order-2', product_name: 'Cancelled Monitor', order_status: 'cancelled' },
      ], refetch: jest.fn(),
    }));
    render(<VendorOrdersPage />);
    const refundButtons = screen.getAllByRole('button', { name: 'Refund', exact: true });
    expect(refundButtons[0]).toBeEnabled();
    expect(refundButtons[1]).toBeEnabled();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(refundButtons[0]).toBeDisabled();
    expect(refundButtons[1]).toBeEnabled();
    expect(screen.getByText('7-day return period expired')).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

test('vendor confirms the product was returned before issuing its refund', async () => {
  useApi.mockImplementation((url) => ({
    data: url.endsWith('/drivers/') ? [] : [{
      ...base, order_status: 'delivered', return_deadline: new Date(Date.now() + 86400000).toISOString(),
    }], refetch: jest.fn(),
  }));
  API.post.mockResolvedValue({ data: { message: 'Full refund processed.' } });
  render(<VendorOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Refund', exact: true }));
  const confirm = screen.getByRole('button', { name: 'Issue Full Refund' });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /returned product has been received/i }));
  fireEvent.click(confirm);
  await waitFor(() => expect(API.post).toHaveBeenCalledWith('/api/vendor/orders/order-1/refund/', { return_received: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('Cancelled tab explains disabled refunds for orders with pending payment', () => {
  useApi.mockImplementation((url) => ({
    data: url.endsWith('/drivers/') ? [] : [{ ...base, order_status: 'cancelled', payment_status: 'pending' }],
    refetch: jest.fn(),
  }));
  render(<VendorOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: /Cancelled/i }));
  expect(screen.getByRole('button', { name: 'Refund', exact: true })).toBeDisabled();
  expect(screen.getByText('No recorded payment to refund.')).toBeInTheDocument();
  expect(API.post).not.toHaveBeenCalled();
});

test('paid cancelled order offers its refund directly in the Cancelled tab', async () => {
  useApi.mockImplementation((url) => ({
    data: url.endsWith('/drivers/') ? [] : [{ ...base, order_status: 'cancelled' }],
    refetch: jest.fn(),
  }));
  API.post.mockResolvedValue({ data: { message: 'Full refund processed.' } });
  render(<VendorOrdersPage />);
  fireEvent.click(screen.getByRole('button', { name: /Cancelled/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Refund', exact: true }));
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Issue Full Refund' }));
  await waitFor(() => expect(API.post).toHaveBeenCalledWith('/api/vendor/orders/order-1/refund/', { return_received: false }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
