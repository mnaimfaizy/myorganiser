import type { Meta, StoryObj } from '@storybook/react';
import { expect } from '@storybook/test';
import {
  ILLUSTRATION_KINDS,
  ILLUSTRATION_SIZES,
  Illustration,
  type IllustrationKind,
  type IllustrationSize,
} from './Illustration';

/**
 * Visible labels for each kind, taken from the Web v2.0 section illustration
 * sheet. Typed as a full Record so a new kind cannot ship without a label.
 */
const KIND_LABELS: Record<IllustrationKind, string> = {
  home: 'Home',
  tasks: 'Tasks',
  groceries: 'Groceries',
  subscriptions: 'Subscriptions',
  addresses: 'Addresses',
  mobile: 'Mobile numbers',
  youtube: 'YouTube',
  vault: 'Vault',
  feedback: 'Feedback',
  admin: 'Overview',
  users: 'Users',
  audit: 'Audit log',
  inbox: 'Feedback inbox',
  more: 'More',
};

/** Admin portal kinds, shown as their own row on the design sheet. */
const ADMIN_KINDS: readonly IllustrationKind[] = [
  'admin',
  'users',
  'audit',
  'inbox',
];

/** Personal section kinds: every registry kind that is neither admin nor the tab bar's More. */
const USER_KINDS = ILLUSTRATION_KINDS.filter(
  (kind) => kind !== 'more' && !ADMIN_KINDS.includes(kind),
);

/** Size captions from the design sheet. The sheet names only these four sizes. */
const SIZE_CAPTIONS: Partial<Record<IllustrationSize, string>> = {
  28: '28 · tab bar',
  36: '36 · sidebar',
  64: '64 · cards',
  140: '140 · hero',
};

function sizeCaption(size: IllustrationSize): string {
  return SIZE_CAPTIONS[size] ?? `${size} px`;
}

function KindGroup({
  label,
  kinds,
  size,
}: {
  label: string;
  kinds: readonly IllustrationKind[];
  size: IllustrationSize | undefined;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-caption font-semibold text-muted-foreground">
        {label}
      </h3>
      <ul className="flex flex-wrap gap-4">
        {kinds.map((kind) => (
          <li
            key={kind}
            className="flex w-28 flex-col items-center gap-2 text-center"
          >
            <Illustration kind={kind} size={size} />
            <span className="text-caption">{KIND_LABELS[kind]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const meta: Meta<typeof Illustration> = {
  component: Illustration,
  title: 'Components/Illustration',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Decorative section illustration. The SVG is `aria-hidden` and not focusable, so it adds no meaning for assistive technology. Always render visible text beside it; the text carries the meaning. Kinds and sizes come from the exported `ILLUSTRATION_KINDS` and `ILLUSTRATION_SIZES`.',
      },
    },
  },
  argTypes: {
    kind: {
      control: 'select',
      options: [...ILLUSTRATION_KINDS],
      description: 'Which section drawing to render',
    },
    size: {
      control: 'select',
      options: [...ILLUSTRATION_SIZES],
      description: 'Edge length in pixels; the drawing is square',
    },
    className: { control: false },
  },
  args: {
    kind: 'home',
    size: 64,
  },
};

export default meta;
type Story = StoryObj<typeof Illustration>;

export const Default: Story = {
  args: {
    kind: 'home',
    size: 64,
  },
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
  },
};

export const AllKinds: Story = {
  args: {
    size: 96,
  },
  render: ({ size }) => (
    <div className="flex flex-col gap-6">
      <KindGroup label="Personal sections" kinds={USER_KINDS} size={size} />
      <KindGroup label="Admin portal" kinds={ADMIN_KINDS} size={size} />
      <KindGroup label="Phone tab bar" kinds={['more']} size={size} />
    </div>
  ),
};

export const AllSizes: Story = {
  args: {
    kind: 'groceries',
  },
  render: ({ kind }) => (
    <ul className="flex flex-wrap items-end gap-8">
      {ILLUSTRATION_SIZES.map((size) => (
        <li key={size} className="flex flex-col items-center gap-2">
          <Illustration kind={kind} size={size} />
          <span className="text-caption text-muted-foreground">
            {sizeCaption(size)}
          </span>
        </li>
      ))}
    </ul>
  ),
};

export const KindsByAllSizes: Story = {
  render: () => (
    <table className="border-separate border-spacing-x-4 border-spacing-y-2 text-left">
      <caption className="sr-only">
        Every section illustration at every size
      </caption>
      <thead>
        <tr>
          <th
            scope="col"
            className="text-caption font-normal text-muted-foreground"
          >
            Kind
          </th>
          {ILLUSTRATION_SIZES.map((size) => (
            <th
              key={size}
              scope="col"
              className="text-caption font-normal text-muted-foreground"
            >
              {size} px
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ILLUSTRATION_KINDS.map((kind) => (
          <tr key={kind}>
            <th scope="row" className="text-caption font-normal">
              {KIND_LABELS[kind]}
            </th>
            {ILLUSTRATION_SIZES.map((size) => (
              <td key={size}>
                <Illustration kind={kind} size={size} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
};

export const InContext: Story = {
  render: () => (
    <article className="flex max-w-md items-center gap-4 rounded-panel border border-border bg-background p-4">
      <Illustration kind="groceries" size={64} />
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">Groceries</h3>
        <p className="text-caption text-muted-foreground">
          12 items on the shopping list
        </p>
      </div>
    </article>
  ),
};
