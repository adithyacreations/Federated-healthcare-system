import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import API from '../../api/axios';
import VendorProductsPage from './VendorProductsPage';

jest.mock('../../api/axios', () => ({ __esModule: true, default: { post: jest.fn(), put: jest.fn() } }));
jest.mock('../../hooks/useApi', () => () => ({ data: [], refetch: jest.fn() }));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);
jest.mock('../../components/common/Modal', () => ({ isOpen, children }) => isOpen ? <div role="dialog">{children}</div> : null);

function openProductForm() {
  render(<MemoryRouter><VendorProductsPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: ' Demo Monitor ' } });
  fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '125.50' } });
}

beforeEach(() => jest.clearAllMocks());

test('optional blank specifications and stock are sent in the format accepted by Django', async () => {
  API.post.mockResolvedValue({ data: { success: true } });
  openProductForm();
  fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(API.post).toHaveBeenCalledWith('/api/vendor/products/create/', expect.objectContaining({
    product_name: 'Demo Monitor', price: '125.50', stock_qty: 0, max_order_qty: 100, specifications: {},
  }));
});

test('invalid specifications show an explanation and keep the form for correction', async () => {
  API.post.mockResolvedValue({ data: { success: true } });
  openProductForm();
  const specifications = screen.getByLabelText('Specifications (JSON, optional)');
  fireEvent.change(specifications, { target: { value: '1 year warranty' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter valid JSON');
  expect(API.post).not.toHaveBeenCalled();
  fireEvent.change(specifications, { target: { value: '{"warranty":"1 year"}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(API.post).toHaveBeenCalledWith('/api/vendor/products/create/', expect.objectContaining({
    specifications: { warranty: '1 year' },
  }));
});

test('API field validation is displayed next to the rejected field', async () => {
  API.post.mockRejectedValue({ response: { data: {
    message: 'Validation failed.', errors: { price: ['Price must be greater than 0.'] },
  } } });
  openProductForm();
  fireEvent.click(screen.getByRole('button', { name: 'Add Product' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Price must be greater than 0.');
  expect(screen.getByLabelText('Price (₹)')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Product Name')).toHaveValue(' Demo Monitor ');
  expect(screen.getByRole('button', { name: 'Add Product' })).toBeEnabled();
});
