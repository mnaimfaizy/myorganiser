// The install and dismissal hooks are real. They keep module-level state (the
// held beforeinstallprompt event and the cached dismissal), so every test loads
// a fresh module graph and drives the hooks through the browser's own signals:
// the user agent, localStorage, and the install prompt event.
//
// React and Testing Library are loaded from that same fresh graph, so the hooks
// and the renderer share one React. Testing Library's auto-cleanup would
// register an afterEach from inside a running test when it is re-evaluated, so
// cleanup runs explicitly in afterEach instead.
import '@testing-library/jest-dom';

process.env.RTL_SKIP_AUTO_CLEANUP = 'true';

type Rtl = typeof import('@testing-library/react');

const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_SAFARI_17_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const DISMISSED_KEY = 'myorganiser.install-card.dismissed.v1';
const IOS_SENTENCE =
  "You'll sign in and unlock your vault again inside the installed MyOrganiser.";

let loadedRtl: Rtl | null = null;

function setUserAgent(userAgent: string): void {
  jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

async function loadStrip() {
  jest.resetModules();
  const rtl = await import('@testing-library/react');
  loadedRtl = rtl;
  const { InstallStrip } = await import('./InstallStrip');
  return { rtl, InstallStrip };
}

async function mountStrip(): Promise<Rtl> {
  const { rtl, InstallStrip } = await loadStrip();
  rtl.render(<InstallStrip />);
  return rtl;
}

/** Fires the browser's install prompt; the hook captures it and the strip offers Install. */
function dispatchInstallPrompt(
  rtl: Rtl,
  outcome: 'accepted' | 'dismissed',
): jest.Mock<Promise<void>, []> {
  const prompt = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const event = Object.assign(
    new Event('beforeinstallprompt', { cancelable: true }),
    {
      prompt,
      userChoice: Promise.resolve({ outcome, platform: 'web' }),
    },
  );
  rtl.act(() => {
    window.dispatchEvent(event);
  });
  return prompt;
}

describe('InstallStrip', () => {
  afterEach(() => {
    loadedRtl?.cleanup();
    loadedRtl = null;
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('is hidden when the browser offers no install path', async () => {
    // jsdom's default user agent is neither iOS Safari nor Mac Safari, and no prompt fires.
    const rtl = await mountStrip();

    expect(rtl.screen.queryByTestId('install-app-card')).toBeNull();
  });

  it('is hidden when the install card was dismissed on this device before', async () => {
    setUserAgent(IPHONE_SAFARI_UA);
    localStorage.setItem(DISMISSED_KEY, 'true');

    const rtl = await mountStrip();

    expect(rtl.screen.queryByTestId('install-app-card')).toBeNull();
  });

  it('calls the browser install prompt when Install is pressed in prompt mode', async () => {
    const rtl = await mountStrip();
    const prompt = dispatchInstallPrompt(rtl, 'accepted');

    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Install' }));

    await rtl.waitFor(() => {
      expect(prompt).toHaveBeenCalledTimes(1);
    });
    expect(rtl.screen.queryByRole('dialog')).toBeNull();
  });

  it('is hidden once the User declines the browser prompt this session', async () => {
    const rtl = await mountStrip();
    dispatchInstallPrompt(rtl, 'dismissed');
    expect(rtl.screen.getByTestId('install-app-card')).toBeInTheDocument();

    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Install' }));

    await rtl.waitFor(() => {
      expect(rtl.screen.queryByTestId('install-app-card')).toBeNull();
    });
  });

  it('shows the install card on iOS Safari and opens the Share steps in a dialog on Install', async () => {
    setUserAgent(IPHONE_SAFARI_UA);
    const rtl = await mountStrip();

    expect(rtl.screen.getByTestId('install-app-card')).toBeInTheDocument();
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Install' }));

    const dialog = await rtl.screen.findByRole('dialog', {
      name: 'Install MyOrganiser',
    });
    const steps = rtl.within(dialog).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[1]).toHaveTextContent(
      "Choose Add to Home Screen. If it isn't listed, tap More first.",
    );
    expect(rtl.within(dialog).getByText(IOS_SENTENCE)).toBeInTheDocument();
  });

  it('opens the File menu steps in a dialog on Mac Safari', async () => {
    setUserAgent(MAC_SAFARI_17_UA);
    const rtl = await mountStrip();

    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Install' }));

    const dialog = await rtl.screen.findByRole('dialog', {
      name: 'Install MyOrganiser',
    });
    expect(
      rtl.within(dialog).getByText("Open the File menu in Safari's menu bar."),
    ).toBeInTheDocument();
    expect(
      rtl.within(dialog).getByText('Choose Add to Dock.'),
    ).toBeInTheDocument();
  });

  it('is hidden and remembered when Dismiss install suggestion is pressed', async () => {
    setUserAgent(IPHONE_SAFARI_UA);
    const rtl = await mountStrip();

    rtl.fireEvent.click(
      rtl.screen.getByRole('button', { name: 'Dismiss install suggestion' }),
    );

    expect(rtl.screen.queryByTestId('install-app-card')).toBeNull();
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('true');
  });
});
