import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { formatMoney } from '@myorganiser/core';
import { SubscriptionsTotals } from './subscriptions-totals';
import type { SubscriptionsTotalsProps } from './subscriptions-totals';

const noop = () => undefined;

function renderTotals(overrides: Partial<SubscriptionsTotalsProps> = {}) {
  const props: SubscriptionsTotalsProps = {
    totals: [],
    preferredCurrency: 'AUD',
    activeCount: 0,
    nextRenewal: null,
    conversion: { status: 'off' },
    onConvert: noop,
    onShowOriginal: noop,
    variant: 'desktop',
    ...overrides,
  };
  return render(<SubscriptionsTotals {...props} />);
}

/** The desktop card whose label reads `label`: the label's parent is the card container. */
function cardFor(label: string): HTMLElement {
  const card = screen.getByText(label).parentElement;
  if (!card) throw new Error(`No card container for "${label}"`);
  return card;
}

const mixedTotals = [
  { currency: 'AUD' as const, monthly: 15.99, count: 1 },
  { currency: 'USD' as const, monthly: 10, count: 1 },
];

describe('SubscriptionsTotals (desktop, mixed currencies)', () => {
  it('lists the other currency yearly figure on the Each year card, not converted', () => {
    renderTotals({ totals: mixedTotals, variant: 'desktop' });

    const yearly = within(cardFor('Each year'));
    // formatMoney is called without a locale, so the expected string is taken from it.
    expect(
      yearly.getByText(formatMoney({ amount: 15.99 * 12, currency: 'AUD' })),
    ).toBeInTheDocument();
    expect(
      yearly.getByText(
        `+ ${formatMoney({ amount: 10 * 12, currency: 'USD' })}`,
      ),
    ).toBeInTheDocument();
    expect(
      yearly.getByText('Monthly, yearly and weekly plans combined'),
    ).toBeInTheDocument();
  });

  it('keeps the Each month card listing the other currency monthly figure', () => {
    renderTotals({ totals: mixedTotals, variant: 'desktop' });

    const monthly = within(cardFor('Each month (active)'));
    // The caption <p> also holds the "Show all" button, so match its full text.
    const other = formatMoney({ amount: 10, currency: 'USD' });
    expect(
      monthly.getByText(
        (_, el) =>
          el?.tagName === 'P' &&
          el.textContent === `+ ${other} · Show all in AUD`,
      ),
    ).toBeInTheDocument();
  });
});

describe('SubscriptionsTotals (desktop, converted)', () => {
  it('shows the converted monthly value times 12 on the Each year card, with no "+" line', () => {
    renderTotals({
      totals: mixedTotals,
      variant: 'desktop',
      conversion: { status: 'ready', monthly: 20 },
    });

    const yearly = within(cardFor('Each year'));
    expect(
      yearly.getByText(formatMoney({ amount: 240, currency: 'AUD' })),
    ).toBeInTheDocument();
    expect(yearly.queryByText(/^\+ /)).not.toBeInTheDocument();
  });
});

describe('SubscriptionsTotals (desktop, single currency)', () => {
  it('shows no "+" line on the Each year card', () => {
    renderTotals({
      totals: [{ currency: 'AUD', monthly: 15.99, count: 2 }],
      variant: 'desktop',
    });

    const yearly = within(cardFor('Each year'));
    expect(
      yearly.getByText(formatMoney({ amount: 15.99 * 12, currency: 'AUD' })),
    ).toBeInTheDocument();
    expect(yearly.queryByText(/^\+ /)).not.toBeInTheDocument();
  });
});

describe('SubscriptionsTotals (phone, mixed currencies)', () => {
  it('keeps the other currency monthly figure in its caption and has no Each year card', () => {
    renderTotals({
      totals: mixedTotals,
      variant: 'phone',
      activeCount: 2,
    });

    const other = formatMoney({ amount: 10, currency: 'USD' });
    expect(screen.getByText(`+ ${other} · 2 active`)).toBeInTheDocument();
    expect(screen.queryByText('Each year')).not.toBeInTheDocument();
  });
});
