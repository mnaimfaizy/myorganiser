import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it('renders the info tone as the info soft ground with its text ink', () => {
    render(<StatusPill tone="info">Under review</StatusPill>);
    const pill = screen.getByText('Under review');
    expect(pill).toHaveClass('bg-info-soft', 'text-info-text');
    expect(pill).not.toHaveClass('border');
  });

  it('renders the outline tone as a surface ground with a warning border and ink', () => {
    render(<StatusPill tone="outline">Can&apos;t reproduce</StatusPill>);
    const pill = screen.getByText("Can't reproduce");
    expect(pill).toHaveClass(
      'border',
      'border-warning',
      'bg-card',
      'text-warning-text',
    );
  });

  it('defaults to the neutral tone', () => {
    render(<StatusPill>Old</StatusPill>);
    expect(screen.getByText('Old')).toHaveClass('bg-subtle');
  });
});
