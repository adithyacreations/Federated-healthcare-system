import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import API from '../../api/axios';
import LabSettingsPage from './LabSettingsPage';

jest.mock('../../api/axios', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn() } }));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { error: jest.fn(), success: jest.fn() } }));

test('lab settings recover from load and save errors without leaving Save disabled', async () => {
  const config = { working_days: [0], start_time: '08:00', end_time: '17:00', slot_duration_minutes: 30,
    max_patients_per_slot: 5, lunch_break_start: '13:00', lunch_break_end: '14:00' };
  API.get.mockRejectedValueOnce({ code: 'ECONNABORTED' }).mockResolvedValueOnce({ data: { success: true, data: config } });
  API.put.mockRejectedValueOnce({ code: 'ECONNABORTED' })
    .mockResolvedValueOnce({ data: { success: true, data: { config_id: 'lab-1' } } });

  render(<LabSettingsPage />);
  const save = screen.getByRole('button', { name: /save lab settings/i });
  expect(save).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry loading settings' }));
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Saving took too long')));
  expect(save).toBeEnabled();

  fireEvent.click(save);
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Lab settings saved and slots generated.'));
  expect(save).toBeEnabled();
});
