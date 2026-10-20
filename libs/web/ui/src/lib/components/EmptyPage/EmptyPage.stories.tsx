import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import { Plus } from 'lucide-react';
import { Button } from '../Button/Button';
import { ILLUSTRATION_KINDS } from '../Illustration/Illustration';
import { EmptyPage } from './EmptyPage';

/**
 * The desktop call to action: a brand, large button with a plus icon. The icon
 * is decorative, so the button's accessible name is the label alone.
 */
function addAction(label: string) {
  return (
    <Button variant="brand" size="lg">
      <Plus aria-hidden="true" />
      {label}
    </Button>
  );
}

const meta: Meta<typeof EmptyPage> = {
  component: EmptyPage,
  title: 'Components/EmptyPage',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Desktop empty state for a feature page: the page h1 with a summary line, then a card with the section illustration, an h2, body copy, optional tips and a call to action. The phone equivalent is `EmptyScreen`.',
      },
    },
  },
  argTypes: {
    illustration: {
      control: 'select',
      options: [...ILLUSTRATION_KINDS],
      description:
        'Section illustration, shown beside the title and in the card',
    },
    tips: {
      control: 'object',
      description:
        'Checked list of short tips. Omit, or pass an empty list, to hide it.',
    },
    note: {
      control: 'text',
      description: 'Trust note beside the action. Pass `null` to hide it.',
    },
    action: { control: false },
    className: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyPage>;

/** Asserts the page h1, card h2 and action name, which every page story shares. */
async function expectEmptyPage(
  canvasElement: HTMLElement,
  expected: { title: string; heading: string; action: string },
) {
  const canvas = within(canvasElement);
  expect(
    canvas.getByRole('heading', { level: 1, name: expected.title }),
  ).toBeVisible();
  expect(
    canvas.getByRole('heading', { level: 2, name: expected.heading }),
  ).toBeVisible();
  expect(canvas.getByRole('button', { name: expected.action })).toBeVisible();
}

export const Addresses: Story = {
  args: {
    illustration: 'addresses',
    title: 'Addresses',
    heading: 'No addresses yet',
    line: 'Save the places you live or have lived. When you move, list everyone who needs your new address and tick them off as you go.',
    tips: [
      'Copy any line in one click',
      'A checklist of who needs your new address',
      'Mark old addresses without losing them',
    ],
    action: addAction('Add address'),
  },
  play: async ({ canvasElement }) => {
    await expectEmptyPage(canvasElement, {
      title: 'Addresses',
      heading: 'No addresses yet',
      action: 'Add address',
    });
  },
};

export const MobileNumbers: Story = {
  args: {
    illustration: 'mobile',
    title: 'Mobile numbers',
    heading: 'No mobile numbers yet',
    line: 'Keep your numbers in one place, copy them in a click, and track which organisations have each one on file.',
    tips: [
      'Copy or call in one click',
      'Track who has each number on file',
      'Country codes formatted for you',
    ],
    action: addAction('Add mobile number'),
  },
  play: async ({ canvasElement }) => {
    await expectEmptyPage(canvasElement, {
      title: 'Mobile numbers',
      heading: 'No mobile numbers yet',
      action: 'Add mobile number',
    });
  },
};

export const Subscriptions: Story = {
  args: {
    illustration: 'subscriptions',
    title: 'Subscriptions',
    heading: 'No subscriptions yet',
    line: 'Add the ones you pay for and see what they cost each month, and what renews next.',
    tips: [
      'One monthly total across weekly, monthly and yearly plans',
      'A heads-up when something renews within a week',
      'Cancelled plans drop out of your totals',
    ],
    action: addAction('Add subscription'),
  },
  play: async ({ canvasElement }) => {
    await expectEmptyPage(canvasElement, {
      title: 'Subscriptions',
      heading: 'No subscriptions yet',
      action: 'Add subscription',
    });
  },
};

/** The tips list is omitted entirely, so the card shows the copy and the action only. */
export const WithoutTips: Story = {
  args: {
    illustration: 'addresses',
    title: 'Addresses',
    heading: 'No addresses yet',
    line: 'Save the places you live or have lived. When you move, list everyone who needs your new address and tick them off as you go.',
    action: addAction('Add address'),
  },
};

/** No trust note beside the action. The default note is hidden with `note={null}`. */
export const WithoutTrustNote: Story = {
  args: {
    illustration: 'addresses',
    title: 'Addresses',
    heading: 'No addresses yet',
    line: 'Save the places you live or have lived. When you move, list everyone who needs your new address and tick them off as you go.',
    tips: [
      'Copy any line in one click',
      'A checklist of who needs your new address',
      'Mark old addresses without losing them',
    ],
    action: addAction('Add address'),
    note: null,
  },
};

/**
 * Synthetic stress test, not design copy. Every text slot is long enough to
 * wrap: the h1, the h2, the body line, each tip, and the action label.
 */
export const LongContent: Story = {
  args: {
    illustration: 'addresses',
    title:
      'Addresses for every home you have lived in, and every place a household member is registered',
    heading:
      'No addresses have been saved for this household yet, so start with the place you live now',
    line: 'Save the places you live or have lived. When you move, list everyone who needs your new address and tick them off as you go. Each address keeps its own checklist, so a move to a new flat does not lose the record of the old one.',
    tips: [
      'Copy any line in one click, including the postcode, the country and the building name',
      'A checklist of every organisation, employer and government service that needs your new address',
      'Mark old addresses as past without losing the dates, the notes or the checklist you kept',
    ],
    action: addAction('Add address for a household member'),
  },
};
