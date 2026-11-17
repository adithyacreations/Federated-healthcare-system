import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import API from '../../api/axios';
import InventoryPage from './InventoryPage';

jest.mock('../../api/axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
jest.mock('../../hooks/useApi', () => () => ({ data: [], loading: false, refetch: jest.fn() }));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);
jest.mock('../../components/common/Modal', () => () => null);

test.each(['5', '0'])('Add Equipment blocks reorder levels above quantity %s', async (quantity) => {
  API.post.mockReset();
  API.post.mockResolvedValue({});
  render(<InventoryPage />);

  fireEvent.change(screen.getByPlaceholderText('e.g. ECG Monitor'), { target: { value: 'ECG Monitor' } });
  const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i });
  const reorderInput = screen.getByRole('spinbutton', { name: 'Reorder Level' });
  const add = screen.getByRole('button', { name: 'Add', exact: true });

  fireEvent.change(quantityInput, { target: { value: '12' } });
  expect(add).toBeEnabled();

  fireEvent.change(quantityInput, { target: { value: quantity } });
  expect(reorderInput).toHaveAttribute('max', quantity);
  expect(screen.getByRole('alert')).toHaveTextContent('Reorder level cannot exceed quantity.');
  expect(add).toBeDisabled();
  fireEvent.submit(add.form);
  expect(API.post).not.toHaveBeenCalled();

  fireEvent.change(reorderInput, { target: { value: quantity } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(add);
  expect(API.post).toHaveBeenCalledWith('/api/hospital/inventory/add/', expect.objectContaining({
    quantity: Number(quantity),
    reorder_level: Number(quantity),
  }));
  await waitFor(() => expect(quantityInput).toHaveValue(null));
});
