import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import API from '../../api/axios';
import PatientRegisterPage from './PatientRegisterPage';

jest.mock('../../api/axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
jest.mock('../../components/auth/PhoneCounter', () => () => null);
jest.mock('../../utils/validation', () => ({
  ...jest.requireActual('../../utils/validation'),
  scrollToFirstError: jest.fn(),
}));
jest.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: {
    div: ({ initial, animate, exit, transition, ...props }) => <div {...props} />,
  },
}));

test('registration is sent only after the Register button is activated', async () => {
  API.post.mockResolvedValue({ data: { data: { email: 'demo@example.test' } } });
  const { container } = render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PatientRegisterPage />
    </MemoryRouter>,
  );
  const form = container.querySelector('form');
  const enter = (input, value) => fireEvent.change(input, { target: { value } });

  enter(screen.getByPlaceholderText('you@example.com'), 'demo@example.test');
  for (const input of form.querySelectorAll('input[type="password"]')) {
    enter(input, 'ExamplePassword9');
  }
  fireEvent.submit(form);
  expect(API.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  enter(screen.getByPlaceholderText('Your full name'), 'Demo Patient');
  enter(screen.getByPlaceholderText('10-digit mobile'), '9876543210');
  const dob = form.querySelector('input[type="date"]');
  enter(dob, '12000-05-08');
  expect(dob).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('Enter a four-digit birth year.')).toBeVisible();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

  enter(dob, '1995-05-08');
  fireEvent.submit(form);
  expect(API.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  const [height, weight] = screen.getAllByRole('spinbutton');
  enter(height, '172.5');
  fireEvent.submit(form);
  expect(API.post).not.toHaveBeenCalled();
  const register = screen.getByRole('button', { name: 'Register' });
  enter(height, '999');
  enter(weight, '-5');
  fireEvent.click(register);
  expect(screen.getByText('Enter a value between 40 and 275 cm.')).toBeVisible();
  expect(screen.getByText('Enter a value between 2 and 650 kg.')).toBeVisible();
  expect(screen.queryByText(/Auto-calculated BMI/)).not.toBeInTheDocument();
  expect(API.post).not.toHaveBeenCalled();

  enter(height, '172.5');
  enter(weight, '71.25');
  fireEvent.click(register);

  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post).toHaveBeenCalledWith('/api/auth/register/patient/', expect.objectContaining({
    height_cm: '172.5',
    weight_kg: '71.25',
  }));
  expect(await screen.findByRole('heading', { name: 'Registration Successful!' })).toBeVisible();
});
