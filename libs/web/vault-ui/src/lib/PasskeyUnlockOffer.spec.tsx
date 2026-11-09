import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import {
  PasskeyUnlockOffer,
  type PasskeyUnlockOfferProps,
} from './PasskeyUnlockOffer';

const OFFER_TITLE = /Unlock faster with a passkey/;

function renderOffer(overrides: Partial<PasskeyUnlockOfferProps> = {}) {
  const props: PasskeyUnlockOfferProps = {
    open: true,
    enrolling: false,
    onAccept: jest.fn(),
    onDecline: jest.fn(),
    ...overrides,
  };
  render(<PasskeyUnlockOffer {...props} />);
  return props;
}

describe('PasskeyUnlockOffer (presentational)', () => {
  test('renders nothing while closed', () => {
    renderOffer({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(OFFER_TITLE)).not.toBeInTheDocument();
  });

  test('open shows the title and both buttons', () => {
    renderOffer();

    expect(
      screen.getByRole('dialog', { name: OFFER_TITLE }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Set up passkey' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeEnabled();
  });

  test('Set up passkey calls onAccept only', () => {
    const props = renderOffer();

    fireEvent.click(screen.getByRole('button', { name: 'Set up passkey' }));

    expect(props.onAccept).toHaveBeenCalledTimes(1);
    expect(props.onDecline).not.toHaveBeenCalled();
  });

  test('Not now calls onDecline only', () => {
    const props = renderOffer();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(props.onDecline).toHaveBeenCalledTimes(1);
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  test('Escape calls onDecline', () => {
    const props = renderOffer();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(props.onDecline).toHaveBeenCalledTimes(1);
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  test('while enrolling both buttons are disabled, the accept label reads Setting up…, and Escape does not decline', () => {
    const props = renderOffer({ enrolling: true });

    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Setting up…' })).toBeDisabled();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(props.onDecline).not.toHaveBeenCalled();
  });
});
