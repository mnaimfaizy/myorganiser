/**
 * The real browser behind `RunDeps.runScenario`, for `tools/qa/qa-run.ts`:
 * Chromium through the repository's existing `@playwright/test` dependency
 * (ADR 0147 decision 1). Kept apart from `qa-run-executor.ts` so a test of
 * the executor never loads it: no test launches a browser.
 *
 * Each run gets a fresh browser and context at the fixed viewport, with video
 * recording always on, a screenshot of where the run ended, and the calls it
 * made to the QA backend. Only method, path (with its query), status and
 * JSON or text bodies are recorded; headers never are, so no cookie or
 * authorization header is ever written down.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type Response, chromium } from '@playwright/test';

import { readQaAccounts } from '../../scripts/lib/qa-accounts.ts';
import { firstLine } from './qa-cli.ts';
import type { RecordedRun } from './qa-run-executor.ts';
import {
  CannotRunError,
  type RecordedCall,
  SCENARIO_TIMEOUT_MS,
  type Scenario,
  type ScenarioAccount,
  VIEWPORT,
} from './qa-run.ts';
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
      const context = await browser.newContext({
        viewport: VIEWPORT,
        baseURL: QA_WEB_ORIGIN,
        recordVideo: { dir: workDir, size: VIEWPORT },
      });
      const page = await context.newPage();
      const pending: Promise<RecordedCall>[] = [];
      context.on('response', (response) => {
        if (new URL(response.url()).origin === QA_BACKEND_ORIGIN) {
          pending.push(recordCall(response));
        }
      });

      let outcome: RecordedRun['outcome'] = 'pass';
      let message: string | undefined;
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          scenario.run({
            page,
            baseURL: QA_WEB_ORIGIN,
            side,
            account,
            cannotRun(reason) {
              throw new CannotRunError(reason);
            },
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(`timed out after ${SCENARIO_TIMEOUT_MS / 1000}s`),
                ),
              SCENARIO_TIMEOUT_MS,
            );
          }),
        ]);
      } catch (error) {
        outcome = error instanceof CannotRunError ? 'cannot-run' : 'fail';
        message = firstLine(error);
      } finally {
        clearTimeout(timer);
      }

      const screenshotPath = join(workDir, 'final.png');
      const screenshot = await page
        .screenshot({ path: screenshotPath })
        .then(() => screenshotPath)
        .catch(() => null);
      const settled = await Promise.allSettled(pending);
      const calls = settled.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const video = page.video();
      // The video file is complete only once its context closes.
      await context.close();
      const videoPath = video ? await video.path().catch(() => null) : null;

      return {
        outcome,
        ...(message === undefined ? {} : { message }),
        video: videoPath !== null && existsSync(videoPath) ? videoPath : null,
        screenshot,
        calls,
      };
    } finally {
      await browser.close();
    }
  };
}
