import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';
import UsersPage from './UsersPage';

jest.mock('../../api/axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('../../hooks/useApi', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);

test('terminating a hospital removes its row and tab count and refreshes the directory', async () => {
  const refetch = jest.fn();
  useApi.mockReturnValue({
    data: { hospital_admins: [{
      login_id: 'hospital-1', email: 'hospital@example.test', hospital_name: 'Demo Hospital',
      is_active: true, is_approved: true,
    }] }, loading: false, refetch,
  });
  API.post.mockResolvedValue({ data: { success: true, message: 'Hospital terminated.' } });
  render(<UsersPage />);
  fireEvent.click(screen.getByRole('button', { name: /terminate/i }));
  const buttons = screen.getAllByRole('button', { name: /terminate/i });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(refetch).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: /hospitals/i })).toHaveTextContent('0');
  expect(screen.queryByText('hospital@example.test')).toBeNull();
});
