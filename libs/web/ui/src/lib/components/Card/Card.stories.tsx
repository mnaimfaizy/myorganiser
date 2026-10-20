import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../Button/Button';
import { Illustration } from '../Illustration/Illustration';
import { StatusPill } from '../StatusPill/StatusPill';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './Card';

function CardWithHeaderAndContentExample() {
  return (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Weekly review</CardTitle>
        <CardDescription>
          Summary of tasks completed and reminders due this week.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-body">
          You finished 12 tasks, cleared 3 overdue reminders, and shared 2
          folders with collaborators.
        </p>
      </CardContent>
    </Card>
  );
}

function CardWithFooterExample() {
  return (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Export workspace</CardTitle>
        <CardDescription>
          Download a copy of your tasks and shared folders.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-body">
          The export includes task titles, due dates, and collaborator lists.
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Start export</Button>
      </CardFooter>
    </Card>
  );
}

function CardWithoutFooterExample() {
  return (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>
          Choose how you receive reminders and collaborator updates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-body">
          Email digests are sent every Monday at 8:00 AM. Push notifications
          follow your device settings.
        </p>
      </CardContent>
    </Card>
  );
}

function CardLongContentExample() {
  return (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>
          Terms for exporting archived workspace projects and shared folders
        </CardTitle>
        <CardDescription>
          Review the full export scope before downloading a copy of your
          organizer workspace, including archived projects, shared folders,
          collaborator permissions, and linked notification settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-body">
          Exports may take several minutes for large workspaces. You will
          receive an email when the archive is ready. The download link expires
          after seven days. Contact support if you need an extended retention
          window or a partial export of specific folders only.
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="outline">Learn more</Button>
      </CardFooter>
    </Card>
  );
}

/**
 * Dashboard card (Data artboard, "Tasks"). The illustration and the warning
 * pill share the top row; the header stacks title and description with a
 * wider gap than the default. Content stays flush under the header (`pt-0`),
 * so the link sits 20px below the description, the same as the card padding.
 */
function DashboardTasksExample() {
  return (
    <Card className="w-96">
      <CardHeader className="gap-3.5">
        <div className="flex items-start justify-between gap-2">
          <Illustration kind="tasks" size={64} />
          <StatusPill tone="warning">4 due today</StatusPill>
        </div>
        <CardTitle>Tasks</CardTitle>
        <CardDescription>12 open across 3 contexts</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="link" asChild>
          <a href="#tasks" aria-label="Open tasks">
            Open
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Stat card (Data artboard). No header: the value is the content, so the
 * card is a single `CardContent` with its top padding restored (`pt-5`).
 */
function StatCardExample() {
  return (
    <Card className="w-96">
      <CardContent className="flex flex-col items-start gap-2.5 pt-5">
        <p className="text-label-caps uppercase text-muted-foreground">
          STAT CARD
        </p>
        <p className="font-display text-value tabular-nums text-foreground">
          $54.97
        </p>
        <p className="text-body-sm text-foreground-supporting">
          a month across 6 active subscriptions
        </p>
        <StatusPill tone="neutral">Next: Streaming plan · Tue</StatusPill>
      </CardContent>
    </Card>
  );
}

/**
 * Section card with a divided header (Data artboard, "Danger zone"). The
 * header row carries the hairline; the content pads itself with `pt-5`.
 * The button is described, not renamed, by the paragraph beside it.
 */
function SectionCardDividedExample() {
  return (
    <Card className="w-full max-w-xl">
      <CardHeader divided>
        <CardTitle>Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-body font-semibold">
            Remove this vault from this device
          </p>
          <p
            id="danger-zone-remove-description"
            className="text-body-sm text-foreground-supporting"
          >
            Everything has reached the server. You can unlock it again later.
          </p>
        </div>
        <Button
          variant="outline"
          aria-describedby="danger-zone-remove-description"
        >
          Remove…
        </Button>
      </CardContent>
    </Card>
  );
}

const meta: Meta<typeof CardWithHeaderAndContentExample> = {
  component: CardWithHeaderAndContentExample,
  title: 'Components/Card',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof CardWithHeaderAndContentExample>;

/**
 * The legacy stacked header with a description. Existing consumers that pass
 * no `divided` prop should look exactly as they did before the Web v2.0 restyle.
 */
export const WithHeaderAndContent: Story = {};

export const WithFooter: Story = {
  render: function Render() {
    return <CardWithFooterExample />;
  },
};

export const WithoutFooter: Story = {
  render: function Render() {
    return <CardWithoutFooterExample />;
  },
};

export const LongContent: Story = {
  render: function Render() {
    return <CardLongContentExample />;
  },
};

export const DashboardTasks: Story = {
  render: function Render() {
    return <DashboardTasksExample />;
  },
};

export const StatCard: Story = {
  render: function Render() {
    return <StatCardExample />;
  },
};

export const SectionCardDivided: Story = {
  render: function Render() {
    return <SectionCardDividedExample />;
  },
};
