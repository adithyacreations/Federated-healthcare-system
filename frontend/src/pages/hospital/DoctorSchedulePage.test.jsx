import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import API from '../../api/axios';
import DoctorSchedulePage from './DoctorSchedulePage';

jest.mock('../../api/axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);
jest.mock('../../components/common/Modal', () => () => null);

const doctor = { doctor_id: 'doctor-1', full_name: 'Demo Doctor', approval_status: 'approved' };
const schedule = {
  schedule_id: 'schedule-1', doctor: doctor.doctor_id, doctor_name: doctor.full_name,
  start_time: '09:00:00', end_time: '17:00:00', working_days: ['monday'],
  slot_duration_minutes: 30, consultation_type: 'both', consultation_fee: '500', is_active: true,
};
const success = (data) => ({ data: { success: true, data } });

beforeEach(() => {
  jest.resetAllMocks();
});

test('create and update show the confirmed schedule while the calendar is still reloading', async () => {
  let finishReload;
  const pendingReload = new Promise((resolve) => { finishReload = resolve; });
  API.get.mockImplementation((url) => {
    if (url.endsWith('/doctors/')) return Promise.resolve(success([doctor]));
    if (url.endsWith('/doctor-schedules/')) return Promise.resolve(success({ schedules: [] }));
    return Promise.resolve(success([]));
  });
  let finishSave;
  API.post.mockReturnValue(new Promise((resolve) => { finishSave = resolve; }));

  render(<DoctorSchedulePage />);
  const option = await screen.findByRole('option', { name: /demo doctor/i });
  fireEvent.change(screen.getByRole('combobox', { name: 'Doctor' }), { target: { value: option.value } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));
  expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

  API.get.mockImplementation((url) => pendingReload.then((updated) => success(
    url.endsWith('/doctor-schedules/') ? { schedules: [updated] } : [],
  )));
  await act(async () => { finishSave(success({ schedule })); });
  expect(screen.getByText('09:00-17:00')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create Schedule' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const updated = { ...schedule, end_time: '16:00:00' };
  API.put.mockResolvedValue(success({ schedule: updated }));
  fireEvent.click(screen.getByRole('button', { name: 'Update Schedule' }));
  expect(await screen.findByText('09:00-16:00')).toBeVisible();
  expect(screen.queryByText('09:00-17:00')).toBeNull();
  expect(screen.getByRole('button', { name: 'Create Schedule' })).toBeEnabled();

  await act(async () => { finishReload(updated); });
  expect(toast.error).not.toHaveBeenCalled();
});

test('a timed-out save releases the button and keeps the form selection', async () => {
  API.get.mockImplementation((url) => Promise.resolve(success(
    url.endsWith('/doctors/') ? [doctor] : [],
  )));
  API.post.mockRejectedValue({ code: 'ECONNABORTED' });

  render(<DoctorSchedulePage />);
  await screen.findByRole('option', { name: /demo doctor/i });
  const select = screen.getByRole('combobox', { name: 'Doctor' });
  fireEvent.change(select, { target: { value: doctor.doctor_id } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
    'The save timed out. Use Refresh to check whether it completed.',
  ));
  expect(select).toHaveValue(doctor.doctor_id);
  expect(screen.getByRole('button', { name: 'Create Schedule' })).toBeEnabled();
});
