import { act, fireEvent, render, screen } from '@testing-library/react';
import API from '../../api/axios';
import LabTestPage from './LabTestPage';

jest.mock('../../api/axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

const slot = {
  slot_id: 'slot-1', start_time: '08:30', end_time: '09:00',
  is_available: true, status: 'available', remaining: 4,
};

test('patient slot loading cancels stale requests and offers retry after a timeout', async () => {
  let finishOldRequest;
  const outdatedRequest = new Promise((resolve) => { finishOldRequest = resolve; });
  const loadSlots = jest.fn()
    .mockReturnValueOnce(outdatedRequest)
    .mockRejectedValueOnce({ code: 'ECONNABORTED' })
    .mockResolvedValueOnce({ data: { success: true, data: [slot] } });
  API.get.mockImplementation((url, options) => {
    if (url === '/api/lab/slots/') return loadSlots(options);
    return Promise.resolve({ data: { success: true, data: {
      hospitals: [{ hospital_id: 'hospital-1', hospital_name: 'Demo Hospital', lab_configured: true }],
      tests: [],
      orders: [],
    } } });
  });

  render(<LabTestPage />);
  fireEvent.click(await screen.findByRole('button', { name: /select hospital/i }));
  fireEvent.click(screen.getByRole('radio', { name: /demo hospital/i }));
  const date = screen.getByLabelText('Date');
  fireEvent.change(date, { target: { value: '2099-01-01' } });
  expect(screen.getByRole('status')).toHaveTextContent('Loading available slots');
  const firstRequest = loadSlots.mock.calls[0][0];

  fireEvent.change(date, { target: { value: '2099-01-02' } });
  expect(firstRequest.signal.aborted).toBe(true);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load available slots.');
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading slots' }));
  expect(await screen.findByRole('button', { name: /8:30 am/i })).toBeEnabled();
  expect(loadSlots).toHaveBeenLastCalledWith(expect.objectContaining({
    params: expect.objectContaining({ hospital_id: 'hospital-1', date: '2099-01-02' }),
    timeout: 15000,
  }));

  await act(async () => { finishOldRequest({ data: { success: true, data: [] } }); });
  expect(screen.getByRole('button', { name: /8:30 am/i })).toBeEnabled();
});
