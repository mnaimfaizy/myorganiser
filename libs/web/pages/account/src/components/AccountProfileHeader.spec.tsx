import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';

import { AccountProfileHeader } from './AccountProfileHeader';

const EMAIL = 'sam@example.com';

describe('AccountProfileHeader', () => {
  it('renders the name, email, verified pill, and initials on desktop', () => {
    render(
      <AccountProfileHeader
        variant="desktop"
        name="Sam Rivera"
        email={EMAIL}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Sam Rivera' }),
    ).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText('EMAIL VERIFIED')).toBeInTheDocument();

    const initials = screen.getByText('SR');
    expect(initials).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the name and email without the verified pill on phone', () => {
    render(
      <AccountProfileHeader variant="phone" name="Sam Rivera" email={EMAIL} />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Sam Rivera' }),
    ).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.queryByText('EMAIL VERIFIED')).toBeNull();
  });

  it('uses the email as the heading and does not repeat it when there is no name', () => {
    render(<AccountProfileHeader variant="desktop" name="" email={EMAIL} />);

    expect(
      screen.getByRole('heading', { level: 1, name: EMAIL }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(EMAIL)).toHaveLength(1);

    const initials = screen.getByText('S');
    expect(initials).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the email as the phone heading and does not repeat it when there is no name', () => {
    render(<AccountProfileHeader variant="phone" name="" email={EMAIL} />);

    expect(
      screen.getByRole('heading', { level: 1, name: EMAIL }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(EMAIL)).toHaveLength(1);
  });
});
