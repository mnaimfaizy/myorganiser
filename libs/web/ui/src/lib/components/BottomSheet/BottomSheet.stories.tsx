import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';

import { Button } from '../Button/Button';
import {
  BottomSheet,
  BottomSheetAction,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
} from './BottomSheet';

/*
 * The Weekly shop action sheet from the PhoneOverlays artboard. The artboard
 * gives the sheet a title and no description, so the content opts out of
 * aria-describedby on purpose, as the BottomSheet contract asks.
 */
function WeeklyShopActionSheet({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  return (
    <BottomSheet defaultOpen={defaultOpen}>
      <BottomSheetTrigger asChild>
        <Button variant="outline">List actions</Button>
      </BottomSheetTrigger>
      <BottomSheetContent aria-describedby={undefined}>
        <BottomSheetHeader>
          <BottomSheetTitle>Weekly shop</BottomSheetTitle>
        </BottomSheetHeader>
        <BottomSheetAction>Rename list</BottomSheetAction>
        <BottomSheetAction>Uncheck All</BottomSheetAction>
        <BottomSheetAction>Remove Checked (4)</BottomSheetAction>
        <BottomSheetAction tone="destructive">
          Delete Grocery List…
        </BottomSheetAction>
      </BottomSheetContent>
    </BottomSheet>
  );
}

const meta: Meta<typeof WeeklyShopActionSheet> = {
  component: WeeklyShopActionSheet,
  title: 'Components/BottomSheet',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof WeeklyShopActionSheet>;

export const ActionSheet: Story = {
  args: { defaultOpen: true },
};

/*
 * The play closes the sheet, so the final frame has no sheet in it. Chromatic
 * would snapshot that as a blank canvas, so this story is interaction-only.
 * The visual state is ActionSheet above.
 */
export const ActivatingActionClosesSheet: Story = {
  args: { defaultOpen: true },
  parameters: {
    chromatic: { disableSnapshot: true },
  },
  play: async () => {
    await userEvent.click(
      within(document.body).getByRole('button', { name: 'Rename list' }),
    );
    await waitFor(() => {
      expect(
        within(document.body).queryByRole('dialog'),
      ).not.toBeInTheDocument();
    });
  },
};

export const Phone: Story = {
  args: { defaultOpen: true },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    chromatic: { viewports: [320] },
  },
};
