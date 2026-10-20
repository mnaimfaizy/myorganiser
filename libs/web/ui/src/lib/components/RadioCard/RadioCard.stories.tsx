import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';

import { RadioCard } from './RadioCard';

// RadioCard needs a fieldset and legend from its caller, and a title on every
// card. Meta is typed against the feedback-kind wrapper, not the primitive, so
// each story shows the group the card is used in (STORYBOOK-PATTERNS §4).

const KIND_NAME = 'feedback-kind';
const LEGEND = 'What kind of feedback is this?';
const BUG_TITLE = 'Bug report';
const BUG_DESCRIPTION = "Something isn't working as it should.";
const SUGGESTION_TITLE = 'Suggestion';
const SUGGESTION_DESCRIPTION = 'An improvement or a new feature.';
const LONG_BUG_DESCRIPTION =
  "Something isn't working as it should, for example a list that won't save after you reorder it, a reminder that arrives twice, or a button that does nothing when you tap it on your phone. Include the steps you took if you can.";

const LEGEND_CLASS = 'pb-2 text-body-sm font-semibold text-foreground';
const CARDS_CLASS = 'grid gap-3 md:grid-cols-2';

// Returns the card (the label) around a radio input. The phone play function
// compares card boxes, so it needs the element that is laid out, not the input.
function cardOf(input: HTMLElement): HTMLElement {
  const card = input.closest('label');
  if (!card) {
    throw new Error('RadioCard input is not inside its label card');
  }
  return card;
}

// Default arrangement: one card selected. Bug report is the selected choice.
function FeedbackKindExample() {
  return (
    <fieldset className="grid gap-3">
      <legend className={LEGEND_CLASS}>{LEGEND}</legend>
      <div className={CARDS_CLASS}>
        <RadioCard
          name={KIND_NAME}
          value="bug"
          title={BUG_TITLE}
          description={BUG_DESCRIPTION}
          defaultChecked
        />
        <RadioCard
          name={KIND_NAME}
          value="suggestion"
          title={SUGGESTION_TITLE}
          description={SUGGESTION_DESCRIPTION}
        />
      </div>
    </fieldset>
  );
}

function FeedbackKindNoneSelected() {
  return (
    <fieldset className="grid gap-3">
      <legend className={LEGEND_CLASS}>{LEGEND}</legend>
      <div className={CARDS_CLASS}>
        <RadioCard
          name={KIND_NAME}
          value="bug"
          title={BUG_TITLE}
          description={BUG_DESCRIPTION}
        />
        <RadioCard
          name={KIND_NAME}
          value="suggestion"
          title={SUGGESTION_TITLE}
          description={SUGGESTION_DESCRIPTION}
        />
      </div>
    </fieldset>
  );
}

// The Suggestion card is disabled to show the disabled styling. The design of
// record does not show a disabled card in this group; this arrangement is the
// component state the coverage table asks for.
function FeedbackKindDisabled() {
  return (
    <fieldset className="grid gap-3">
      <legend className={LEGEND_CLASS}>{LEGEND}</legend>
      <div className={CARDS_CLASS}>
        <RadioCard
          name={KIND_NAME}
          value="bug"
          title={BUG_TITLE}
          description={BUG_DESCRIPTION}
          defaultChecked
        />
        <RadioCard
          name={KIND_NAME}
          value="suggestion"
          title={SUGGESTION_TITLE}
          description={SUGGESTION_DESCRIPTION}
          disabled
        />
      </div>
    </fieldset>
  );
}

// Title-only cards: the description is omitted, so the input has no
// aria-describedby and the card is one line tall.
function FeedbackKindTitleOnly() {
  return (
    <fieldset className="grid gap-3">
      <legend className={LEGEND_CLASS}>{LEGEND}</legend>
      <div className={CARDS_CLASS}>
        <RadioCard name={KIND_NAME} value="bug" title={BUG_TITLE} />
        <RadioCard
          name={KIND_NAME}
          value="suggestion"
          title={SUGGESTION_TITLE}
        />
      </div>
    </fieldset>
  );
}

// Long description: the card grows and the text wraps inside the card, which
// is the layout the grid has to hold without the two columns misaligning.
function FeedbackKindLongDescription() {
  return (
    <fieldset className="grid gap-3">
      <legend className={LEGEND_CLASS}>{LEGEND}</legend>
      <div className={CARDS_CLASS}>
        <RadioCard
          name={KIND_NAME}
          value="bug"
          title={BUG_TITLE}
          description={LONG_BUG_DESCRIPTION}
          defaultChecked
        />
        <RadioCard
          name={KIND_NAME}
          value="suggestion"
          title={SUGGESTION_TITLE}
          description={SUGGESTION_DESCRIPTION}
        />
      </div>
    </fieldset>
  );
}

const meta: Meta<typeof FeedbackKindExample> = {
  component: FeedbackKindExample,
  title: 'Components/RadioCard',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FeedbackKindExample>;

export const OneSelected: Story = {};

export const NoneSelected: Story = {
  render: () => <FeedbackKindNoneSelected />,
};

export const DisabledCard: Story = {
  render: () => <FeedbackKindDisabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const suggestion = canvas.getByRole('radio', { name: SUGGESTION_TITLE });
    expect(suggestion).toBeDisabled();
    await userEvent.click(suggestion);
    expect(suggestion).not.toBeChecked();
  },
};

export const TitleOnly: Story = {
  render: () => <FeedbackKindTitleOnly />,
};

export const LongDescription: Story = {
  render: () => <FeedbackKindLongDescription />,
};

// Phone: the cards stack in one column below md. The viewport parameter is
// read by the test-runner preVisit hook; chromatic.viewports makes Chromatic
// render the same 320px width. The play function asserts the stacking itself.
export const Phone: Story = {
  render: () => <FeedbackKindExample />,
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    chromatic: { viewports: [320] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bugCard = cardOf(canvas.getByRole('radio', { name: BUG_TITLE }));
    const suggestionCard = cardOf(
      canvas.getByRole('radio', { name: SUGGESTION_TITLE }),
    );
    expect(suggestionCard.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      bugCard.getBoundingClientRect().bottom,
    );
  },
};

// Keyboard: focus the first radio, press ArrowDown, and the native group moves
// the selection to the second card. No pointer input is involved.
export const KeyboardSelect: Story = {
  render: () => <FeedbackKindNoneSelected />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bug = canvas.getByRole('radio', { name: BUG_TITLE });
    const suggestion = canvas.getByRole('radio', { name: SUGGESTION_TITLE });
    bug.focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(suggestion).toBeChecked();
    });
    expect(bug).not.toBeChecked();
  },
};
