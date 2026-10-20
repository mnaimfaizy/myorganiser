import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import { ChevronRight, Copy as CopyIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Checkbox } from '../Checkbox/Checkbox';
import { Illustration } from '../Illustration/Illustration';
import { StatusPill } from '../StatusPill/StatusPill';
import {
  ListGroup,
  ListGroupHeader,
  ListGroupHeaderTitle,
  ListGroupRow,
  ListGroupRowBody,
  ListGroupRowLeading,
  ListGroupRowMeta,
  ListGroupRowTitle,
  ListGroupRowTrailing,
} from './ListGroup';

/*
 * Row sizes follow the design: value 56, default 64, navigation 68 (which also
 * serves copy-a-field rows), checklist 72.
 */

interface CheckboxRowProps {
  title: string;
  meta?: ReactNode;
  trailing?: ReactNode;
  defaultChecked?: boolean;
  size?: 'default' | 'checklist';
}

/**
 * A row whose checkbox is the control. The row is a `<label>`, so the whole
 * row toggles the box. The checkbox state lives in the row, so the control
 * responds to clicks and the title strikes through when it is checked
 * (STORYBOOK-PATTERNS §5). `aria-label` names the checkbox by its title, not
 * by the row's full text, which would include the meta line and pills.
 */
function CheckboxRow({
  title,
  meta,
  trailing,
  defaultChecked = false,
  size = 'default',
}: CheckboxRowProps) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <ListGroupRow asChild size={size}>
      <label>
        <ListGroupRowLeading>
          <Checkbox
            aria-label={title}
            checked={checked}
            onCheckedChange={(value) => setChecked(value === true)}
          />
        </ListGroupRowLeading>
        <ListGroupRowBody>
          <ListGroupRowTitle
            className={
              checked ? 'text-muted-foreground line-through' : undefined
            }
          >
            {title}
          </ListGroupRowTitle>
          {meta ? <ListGroupRowMeta>{meta}</ListGroupRowMeta> : null}
        </ListGroupRowBody>
        {trailing ? (
          <ListGroupRowTrailing>{trailing}</ListGroupRowTrailing>
        ) : null}
      </label>
    </ListGroupRow>
  );
}

interface NavigationListRowProps {
  href: string;
  title: string;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}

/** A navigation row is an `<a>`, so it is a link to assistive technology. */
function NavigationListRow({
  href,
  title,
  meta,
  leading,
  trailing,
}: NavigationListRowProps) {
  return (
    <ListGroupRow asChild size="navigation" interactive>
      <a href={href}>
        {leading ? <ListGroupRowLeading>{leading}</ListGroupRowLeading> : null}
        <ListGroupRowBody>
          <ListGroupRowTitle>{title}</ListGroupRowTitle>
          {meta ? <ListGroupRowMeta>{meta}</ListGroupRowMeta> : null}
        </ListGroupRowBody>
        <ListGroupRowTrailing>
          {trailing}
          <ChevronRight aria-hidden="true" className="size-4 text-inactive" />
        </ListGroupRowTrailing>
      </a>
    </ListGroupRow>
  );
}

interface CopyFieldRowProps {
  /** The field name shown above the value, and the lowercase part of the name. */
  label: string;
  value: string;
}

/**
 * A copy-a-field row is a `<button>`. Its visible text (the label and value)
 * is replaced by an `aria-label` that names the action and the value.
 */
function CopyFieldRow({ label, value }: CopyFieldRowProps) {
  return (
    <ListGroupRow asChild size="navigation" interactive>
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}: ${value}`}
        className="text-left"
      >
        <ListGroupRowBody>
          <ListGroupRowMeta>{label}</ListGroupRowMeta>
          <ListGroupRowTitle>{value}</ListGroupRowTitle>
        </ListGroupRowBody>
        <ListGroupRowTrailing>
          <CopyIcon aria-hidden="true" className="text-foreground-secondary" />
        </ListGroupRowTrailing>
      </button>
    </ListGroupRow>
  );
}

interface ValueListRowProps {
  title: string;
  value: string;
}

/** A value row is read-only, so it has no `interactive` hover or focus. */
function ValueListRow({ title, value }: ValueListRowProps) {
  return (
    <ListGroupRow size="value">
      <ListGroupRowBody>
        <ListGroupRowTitle>{title}</ListGroupRowTitle>
      </ListGroupRowBody>
      <ListGroupRowTrailing>
        <span className="text-body font-semibold tabular-nums">{value}</span>
      </ListGroupRowTrailing>
    </ListGroupRow>
  );
}

function TaskRowExample() {
  return (
    <ListGroup>
      <CheckboxRow
        title="Pay council tax"
        meta={
          <>
            <StatusPill tone="danger" size="sm">
              Overdue
            </StatusPill>
            <span>Yesterday · Personal</span>
          </>
        }
        trailing={
          <StatusPill tone="danger" size="sm">
            High
          </StatusPill>
        }
      />
    </ListGroup>
  );
}

/**
 * A long user-supplied title wraps inside `ListGroupRowBody` (`min-w-0`), and
 * the trailing pill stays on the row. The row grows in height; it does not push
 * the pill off the edge.
 */
function LongTitleExample() {
  return (
    <ListGroup>
      <CheckboxRow
        title="Renew the building insurance for the rental property on Rose Lane before the policy lapses at the end of the month"
        meta={
          <>
            <StatusPill tone="danger" size="sm">
              Overdue
            </StatusPill>
            <span>Friday · Rental</span>
          </>
        }
        trailing={
          <StatusPill tone="danger" size="sm">
            High
          </StatusPill>
        }
      />
    </ListGroup>
  );
}

function NavigationExample() {
  return (
    <ListGroup>
      <NavigationListRow
        href="#home"
        title="Home"
        meta="3 of 5 places updated"
        leading={<Illustration kind="addresses" size={36} />}
      />
    </ListGroup>
  );
}

function CopyFieldExample() {
  return (
    <ListGroup>
      <CopyFieldRow label="Street" value="14 Rose Lane" />
    </ListGroup>
  );
}

function ValueExample() {
  return (
    <ListGroup>
      <ValueListRow title="Streaming plan" value="$15.49" />
    </ListGroup>
  );
}

/**
 * The section header sits above the card, not inside it. The checklist rows
 * are the 72px size; the second row is checked and struck through; the third
 * shows the in-progress meta in the warning text colour.
 */
function ChecklistExample() {
  return (
    <div className="flex flex-col gap-2">
      <ListGroupHeader>
        <ListGroupHeaderTitle>Produce · 3</ListGroupHeaderTitle>
      </ListGroupHeader>
      <ListGroup>
        <CheckboxRow size="checklist" title="Bananas" meta="1 bunch · $2.50" />
        <CheckboxRow size="checklist" title="Baby spinach" defaultChecked />
        <CheckboxRow
          size="checklist"
          title="Avocados"
          meta={<span className="text-warning-text">Saving…</span>}
        />
      </ListGroup>
    </div>
  );
}

/**
 * Rows of every size share one card. The hairline between rows of different
 * heights is the thing to check here.
 */
function GroupedCardExample() {
  return (
    <ListGroup>
      <CheckboxRow
        title="Pay council tax"
        meta={
          <>
            <StatusPill tone="danger" size="sm">
              Overdue
            </StatusPill>
            <span>Yesterday · Personal</span>
          </>
        }
        trailing={
          <StatusPill tone="danger" size="sm">
            High
          </StatusPill>
        }
      />
      <NavigationListRow
        href="#home"
        title="Home"
        meta="3 of 5 places updated"
        leading={<Illustration kind="addresses" size={36} />}
      />
      <ValueListRow title="Streaming plan" value="$15.49" />
      <CopyFieldRow label="Street" value="14 Rose Lane" />
    </ListGroup>
  );
}

/**
 * The phone layout (PhoneLists artboard). Each group stacks below the last, at
 * the 320px width the phone story declares.
 */
function PhoneListsExample() {
  return (
    <div className="flex w-full flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        <ListGroupHeader>
          <ListGroupHeaderTitle>Produce · 3</ListGroupHeaderTitle>
        </ListGroupHeader>
        <ListGroup>
          <CheckboxRow
            size="checklist"
            title="Bananas"
            meta="1 bunch · $2.50"
          />
          <CheckboxRow size="checklist" title="Baby spinach" defaultChecked />
          <CheckboxRow
            size="checklist"
            title="Avocados"
            meta={<span className="text-warning-text">Saving…</span>}
          />
        </ListGroup>
      </div>
      <ListGroup>
        <NavigationListRow
          href="#home"
          title="Home"
          trailing={
            <StatusPill tone="trust" size="sm">
              Current
            </StatusPill>
          }
        />
        <NavigationListRow
          href="#personal"
          title="Personal"
          meta="+61 412 345 678"
        />
      </ListGroup>
      <ListGroup>
        <CopyFieldRow label="Street" value="14 Rose Lane" />
        <CopyFieldRow label="Suburb" value="Richmond VIC" />
        <CopyFieldRow label="Postcode" value="3121" />
      </ListGroup>
      <ListGroup>
        <CheckboxRow
          size="checklist"
          title="Tax office"
          meta={
            <StatusPill tone="success" size="sm">
              Changed
            </StatusPill>
          }
        />
        <CheckboxRow
          size="checklist"
          title="Bank"
          meta={
            <StatusPill tone="danger" size="sm">
              High
            </StatusPill>
          }
        />
      </ListGroup>
    </div>
  );
}

const meta: Meta<typeof GroupedCardExample> = {
  component: GroupedCardExample,
  title: 'Components/ListGroup',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof GroupedCardExample>;

export const TaskRow: Story = {
  render: function Render() {
    return <TaskRowExample />;
  },
};

export const LongTitle: Story = {
  render: function Render() {
    return <LongTitleExample />;
  },
};

export const Navigation: Story = {
  render: function Render() {
    return <NavigationExample />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A navigation row is a link, so it is in the link landmark list.
    expect(canvas.getByRole('link', { name: /^Home/ })).toHaveAttribute(
      'href',
      '#home',
    );
  },
};

export const CopyField: Story = {
  render: function Render() {
    return <CopyFieldExample />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole('button', { name: 'Copy street: 14 Rose Lane' }),
    ).toBeVisible();
  },
};

export const Value: Story = {
  render: function Render() {
    return <ValueExample />;
  },
};

export const Checklist: Story = {
  render: function Render() {
    return <ChecklistExample />;
  },
};

export const GroupedCard: Story = {
  render: function Render() {
    return <GroupedCardExample />;
  },
};

export const PhoneLists: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    chromatic: { viewports: [320] },
  },
  render: function Render() {
    return <PhoneListsExample />;
  },
};
