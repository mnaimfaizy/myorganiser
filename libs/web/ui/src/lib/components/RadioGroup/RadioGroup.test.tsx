import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRef } from 'react';
import { RadioGroup, RadioGroupItem } from './RadioGroup';

describe('RadioGroup', () => {
  describe('accessible naming', () => {
    it('names the fieldset group by its legend', () => {
      render(
        <RadioGroup legend="Priority">
          <RadioGroupItem name="priority" value="high">
            High
          </RadioGroupItem>
        </RadioGroup>,
      );

      expect(
        screen.getByRole('group', { name: 'Priority' }),
      ).toBeInTheDocument();
    });

    it('names each option by its children text', () => {
      render(
        <RadioGroup legend="Priority">
          <RadioGroupItem name="priority" value="high">
            High
          </RadioGroupItem>
          <RadioGroupItem name="priority" value="low">
            Low
          </RadioGroupItem>
        </RadioGroup>,
      );

      expect(screen.getByRole('radio', { name: 'High' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Low' })).toBeInTheDocument();
    });

    it('forwards aria-invalid to the input, since radio options have no error styling of their own', () => {
      render(
        <RadioGroup legend="Priority">
          <RadioGroupItem name="priority" value="high" aria-invalid>
            High
          </RadioGroupItem>
        </RadioGroup>,
      );

      expect(screen.getByRole('radio', { name: 'High' })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });
  });

  describe('selection', () => {
    it('checks the option and calls onChange with the radio as target when its label text is clicked', () => {
      const onChange = jest.fn();
      render(
        <RadioGroup legend="Priority">
          <RadioGroupItem name="priority" value="high" onChange={onChange}>
            High
          </RadioGroupItem>
        </RadioGroup>,
      );
      const radio = screen.getByRole('radio', { name: 'High' });

      fireEvent.click(screen.getByText('High'));

      expect(radio).toBeChecked();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ target: radio }),
      );
    });

    it('unchecks the previous option when a second option with the same name is checked', () => {
      render(
        <RadioGroup legend="Priority">
          <RadioGroupItem name="priority" value="high">
            High
          </RadioGroupItem>
          <RadioGroupItem name="priority" value="low">
            Low
          </RadioGroupItem>
        </RadioGroup>,
      );
      const high = screen.getByRole('radio', { name: 'High' });
      const low = screen.getByRole('radio', { name: 'Low' });

      fireEvent.click(high);
      expect(high).toBeChecked();

      fireEvent.click(low);

      expect(low).toBeChecked();
      expect(high).not.toBeChecked();
    });

    it('does not check a disabled option and does not call onChange when it is clicked', () => {
      const onChange = jest.fn();
      render(
        <RadioGroup legend="Priority">
          <RadioGroupItem
            name="priority"
            value="urgent"
            disabled
            onChange={onChange}
          >
            Urgent
          </RadioGroupItem>
        </RadioGroup>,
      );
      const radio = screen.getByRole('radio', { name: 'Urgent' });

      expect(radio).toBeDisabled();

      fireEvent.click(screen.getByText('Urgent'));

      expect(radio).not.toBeChecked();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('disables every option when the fieldset is disabled, and a click does not check any of them', () => {
      const onChange = jest.fn();
      render(
        <RadioGroup legend="Priority" disabled>
          <RadioGroupItem name="priority" value="high" onChange={onChange}>
            High
          </RadioGroupItem>
          <RadioGroupItem name="priority" value="low" onChange={onChange}>
            Low
          </RadioGroupItem>
        </RadioGroup>,
      );
      const high = screen.getByRole('radio', { name: 'High' });
      const low = screen.getByRole('radio', { name: 'Low' });

      expect(high).toBeDisabled();
      expect(low).toBeDisabled();

      fireEvent.click(screen.getByText('High'));

      expect(high).not.toBeChecked();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('ref forwarding', () => {
    it('forwards the RadioGroup ref to the fieldset element', () => {
      const ref = createRef<HTMLFieldSetElement>();

      render(
        <RadioGroup ref={ref} legend="Priority">
          <RadioGroupItem name="priority" value="high">
            High
          </RadioGroupItem>
        </RadioGroup>,
      );

      expect(ref.current).toBeInstanceOf(HTMLFieldSetElement);
      expect(ref.current).toBe(screen.getByRole('group', { name: 'Priority' }));
    });

    it('forwards the RadioGroupItem ref to the input element', () => {
      const ref = createRef<HTMLInputElement>();

      render(
        <RadioGroup legend="Priority">
          <RadioGroupItem ref={ref} name="priority" value="high">
            High
          </RadioGroupItem>
        </RadioGroup>,
      );

      expect(ref.current).toBeInstanceOf(HTMLInputElement);
      expect(ref.current).toBe(screen.getByRole('radio', { name: 'High' }));
    });
  });

  describe('layout hook', () => {
    it('keeps a caller className alongside the base group classes', () => {
      render(
        <RadioGroup legend="Priority" className="grid-cols-2">
          <RadioGroupItem name="priority" value="high">
            High
          </RadioGroupItem>
        </RadioGroup>,
      );

      const group = screen.getByRole('group', { name: 'Priority' });

      expect(group).toHaveClass('grid-cols-2');
      expect(group).toHaveClass('group', 'flex', 'flex-col');
    });
  });
});
