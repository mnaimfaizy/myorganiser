/* eslint-disable import/first */
import '@testing-library/jest-dom';

// The meter imports its bounds and duration formatter from the hooks barrel,
// which pulls in auth and the API client. The pure ledger helpers are enough.
jest.mock('../hooks', () => jest.requireActual('../lib/shortsBudget'));

jest.mock('@myorganiser/web-ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Input: (props: any) => <input {...props} />,
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShortsBudgetMeter } from './ShortsBudgetMeter';

type MeterProps = ComponentProps<typeof ShortsBudgetMeter>;

const baseProps: Omit<MeterProps, 'onLimitMinutesChange'> = {
  spentMs: 65_000,
  limitMs: 3_600_000,
  remainingMs: 3_535_000,
  usedPercent: 2,
  locked: false,
  metering: false,
};

/** Renders the meter; `rerenderMeter` re-renders the same instance with new props. */
const renderMeter = (overrides: Partial<MeterProps> = {}) => {
  const onLimitMinutesChange = jest.fn();
  const props = { ...baseProps, onLimitMinutesChange, ...overrides };
  const view = render(<ShortsBudgetMeter {...props} />);
  return {
    ...view,
    onLimitMinutesChange,
    rerenderMeter: (next: Partial<MeterProps>) =>
      view.rerender(<ShortsBudgetMeter {...props} {...next} />),
  };
};

const limitInput = () => screen.getByLabelText('Daily limit (minutes)');

describe('ShortsBudgetMeter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('readout and progress', () => {
    it('shows spent of limit in whole minutes with the figure in bold, and remaining minutes', () => {
      renderMeter();

      // The bold figure is its own element, so match the whole phrase by its text content.
      expect(
        screen.getByText(
          (_, el) => el?.textContent === '1 of 60 min used today',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('1 of 60 min')).toHaveClass('font-semibold');
      expect(screen.getByText('59 min left')).toBeInTheDocument();
    });

    it('rounds spent minutes down, so 59 seconds spent still reads 0 and 60 seconds reads 1', () => {
      const { rerenderMeter } = renderMeter({ spentMs: 59_000 });
      expect(screen.getByText('0 of 60 min')).toBeInTheDocument();

      rerenderMeter({ spentMs: 60_000 });
      expect(screen.getByText('1 of 60 min')).toBeInTheDocument();
    });

    it('rounds remaining minutes up, so 60 seconds left reads 1 and 61 seconds left reads 2', () => {
      const { rerenderMeter } = renderMeter({ remainingMs: 60_000 });
      expect(screen.getByText('1 min left')).toBeInTheDocument();

      rerenderMeter({ remainingMs: 61_000 });
      expect(screen.getByText('2 min left')).toBeInTheDocument();
    });

    it('hides the progress bar when showProgressBar is false, keeping the readout and percentage text', () => {
      renderMeter({ showProgressBar: false, usedPercent: 2 });

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByText('1 of 60 min')).toBeInTheDocument();
      expect(screen.getByText('2% used')).toBeInTheDocument();
    });

    it('shows the metering marker only while the budget is metering', () => {
      const { rerenderMeter } = renderMeter({ metering: false });
      expect(screen.queryByText('(metering…)')).not.toBeInTheDocument();

      rerenderMeter({ metering: true });
      expect(screen.getByText('(metering…)')).toBeInTheDocument();
    });

    it('exposes the used percentage as progressbar values and a label, with a fill of the same width', () => {
      renderMeter({ usedPercent: 2 });

      const bar = screen.getByRole('progressbar', {
        name: '2% of daily Shorts budget used',
      });
      expect(bar).toHaveAttribute('aria-valuenow', '2');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      expect(bar.firstElementChild).toHaveStyle({ width: '2%' });
    });

    it('caps the progress fill at 100% when usage exceeds the limit', () => {
      renderMeter({ usedPercent: 120 });

      const bar = screen.getByRole('progressbar', {
        name: '120% of daily Shorts budget used',
      });
      expect(bar.firstElementChild).toHaveStyle({ width: '100%' });
    });
  });

  describe('polite announcement and locked state', () => {
    it('announces whole remaining minutes, singular for one and plural otherwise', () => {
      const { rerenderMeter } = renderMeter({ remainingMs: 30_000 });

      const one = screen.getByText(
        '1 minute of Shorts Daily Budget remaining today.',
      );
      expect(one).toHaveAttribute('aria-live', 'polite');

      rerenderMeter({ remainingMs: 1_500_000 });
      expect(
        screen.getByText('25 minutes of Shorts Daily Budget remaining today.'),
      ).toBeInTheDocument();
    });

    it('announces the spent budget and shows the locked banner, leaving the limit input editable', () => {
      renderMeter({ locked: true, remainingMs: 0, usedPercent: 100 });

      expect(
        screen.getByText(
          'Shorts Daily Budget spent for today. Shorts stay locked until local midnight.',
        ),
      ).toHaveAttribute('aria-live', 'polite');
      expect(
        screen.getByText(
          "Today's Shorts budget is exhausted. Raising the daily limit gives time back today.",
        ),
      ).toBeInTheDocument();
      expect(limitInput()).not.toBeDisabled();
    });
  });

  describe('daily limit input', () => {
    it('calls onLimitMinutesChange with each in-range integer typed, including the bounds', () => {
      const { onLimitMinutesChange } = renderMeter();

      fireEvent.change(limitInput(), { target: { value: '15' } });
      expect(onLimitMinutesChange).toHaveBeenLastCalledWith(15);

      fireEvent.change(limitInput(), { target: { value: '1' } });
      expect(onLimitMinutesChange).toHaveBeenLastCalledWith(1);

      fireEvent.change(limitInput(), { target: { value: '180' } });
      expect(onLimitMinutesChange).toHaveBeenLastCalledWith(180);
    });

    it('never calls onLimitMinutesChange for empty, zero or above-maximum input, but keeps the typed value', () => {
      const { onLimitMinutesChange } = renderMeter();

      fireEvent.change(limitInput(), { target: { value: '0' } });
      expect(onLimitMinutesChange).not.toHaveBeenCalled();
      expect(limitInput()).toHaveValue(0);

      fireEvent.change(limitInput(), { target: { value: '181' } });
      expect(onLimitMinutesChange).not.toHaveBeenCalled();
      expect(limitInput()).toHaveValue(181);

      fireEvent.change(limitInput(), { target: { value: '' } });
      expect(onLimitMinutesChange).not.toHaveBeenCalled();
      expect(limitInput()).toHaveValue(null);
    });

    it('resyncs the input when the committed limit changes from outside', () => {
      const { rerenderMeter } = renderMeter();
      expect(limitInput()).toHaveValue(60);

      rerenderMeter({ limitMs: 15 * 60_000 });
      expect(limitInput()).toHaveValue(15);
    });
  });

  describe('Five minutes less / more stepper', () => {
    it('steps the limit down by five minutes, writes it to the input and reports it', () => {
      const { onLimitMinutesChange } = renderMeter();

      fireEvent.click(
        screen.getByRole('button', { name: 'Five minutes less' }),
      );

      expect(limitInput()).toHaveValue(55);
      expect(onLimitMinutesChange).toHaveBeenCalledWith(55);
    });

    it('steps from the value typed in the input, not the committed limit', () => {
      const { onLimitMinutesChange } = renderMeter();

      fireEvent.change(limitInput(), { target: { value: '12' } });
      fireEvent.click(
        screen.getByRole('button', { name: 'Five minutes more' }),
      );

      expect(limitInput()).toHaveValue(17);
      expect(onLimitMinutesChange).toHaveBeenLastCalledWith(17);
    });

    it('starts from the committed limit when the input is empty', () => {
      const { onLimitMinutesChange } = renderMeter();

      fireEvent.change(limitInput(), { target: { value: '' } });
      fireEvent.click(
        screen.getByRole('button', { name: 'Five minutes more' }),
      );

      expect(limitInput()).toHaveValue(65);
      expect(onLimitMinutesChange).toHaveBeenCalledTimes(1);
      expect(onLimitMinutesChange).toHaveBeenCalledWith(65);
    });

    it('clamps at the minimum and reports only the first change', () => {
      const { onLimitMinutesChange } = renderMeter({ limitMs: 3 * 60_000 });
      const less = screen.getByRole('button', { name: 'Five minutes less' });

      fireEvent.click(less);
      expect(limitInput()).toHaveValue(1);
      expect(onLimitMinutesChange).toHaveBeenCalledWith(1);

      fireEvent.click(less);
      expect(limitInput()).toHaveValue(1);
      expect(onLimitMinutesChange).toHaveBeenCalledTimes(1);
    });

    it('clamps at the maximum and reports only the first change', () => {
      const { onLimitMinutesChange } = renderMeter({ limitMs: 178 * 60_000 });
      const more = screen.getByRole('button', { name: 'Five minutes more' });

      fireEvent.click(more);
      expect(limitInput()).toHaveValue(180);
      expect(onLimitMinutesChange).toHaveBeenCalledWith(180);

      fireEvent.click(more);
      expect(limitInput()).toHaveValue(180);
      expect(onLimitMinutesChange).toHaveBeenCalledTimes(1);
    });
  });
});
