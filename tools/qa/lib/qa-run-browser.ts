/**
 * The real browser behind `RunDeps.runScenario`, for `tools/qa/qa-run.ts`:
 * Chromium through the repository's existing `@playwright/test` dependency
 * (ADR 0147 decision 1). Kept apart from `qa-run-executor.ts` so a test of
 * the executor never loads it: no test plays a scenario in a browser.
 *
 * Each run gets a fresh browser; every device a scenario opens (the default
 * page's device A, and each `device(name)`) gets a context at the fixed
 * viewport and baseURL, with video recording always on and its backend calls
 * recorded, and is closed at the end even after a timeout or failure. A run
 * has a screenshot of where the run ended, the calls it made to the QA
 * backend, each `step()`'s still and record (`qa-scenario-context.ts`), and
 * what a passing run observed. Only method, path (with its query), status and
 * JSON or text bodies are recorded; headers never are, so no cookie or
 * authorization header is ever written down.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type BrowserContext, type Response, chromium } from '@playwright/test';

import { readQaAccounts } from '../../scripts/lib/qa-accounts.ts';
import { firstLine } from './qa-cli.ts';
import type { RecordedRun } from './qa-run-executor.ts';
import { type RecordedCall, SCENARIO_TIMEOUT_MS, VIEWPORT } from './qa-run.ts';
import {
  CannotRunError,
  type Scenario,
  type ScenarioAccount,
} from './qa-scenario.ts';
import {
  DEFAULT_DEVICE,
  DEFAULT_TAB,
  deviceRegistry,
  playScenario,
  stepRecorder,
  watchBackend,
} from './qa-scenario-context.ts';
import { QA_STACK } from './qa-stack.ts';
import type { Side } from './qa-stack.ts';

export const QA_WEB_ORIGIN = `http://localhost:${QA_STACK.webPort}`;
export const QA_BACKEND_ORIGIN = `http://localhost:${QA_STACK.backendPort}`;

/** Why Chromium cannot be launched, or `null`. */
export function chromiumMissing(): string | null {
  let path: string;
  try {
    path = chromium.executablePath();
  } catch {
    path = '';
  }
  return path !== '' && existsSync(path)
    ? null
    : 'Playwright\'s Chromium is not installed, so no scenario can run. Install it with "corepack yarn playwright install chromium" and run again.';
}

/** A QA Account lookup over the tracked table, for a scenario's `account(id)`. */
export function qaAccountLookup(
  repoRoot: string,
): (id: string) => ScenarioAccount {
  const accounts = readQaAccounts(repoRoot);
  return (id) => {
    const account = accounts.find((candidate) => candidate.id === id);
    if (!account) {
      throw new Error(
        `no QA Account "${id}"; the ids are ${accounts.map((a) => a.id).join(', ')}`,
      );
    }
    return {
      id: account.id,
      email: account.email,
      password: account.password,
      vaultPassphrase: account.vaultPassphrase,
    };
  };
}

/** A body as JSON when it parses, as text otherwise, and absent when empty. */
function parseBody(text: string | null): unknown {
  if (text === null || text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function recordCall(response: Response): Promise<RecordedCall> {
  const request = response.request();
  const url = new URL(request.url());
  const body = parseBody(request.postData());
  const responseBody = parseBody(await response.text().catch(() => ''));
  return {
    request: {
      method: request.method(),
      path: `${url.pathname}${url.search}`,
      ...(body === undefined ? {} : { body }),
    },
    response: {
      status: response.status(),
      ...(responseBody === undefined ? {} : { body: responseBody }),
    },
  };
}

export function chromiumRunner(
  account: (id: string) => ScenarioAccount,
): (
  scenario: Scenario,
  run: { side: Side; workDir: string },
) => Promise<RecordedRun> {
  return async (scenario, { side, workDir }) => {
    const browser = await chromium.launch();
    try {
      const pending: Promise<RecordedCall>[] = [];
      /** Values the Storyboard may not show; they stay in memory. */
      const denied = new Set<string>();
      /** The ids (never emails) of the QA Accounts the scenario asked for. */
      const accountIds = new Set<string>();
      /** Every device is made alike, and its backend calls are recorded. */
      const open = async (): Promise<BrowserContext> => {
        const context = await browser.newContext({
          viewport: VIEWPORT,
          baseURL: QA_WEB_ORIGIN,
          recordVideo: { dir: workDir, size: VIEWPORT },
        });
        watchBackend(context, QA_BACKEND_ORIGIN, recordCall, pending);
        return context;
      };
      const ownContext = await open();
      // Step times count from here, where the context's video starts.
      const startedAt = Date.now();
      const page = await ownContext.newPage();
      const registry = deviceRegistry({
        open,
        own: { context: ownContext, page },
        elapsedMs: () => Date.now() - startedAt,
      });
      const recorder = stepRecorder({
        side,
        workDir,
        startedAt,
        lookup: registry.lookup,
      });
      let screenshot: string | null = null;
      const played = await playScenario({
        run: () =>
          scenario.run({
            page,
            device: registry.device,
            baseURL: QA_WEB_ORIGIN,
            side,
            account(id) {
              const found = account(id);
              accountIds.add(found.id);
              denied.add(found.password);
              denied.add(found.vaultPassphrase);
              return found;
            },
            secret(value) {
              denied.add(value);
            },
            cannotRun(reason) {
              throw new CannotRunError(reason);
            },
            step: recorder.step,
            observed: recorder.observed,
          }),
        timeoutMs: SCENARIO_TIMEOUT_MS,
        isCannotRun: (error) => error instanceof CannotRunError,
        describe: firstLine,
        registry,
        async beforeClose() {
          const path = join(workDir, 'final.png');
          screenshot = await page
            .screenshot({ path })
            .then(() => path)
            .catch(() => null);
        },
      });
      const { outcome, message, returned, recordings } = played;

      const settled = await Promise.allSettled(pending);
      const calls = settled.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const exists = (path: string | null): string | null =>
        path !== null && existsSync(path) ? path : null;
      const own = recordings.find(
        (r) => r.device === DEFAULT_DEVICE && r.tab === DEFAULT_TAB,
      );
      const tabVideos = recordings
        .filter((r) => r !== own)
        .map((r) => ({ ...r, path: exists(r.path) }));

      const observed =
        outcome !== 'pass'
          ? undefined
          : typeof returned === 'string'
            ? returned
            : recorder.observation();
      return {
        outcome,
        ...(message === undefined ? {} : { message }),
        ...(observed === undefined ? {} : { observed }),
        // A tab keeps one label for the whole run, from the tabs its device ended with.
        steps: recorder.steps.map((step) => ({
          ...step,
          label: registry.finalLabel(step.device, step.tab),
        })),
        video: exists(own?.path ?? null),
        screenshot,
        calls,
        denied: [...denied],
        accountIds: [...accountIds],
        ...(tabVideos.length === 0 ? {} : { tabVideos }),
        startedAtMs: startedAt,
      };
    } finally {
      await browser.close();
    }
  };
}
