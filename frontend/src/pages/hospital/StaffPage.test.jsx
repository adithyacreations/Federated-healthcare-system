import { fireEvent, render, screen, within } from '@testing-library/react';
import API from '../../api/axios';
import StaffPage from './StaffPage';

jest.mock('../../api/axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
jest.mock('../../hooks/useApi', () => () => ({ data: [], loading: false, refetch: jest.fn() }));
jest.mock('../../components/common/DashboardLayout', () => ({ children }) => children);
jest.mock('../../components/common/Modal', () => ({ isOpen, children }) => (
  isOpen ? <div role="dialog">{children}</div> : null
));

test.each([
  ['Doctor', 'Add doctor', 'Add Doctor', '/api/hospital/add-doctor/'],
  ['Lab technician', 'Add lab technician', 'Add Lab Tech', '/api/hospital/add-lab-tech/'],
  ['Driver', 'Add ambulance driver', 'Add Driver', '/api/hospital/add-driver/'],
])('%s form validates the name and phone number', async (role, openLabel, addLabel, path) => {
  API.post.mockClear();
  API.post.mockResolvedValue({ data: { data: {} } });
  render(<StaffPage />);
  fireEvent.click(screen.getByRole('button', { name: openLabel }));

  const modal = within(screen.getByRole('dialog'));
  const name = modal.getByRole('textbox', { name: `${role} full name` });
  const phone = modal.getByRole('textbox', { name: `${role} phone number` });
  const add = modal.getByRole('button', { name: addLabel });

  fireEvent.change(name, { target: { value: 'Demo Person 12' } });
  expect(modal.getByText(`${role} name cannot contain numbers.`)).toBeVisible();
  fireEvent.click(add);
  expect(API.post).not.toHaveBeenCalled();

  fireEvent.change(name, { target: { value: 'Demo Person' } });
  if (role === 'Driver') {
    fireEvent.click(add);
    expect(modal.getByText('Enter a 10-digit phone number.')).toBeVisible();
    expect(API.post).not.toHaveBeenCalled();
  }

  fireEvent.change(phone, { target: { value: '98765' } });
  fireEvent.click(add);
  expect(modal.getByText('Enter a 10-digit phone number.')).toBeVisible();
  expect(API.post).not.toHaveBeenCalled();

  expect(phone).toHaveAttribute('maxlength', '10');
  fireEvent.change(phone, { target: { value: '9a8765432105' } });
  expect(phone).toHaveValue('9876543210');
  if (role === 'Driver') {
    const license = modal.getByRole('textbox', { name: 'Driving license number' });
    const vehicle = modal.getByRole('textbox', { name: 'Vehicle number' });
    fireEvent.click(add);
    expect(modal.getByText('Driving license number is required.')).toBeVisible();
    expect(modal.getByText('Vehicle number is required.')).toBeVisible();
    expect(API.post).not.toHaveBeenCalled();
    fireEvent.change(vehicle, { target: { value: 'KL07-AB 123456789' } });
    expect(vehicle).toHaveValue('KL07AB123456');
    fireEvent.click(add);
    expect(API.post).not.toHaveBeenCalled();
    fireEvent.change(license, { target: { value: 'KL01-2024 123456' } });
    expect(license).toHaveValue('KL0120241234');
  }
  fireEvent.click(add);

  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post).toHaveBeenCalledWith(path, expect.objectContaining({
    full_name: 'Demo Person',
    phone: '9876543210',
    ...(role === 'Driver' ? { license_no: 'KL0120241234', vehicle_no: 'KL07AB123456' } : {}),
  }));
  expect(await screen.findByRole('button', { name: 'Done' })).toBeVisible();
});
