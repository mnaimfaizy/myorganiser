import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
} from './Sidebar';

const PHONE_WIDTH = 390;

describe('Sidebar (mobile drawer)', () => {
  const originalMatchMedia = Object.getOwnPropertyDescriptor(
    window,
    'matchMedia',
  );
  const originalInnerWidth = Object.getOwnPropertyDescriptor(
    window,
    'innerWidth',
  );

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }),
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: PHONE_WIDTH,
    });
  });

  afterEach(() => {
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    } else {
      delete (window as Partial<Window>).matchMedia;
    }
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    jest.restoreAllMocks();
  });

  function renderMobileSidebar() {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Dashboard links</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
  }

  it('should expose the opened drawer as a dialog named "Navigation" with the navigation description', () => {
    renderMobileSidebar();

    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(
      'Main navigation for the dashboard',
    );
  });

  it('should log no console errors or warnings when the drawer opens', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    renderMobileSidebar();
    screen.getByRole('dialog', { name: 'Navigation' });

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
