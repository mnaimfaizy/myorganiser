// Contracts for `qa-scenario-context.ts`: the device and tab registry, the
// step recorder's labels, the backend watch, and the run's time limit and
// closing. Hand-written fakes stand in for Playwright's Page and
// BrowserContext; no browser starts here. The module's Playwright imports
// are type-only, so none loads at run time.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { type Box, CannotRunError, type StepRecord } from './qa-scenario.ts';
import {
  DEFAULT_DEVICE,
  DEFAULT_TAB,
  type DeviceRegistry,
  deviceRegistry,
  playScenario,
  stepRecorder,
  tabLabel,
  watchBackend,
} from './qa-scenario-context.ts';

const BACKEND = 'http://localhost:3000';
const WEB = 'http://localhost:4200';

interface FakeResponse {
  url(): string;
}

const responseTo = (url: string): FakeResponse => ({ url: () => url });

/**
 * The part of a Page the runner touches: its video, screenshots, and the
 * animation settle wait. `settles: false` makes that wait time out.
 */
function fakePage(
  name: string,
  options: { video?: string | null; settles?: boolean } = {},
) {
  const video =
    options.video === undefined ? `/work/${name}.webm` : options.video;
  const shots: Record<string, unknown>[] = [];
  return {
    name,
    shots,
    video: () => (video === null ? null : { path: async () => video }),
    async screenshot(shot: Record<string, unknown>) {
      shots.push(shot);
    },
    async waitForFunction() {
      if (options.settles === false) throw new Error('animations never ended');
    },
    async evaluate() {
      return undefined;
    },
  };
}
type FakePage = ReturnType<typeof fakePage>;
const asPage = (page: FakePage): Page => page as unknown as Page;

/**
 * A BrowserContext as the registry and `watchBackend` use it: `newPage`,
 * `close` (logged, and rejecting when `closeFails`), and `on` with a way to
 * emit a response through every handler.
 */
function fakeContext(
  name: string,
  log: string[],
  options: { closeFails?: boolean } = {},
) {
  const state = { closes: 0 };
  const handlers: ((response: FakeResponse) => void)[] = [];
  const pages: FakePage[] = [];
  return {
    name,
    pages,
    state,
    on(_event: string, handler: (response: FakeResponse) => void) {
      handlers.push(handler);
    },
    emit(response: FakeResponse) {
      for (const handler of handlers) handler(response);
    },
    async newPage() {
      await Promise.resolve();
      const page = fakePage(`${name}#${pages.length + 1}`);
      pages.push(page);
      return asPage(page);
    },
    async close() {
      state.closes++;
      log.push(`close ${name}`);
      if (options.closeFails) throw new Error(`${name} would not close`);
    },
  };
}
type FakeContext = ReturnType<typeof fakeContext>;
const asContext = (context: FakeContext): BrowserContext =>
  context as unknown as BrowserContext;

/** A registry over fake contexts: the default device A is `own`; `open` makes the rest. */
function rig(log: string[], closeFails: string[] = []) {
  const own = fakeContext('A', log, { closeFails: closeFails.includes('A') });
  const ownPage = fakePage('A');
  const opened: string[] = [];
  const contexts = new Map<string, FakeContext>();
  const registry = deviceRegistry({
    async open(device) {
      opened.push(device);
      const context = fakeContext(device, log, {
        closeFails: closeFails.includes(device),
      });
      contexts.set(device, context);
      return asContext(context);
    },
    own: { context: asContext(own), page: asPage(ownPage) },
  });
  return { own, ownPage, opened, contexts, registry };
}

/** A rig with device B open and a second tab on it, as a scenario with two devices would have. */
async function rigWithDevices(log: string[], closeFails: string[] = []) {
  const parts = rig(log, closeFails);
  await parts.registry.device('B').tab('B1');
  return parts;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type PlayOptions = Parameters<typeof playScenario>[0];

/** `playScenario` with the defaults a test does not care about. */
function play(
  registry: Pick<DeviceRegistry, 'closeAll'>,
  options: Pick<PlayOptions, 'run'> & Partial<PlayOptions>,
) {
  return playScenario({
    timeoutMs: 1000,
    isCannotRun: () => false,
    describe: describeError,
    registry,
    ...options,
  });
}

/**
 * A subject `step()` reads: its box from `boxAt` (the nth read), inside a
 * toast or not, and visible at once unless `visible` is false, in which case
 * its `waitFor` rejects as Playwright's does at its timeout.
 */
function fakeSubject(
  boxAt: (read: number) => Box,
  inToast = false,
  visible = true,
) {
  let reads = 0;
  return {
    async waitFor() {
      if (!visible) throw new Error('subject never became visible');
    },
    async boundingBox() {
      return boxAt(reads++);
    },
    async evaluate() {
      return inToast;
    },
  };
}
type FakeSubject = ReturnType<typeof fakeSubject>;
const asLocator = (subject: FakeSubject): Locator =>
  subject as unknown as Locator;

describe('tab labels on a step', () => {
  test('a device with one tab named like the device is "Device d"; any other tab is "Device d · tab t"', () => {
    assert.equal(tabLabel('A', 'A', 1), 'Device A');
    assert.equal(tabLabel('A', 'A', 2), 'Device A · tab A');
    assert.equal(tabLabel('A', 'B', 1), 'Device A · tab B');
    assert.equal(tabLabel('B', 'A', 1), 'Device B · tab A');
  });
});

describe('a step is labelled from the tab it names', () => {
  test('a scenario with two devices and four tabs (the default plus three opened) labels each step from its own tab, and relabels device A once it has a second tab', async () => {
    const log: string[] = [];
    const { ownPage, opened, registry } = await rigWithDevices(log);
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
      lookup: registry.lookup,
    });
    // Device A has only its default tab when the first step is taken.
    const defaultTab = asPage(ownPage);
    await recorder.step(defaultTab, 'the default page');
    const aTabB = await registry.device('A').tab('B');
    await recorder.step(aTabB, 'device A, tab B');
    const bTabB1 = await registry.device('B').tab('B1');
    const bTabB2 = await registry.device('B').tab('B2');
    await recorder.step(bTabB1, 'device B, tab B1');
    await recorder.step(bTabB2, 'device B, tab B2');
    await recorder.step(defaultTab, 'device A, tab A again');

    assert.deepEqual(
      recorder.steps.map(({ index, device, tab, label }) => ({
        index,
        device,
        tab,
        label,
      })),
      [
        { index: 1, device: 'A', tab: 'A', label: 'Device A' },
        { index: 2, device: 'A', tab: 'B', label: 'Device A · tab B' },
        { index: 3, device: 'B', tab: 'B1', label: 'Device B · tab B1' },
        { index: 4, device: 'B', tab: 'B2', label: 'Device B · tab B2' },
        { index: 5, device: 'A', tab: 'A', label: 'Device A · tab A' },
      ],
    );
    assert.deepEqual(opened, ['B'], 'device B is opened once');
  });

  test('a step records its still, its time and its caption, and takes the still with animations disabled and toasts hidden', async () => {
    const log: string[] = [];
    const { ownPage, registry } = rig(log);
    const recorder = stepRecorder({
      side: 'before',
      workDir: '/work',
      startedAt: 1000,
      now: () => 1500,
      lookup: registry.lookup,
    });
    await recorder.step(asPage(ownPage), 'the first screen');

    const [step] = recorder.steps;
    assert.deepEqual(step, {
      side: 'before',
      index: 1,
      device: 'A',
      tab: 'A',
      label: 'Device A',
      caption: 'the first screen',
      still: '/work/step-01.png',
      subject: null,
      atMs: 500,
    });
    assert.equal(ownPage.shots.length, 1);
    assert.equal(ownPage.shots[0]?.path, '/work/step-01.png');
    assert.equal(ownPage.shots[0]?.animations, 'disabled');
    assert.match(String(ownPage.shots[0]?.style), /visibility:hidden/);
  });

  test('a page the registry did not open is labelled as the default device and tab', async () => {
    const log: string[] = [];
    const { registry } = rig(log);
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
      lookup: registry.lookup,
    });
    const stranger = fakePage('stranger');
    assert.equal(registry.lookup(asPage(stranger)), undefined);
    await recorder.step(asPage(stranger), 'not from the registry');

    const [step] = recorder.steps;
    assert.equal(step?.device, DEFAULT_DEVICE);
    assert.equal(step?.tab, DEFAULT_TAB);
    assert.equal(step?.label, 'Device A');
  });

  test('a step whose animations never end is still taken, and is recorded settled: false', async () => {
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
    });
    const busy = fakePage('busy', { settles: false });
    await recorder.step(asPage(busy), 'a spinner keeps going');

    const recorded: StepRecord[] = [...recorder.steps];
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.settled, false);
    assert.equal(busy.shots.length, 1, 'the still is taken anyway');
  });
});

describe('backend calls are recorded from every device', () => {
  test('a watched context records only responses from the backend origin, not its web origin, another port, or another host', async () => {
    const pending: Promise<string>[] = [];
    const context = fakeContext('B', []);
    watchBackend(
      asContext(context),
      BACKEND,
      async (response) => response.url(),
      pending,
    );
    context.emit(responseTo(`${BACKEND}/api/vault?page=1`));
    context.emit(responseTo(`${WEB}/dashboard`));
    context.emit(responseTo('http://localhost:30000/api/other'));
    context.emit(responseTo('http://localhost.example.test:3000/api/x'));
    context.emit(responseTo(`${BACKEND}/api/auth/login`));

    assert.deepEqual(await Promise.all(pending), [
      `${BACKEND}/api/vault?page=1`,
      `${BACKEND}/api/auth/login`,
    ]);
  });

  test('watchBackend, called from a test-supplied open and on the default context, lands every backend call in one pending list', async () => {
    const pending: Promise<string>[] = [];
    const log: string[] = [];
    const own = fakeContext('A', log);
    const ownPage = fakePage('A');
    const opened = new Map<string, FakeContext>();
    const registry = deviceRegistry({
      async open(device) {
        const context = fakeContext(device, log);
        opened.set(device, context);
        watchBackend(
          asContext(context),
          BACKEND,
          async (response) => `${device} ${response.url()}`,
          pending,
        );
        return asContext(context);
      },
      own: { context: asContext(own), page: asPage(ownPage) },
    });
    watchBackend(
      asContext(own),
      BACKEND,
      async (response) => `A ${response.url()}`,
      pending,
    );

    await registry.device('B').tab('B1');
    own.emit(responseTo(`${BACKEND}/api/a-call`));
    const bContext = opened.get('B');
    assert.ok(bContext, 'device B was opened through open()');
    bContext.emit(responseTo(`${BACKEND}/api/b-call`));
    bContext.emit(responseTo(`${WEB}/not-a-call`));

    assert.deepEqual(await Promise.all(pending), [
      `A ${BACKEND}/api/a-call`,
      `B ${BACKEND}/api/b-call`,
    ]);
  });
});

describe('a one-page scenario runs unchanged', () => {
  test('its one step is labelled Device A, the registry holds one tab, and closeAll closes the one context', async () => {
    const log: string[] = [];
    const { own, ownPage, opened, registry } = rig(log);
    const recorder = stepRecorder({
      side: 'before',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
      lookup: registry.lookup,
    });
    const played = await play(registry, {
      run: () => recorder.step(asPage(ownPage), 'only the page'),
    });

    assert.equal(played.outcome, 'pass');
    assert.deepEqual(
      recorder.steps.map(({ device, tab, label }) => ({ device, tab, label })),
      [{ device: 'A', tab: 'A', label: 'Device A' }],
    );
    assert.equal(registry.tabs().length, 1);
    assert.deepEqual(opened, [], 'no other device is opened');
    assert.equal(own.state.closes, 1);
    assert.deepEqual(log, ['close A']);
    assert.deepEqual(played.recordings, [
      { device: 'A', tab: 'A', path: '/work/A.webm', openedAtMs: 0 },
    ]);
  });
});

describe('playScenario closes every device, however the run ends', () => {
  test('a run that never resolves times out as a fail, and every device context is closed', async () => {
    const log: string[] = [];
    const { registry } = await rigWithDevices(log);
    const played = await play(registry, {
      run: () => new Promise<never>(() => undefined),
      timeoutMs: 10,
    });

    assert.equal(played.outcome, 'fail');
    assert.equal(played.message, 'timed out after 0.01s');
    assert.deepEqual([...log].sort(), ['close A', 'close B']);
  });

  test('a run that throws is a fail with its message, and every device context is closed', async () => {
    const log: string[] = [];
    const { registry } = await rigWithDevices(log);
    const played = await play(registry, {
      run: async () => {
        throw new Error('the scenario broke');
      },
    });

    assert.equal(played.outcome, 'fail');
    assert.equal(played.message, 'the scenario broke');
    assert.deepEqual([...log].sort(), ['close A', 'close B']);
  });

  test('a run that cannot run is cannot-run, and every device context is closed', async () => {
    const log: string[] = [];
    const { registry } = await rigWithDevices(log);
    const played = await play(registry, {
      run: async () => {
        throw new CannotRunError('no QA Account to sign in with');
      },
      isCannotRun: (error) => error instanceof CannotRunError,
    });

    assert.equal(played.outcome, 'cannot-run');
    assert.equal(played.message, 'no QA Account to sign in with');
    assert.deepEqual([...log].sort(), ['close A', 'close B']);
  });

  test('when one context fails to close, the others still close and the run is still reported', async () => {
    const log: string[] = [];
    const { registry } = await rigWithDevices(log, ['B']);
    const played = await play(registry, {
      run: async () => 'done',
    });

    assert.equal(played.outcome, 'pass');
    assert.equal(played.returned, 'done');
    assert.deepEqual([...log].sort(), ['close A', 'close B']);
    assert.deepEqual(
      played.recordings.map(({ device, tab }) => `${device}/${tab}`).sort(),
      ['A/A', 'B/B1'],
    );
  });

  test('beforeClose runs before any context closes, and its rejection is swallowed', async () => {
    const log: string[] = [];
    const { registry } = await rigWithDevices(log);
    const played = await play(registry, {
      run: async () => 'observed',
      beforeClose: async () => {
        log.push('beforeClose');
        throw new Error('the final screenshot failed');
      },
    });

    assert.equal(played.outcome, 'pass');
    assert.equal(played.returned, 'observed');
    assert.deepEqual(log, ['beforeClose', 'close A', 'close B']);
  });
});

describe('the device registry', () => {
  test('tab(name) returns the same page for the same name, and a concurrent second call does not open another', async () => {
    const log: string[] = [];
    const { registry, contexts, opened } = rig(log);
    const [first, second] = await Promise.all([
      registry.device('B').tab('B1'),
      registry.device('B').tab('B1'),
    ]);
    const again = await registry.device('B').tab('B1');

    assert.equal(first, second);
    assert.equal(first, again);
    assert.deepEqual(opened, ['B'], 'device B is opened once');
    assert.equal(contexts.get('B')?.pages.length, 1, 'newPage runs once');
  });

  test('one context serves every tab of a device, and a second tab is a second page on it', async () => {
    const log: string[] = [];
    const { registry, contexts, opened } = rig(log);
    const b1 = await registry.device('B').tab('B1');
    const b2 = await registry.device('B').tab('B2');

    assert.notEqual(b1, b2);
    assert.deepEqual(opened, ['B']);
    assert.equal(contexts.get('B')?.pages.length, 2);
    assert.deepEqual(
      registry.tabs().map(({ device, tab }) => `${device}/${tab}`),
      ['A/A', 'B/B1', 'B/B2'],
    );
  });
  test('each tab is stamped with the run time at which its page opened, and the default tab with 0', async () => {
    const log: string[] = [];
    const own = fakeContext('A', log);
    const b = fakeContext('B', log);
    let now = 0;
    const registry = deviceRegistry({
      async open() {
        return asContext(b);
      },
      own: { context: asContext(own), page: asPage(fakePage('A')) },
      elapsedMs: () => now,
    });
    now = 1200;
    await registry.device('B').tab('B1');
    // The clock moves while the page opens: the stamp is taken after it exists.
    b.newPage = async () => {
      now = 3500;
      return asPage(fakePage('B2'));
    };
    await registry.device('B').tab('B2');

    assert.deepEqual(
      (await registry.closeAll()).map(({ device, tab, openedAtMs }) => [
        device,
        tab,
        openedAtMs,
      ]),
      [
        ['A', 'A', 0],
        ['B', 'B1', 1200],
        ['B', 'B2', 3500],
      ],
    );
  });
});

describe('closing while a device or tab is still opening', () => {
  /** A registry whose `open` is the test's; device A is `own`. */
  function custom(
    log: string[],
    open: (device: string) => Promise<BrowserContext>,
  ) {
    const own = fakeContext('A', log);
    return deviceRegistry({
      open,
      own: { context: asContext(own), page: asPage(fakePage('A')) },
      openGraceMs: 20,
    });
  }

  test('a device that never finishes opening does not keep device A open, and the run is still reported', async () => {
    const log: string[] = [];
    const registry = custom(log, () => new Promise<never>(() => undefined));
    void registry.device('B').tab('B1');
    const played = await play(registry, {
      run: async () => {
        throw new Error('boom');
      },
      timeoutMs: 100,
    });

    assert.equal(played.outcome, 'fail');
    assert.equal(played.message, 'boom');
    assert.deepEqual(log, ['close A']);
  });

  test('a tab whose page opens during the grace is closed with its device and its recording is reported', async () => {
    const log: string[] = [];
    const b = fakeContext('B', log);
    b.newPage = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const page = fakePage('B1');
      b.pages.push(page);
      return asPage(page);
    };
    const registry = custom(log, async () => asContext(b));
    void registry.device('B').tab('B1');
    const played = await play(registry, {
      run: async () => 'done',
    });

    assert.deepEqual([...log].sort(), ['close A', 'close B']);
    assert.deepEqual(
      played.recordings.find(({ device }) => device === 'B'),
      { device: 'B', tab: 'B1', path: '/work/B1.webm', openedAtMs: 0 },
    );
  });

  test('a device that opens after the run has ended is closed on arrival, and a tab opened after the run is refused', async () => {
    const log: string[] = [];
    const c = fakeContext('C', log);
    let release: () => void = () => undefined;
    const registry = custom(
      log,
      () =>
        new Promise<BrowserContext>((resolve) => {
          release = () => resolve(asContext(c));
        }),
    );
    const pending = registry.device('C').tab('C1');
    pending.catch(() => undefined);
    await play(registry, { run: async () => 'done' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.ok(log.includes('close C'), 'the late context is closed');
    await assert.rejects(registry.device('D').tab('D1'), /run has ended/);
  });
});

describe('a tab with no recording', () => {
  test('a tab whose video() is null, or whose path() rejects, is reported with a null path', async () => {
    const log: string[] = [];
    const a = fakeContext('A', log);
    const b = fakeContext('B', log);
    const pageB1 = fakePage('B1', { video: null });
    const pageB2 = fakePage('B2');
    pageB2.video = () => ({
      path: async () => {
        throw new Error('no video file');
      },
    });
    const queue = [pageB1, pageB2];
    b.newPage = async () => asPage(queue.shift() as FakePage);
    const registry = deviceRegistry({
      open: async () => asContext(b),
      own: { context: asContext(a), page: asPage(fakePage('A')) },
    });
    await registry.device('B').tab('B1');
    await registry.device('B').tab('B2');

    assert.deepEqual(await registry.closeAll(), [
      { device: 'A', tab: 'A', path: '/work/A.webm', openedAtMs: 0 },
      { device: 'B', tab: 'B1', path: null, openedAtMs: 0 },
      { device: 'B', tab: 'B2', path: null, openedAtMs: 0 },
    ]);
  });
});

describe('a device that fails to open', () => {
  /** A registry whose `open` is the test's; device A is `own`. */
  function failing(
    log: string[],
    open: (device: string) => Promise<BrowserContext>,
  ) {
    return deviceRegistry({
      open,
      own: {
        context: asContext(fakeContext('A', log)),
        page: asPage(fakePage('A')),
      },
    });
  }

  test('a browser that runs out of memory rejects the tab, and closeAll still reports device A', async () => {
    const log: string[] = [];
    const registry = failing(log, async () => {
      throw new Error('browser out of memory');
    });
    await assert.rejects(registry.device('B').tab('B1'), /out of memory/);

    assert.deepEqual(await registry.closeAll(), [
      { device: 'A', tab: 'A', path: '/work/A.webm', openedAtMs: 0 },
    ]);
    assert.deepEqual(log, ['close A']);
  });

  test('a context whose new page throws rejects the tab, is still closed, and closeAll reports device A', async () => {
    const log: string[] = [];
    const b = fakeContext('B', log);
    b.newPage = async () => {
      throw new Error('context closed');
    };
    const registry = failing(log, async () => asContext(b));
    await assert.rejects(registry.device('B').tab('B1'), /context closed/);

    assert.equal(registry.tabs().length, 1, 'only device A has a tab');
    assert.deepEqual(await registry.closeAll(), [
      { device: 'A', tab: 'A', path: '/work/A.webm', openedAtMs: 0 },
    ]);
    assert.deepEqual([...log].sort(), ['close A', 'close B']);
  });
});

describe('a tab label is computed from the tabs its device has when asked', () => {
  test('the lone default tab is "Device A", and it becomes "Device A · tab A" once device A opens a second tab, while a step already taken keeps its recorded label', async () => {
    const log: string[] = [];
    const { ownPage, registry } = rig(log);
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
      lookup: registry.lookup,
    });
    await recorder.step(asPage(ownPage), 'before the second tab');
    assert.equal(registry.finalLabel('A', 'A'), 'Device A');

    await registry.device('A').tab('A2');
    assert.equal(registry.finalLabel('A', 'A'), 'Device A · tab A');
    assert.equal(
      recorder.steps[0]?.label,
      'Device A',
      'the recorded label is kept',
    );
  });

  test('a device with one tab named like the device is "Device B"', async () => {
    const log: string[] = [];
    const { registry } = rig(log);
    await registry.device('B').tab('B');

    assert.equal(registry.finalLabel('B', 'B'), 'Device B');
  });

  test('a device with two tabs labels each as "Device B · tab <name>"', async () => {
    const log: string[] = [];
    const { registry } = rig(log);
    await registry.device('B').tab('B1');
    await registry.device('B').tab('B2');

    assert.equal(registry.finalLabel('B', 'B1'), 'Device B · tab B1');
    assert.equal(registry.finalLabel('B', 'B2'), 'Device B · tab B2');
  });
});

describe('the observation a run records', () => {
  test('observation() is undefined until observed is called, and the last text observed is the one kept', () => {
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
    });
    assert.equal(recorder.observation(), undefined);

    recorder.observed('a');
    recorder.observed('b');
    assert.equal(recorder.observation(), 'b');
  });
});

describe('a step with a subject', () => {
  const BOX: Box = { x: 10, y: 20, width: 100, height: 40 };

  test('a subject that never becomes visible fails the step before any still is taken or recorded', async () => {
    const page = fakePage('A');
    const subject = fakeSubject(() => BOX, false, false);
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
    });

    await assert.rejects(
      recorder.step(asPage(page), 'the vanished subject', {
        subject: asLocator(subject),
      }),
      /never became visible/,
    );
    assert.equal(page.shots.length, 0, 'no still is taken');
    assert.equal(recorder.steps.length, 0, 'no step is recorded');
  });

  test('a subject inside a toast is shot with the toast region left visible, and a stable box is not marked settled: false', async () => {
    const page = fakePage('A');
    const subject = fakeSubject(() => BOX, true);
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
    });
    await recorder.step(asPage(page), 'the toast itself', {
      subject: asLocator(subject),
    });

    const [shot] = page.shots;
    assert.ok(shot, 'the still is taken');
    assert.equal(shot.animations, 'disabled');
    assert.equal(
      Object.hasOwn(shot, 'style'),
      false,
      'no toast-hiding style is passed',
    );
    const [step] = recorder.steps;
    assert.deepEqual(step?.subject, BOX);
    assert.equal(step?.settled, undefined);
  });

  test('a subject whose box moves on every read is still shot once the tries run out, and is recorded settled: false', async () => {
    const page = fakePage('A');
    const subject = fakeSubject((read) => ({
      x: read,
      y: 0,
      width: 10,
      height: 10,
    }));
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
    });
    await recorder.step(asPage(page), 'a box that keeps moving', {
      subject: asLocator(subject),
    });

    assert.equal(page.shots.length, 1, 'the still is taken anyway');
    assert.equal(page.shots[0]?.animations, 'disabled');
    const [step] = recorder.steps;
    assert.equal(step?.settled, false);
    assert.ok(step?.subject, 'the subject box is still recorded');
  });
});

describe('a step marked checked', () => {
  test('only the step taken with checked: true records checked: true; an unmarked step has no checked key at all', async () => {
    const log: string[] = [];
    const { ownPage, registry } = rig(log);
    const recorder = stepRecorder({
      side: 'before',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
      lookup: registry.lookup,
    });
    await recorder.step(asPage(ownPage), 'the first screen');
    await recorder.step(asPage(ownPage), 'the check', { checked: true });
    await recorder.step(asPage(ownPage), 'after the check');

    assert.deepEqual(
      recorder.steps.map((step) => step.checked),
      [undefined, true, undefined],
    );
    assert.equal('checked' in recorder.steps[0], false);
    assert.equal('checked' in recorder.steps[2], false);
  });
});

describe('a step with showing', () => {
  const BOX: Box = { x: 10, y: 20, width: 100, height: 40 };

  /** A locator `step()` waits on with `showing`; its `waitFor` is the test's. */
  function fakeShowing(waitFor: (options: unknown) => Promise<void>) {
    return { waitFor } as unknown as Locator;
  }

  test('waits for the showing element, then takes the still at once with no animation settle, no toast-hiding style, and atMs from the clock at capture', async () => {
    let clock = 1500;
    const page = fakePage('A');
    let animationWaits = 0;
    page.waitForFunction = async () => {
      animationWaits++;
    };
    const waits: unknown[] = [];
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 1000,
      now: () => clock,
    });

    await recorder.step(asPage(page), 'the toast appears', {
      showing: fakeShowing(async (options) => {
        waits.push(options);
        clock = 2300;
      }),
    });

    assert.deepEqual(waits, [{ state: 'visible', timeout: 5000 }]);
    assert.equal(animationWaits, 0, 'the animation settle is not waited for');
    assert.equal(page.shots.length, 1, 'the still is taken');
    const [shot] = page.shots;
    assert.equal(shot?.path, '/work/step-01.png');
    assert.equal(shot?.animations, 'disabled');
    assert.equal(
      Object.hasOwn(shot ?? {}, 'style'),
      false,
      'no toast-hiding style is passed',
    );
    const [step] = recorder.steps;
    assert.equal(step?.atMs, 1300, 'atMs is read after the wait');
    assert.equal(step?.settled, undefined, 'the record has no settled: false');
  });

  test('the still is taken straight after the wait resolves, before any animation settle', async () => {
    const events: string[] = [];
    const page = fakePage('A');
    const takeShot = page.screenshot;
    page.screenshot = async (shot) => {
      events.push('screenshot');
      await takeShot(shot);
    };
    page.waitForFunction = async () => {
      events.push('animation settle');
    };
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
    });

    await recorder.step(asPage(page), 'the toast dismisses soon', {
      showing: fakeShowing(async () => {
        events.push('waitFor resolved');
      }),
    });

    assert.deepEqual(events, ['waitFor resolved', 'screenshot']);
    assert.equal(page.shots.length, 1);
    assert.equal(recorder.steps.length, 1);
  });

  test('an element that never appears fails the step, naming the step and its caption, with no still taken and no step recorded', async () => {
    const page = fakePage('A');
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
    });
    await recorder.step(asPage(page), 'the first screen');
    const timeout = Object.assign(
      new Error('locator.waitFor: Timeout 5000ms exceeded.'),
      {
        name: 'TimeoutError',
      },
    );

    await assert.rejects(
      recorder.step(asPage(page), 'the toast confirms', {
        showing: fakeShowing(async () => {
          throw timeout;
        }),
      }),
      (error: unknown) =>
        error instanceof Error &&
        /^Step 2 \("the toast confirms"\): the element it must show did not appear within 5000 ms$/.test(
          error.message,
        ) &&
        error.cause === timeout,
    );
    assert.equal(page.shots.length, 1, 'only the first step has a still');
    assert.equal(recorder.steps.length, 1, 'only the first step is recorded');
  });

  test('a wait that fails for another reason names the step and the original message, not a timeout, and records no step', async () => {
    const page = fakePage('A');
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
    });
    await recorder.step(asPage(page), 'the first screen');
    const closed = new Error('Target page, context or browser has been closed');

    await assert.rejects(
      recorder.step(asPage(page), 'the toast confirms', {
        showing: fakeShowing(async () => {
          throw closed;
        }),
      }),
      (error: unknown) =>
        error instanceof Error &&
        /^Step 2 \("the toast confirms"\): waiting for the element it must show failed: Target page, context or browser has been closed$/.test(
          error.message,
        ) &&
        !error.message.includes('did not appear') &&
        error.cause === closed,
    );
    assert.equal(page.shots.length, 1, 'only the first step has a still');
    assert.equal(recorder.steps.length, 1, 'only the first step is recorded');
  });

  test('a showing step with a subject records the subject box from its one read, and the region stays visible', async () => {
    const page = fakePage('A');
    const reads: number[] = [];
    const subject = fakeSubject((read) => {
      reads.push(read);
      return BOX;
    });
    const waits: unknown[] = [];
    const recorder = stepRecorder({
      side: 'after',
      workDir: '/work',
      startedAt: 0,
      now: () => 0,
    });

    await recorder.step(asPage(page), 'the toast over the subject', {
      subject: asLocator(subject),
      showing: fakeShowing(async (options) => {
        waits.push(options);
      }),
    });

    assert.deepEqual(waits, [{ state: 'visible', timeout: 5000 }]);
    assert.deepEqual(
      reads,
      [0],
      'the subject is read once, with no stability tries',
    );
    const [shot] = page.shots;
    assert.equal(
      Object.hasOwn(shot ?? {}, 'style'),
      false,
      'no toast-hiding style is passed',
    );
    const [step] = recorder.steps;
    assert.deepEqual(step?.subject, BOX);
    assert.equal(step?.settled, undefined);
  });
});
