#!/usr/bin/env node
// Builds the Host Apply on-host script for one environment from resolved
// GitHub Environment secrets (ADR 0056, issue #567). The caller redirects
// stdout to a file consumed by the SSH step — this script never writes a
// secret value to the workflow's own log, only to that file.
//
//   node tools/scripts/run-host-apply.mjs <staging|production> > script.sh
//
// Exit 0 = script written to stdout. Exit 1 = a guard refused (HostApplyRefusal).
// Exit 2 = bad invocation.
import {
  HostApplyRefusal,
  assertAppRootGuard,
  buildHostApplyScript,
} from './lib/host-apply.ts';

const [, , environment] = process.argv;

if (environment !== 'staging' && environment !== 'production') {
  console.error(
    `run-host-apply: unknown environment ${JSON.stringify(environment)} (expected staging or production)`,
  );
  process.exit(2);
}

try {
  // A job scoped to `environment: staging` cannot read `production`'s
  // environment secrets to compare the two roots live, so each environment
  // carries the other's pin as its own `COUNTERPART_APP_ROOT` secret. Both
  // values are host paths, not credentials, and neither is printed here — a
  // refusal names the environment, never the path.
  const appRoot = assertAppRootGuard({
    environment,
    appRoot: process.env.APP_ROOT,
    counterpartAppRoot: process.env.COUNTERPART_APP_ROOT,
  });

  const { script } = buildHostApplyScript({
    nodevenvActivate: process.env.NODEVENV_ACTIVATE,
    appRoot,
    selectorAppKey: process.env.SELECTOR_APP_KEY,
  });

  process.stdout.write(script);
} catch (err) {
  if (err instanceof HostApplyRefusal) {
    console.error(`run-host-apply: refused - ${err.message}`);
    process.exit(1);
  }
  throw err;
}
