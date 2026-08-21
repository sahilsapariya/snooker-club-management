import { fireEvent, waitFor } from '@testing-library/react-native';

import { AppError } from '@/lib/errors';
import { renderWithProviders } from '@/test-utils/render';

import { LoginForm } from './LoginForm';

const mockMutate = jest.fn();
let mockState: { isPending: boolean; error: unknown } = { isPending: false, error: null };

// The form's only dependency is the sign-in mutation; stubbing it keeps the
// test about the form rather than about Supabase.
jest.mock('../hooks/use-app-session', () => ({
  useSignIn: () => ({
    mutate: mockMutate,
    isPending: mockState.isPending,
    error: mockState.error,
  }),
}));

describe('LoginForm', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockState = { isPending: false, error: null };
  });

  it('renders the credential fields and the submit button', () => {
    const { getByTestId, getByText } = renderWithProviders(<LoginForm />);

    expect(getByTestId('login-email')).toBeTruthy();
    expect(getByTestId('login-password')).toBeTruthy();
    expect(getByText('Sign in')).toBeTruthy();
    // There is no self-service signup in this product.
    expect(getByText(/Accounts are created by your club owner/)).toBeTruthy();
  });

  it('refuses to submit an empty form and says why', async () => {
    const { getByTestId, findByText } = renderWithProviders(<LoginForm />);

    fireEvent.press(getByTestId('login-submit'));

    expect(await findByText('Enter your email address')).toBeTruthy();
    expect(await findByText('Enter your password')).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('rejects a malformed email before making a request', async () => {
    const { getByTestId, findByText } = renderWithProviders(<LoginForm />);

    fireEvent.changeText(getByTestId('login-email'), 'not-an-email');
    fireEvent.changeText(getByTestId('login-password'), 'DevPassword123');
    fireEvent.press(getByTestId('login-submit'));

    expect(await findByText('That does not look like an email address')).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('submits valid credentials', async () => {
    const { getByTestId } = renderWithProviders(<LoginForm />);

    fireEvent.changeText(getByTestId('login-email'), 'reception@royalsnooker.dev');
    fireEvent.changeText(getByTestId('login-password'), 'DevPassword123');
    fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith({
        email: 'reception@royalsnooker.dev',
        password: 'DevPassword123',
      });
    });
  });

  /**
   * The important half of error handling: what the user is shown is the mapped
   * message, never the technical one.
   */
  it('shows the user-facing message and never the technical one', () => {
    mockState = {
      isPending: false,
      error: new AppError({
        code: 'auth/invalid-credentials',
        message: 'That email or password is incorrect.',
        technicalMessage: 'AuthApiError: Invalid login credentials (400)',
      }),
    };

    const { getByText, queryByText } = renderWithProviders(<LoginForm />);

    expect(getByText('That email or password is incorrect.')).toBeTruthy();
    expect(queryByText(/AuthApiError/)).toBeNull();
    expect(queryByText(/400/)).toBeNull();
  });

  it('shows a notice when the previous session expired', () => {
    const { getByText } = renderWithProviders(
      <LoginForm notice="Your session expired. Please sign in again." />,
    );

    expect(getByText('Your session expired. Please sign in again.')).toBeTruthy();
  });

  it('marks the submit button busy while signing in', () => {
    mockState = { isPending: true, error: null };

    const { getByTestId } = renderWithProviders(<LoginForm />);

    expect(getByTestId('login-submit').props.accessibilityState).toMatchObject({ busy: true });
  });
});
