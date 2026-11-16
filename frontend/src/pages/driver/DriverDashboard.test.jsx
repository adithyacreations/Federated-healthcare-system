import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import API from '../../api/axios';
import DriverDashboard from './DriverDashboard';

jest.mock('../../api/axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);
jest.mock('../../components/common/RouteLine', () => () => null);
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { error: jest.fn(), success: jest.fn() } }));
jest.mock('react-leaflet', () => ({ MapContainer: () => null, TileLayer: () => null, Marker: () => null, Popup: () => null }));
jest.mock('leaflet', () => {
  const Icon = function () {};
  Icon.Default = { prototype: {}, mergeOptions: jest.fn() };
  return { __esModule: true, default: { Icon } };
});
jest.mock('../../hooks/useApi', () => (url) => ({
  data: url === '/api/emergency/active-dispatch/' ? {
    data: { dispatch_id: 'dispatch-1', status: 'dispatched', patient_name: 'Demo Patient', timeout_seconds: 1 },
  } : null,
  refetch: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  API.get.mockResolvedValue({ data: { success: false } });
});

test('the countdown does not reject a dispatch while Accept is still in flight', async () => {
  jest.useFakeTimers();
  try {
    let finishAccept;
    API.post.mockReturnValueOnce(new Promise((resolve) => { finishAccept = resolve; }));
    render(<DriverDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    act(() => { jest.advanceTimersByTime(1000); });
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(API.post).toHaveBeenCalledWith('/api/emergency/dispatch/dispatch-1/accept/');

    await act(async () => { finishAccept({ data: { message: 'Dispatch accepted.' } }); });
    expect(toast.success).toHaveBeenCalledWith('Dispatch accepted.');
  } finally {
    jest.useRealTimers();
  }
});

test('an expired dispatch shows the API message and closes the alert', async () => {
  const message = 'This emergency is no longer available to accept.';
  API.post.mockRejectedValueOnce({ response: { status: 409, data: { message } } });
  render(<DriverDashboard />);
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
  expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
});
