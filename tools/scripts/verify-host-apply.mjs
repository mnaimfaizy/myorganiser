#!/usr/bin/env node
// Grades the two Host Apply HTTP probes (ADR 0056 verify step, issue #567)
// from status codes the caller already fetched. The actual `curl` calls live
// in the workflow step — this script never performs network I/O, only the
// pass/fail decision, so the same grading logic runs under test without a
// live host.
//
//   node tools/scripts/verify-host-apply.mjs <docsStatus> <cronStatus>
//
// Exit 0 = both probes healthy. Exit 1 = a probe failed. Exit 2 = bad invocation.
import {
  HostApplyRefusal,
  assertHostApplyProbesHealthy,
} from './lib/host-apply.ts';

const [, , docsStatusArg, cronStatusArg] = process.argv;
const docsStatus = Number(docsStatusArg);
const cronStatus = Number(cronStatusArg);

if (!Number.isFinite(docsStatus) || !Number.isFinite(cronStatus)) {
  console.error(
    `verify-host-apply: expected two numeric status codes, got ${JSON.stringify(
      [docsStatusArg, cronStatusArg],
    )}`,
  );
  process.exit(2);
}

try {
  assertHostApplyProbesHealthy({ docsStatus, cronStatus });
  console.log('verify-host-apply: both probes healthy');
} catch (err) {
  if (err instanceof HostApplyRefusal) {
    console.error(`verify-host-apply: refused - ${err.message}`);
    process.exit(1);
  }
  throw err;
}
