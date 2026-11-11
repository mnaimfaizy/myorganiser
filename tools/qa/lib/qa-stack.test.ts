// Contracts for the local QA stack's pure rules (ADR 0147 decisions 2 and 9),
// exercised through qa-stack.ts's public exports. Every fact is passed in;
// the only reads are the committed `.env.example`, `docker-compose.yml`, and
// `.claude/launch.json` at the repo root, to pin values the stack depends on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import { localDatabaseRefusal } from '../../scripts/lib/qa-accounts.ts';
import {
  NEXT_DEV_REWRITE,
  QA_STACK,
  SERVICE_PORT,
  buildQaEnv,
  composeDatabaseImage,
  portRefusal,
  qaContainerDatabaseUrl,
  renderEnvFile,
  servedCommitProblems,
  stackDatabaseRefusal,
  uncommittedPaths,
  worktreeRefusal,
  type ServedCommitFacts,
} from './qa-stack.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const LOCAL_URL = 'postgresql://qa:qa-local-only@127.0.0.1:5499/myorganiser_qa';

describe('stackDatabaseRefusal', () => {
  const REFUSED: readonly {
    name: string;
    env: Record<string, string | undefined>;
    message: RegExp;
  }[] = [
    {
      name: 'a non-local host',
      env: {
        DATABASE_URL: 'postgresql://qa:qa-local-only@db.example.com:5499/x',
        NODE_ENV: 'development',
      },
      message: /db\.example\.com/,
    },
    {
      name: 'NODE_ENV production',
      env: { DATABASE_URL: LOCAL_URL, NODE_ENV: 'production' },
      message: /NODE_ENV is production/,
    },
    {
      name: 'an unset DATABASE_URL',
      env: { NODE_ENV: 'development' },
      message: /DATABASE_URL is not set/,
    },
    {
      name: 'a host query parameter',
      env: {
        DATABASE_URL: `${LOCAL_URL}?host=db.example.com`,
        NODE_ENV: 'development',
      },
      message: /carries a host parameter/,
    },
  ];

  test('accepts a local URL under NODE_ENV development', () => {
    assert.equal(
      stackDatabaseRefusal({
        DATABASE_URL: LOCAL_URL,
        NODE_ENV: 'development',
      }),
      null,
    );
  });

  for (const { name, env, message } of REFUSED) {
    test(`refuses ${name}`, () => {
      const refusal = stackDatabaseRefusal(env);
      assert.notEqual(refusal, null);
      assert.match(refusal ?? '', message);
    });
  }

  test('agrees with localDatabaseRefusal for the same input, so the rule is reused, not copied', () => {
    const inputs = [
      { DATABASE_URL: LOCAL_URL, NODE_ENV: 'development' },
      ...REFUSED.map(({ env }) => env),
    ];
    for (const env of inputs) {
      assert.equal(
        stackDatabaseRefusal(env),
        localDatabaseRefusal({
          databaseUrl: env.DATABASE_URL,
          nodeEnv: env.NODE_ENV,
        }),
      );
    }
  });
});

describe('buildQaEnv', () => {
  const ENV_EXAMPLE = [
    '# a comment line',
    'ACCESS_JWT_SECRET=',
    'YOUTUBE_CRON_SECRET=keep',
    'PORT=3000',
    'CORS_ORIGINS=http://localhost:4200',
    'GOOGLE_REDIRECT_URI=http://localhost:4200/dashboard/youtube/callback',
    'OTHER=http://localhost:3000/x',
  ].join('\n');

  test('fills blank secrets, keeps pre-filled ones, and points ports, origins, API and database at the stack', () => {
    let calls = 0;
    const databaseUrl = qaContainerDatabaseUrl('qa-local-only');
    const env = buildQaEnv({
      envExample: ENV_EXAMPLE,
      databaseUrl,
      generateSecret: () => `generated-${++calls}`,
    });

    assert.equal(env.ACCESS_JWT_SECRET, 'generated-1');
    assert.equal(env.YOUTUBE_CRON_SECRET, 'keep');
    // Five blank generated keys are absent from the example; the pre-filled one is not generated.
    assert.equal(calls, 5);

    assert.equal(env.PORT, '3300');
    assert.equal(env.APP_FRONTEND_URL, 'http://localhost:4300');
    assert.equal(env.CORS_ORIGINS, 'http://localhost:4300');
    assert.equal(env.API_BASE_URL, 'http://localhost:3300/api/v1');
    assert.equal(env.NEXT_PUBLIC_API_BASE_URL, 'http://localhost:3300/api/v1');
    assert.equal(env.NODE_ENV, 'development');
    assert.equal(env.DATABASE_URL, databaseUrl);

    // Local origins in any other key are moved to the QA ports too.
    assert.equal(
      env.GOOGLE_REDIRECT_URI,
      'http://localhost:4300/dashboard/youtube/callback',
    );
    assert.equal(env.OTHER, 'http://localhost:3300/x');

    const nonKeys = Object.keys(env).filter(
      (key) => !/^[A-Z][A-Z0-9_]*$/.test(key),
    );
    assert.deepEqual(nonKeys, []);
  });

  test('built from the real .env.example with a container URL, the database is accepted and no value points at the Maintainer ports 4200, 3000 or 5453', () => {
    const envExample = readFileSync(join(REPO, '.env.example'), 'utf8');
    const env = buildQaEnv({
      envExample,
      databaseUrl: qaContainerDatabaseUrl('qa-local-only'),
      generateSecret: () => 'generated',
    });

    assert.equal(stackDatabaseRefusal(env), null);
    for (const [key, value] of Object.entries(env)) {
      for (const port of [':4200', ':3000', ':5453']) {
        assert.ok(!value.includes(port), `${key} contains ${port}`);
      }
    }
  });
});

test('renderEnvFile writes a header and sorted export lines, and escapes a single quote in a value', () => {
  assert.equal(
    renderEnvFile({ B: '2', A: "it's" }),
    "# Generated by yarn qa:stack:start. Local only; never commit.\nexport A='it'\\''s'\nexport B='2'\n",
  );
});

describe('worktreeRefusal', () => {
  test('refuses the primary checkout, with or without a trailing slash', () => {
    for (const gitDir of ['/r/.git', '/r/.git/']) {
      const refusal = worktreeRefusal({
        gitDir,
        gitCommonDir: '/r/.git',
        statusPorcelain: '',
      });
      assert.match(refusal ?? '', /primary checkout/, gitDir);
    }
  });

  const ALLOWED: readonly { name: string; statusPorcelain: string }[] = [
    { name: 'a clean linked worktree', statusPorcelain: '' },
    {
      name: 'a linked worktree whose only change is the next dev rewrite',
      statusPorcelain: ` M ${NEXT_DEV_REWRITE}\n`,
    },
  ];

  for (const { name, statusPorcelain } of ALLOWED) {
    test(`allows ${name}`, () => {
      assert.equal(
        worktreeRefusal({
          gitDir: '/r/.git/worktrees/x',
          gitCommonDir: '/r/.git',
          statusPorcelain,
        }),
        null,
      );
    });
  }

  test('refuses a linked worktree with uncommitted changes, naming both paths', () => {
    const refusal = worktreeRefusal({
      gitDir: '/r/.git/worktrees/x',
      gitCommonDir: '/r/.git',
      statusPorcelain: ' M src/a.ts\n?? new.txt\n',
    });
    assert.match(refusal ?? '', /src\/a\.ts/);
    assert.match(refusal ?? '', /new\.txt/);
  });
});

test('uncommittedPaths drops exactly the next dev rewrite and nothing else', () => {
  assert.deepEqual(
    uncommittedPaths(
      ` M ${NEXT_DEV_REWRITE}\n M src/a.ts\n?? new.txt\n M ${NEXT_DEV_REWRITE}.bak\n`,
    ),
    ['src/a.ts', 'new.txt', `${NEXT_DEV_REWRITE}.bak`],
  );
});

describe('portRefusal', () => {
  test('allows the stack when no listed port has a listener', () => {
    assert.equal(
      portRefusal({ [QA_STACK.backendPort]: null, [QA_STACK.webPort]: null }),
      null,
    );
  });

  test('refuses when a port is taken, naming the port and its pid, and never stopping what it did not start', () => {
    const refusal = portRefusal({
      [QA_STACK.backendPort]: 4242,
      [QA_STACK.webPort]: null,
    });
    assert.match(refusal ?? '', /3300 \(pid 4242\)/);
    assert.match(refusal ?? '', /never stops what it did not start/);
  });
});

function passingFacts(): ServedCommitFacts {
  const expected = 'e4f5a6b7';
  return {
    expected,
    worktreeHead: expected,
    statusPorcelain: ` M ${NEXT_DEV_REWRITE}\n`,
    services: {
      backend: {
        record: {
          pgid: 101,
          spawnCommit: expected,
          port: SERVICE_PORT.backend,
        },
        alive: true,
        listenerPgid: 101,
      },
      web: {
        record: { pgid: 202, spawnCommit: expected, port: SERVICE_PORT.web },
        alive: true,
        listenerPgid: 202,
      },
    },
  };
}

describe('servedCommitProblems', () => {
  test('reports no problem for a worktree at the expected commit with both services serving it', () => {
    assert.deepEqual(servedCommitProblems(passingFacts()), []);
  });

  const BROKEN: readonly {
    name: string;
    change: (facts: ServedCommitFacts) => void;
    message: RegExp;
  }[] = [
    {
      name: 'a worktree HEAD that differs',
      change: (facts) => {
        facts.worktreeHead = 'ffffff0';
      },
      message: /the worktree is at ffffff0, not e4f5a6b7/,
    },
    {
      name: 'a dirty status other than the next dev rewrite',
      change: (facts) => {
        facts.statusPorcelain = ' M src/a.ts\n';
      },
      message: /uncommitted changes \(src\/a\.ts\)/,
    },
    {
      name: 'a backend process that is not alive',
      change: (facts) => {
        facts.services.backend.alive = false;
      },
      message: /backend \(process group 101\) is not running/,
    },
    {
      name: 'nothing listening on the web port',
      change: (facts) => {
        facts.services.web.listenerPgid = null;
      },
      message: /nothing listens on web's port 4300/,
    },
    {
      name: 'the web port served by another process group',
      change: (facts) => {
        facts.services.web.listenerPgid = 999;
      },
      message: /served by process group 999, not 202/,
    },
    {
      name: 'a backend started at another commit',
      change: (facts) => {
        facts.services.backend.record = {
          pgid: 101,
          spawnCommit: 'deadbee',
          port: SERVICE_PORT.backend,
        };
      },
      message: /backend was started at deadbee, not e4f5a6b7/,
    },
    {
      name: 'a service with no recorded process',
      change: (facts) => {
        facts.services.web.record = undefined;
      },
      message: /web has no recorded process/,
    },
  ];

  for (const { name, change, message } of BROKEN) {
    test(`reports exactly one problem for ${name}`, () => {
      const facts = passingFacts();
      change(facts);
      const problems = servedCommitProblems(facts);
      assert.equal(problems.length, 1, problems.join('; '));
      assert.match(problems[0], message);
    });
  }
});

describe('composeDatabaseImage', () => {
  test('returns the digest-pinned bitnami PostgreSQL image from the real docker-compose.yml', () => {
    const compose = readFileSync(join(REPO, 'docker-compose.yml'), 'utf8');
    assert.match(
      composeDatabaseImage(compose) ?? '',
      /^bitnami\/postgresql@sha256:[0-9a-f]{64}$/,
    );
  });

  test('returns null when there is no myorganiser_db service', () => {
    assert.equal(
      composeDatabaseImage('services:\n  other:\n    image: nginx:1\n'),
      null,
    );
  });
});

test('the qa-web attach configuration has no runtime executable and attaches to the stack web port, not 4200', () => {
  const launch = JSON.parse(
    readFileSync(join(REPO, '.claude', 'launch.json'), 'utf8'),
  ) as {
    configurations: {
      name: string;
      url?: string;
      runtimeExecutable?: string;
    }[];
  };
  const config = launch.configurations.find(({ name }) => name === 'qa-web');
  assert.ok(config, 'expected a qa-web configuration');
  assert.equal(config.runtimeExecutable, undefined);
  assert.ok(config.url, 'expected a url to attach to');
  const port = new URL(config.url).port;
  assert.equal(port, String(QA_STACK.webPort));
  assert.equal(Number(port), SERVICE_PORT.web);
  assert.notEqual(port, '4200');
});
