import type { Meta, StoryObj } from '@storybook/react';
import { expect, waitFor, within } from '@storybook/test';

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLabelProvider,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  useBreadcrumbLabel,
  useSetBreadcrumbLabel,
} from './Breadcrumb';

function BreadcrumbExample() {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/projects">Projects</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Launch checklist</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function BreadcrumbWithEllipsisExample() {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/projects/launch">
            Launch checklist
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Stakeholder review</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function BreadcrumbLongContentExample() {
  return (
    <Breadcrumb className="max-w-md">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/workspaces">
            Client onboarding workspace
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/workspaces/q3-rollout">
            Q3 product rollout and stakeholder communications plan
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>
            Final approval checklist for executive summary deck
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function BreadcrumbManyItemsExample() {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/workspaces">
            Workspaces
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/workspaces/marketing">
            Marketing
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/workspaces/marketing/campaigns">
            Campaigns
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/workspaces/marketing/campaigns/summer">
            Summer launch
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Asset review</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * The last segment reads the page-supplied label, and falls back to "Details"
 * when none is set, as DynamicBreadcrumb does in the dashboard shell.
 */
function LabelledBreadcrumbExample() {
  const label = useBreadcrumbLabel();
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/tasks">Tasks</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{label ?? 'Details'}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** Supplies the record name the way a detail page does, from inside the provider. */
function SupplyRecordLabel() {
  useSetBreadcrumbLabel('Renew passport');
  return null;
}

function LabelOverrideExample() {
  return (
    <BreadcrumbLabelProvider>
      <SupplyRecordLabel />
      <LabelledBreadcrumbExample />
    </BreadcrumbLabelProvider>
  );
}

function LabelFallbackExample() {
  return (
    <BreadcrumbLabelProvider>
      <LabelledBreadcrumbExample />
    </BreadcrumbLabelProvider>
  );
}

const meta: Meta<typeof BreadcrumbExample> = {
  component: BreadcrumbExample,
  title: 'Components/Breadcrumb',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof BreadcrumbExample>;

export const Default: Story = {};

export const WithEllipsis: Story = {
  render: function Render() {
    return <BreadcrumbWithEllipsisExample />;
  },
};

export const LongContent: Story = {
  render: function Render() {
    return <BreadcrumbLongContentExample />;
  },
};

export const ManyItems: Story = {
  render: function Render() {
    return <BreadcrumbManyItemsExample />;
  },
};

/**
 * A component inside BreadcrumbLabelProvider sets the label on mount. The
 * last segment shows it, not the static fallback.
 */
export const RecordLabelOverride: Story = {
  render: function Render() {
    return <LabelOverrideExample />;
  },
  play: async ({ canvasElement }) => {
    const crumbs = within(canvasElement).getByRole('navigation', {
      name: 'breadcrumb',
    });
    await waitFor(() => {
      expect(within(crumbs).getByText('Renew passport')).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
    expect(within(crumbs).queryByText('Details')).toBeNull();
  },
};

/**
 * The provider is mounted and nothing sets a label, so the hook reads null and
 * the last segment shows "Details".
 */
export const RecordLabelFallback: Story = {
  render: function Render() {
    return <LabelFallbackExample />;
  },
  play: async ({ canvasElement }) => {
    const crumbs = within(canvasElement).getByRole('navigation', {
      name: 'breadcrumb',
    });
    await waitFor(() => {
      expect(within(crumbs).getByText('Details')).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  },
};
