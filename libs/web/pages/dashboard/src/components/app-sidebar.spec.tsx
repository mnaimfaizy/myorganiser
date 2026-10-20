/* eslint-disable import/first */
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

jest.mock('../hooks/useYouTubeNavVisible', () => ({
  useYouTubeNavVisible: jest.fn(),
}));

jest.mock('../hooks/use-feedback-dialog', () => ({
  openFeedbackDialog: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  useOptionalVaultSession: jest.fn(),
}));

jest.mock('./SidebarVaultCard', () => ({
  SidebarVaultCard: () => <div data-testid="sidebar-vault-card" />,
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useSidebar: jest.fn(),
  // The real root and rail read the module-local useSidebar, which a barrel
  // mock cannot reach, so both are stubbed. Header, content and footer are
  // plain containers and render for real.
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  ),
  SidebarRail: () => <div data-testid="sidebar-rail" />,
}));

// Spy on the real NavMain: the rendered tree is real, and its props are read
// back for the counts contract (no nav item supplies a count yet).
jest.mock('./nav-main', () => {
  const actual = jest.requireActual('./nav-main');
  return { ...actual, NavMain: jest.fn(actual.NavMain) };
});

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { TooltipProvider, useSidebar } from '@myorganiser/web-ui';
import { useOptionalVaultSession } from '@myorganiser/web-vault-ui';
import { useYouTubeNavVisible } from '../hooks/useYouTubeNavVisible';
import { openFeedbackDialog } from '../hooks/use-feedback-dialog';
import { AppSidebar } from './app-sidebar';
import { NavMain } from './nav-main';

type SidebarState = 'expanded' | 'collapsed';

function stubSidebar({
  isMobile = false,
  state = 'expanded',
}: {
  isMobile?: boolean;
  state?: SidebarState;
} = {}) {
  const sidebar = {
    state,
    open: state === 'expanded',
    isMobile,
    openMobile: false,
    setOpen: jest.fn(),
    setOpenMobile: jest.fn(),
    toggleSidebar: jest.fn(),
  };
  (useSidebar as jest.Mock).mockReturnValue(sidebar);
  return sidebar;
}

function stubVaultSession(masterKeyBytes: Uint8Array | null | 'no-session') {
  (useOptionalVaultSession as jest.Mock).mockReturnValue(
    masterKeyBytes === 'no-session' ? null : { masterKeyBytes },
  );
}

function lastNavMainProps(): { countsVisible: boolean } {
  const calls = (NavMain as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
}

function renderSidebar() {
  return render(
    <TooltipProvider>
      <AppSidebar />
    </TooltipProvider>,
  );
}

describe('AppSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (usePathname as jest.Mock).mockReturnValue('/dashboard');
    (useYouTubeNavVisible as jest.Mock).mockReturnValue(true);
    stubVaultSession('no-session');
    stubSidebar();
  });

  describe('sections', () => {
    it('renders the sections in artboard order with their hrefs', () => {
      renderSidebar();

      const nav = screen.getByRole('navigation', { name: 'Sections' });
      const rendered = Array.from(nav.children).map((group) => ({
        label: group.querySelector('span')?.textContent,
        links: Array.from(group.querySelectorAll('a')).map((a) => [
          a.textContent,
          a.getAttribute('href'),
        ]),
      }));

      expect(rendered).toEqual([
        { label: 'OVERVIEW', links: [['Home', '/dashboard']] },
        {
          label: 'ORGANISE',
          links: [
            ['Tasks', '/dashboard/tasks'],
            ['Groceries', '/dashboard/groceries'],
            ['Subscriptions', '/dashboard/subscriptions'],
          ],
        },
        {
          label: 'PEOPLE AND PLACES',
          links: [
            ['Addresses', '/dashboard/addresses'],
            ['Mobile numbers', '/dashboard/mobile-numbers'],
          ],
        },
        { label: 'MEDIA', links: [['YouTube', '/dashboard/youtube']] },
        { label: 'SECURITY', links: [['Vault', '/dashboard/vault']] },
      ]);
    });

    it('drops the MEDIA group with its only item when YouTube is hidden', () => {
      (useYouTubeNavVisible as jest.Mock).mockReturnValue(false);

      renderSidebar();

      expect(
        screen.queryByRole('link', { name: 'YouTube' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('MEDIA')).not.toBeInTheDocument();
      expect(screen.getByText('SECURITY')).toBeInTheDocument();
    });
  });

  describe('feedback button', () => {
    it('opens the feedback dialog from the Send feedback button', () => {
      renderSidebar();
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

      expect(openFeedbackDialog).toHaveBeenCalledTimes(1);
    });

    it('closes the phone drawer when Send feedback is chosen', () => {
      const sidebar = stubSidebar({ isMobile: true });

      renderSidebar();
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

      expect(openFeedbackDialog).toHaveBeenCalledTimes(1);
      expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
    });

    it('leaves drawer state alone on desktop when Send feedback is chosen', () => {
      const sidebar = stubSidebar({ isMobile: false });

      renderSidebar();
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

      expect(openFeedbackDialog).toHaveBeenCalledTimes(1);
      expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
    });
  });

  describe('drawer closes after navigation on phone width', () => {
    it('closes the phone drawer when a nav link is chosen', () => {
      const sidebar = stubSidebar({ isMobile: true });

      renderSidebar();
      fireEvent.click(screen.getByRole('link', { name: 'Tasks' }));

      expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
      expect(sidebar.setOpen).not.toHaveBeenCalled();
    });

    it('closes the phone drawer for a link to the page already open', () => {
      // The pathname is /dashboard, so Home is the current page; closing must
      // not depend on a route change.
      const sidebar = stubSidebar({ isMobile: true });

      renderSidebar();
      fireEvent.click(screen.getByRole('link', { name: 'Home' }));

      expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
    });

    it('leaves the phone drawer open when a click is not on a link', () => {
      const sidebar = stubSidebar({ isMobile: true });

      renderSidebar();
      fireEvent.click(screen.getByText('ORGANISE'));

      expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
    });

    it('never touches drawer state on desktop when a nav link is chosen', () => {
      const sidebar = stubSidebar({ isMobile: false });

      renderSidebar();
      fireEvent.click(screen.getByRole('link', { name: 'Tasks' }));

      expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
      expect(sidebar.setOpen).not.toHaveBeenCalled();
    });
  });

  describe('collapsed layout', () => {
    it('hides the vault card, group labels and keeps Send feedback reachable by name on the desktop rail', () => {
      stubSidebar({ isMobile: false, state: 'collapsed' });
      stubVaultSession(new Uint8Array(32));

      renderSidebar();

      expect(
        screen.queryByTestId('sidebar-vault-card'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('ORGANISE')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Send feedback' }),
      ).toBeInTheDocument();
    });

    it('keeps the expanded layout at phone width even when the desktop state is collapsed', () => {
      stubSidebar({ isMobile: true, state: 'collapsed' });
      stubVaultSession(new Uint8Array(32));

      renderSidebar();

      expect(screen.getByText('ORGANISE')).toBeInTheDocument();
      expect(screen.getByTestId('sidebar-vault-card')).toBeInTheDocument();
    });
  });

  describe('vault counts', () => {
    it('hides counts while the Vault is locked', () => {
      stubVaultSession(null);

      renderSidebar();

      expect(lastNavMainProps().countsVisible).toBe(false);
    });

    it('shows counts while the Vault is unlocked', () => {
      stubVaultSession(new Uint8Array(32));

      renderSidebar();

      expect(lastNavMainProps().countsVisible).toBe(true);
    });

    it('shows counts when there is no Vault Session', () => {
      stubVaultSession('no-session');

      renderSidebar();

      expect(lastNavMainProps().countsVisible).toBe(true);
    });
  });

  describe('search', () => {
    it('renders no search box in the sidebar', () => {
      renderSidebar();

      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });
});
