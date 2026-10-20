import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton } from './Skeleton';

const meta: Meta<typeof Skeleton> = {
  component: Skeleton,
  title: 'Components/Skeleton',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {
  args: {
    className: 'h-4 w-64',
  },
};

export const ProfilePreview: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  ),
};

export const CardPlaceholder: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3 rounded-lg border p-4">
      <Skeleton className="h-32 w-full rounded-md" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  ),
};

// The Feedback artboard's loading state: two rows, each a 36px tile and two
// text bars. The bar widths are the nearest fractions on the scale (60% and
// 35%, then 48% and 28%). The container is the labelled loading region; the
// skeleton pieces are aria-hidden by the component.
const LOADING_ROWS = [
  { titleWidth: 'w-3/5', detailWidth: 'w-1/3' },
  { titleWidth: 'w-1/2', detailWidth: 'w-1/4' },
] as const;

export const TwoRows: Story = {
  render: () => (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col gap-2.5 rounded-xl border border-border p-4"
    >
      {LOADING_ROWS.map((row, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-control-sm" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={`h-3 ${row.titleWidth}`} />
            <Skeleton className={`h-2.5 ${row.detailWidth} rounded-sm`} />
          </div>
        </div>
      ))}
    </div>
  ),
};
