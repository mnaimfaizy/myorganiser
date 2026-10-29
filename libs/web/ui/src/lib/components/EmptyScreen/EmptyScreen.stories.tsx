import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import { ChevronLeft } from 'lucide-react';
import { Button } from '../Button/Button';
import { ILLUSTRATION_KINDS } from '../Illustration/Illustration';
import { EmptyScreen } from './EmptyScreen';

/**
 * The "‹ More" back link in the phone top bar, from the EmptyPhone artboard.
 * The chevron is decorative, so the link's accessible name is "More".
 */
const moreNavigation = (
  <a
    href="/dashboard"
    className="inline-flex h-11 items-center gap-0.5 pl-1 pr-2 text-body text-brand-text"
  >
    <ChevronLeft aria-hidden="true" className="size-5.5" />
    More
  </a>
);

const meta: Meta<typeof EmptyScreen> = {
  component: EmptyScreen,
  title: 'Components/EmptyScreen',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Phone empty state (below md): the page title sits under the navigation slot, and the illustration, h2, body copy and a full-width call to action are centred beneath it. The desktop equivalent is `EmptyPage`.',
      },
    },
    // Every EmptyScreen is a phone screen, so the phone width applies to the
    // whole file. The test-runner reads `viewport`.
    viewport: { defaultViewport: 'mobile1' },
  },
  argTypes: {
    illustration: {
      control: 'select',
      options: [...ILLUSTRATION_KINDS],
      description: 'Section illustration, shown at 112 pixels',
    },
    note: {
      control: 'text',
      description: 'Trust note under the action. Pass `null` to hide it.',
    },
    navigation: {
      control: false,
      description: 'Top bar slot, for example the "‹ More" back link',
    },
    action: { control: false },
    className: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyScreen>;

/**
 * Asserts the screen h1, the centred h2, and that the action fills the width
 * of its wrapper, which is what "full width on phone" means.
 */
async function expectPhoneScreen(
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

  const button = canvas.getByRole('button', { name: expected.action });
  // The action sits directly in its full-width wrapper, so the wrapper is the
  // button's parent.
  const wrapper = button.parentElement;
  if (!wrapper) {
    throw new Error('The action button has no wrapper element');
  }
  expect(button.getBoundingClientRect().width).toBeCloseTo(
    wrapper.getBoundingClientRect().width,
    0,
  );
}

export const Addresses: Story = {
  args: {
    illustration: 'addresses',
    title: 'Addresses',
    heading: 'No addresses yet',
    line: 'Save the places you live or have lived, and track who needs your new address when you move.',
    action: (
      <Button variant="brand" size="lg">
        Add address
      </Button>
    ),
    navigation: moreNavigation,
  },
  play: async ({ canvasElement }) => {
    await expectPhoneScreen(canvasElement, {
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
    line: 'Keep your numbers in one place and copy or call them in a tap.',
    action: (
      <Button variant="brand" size="lg">
        Add mobile number
      </Button>
    ),
    navigation: moreNavigation,
  },
  play: async ({ canvasElement }) => {
    await expectPhoneScreen(canvasElement, {
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
    line: 'Add the ones you pay for and see what they cost each month.',
    action: (
      <Button variant="brand" size="lg">
        Add subscription
      </Button>
    ),
    navigation: moreNavigation,
  },
  play: async ({ canvasElement }) => {
    await expectPhoneScreen(canvasElement, {
      title: 'Subscriptions',
      heading: 'No subscriptions yet',
      action: 'Add subscription',
    });
  },
};

/** The top bar slot is omitted, so the title sits at the top of the screen. */
export const WithoutNavigation: Story = {
  args: {
    illustration: 'addresses',
    title: 'Addresses',
    heading: 'No addresses yet',
    line: 'Save the places you live or have lived, and track who needs your new address when you move.',
    action: (
      <Button variant="brand" size="lg">
        Add address
      </Button>
    ),
  },
};
