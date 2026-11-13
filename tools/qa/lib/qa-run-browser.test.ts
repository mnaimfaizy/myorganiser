// Contracts for `chromiumRunner` (qa-run-browser.ts): the production `open()`
// wiring, with `chromium.launch` replaced for each test by a fake browser. No
// browser starts here; the module's Playwright import loads but never launches.
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';

import {
  type Browser,
  type BrowserContext,
  type Page,
  chromium,
} from '@playwright/test';

import { VIEWPORT } from './qa-run.ts';
import {
  QA_BACKEND_ORIGIN,
  QA_WEB_ORIGIN,
  chromiumRunner,
} from './qa-run-browser.ts';
import { type Scenario, type ScenarioAccount } from './qa-scenario.ts';

const WORK_DIR = '/work/run';

interface FakeResponse {
  url(): string;
  request(): {
    method(): string;
    url(): string;
    postData(): string | null;
    headers(): Record<string, string>;
  };
  status(): number;
  text(): Promise<string>;
}

/** A response as Chromium reports it; `request` carries an optional body and headers. */
function fakeResponse(
  method: string,
  url: string,
  status: number,
  body: string,
  request: { postData?: string; headers?: Record<string, string> } = {},
): FakeResponse {
  return {
    url: () => url,
    request: () => ({
      method: () => method,
      url: () => url,
      postData: () => request.postData ?? null,
      headers: () => request.headers ?? {},
    }),
    status: () => status,
    text: async () => body,
  };
}

type Handler = (response: FakeResponse) => void;

/** The part of a Page the runner touches on a run with no step: its video and final screenshot. */
function fakePage(name: string) {
  return {
    name,
    video: () => null,
    async screenshot() {
      return undefined;
    },
    async waitForFunction() {
      return undefined;
    },
  };
}
type FakePage = ReturnType<typeof fakePage>;
const asPage = (page: FakePage): Page => page as unknown as Page;

/** A BrowserContext as `chromiumRunner` uses it: its options, its listeners, and `emit`. */
function fakeContext(name: string, log: string[], options: object) {
  const listeners: { event: string; handler: Handler }[] = [];
  let pages = 0;
  return {
    name,
    options,
    listeners,
    on(event: string, handler: Handler) {
      listeners.push({ event, handler });
    },
    /** Delivers a response to every `response` listener, as Chromium does. */
    emit(response: FakeResponse) {
      for (const { event, handler } of listeners) {
        if (event === 'response') handler(response);
      }
    },
    async newPage() {
      pages++;
      return asPage(fakePage(`${name} page ${pages}`));
    },
    async close() {
      log.push(`close ${name}`);
    },
  };
}
type FakeContext = ReturnType<typeof fakeContext>;
const asContext = (context: FakeContext) =>
  context as unknown as BrowserContext;

/** A Browser that makes numbered contexts, in the order they are opened. */
function fakeBrowser(log: string[]) {
  const contexts: FakeContext[] = [];
  return {
    contexts,
    async newContext(options: object) {
      const context = fakeContext(
        `context ${contexts.length + 1}`,
        log,
        options,
      );
      contexts.push(context);
      return asContext(context);
    },
    async close() {
      log.push('close browser');
    },
  };
}
const asBrowser = (browser: ReturnType<typeof fakeBrowser>): Browser =>
  browser as unknown as Browser;

const account = (): ScenarioAccount => {
  throw new Error('no scenario in these tests signs in');
};

const scenario = (run: Scenario['run']): Scenario => ({
  id: 'S',
  capture: 'none',
  run,
});

afterEach(() => {
  mock.restoreAll();
});

describe('chromiumRunner opens every device the same way', () => {
  test('each context is made alike with one response listener, and a backend call from device B is recorded while its web call is not', async () => {
    const log: string[] = [];
    const browser = fakeBrowser(log);
    const launch = mock.method(chromium, 'launch', async () =>
      asBrowser(browser),
    );

    const run = await chromiumRunner(account)(
      scenario(async (context) => {
        await context.device('B').tab('B1');
        const [own, b] = browser.contexts;
        assert.ok(own && b, 'device B opened a second context');
        own.emit(
          fakeResponse(
            'GET',
            `${QA_BACKEND_ORIGIN}/api/auth/session`,
            200,
            '{"ok":true}',
          ),
        );
        b.emit(
          fakeResponse(
            'GET',
            `${QA_BACKEND_ORIGIN}/api/vault?page=1`,
            200,
            '{"ok":true}',
          ),
        );
        b.emit(
          fakeResponse(
            'GET',
            `${QA_WEB_ORIGIN}/dashboard`,
            200,
            '<html></html>',
          ),
        );
      }),
      { side: 'after', workDir: WORK_DIR },
    );

    assert.equal(run.outcome, 'pass');
    assert.equal(launch.mock.callCount(), 1, 'one browser per run');
    assert.equal(browser.contexts.length, 2, 'the default device and B');
    for (const context of browser.contexts) {
      assert.deepEqual(context.options, {
        viewport: VIEWPORT,
        baseURL: QA_WEB_ORIGIN,
        recordVideo: { dir: WORK_DIR, size: VIEWPORT },
      });
      assert.equal(
        context.listeners.filter(({ event }) => event === 'response').length,
        1,
        `${context.name} has exactly one response listener`,
      );
    }
    assert.deepEqual(run.calls, [
      {
        request: { method: 'GET', path: '/api/auth/session' },
        response: { status: 200, body: { ok: true } },
      },
      {
        request: { method: 'GET', path: '/api/vault?page=1' },
        response: { status: 200, body: { ok: true } },
      },
    ]);
    assert.deepEqual(
      [...log].sort(),
      ['close browser', 'close context 1', 'close context 2'],
      'every context and the browser close',
    );
  });

  test('a scenario that throws after opening device B still closes both contexts and the browser', async () => {
    const log: string[] = [];
    const browser = fakeBrowser(log);
    mock.method(chromium, 'launch', async () => asBrowser(browser));

    const run = await chromiumRunner(account)(
      scenario(async (context) => {
        await context.device('B').tab('B1');
        throw new Error('the scenario broke');
      }),
      { side: 'before', workDir: WORK_DIR },
    );

    assert.equal(run.outcome, 'fail');
    assert.equal(run.message, 'the scenario broke');
    assert.equal(browser.contexts.length, 2);
    assert.deepEqual(
      [...log].sort(),
      ['close browser', 'close context 1', 'close context 2'],
      'every context and the browser close after the throw',
    );
  });
});

describe('what a run records of its calls and observation', () => {
  /** Plays `run` on `browser`, with Chromium's launch replaced by it. */
  async function playWith(
    browser: ReturnType<typeof fakeBrowser>,
    run: Scenario['run'],
  ) {
    mock.method(chromium, 'launch', async () => asBrowser(browser));
    return chromiumRunner(account)(scenario(run), {
      side: 'after',
      workDir: WORK_DIR,
    });
  }

  test('a call keeps its JSON request body, never its headers; a text body stays text, and an empty body is absent', async () => {
    const browser = fakeBrowser([]);
    const run = await playWith(browser, async (context) => {
      await context.device('B').tab('B1');
      const b = browser.contexts[1];
      assert.ok(b, 'device B opened a second context');
      b.emit(
        fakeResponse(
          'POST',
          `${QA_BACKEND_ORIGIN}/api/auth/login`,
          200,
          '{"ok":true}',
          {
            postData: '{"email":"x@example.test","password":"SECRET-PW"}',
            headers: {
              cookie: 'sid=SECRET-COOKIE',
              authorization: 'Bearer SECRET-TOKEN',
            },
          },
        ),
      );
      b.emit(
        fakeResponse('GET', `${QA_BACKEND_ORIGIN}/api/plain`, 200, 'plain ok'),
      );
      b.emit(fakeResponse('DELETE', `${QA_BACKEND_ORIGIN}/api/empty`, 204, ''));
    });

    assert.equal(run.outcome, 'pass');
    assert.deepEqual(run.calls, [
      {
        request: {
          method: 'POST',
          path: '/api/auth/login',
          body: { email: 'x@example.test', password: 'SECRET-PW' },
        },
        response: { status: 200, body: { ok: true } },
      },
      {
        request: { method: 'GET', path: '/api/plain' },
        response: { status: 200, body: 'plain ok' },
      },
      {
        request: { method: 'DELETE', path: '/api/empty' },
        response: { status: 204 },
      },
    ]);
    const serialised = JSON.stringify(run.calls);
    assert.equal(serialised.includes('SECRET-COOKIE'), false);
    assert.equal(serialised.includes('SECRET-TOKEN'), false);
  });

  test('every returned step keeps a label that is final for its tab, so a step taken before a second tab opened is relabelled', async () => {
    const run = await playWith(fakeBrowser([]), async (context) => {
      await context.step(context.page, 'the first screen');
      const second = await context.device('A').tab('A2');
      await context.step(second, 'the second tab');
    });

    assert.equal(run.outcome, 'pass');
    assert.deepEqual(
      run.steps.map(({ index, device, tab, label }) => ({
        index,
        device,
        tab,
        label,
      })),
      [
        { index: 1, device: 'A', tab: 'A', label: 'Device A · tab A' },
        { index: 2, device: 'A', tab: 'A2', label: 'Device A · tab A2' },
      ],
    );
  });

  test('what a passing scenario passes to observed is the run observation when it returns nothing', async () => {
    const run = await playWith(fakeBrowser([]), async (context) => {
      context.observed('seen');
    });

    assert.equal(run.outcome, 'pass');
    assert.equal(run.observed, 'seen');
  });

  test('a string the scenario returns is its observation, over what it passed to observed', async () => {
    const run = await playWith(fakeBrowser([]), async (context) => {
      context.observed('seen');
      return 'returned';
    });

    assert.equal(run.outcome, 'pass');
    assert.equal(run.observed, 'returned');
  });

  test('a failing scenario records no observation, even one it passed to observed', async () => {
    const run = await playWith(fakeBrowser([]), async (context) => {
      context.observed('seen');
      throw new Error('the scenario broke');
    });

    assert.equal(run.outcome, 'fail');
    assert.equal(run.observed, undefined);
  });
});
