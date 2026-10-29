import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { ClipboardList, Settings, ShoppingCart } from 'lucide-react';
import * as React from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from './Sidebar';

type NavItem = {
  title: string;
  icon: React.ComponentType<{
    className?: string;
    'aria-hidden'?: boolean | 'true';
  }>;
  isActive?: boolean;
  disabled?: boolean;
};

const DEFAULT_NAV_ITEMS: NavItem[] = [
  { title: 'Tasks', icon: ClipboardList, isActive: true },
  { title: 'Groceries', icon: ShoppingCart },
];

type SidebarDashboardProps = {
  defaultOpen?: boolean;
  items?: NavItem[];
  showFooter?: boolean;
  children?: React.ReactNode;
};

function SidebarNavMenu({ items }: { items: NavItem[] }) {
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={item.isActive}
            disabled={item.disabled}
          >
            <item.icon aria-hidden="true" />
            <span>{item.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function SidebarDashboardExample({
  defaultOpen = true,
  items = DEFAULT_NAV_ITEMS,
  showFooter = true,
  children,
}: SidebarDashboardProps) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <MobileReadyMarker />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-3">
            <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
              MyOrganiser
            </span>
            <span className="sr-only font-semibold group-data-[collapsible=icon]:not-sr-only">
              MO
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarNavMenu items={items} />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {showFooter ? (
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Settings">
                  <Settings aria-hidden="true" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        ) : null}
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1 className="text-lg font-medium">Dashboard</h1>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">
            Main content area beside the sidebar.
          </p>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Signals when `useIsMobile` has resolved true (post-mount). */
function MobileReadyMarker() {
  const { isMobile } = useSidebar();

  if (!isMobile) {
    return null;
  }

  return <span data-testid="sidebar-mobile-ready" hidden aria-hidden="true" />;
}

/** Opens the mobile sheet after `useIsMobile` resolves true (post-mount). */
function OpenMobileSidebarHelper() {
  const { isMobile, setOpenMobile } = useSidebar();

  React.useEffect(() => {
    if (isMobile) {
      setOpenMobile(true);
    }
  }, [isMobile, setOpenMobile]);

  return null;
}

function SidebarMobileExample() {
  return (
    <SidebarProvider defaultOpen={true}>
      <MobileReadyMarker />
      <OpenMobileSidebarHelper />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-3">
            <span className="truncate font-semibold">MyOrganiser</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarNavMenu items={DEFAULT_NAV_ITEMS} />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings">
                <Settings aria-hidden="true" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1 className="text-lg font-medium">Dashboard</h1>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">
            Mobile layout — sidebar renders as a portalled sheet.
          </p>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function SidebarMenuButtonVariantsExample() {
  const variants = ['default', 'outline'] as const;
  const sizes = ['default', 'sm', 'lg'] as const;

  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar collapsible="none" className="w-64">
        <SidebarHeader>
          <SidebarGroupLabel>Menu button variants</SidebarGroupLabel>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {variants.flatMap((variant) =>
                  sizes.map((size) => (
                    <SidebarMenuItem key={`${variant}-${size}`}>
                      <SidebarMenuButton variant={variant} size={size}>
                        <ClipboardList aria-hidden="true" />
                        <span>
                          {variant} / {size}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

const LONG_NAV_ITEMS: NavItem[] = Array.from({ length: 18 }, (_, index) => ({
  title: `Very long navigation label for overflow testing — section ${index + 1}`,
  icon: index % 2 === 0 ? ClipboardList : ShoppingCart,
}));

function SidebarLongNavExample() {
  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-3">
            <span className="truncate font-semibold">MyOrganiser</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarNavMenu items={LONG_NAV_ITEMS} />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1 className="text-lg font-medium">Long navigation</h1>
        </header>
        <main className="p-4 text-sm text-muted-foreground">
          Scroll the sidebar menu to verify overflow behaviour.
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

const DISABLED_NAV_ITEMS: NavItem[] = [
  { title: 'Tasks', icon: ClipboardList, isActive: true },
  { title: 'Groceries', icon: ShoppingCart, disabled: true },
];

const meta: Meta<typeof SidebarDashboardExample> = {
  component: SidebarDashboardExample,
  title: 'Components/Sidebar',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof SidebarDashboardExample>;

export const Expanded: Story = {
  render: function Render() {
    return <SidebarDashboardExample defaultOpen={true} />;
  },
};

export const Collapsed: Story = {
  render: function Render() {
    return <SidebarDashboardExample defaultOpen={false} />;
  },
};

export const OpenMobile: Story = {
  render: function Render() {
    return <SidebarMobileExample />;
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

export const OpensOnClick: Story = {
  render: function Render() {
    return <SidebarDashboardExample defaultOpen={true} />;
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByTestId('sidebar-mobile-ready')).toBeInTheDocument();
    });
    await userEvent.click(
      canvas.getByRole('button', { name: 'Toggle Sidebar' }),
    );
    await waitFor(() => {
      expect(within(document.body).getByRole('dialog')).toBeVisible();
    });
  },
};

export const MenuButtonVariants: Story = {
  render: function Render() {
    return <SidebarMenuButtonVariantsExample />;
  },
};

export const LongNavOverflow: Story = {
  render: function Render() {
    return <SidebarLongNavExample />;
  },
};

export const DisabledMenuItem: Story = {
  render: function Render() {
    return <SidebarDashboardExample items={DISABLED_NAV_ITEMS} />;
  },
};
