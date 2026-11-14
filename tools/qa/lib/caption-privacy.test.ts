// Contracts for the caption privacy check (caption-privacy.ts): which Storyboard
// fields a denied value (an exact substring) or a Bearer/JWT (the redactor's own
// detection) makes refused, the names a refusal gives, and the withheld copy
// the step-records file keeps. Pure: no browser, disk or process starts here.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type CheckedField,
  WITHHELD_FIELD,
  captionFields,
  findCaptionLeaks,
  withholdLeaks,
} from './caption-privacy.ts';
import type { StepRecord } from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';
import type { RunContext } from './storyboard-context.ts';
import type { StoryboardInput, StoryboardSideInput } from './storyboard.ts';

// Obviously fake values, each under the 16-character fixture limit.
const PASSWORD = 'hunter2-fake';
const PASSPHRASE = 'qa-fake-phrase';
const SECRET = 'qa-fake-value';
const BEARER = 'Bearer qa-tok';
// A JWT shape built at runtime: a readable header prefix, two dotted segments.
const JWT = ['eyJ'.concat('a'.repeat(8)), 'b'.repeat(8), 'c2ln'].join('.');
const ALL_SECRETS = [PASSWORD, PASSPHRASE, SECRET];

const SHA_BEFORE = 'a'.repeat(40);
const SHA_AFTER = 'b'.repeat(40);

function stepOf(side: Side, index: number): StepRecord {
  return {
    side,
    index,
    device: 'Desktop',
    tab: 'Main',
    label: 'Device A',
    caption: `${side} caption ${index}`,
    still: `steps/S1/${side}/${String(index).padStart(2, '0')}.png`,
    subject: null,
    atMs: index * 100,
  };
}

/** A Storyboard whose every field is clean. */
function clean(): StoryboardInput {
  return {
    id: 'S1',
    title: 'Sign in shows the dashboard',
    expected: {
      before: 'the form shows an error',
      after: 'the dashboard shows',
    },
    result: 'PASS',
    commits: { before: SHA_BEFORE, after: SHA_AFTER },
    sides: {
      before: {
        outcome: 'fail',
        message: 'the form did not show an error',
        steps: [stepOf('before', 1), stepOf('before', 2), stepOf('before', 3)],
      },
      after: {
        outcome: 'pass',
        observed: 'the dashboard is shown',
        steps: [stepOf('after', 1), stepOf('after', 2), stepOf('after', 3)],
      },
    },
  };
}

function patchSide(
  input: StoryboardInput,
  side: Side,
  patch: Partial<StoryboardSideInput>,
): StoryboardInput {
  const run = input.sides[side];
  if (!run) throw new Error(`the fixture has no ${side} side`);
  return { ...input, sides: { ...input.sides, [side]: { ...run, ...patch } } };
}

function patchStep(
  input: StoryboardInput,
  side: Side,
  index: number,
  patch: Partial<StepRecord>,
): StoryboardInput {
  const run = input.sides[side];
  if (!run) throw new Error(`the fixture has no ${side} side`);
  return patchSide(input, side, {
    steps: run.steps.map((step) =>
      step.index === index ? { ...step, ...patch } : step,
    ),
  });
}

/** Each checked field, in reading order, with a setter that puts text in it. */
const FIELDS: [
  string,
  (input: StoryboardInput, text: string) => StoryboardInput,
][] = [
  ['S1 title', (input, text) => ({ ...input, title: text })],
  [
    'S1 expected after',
    (input, text) => ({
      ...input,
      expected: { ...input.expected, after: text },
    }),
  ],
  [
    'S1 expected before',
    (input, text) => ({
      ...input,
      expected: { ...input.expected, before: text },
    }),
  ],
  [
    'S1 before observed',
    (input, text) => patchSide(input, 'before', { observed: text }),
  ],
  [
    'S1 before message',
    (input, text) => patchSide(input, 'before', { message: text }),
  ],
  [
    'S1 before step 2 caption',
    (input, text) => patchStep(input, 'before', 2, { caption: text }),
  ],
  [
    'S1 after observed',
    (input, text) => patchSide(input, 'after', { observed: text }),
  ],
  [
    'S1 after message',
    (input, text) => patchSide(input, 'after', { message: text }),
  ],
  [
    'S1 after step 3 caption',
    (input, text) => patchStep(input, 'after', 3, { caption: text }),
  ],
  [
    'S1 after step 3 label',
    (input, text) => patchStep(input, 'after', 3, { label: text }),
  ],
  [
    'S1 after step 3 device',
    (input, text) => patchStep(input, 'after', 3, { device: text }),
  ],
  [
    'S1 after step 3 tab',
    (input, text) => patchStep(input, 'after', 3, { tab: text }),
  ],
];

describe('findCaptionLeaks names the field a denied value is in', () => {
  for (const [field, place] of FIELDS) {
    test(`a QA Account password in ${field} is refused by exactly that name`, () => {
      const input = place(clean(), PASSWORD);
      assert.deepEqual(findCaptionLeaks(input, ALL_SECRETS), [field]);
    });
  }

  test('the names of every leaking field come back in reading order, and none holds a secret value', () => {
    const everything = FIELDS.reduce(
      (input, [, place]) => place(input, PASSWORD),
      clean(),
    );
    const names = findCaptionLeaks(everything, ALL_SECRETS);
    assert.deepEqual(
      names,
      FIELDS.map(([field]) => field),
    );
    for (const name of names) {
      assert.equal(name.includes(PASSWORD), false, `${name} holds no value`);
    }
  });

  test('a clean Storyboard has no leaking field', () => {
    assert.deepEqual(findCaptionLeaks(clean(), ALL_SECRETS), []);
  });
});

describe('what is denied', () => {
  test('a QA Account password is refused wherever it sits inside a longer text', () => {
    const input = patchSide(clean(), 'after', {
      observed: `Typed ${PASSWORD} into the form`,
    });
    assert.deepEqual(findCaptionLeaks(input, ALL_SECRETS), [
      'S1 after observed',
    ]);
  });

  test('a vault passphrase is refused the same way', () => {
    const input = patchStep(clean(), 'after', 2, {
      caption: `Unlocked with ${PASSPHRASE}`,
    });
    assert.deepEqual(findCaptionLeaks(input, ALL_SECRETS), [
      'S1 after step 2 caption',
    ]);
  });

  test('a value passed to secret() is refused the same way', () => {
    const input = { ...clean(), title: `Shows ${SECRET} on screen` };
    assert.deepEqual(findCaptionLeaks(input, ALL_SECRETS), ['S1 title']);
  });

  test('a Bearer value is refused with no secret supplied', () => {
    const input = patchSide(clean(), 'before', {
      message: `Sent ${BEARER} and got a 401`,
    });
    assert.deepEqual(findCaptionLeaks(input, []), ['S1 before message']);
  });

  test('a JWT is refused with no secret supplied', () => {
    const input = patchSide(clean(), 'after', {
      observed: `The token was ${JWT}`,
    });
    assert.deepEqual(findCaptionLeaks(input, []), ['S1 after observed']);
  });

  test('an empty secret flags nothing, so a clean Storyboard stays clean', () => {
    assert.deepEqual(findCaptionLeaks(clean(), ['']), []);
  });

  test('an empty secret beside a real one still flags only the field holding the real one', () => {
    const input = { ...clean(), title: `Shows ${PASSWORD}` };
    assert.deepEqual(findCaptionLeaks(input, ['', PASSWORD]), ['S1 title']);
  });

  test('a case-changed secret is not flagged: the check is an exact substring', () => {
    const input = { ...clean(), title: PASSWORD.toUpperCase() };
    assert.deepEqual(findCaptionLeaks(input, [PASSWORD]), []);
  });
});

describe("findCaptionLeaks checks further fields the caller names, after the Storyboard's own", () => {
  /** A field a caller adds, as a `video` scenario's MP4 tab label is. */
  const label = (side: Side, text: string): CheckedField => ({
    field: `S1 video ${side} label`,
    text,
  });

  test('a leaking further field is reported by name, after the Storyboard fields', () => {
    const input = { ...clean(), title: `Shows ${PASSWORD}` };
    assert.deepEqual(
      findCaptionLeaks(input, ALL_SECRETS, [
        label('after', `Device B · tab ${PASSWORD}`),
      ]),
      ['S1 title', 'S1 video after label'],
    );
  });

  test('a clean further field adds nothing to a clean Storyboard', () => {
    assert.deepEqual(
      findCaptionLeaks(clean(), ALL_SECRETS, [
        label('before', 'Device B · tab B1'),
        label('after', 'Device B · tab B1'),
      ]),
      [],
    );
  });

  test('an empty list of further fields is the same check as the default', () => {
    const input = patchStep(clean(), 'after', 3, {
      caption: `Typed ${PASSWORD}`,
    });
    assert.deepEqual(findCaptionLeaks(input, ALL_SECRETS, []), [
      'S1 after step 3 caption',
    ]);
    assert.deepEqual(
      findCaptionLeaks(input, ALL_SECRETS, []),
      findCaptionLeaks(input, ALL_SECRETS),
    );
  });
});

describe('withholdLeaks replaces only the leaking fields', () => {
  test('each leaking field becomes [withheld], the others are unchanged, and the output holds no secret', () => {
    const leaking = patchSide(
      patchStep(clean(), 'after', 3, { caption: `Typed ${PASSWORD}` }),
      'before',
      { observed: `Got ${JWT}` },
    );
    assert.deepEqual(findCaptionLeaks(leaking, [PASSWORD]), [
      'S1 before observed',
      'S1 after step 3 caption',
    ]);

    const withheld = withholdLeaks(leaking, [PASSWORD]);

    assert.equal(withheld.sides.after?.steps[2].caption, '[withheld]');
    assert.equal(withheld.sides.before?.observed, '[withheld]');
    assert.equal(withheld.title, clean().title);
    assert.equal(withheld.sides.after?.steps[1].caption, 'after caption 2');
    assert.equal(withheld.sides.after?.observed, 'the dashboard is shown');
    assert.deepEqual(findCaptionLeaks(withheld, [PASSWORD]), []);
    assert.equal(JSON.stringify(withheld).includes(PASSWORD), false);
    assert.equal(JSON.stringify(withheld).includes(JWT), false);
  });

  test('a clean Storyboard comes back equal, and the input is not mutated', () => {
    const input = clean();
    assert.deepEqual(withholdLeaks(input, [PASSWORD]), clean());

    const leaking = { ...clean(), title: `Shows ${PASSWORD}` };
    withholdLeaks(leaking, [PASSWORD]);
    assert.equal(leaking.title, `Shows ${PASSWORD}`);
  });
});

describe('an After-only Storyboard: no before side and no expected.before', () => {
  /** A clean After-only Storyboard: sides and expected carry no `before`. */
  function afterOnly(): StoryboardInput {
    const full = clean();
    return {
      id: full.id,
      title: full.title,
      expected: { after: full.expected.after },
      result: full.result,
      commits: full.commits,
      sides: { after: full.sides.after },
    };
  }

  test('a password in S1 after step 1 caption is refused by exactly that name', () => {
    const input = patchStep(afterOnly(), 'after', 1, {
      caption: `Typed ${PASSWORD}`,
    });
    assert.deepEqual(findCaptionLeaks(input, ALL_SECRETS), [
      'S1 after step 1 caption',
    ]);
  });

  test('withholdLeaks keeps the After-only shape: no expected.before and no sides.before, and only the leaking caption withheld', () => {
    const input = patchStep(afterOnly(), 'after', 1, {
      caption: `Typed ${PASSWORD}`,
    });
    const withheld = withholdLeaks(input, [PASSWORD]);

    assert.equal('before' in withheld.expected, false);
    assert.deepEqual(Object.keys(withheld.sides), ['after']);
    assert.deepEqual(
      withheld,
      patchStep(afterOnly(), 'after', 1, { caption: '[withheld]' }),
    );
  });
});

describe('a run context on the band: its account ids, devices and tabs are checked by name (#1558)', () => {
  /** A run context: one account, two devices, two tabs. */
  const CONTEXT: RunContext = {
    changeKind: 'fix',
    accounts: ['primary'],
    devices: ['A', 'B'],
    tabs: ['B1', 'B2'],
  };
  /** A clean Storyboard that names the given run context. */
  const withContextOf = (context: RunContext): StoryboardInput => ({
    ...clean(),
    context,
  });
  const withContext = (): StoryboardInput => withContextOf(CONTEXT);

  test('captionFields names each account, device and tab of the band, after the expected results and before the sides', () => {
    const fields = captionFields(withContext()).map(({ field, text }) => ({
      field,
      text,
    }));
    const band = fields.filter(({ field }) => field.includes(' band '));
    assert.deepEqual(band, [
      { field: 'S1 band account 1', text: 'primary' },
      { field: 'S1 band device 1', text: 'A' },
      { field: 'S1 band device 2', text: 'B' },
      { field: 'S1 band tab 1', text: 'B1' },
      { field: 'S1 band tab 2', text: 'B2' },
    ]);
    const position = (field: string) =>
      fields.findIndex((entry) => entry.field === field);
    const firstBand = position('S1 band account 1');
    assert.ok(position('S1 expected after') < firstBand, 'after expected');
    assert.ok(firstBand < position('S1 before message'), 'before the sides');
  });

  test('a Storyboard with no context has no band field', () => {
    assert.equal(
      captionFields(clean()).some(({ field }) => field.includes(' band ')),
      false,
    );
  });

  test('a QA Account password, device or tab name is refused by exactly that band field name', () => {
    const cases: [string, RunContext][] = [
      ['S1 band account 1', { ...CONTEXT, accounts: [PASSWORD] }],
      ['S1 band device 2', { ...CONTEXT, devices: ['A', PASSWORD] }],
      ['S1 band tab 1', { ...CONTEXT, tabs: [PASSPHRASE, 'B2'] }],
    ];
    for (const [field, context] of cases) {
      assert.deepEqual(
        findCaptionLeaks(withContextOf(context), ALL_SECRETS),
        [field],
        field,
      );
    }
  });

  test('a Bearer value in a device name is refused with no secret supplied, by its band field name', () => {
    const input = withContextOf({ ...CONTEXT, devices: ['A', BEARER] });
    assert.deepEqual(findCaptionLeaks(input, []), ['S1 band device 2']);
  });

  test('withholdLeaks replaces only the leaking context entries with [withheld], keeps the rest, and the output holds no secret', () => {
    const leaking: StoryboardInput = {
      ...withContext(),
      context: {
        changeKind: 'fix',
        accounts: ['primary'],
        devices: ['A', PASSWORD],
        tabs: ['B1', PASSPHRASE],
      },
    };
    assert.deepEqual(findCaptionLeaks(leaking, ALL_SECRETS), [
      'S1 band device 2',
      'S1 band tab 2',
    ]);

    const withheld = withholdLeaks(leaking, ALL_SECRETS);

    assert.deepEqual(withheld.context, {
      changeKind: 'fix',
      accounts: ['primary'],
      devices: ['A', WITHHELD_FIELD],
      tabs: ['B1', WITHHELD_FIELD],
    });
    assert.deepEqual(findCaptionLeaks(withheld, ALL_SECRETS), []);
    assert.equal(JSON.stringify(withheld).includes(PASSWORD), false);
    assert.equal(JSON.stringify(withheld).includes(PASSPHRASE), false);
  });

  test('withholdLeaks leaves a clean context equal, and a Storyboard with no context has no context key', () => {
    assert.deepEqual(
      withholdLeaks(withContext(), ALL_SECRETS).context,
      withContext().context,
    );
    assert.equal('context' in withholdLeaks(clean(), ALL_SECRETS), false);
  });
});
