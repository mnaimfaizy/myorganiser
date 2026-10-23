import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRef } from 'react';
import { RadioCard } from './RadioCard';

describe('RadioCard', () => {
  describe('accessible naming', () => {
    it('uses the title as the accessible name and the description as the accessible description', () => {
      render(
        <RadioCard
          name="plan"
          value="starter"
          title="Starter"
          description="Up to three projects"
        />,
      );

      const radio = screen.getByRole('radio', { name: 'Starter' });

      expect(radio).toHaveAccessibleDescription('Up to three projects');
    });

    it('merges a caller aria-describedby with the description id', () => {
      render(
        <>
          <p id="billing-note">Billed monthly</p>
          <RadioCard
            name="plan"
            value="pro"
            title="Pro"
            description="Unlimited projects"
            aria-describedby="billing-note"
          />
        </>,
      );

      expect(
        screen.getByRole('radio', { name: 'Pro' }),
      ).toHaveAccessibleDescription('Billed monthly Unlimited projects');
    });

    it('uses only the caller aria-describedby as the description when no description prop is given', () => {
      render(
        <>
          <p id="x">Caller supplied hint</p>
          <RadioCard
            name="plan"
            value="free"
            title="Free"
            aria-describedby="x"
          />
        </>,
      );

      expect(
        screen.getByRole('radio', { name: 'Free' }),
      ).toHaveAccessibleDescription('Caller supplied hint');
    });

    it('forwards aria-invalid to the input, since the card has no error state of its own', () => {
      render(<RadioCard name="plan" value="team" title="Team" aria-invalid />);

      expect(screen.getByRole('radio', { name: 'Team' })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });
  });

  describe('selection', () => {
    it('checks the radio and calls onChange when the title inside the card is clicked', () => {
      const onChange = jest.fn();
      render(
        <RadioCard
          name="plan"
          value="starter"
          title="Starter"
          onChange={onChange}
        />,
      );
      const radio = screen.getByRole('radio', { name: 'Starter' });

      fireEvent.click(screen.getByText('Starter'));

      expect(radio).toBeChecked();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ target: radio }),
      );
    });

    it('unchecks the previous card when a second card with the same name is checked', () => {
      render(
        <>
          <RadioCard name="plan" value="starter" title="Starter" />
          <RadioCard name="plan" value="pro" title="Pro" />
        </>,
      );
      const starter = screen.getByRole('radio', { name: 'Starter' });
      const pro = screen.getByRole('radio', { name: 'Pro' });

      fireEvent.click(starter);
      expect(starter).toBeChecked();

      fireEvent.click(pro);

      expect(pro).toBeChecked();
      expect(starter).not.toBeChecked();
    });

    it('does not check a disabled card when it is clicked', () => {
      const onChange = jest.fn();
      render(
        <RadioCard
          name="plan"
          value="enterprise"
          title="Enterprise"
          disabled
          onChange={onChange}
        />,
      );
      const radio = screen.getByRole('radio', { name: 'Enterprise' });

      expect(radio).toBeDisabled();

      fireEvent.click(screen.getByText('Enterprise'));

      expect(radio).not.toBeChecked();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('ref forwarding', () => {
    it('forwards the ref to the underlying input element', () => {
      const ref = createRef<HTMLInputElement>();

      render(<RadioCard ref={ref} name="plan" value="pro" title="Pro" />);

      expect(ref.current).toBeInstanceOf(HTMLInputElement);
      expect(ref.current).toBe(screen.getByRole('radio', { name: 'Pro' }));
    });
  });
});
