import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useState } from 'react';

import { Label } from '../Label/Label';
import { Switch } from './Switch';

const meta: Meta<typeof Switch> = {
  component: Switch,
  title: 'Components/Switch',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Switch>;

const DIGEST_LABEL = 'Weekly digest';
const DIGEST_DESCRIPTION = 'Email on Sundays';
const DESCRIPTION_CLASS = 'text-caption text-muted-foreground';

// Fixed ids keep Chromatic snapshots deterministic. The Label htmlFor/id pair
// gives the switch its accessible name, the same wiring a settings page uses.
const LABELLED_ID = 'weekly-digest';
const ROW_SWITCH_ID = 'weekly-digest-row';
const ROW_DESCRIPTION_ID = 'weekly-digest-row-description';
const CONTROLLED_ID = 'weekly-digest-controlled';

function LabelledSwitch({
  id,
  defaultChecked,
  disabled,
}: {
  id: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} defaultChecked={defaultChecked} disabled={disabled} />
      <Label htmlFor={id}>{DIGEST_LABEL}</Label>
    </div>
  );
}

// Controlled switch with a visible readout. The readout is the proof that
// onCheckedChange reaches the owner of the state.
function ControlledExample() {
  const [checked, setChecked] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-3">
        <Switch
          id={CONTROLLED_ID}
          checked={checked}
          onCheckedChange={setChecked}
        />
        <Label htmlFor={CONTROLLED_ID}>{DIGEST_LABEL}</Label>
      </div>
      <p className={DESCRIPTION_CLASS}>
        {`${DIGEST_LABEL} is ${checked ? 'on' : 'off'}.`}
      </p>
    </div>
  );
}

// Settings-row composition from the PhoneForms artboard: title and description
// on the left, switch on the right, minimum height 64px. The description is
// linked to the switch with aria-describedby.
function SettingsRowExample() {
  return (
    <div className="flex min-h-16 w-full max-w-md items-center justify-between gap-4 border-b border-border-subtle px-4 py-3">
      <div className="grid min-w-0 gap-0.5">
        <Label htmlFor={ROW_SWITCH_ID}>{DIGEST_LABEL}</Label>
        <p id={ROW_DESCRIPTION_ID} className={DESCRIPTION_CLASS}>
          {DIGEST_DESCRIPTION}
        </p>
      </div>
      <Switch
        id={ROW_SWITCH_ID}
        aria-describedby={ROW_DESCRIPTION_ID}
        defaultChecked
      />
    </div>
  );
}

export const On: Story = {
  render: () => <LabelledSwitch id={LABELLED_ID} defaultChecked />,
};

export const Off: Story = {
  render: () => <LabelledSwitch id={LABELLED_ID} />,
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole('switch', {
      name: DIGEST_LABEL,
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  },
};

export const DisabledOn: Story = {
  render: () => <LabelledSwitch id={LABELLED_ID} defaultChecked disabled />,
  play: async ({ canvasElement }) => {
    // A disabled switch refuses input: the click must not flip the state.
    const toggle = within(canvasElement).getByRole('switch', {
      name: DIGEST_LABEL,
    });
    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  },
};

export const DisabledOff: Story = {
  render: () => <LabelledSwitch id={LABELLED_ID} disabled />,
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole('switch', {
      name: DIGEST_LABEL,
    });
    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  },
};

export const Controlled: Story = {
  render: () => <ControlledExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('switch', { name: DIGEST_LABEL }));
    await waitFor(() => {
      expect(canvas.getByText('Weekly digest is on.')).toBeVisible();
    });
  },
};

export const SettingsRow: Story = {
  render: () => <SettingsRowExample />,
};
