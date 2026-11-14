// Contracts for the run context a Storyboard's band names (#1558), through
// storyboard-context.ts's exports: what a run's context holds (its change kind,
// QA Account ids, devices and tabs), which saved values count as a context, the
// names a caption check gives each string, and the wording of the band's line.
// Pure: no browser, disk or process starts here.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type RunContext,
  contextFields,
  contextLine,
  isRunContext,
  runContext,
} from './storyboard-context.ts';

/** A step on `device`'s `tab`, as far as the context reads it. */
const at = (device: string, tab: string) => ({ device, tab });

/** A context written out in full, for the tests that read a saved one. */
const CONTEXT: RunContext = {
  changeKind: 'fix',
  accounts: ['primary'],
  devices: ['A', 'B'],
  tabs: ['B1', 'B2'],
};

describe('runContext: what a run names', () => {
  test('the account ids are de-duplicated and sorted, and the devices and tabs are de-duplicated in the order they first appear', () => {
    const context = runContext(
      'fix',
      ['secondary', 'primary', 'secondary'],
      [at('A', 'B1'), at('B', 'B2'), at('A', 'B1'), at('B', 'B1')],
    );
    assert.deepEqual(context, {
      changeKind: 'fix',
      accounts: ['primary', 'secondary'],
      devices: ['A', 'B'],
      tabs: ['B1', 'B2'],
    });
  });

  test('a run with no steps and no account names no device, tab or account', () => {
    assert.deepEqual(runContext('feature', [], []), {
      changeKind: 'feature',
      accounts: [],
      devices: [],
      tabs: [],
    });
  });

  test('the change kind is kept as given', () => {
    assert.equal(runContext('feature', ['primary'], []).changeKind, 'feature');
  });
});

describe('isRunContext: what a saved context must look like to be read', () => {
  test('a well-formed context is accepted, whatever its lists hold', () => {
    assert.equal(isRunContext(CONTEXT), true);
    assert.equal(
      isRunContext({
        changeKind: 'feature',
        accounts: [],
        devices: [],
        tabs: [],
      }),
      true,
    );
  });

  test('a value that is not an object, or is an array, is refused', () => {
    for (const value of [null, undefined, 'fix', 3, []]) {
      assert.equal(isRunContext(value), false, JSON.stringify(value));
    }
  });

  test('a change kind other than fix or feature is refused', () => {
    assert.equal(isRunContext({ ...CONTEXT, changeKind: 'refactor' }), false);
    assert.equal(isRunContext({ ...CONTEXT, changeKind: undefined }), false);
  });

  test('a list that is missing, is not a list, or holds a non-text item is refused', () => {
    for (const bad of [
      { accounts: undefined },
      { accounts: 'primary' },
      { devices: [1] },
      { tabs: [null] },
      { tabs: 'B1' },
    ]) {
      assert.equal(
        isRunContext({ ...CONTEXT, ...bad }),
        false,
        JSON.stringify(bad),
      );
    }
  });
});

describe('contextFields: each string a caption check reads, with its name', () => {
  test('accounts, devices and tabs are named by their position, in that order', () => {
    assert.deepEqual(
      contextFields({
        changeKind: 'fix',
        accounts: ['primary', 'secondary'],
        devices: ['A', 'B'],
        tabs: ['B1'],
      }),
      [
        { name: 'account 1', text: 'primary' },
        { name: 'account 2', text: 'secondary' },
        { name: 'device 1', text: 'A' },
        { name: 'device 2', text: 'B' },
        { name: 'tab 1', text: 'B1' },
      ],
    );
  });

  test('the change kind is not a checked field: it is a fixed word of the band', () => {
    const names = contextFields(CONTEXT).map(({ name }) => name);
    assert.equal(
      names.some((name) => name.includes('change')),
      false,
    );
  });
});

describe('contextLine: the words the band says of the run', () => {
  test('a fix on devices A and B with tabs B1 and B2 names the account, the devices and the tabs', () => {
    assert.equal(
      contextLine(CONTEXT),
      'Fix · QA Account primary · devices A, B (tabs B1, B2)',
    );
  });

  test('tabs that are only the devices own names (A and B on devices A and B) are omitted', () => {
    const context = runContext(
      'fix',
      ['primary'],
      [at('A', 'A'), at('B', 'B')],
    );
    assert.equal(
      contextLine(context),
      'Fix · QA Account primary · devices A, B',
    );
  });

  test('a tab that is not a device name is named after the devices, even when the tab count equals the device count', () => {
    const context = runContext(
      'fix',
      ['primary'],
      [at('A', 'A'), at('B', 'B1')],
    );
    assert.equal(
      contextLine(context),
      'Fix · QA Account primary · devices A, B (tabs A, B1)',
    );
  });

  test('every tab of the run is named, in first-seen order, when one of them is not a device name', () => {
    const context = runContext(
      'fix',
      ['primary'],
      [at('A', 'A1'), at('B', 'B1'), at('B', 'B2')],
    );
    assert.equal(
      contextLine(context),
      'Fix · QA Account primary · devices A, B (tabs A1, B1, B2)',
    );
  });

  test('two accounts are named in the plural, sorted', () => {
    assert.equal(
      contextLine({ ...CONTEXT, accounts: ['primary', 'secondary'] }),
      'Fix · QA Accounts primary, secondary · devices A, B (tabs B1, B2)',
    );
  });

  test('a feature is named Feature', () => {
    assert.equal(
      contextLine({ ...CONTEXT, changeKind: 'feature' }),
      'Feature · QA Account primary · devices A, B (tabs B1, B2)',
    );
  });

  test('a run that stayed on the lone default device A and its one tab omits the devices and tabs', () => {
    const context = runContext(
      'fix',
      ['primary'],
      [at('A', 'A'), at('A', 'A')],
    );
    assert.equal(contextLine(context), 'Fix · QA Account primary');
  });

  test('a run with no account omits the account segment', () => {
    const context = runContext('fix', [], [at('A', 'A')]);
    assert.equal(contextLine(context), 'Fix');
  });

  test('a lone device A with a tab of its own name shows that tab in the device segment', () => {
    const context = runContext('fix', ['primary'], [at('A', 'A1')]);
    assert.equal(
      contextLine(context),
      'Fix · QA Account primary · device A (tabs A1)',
    );
  });

  test('a lone device A whose tabs include a tab that is not its name shows every tab', () => {
    const context = runContext(
      'fix',
      ['primary'],
      [at('A', 'A'), at('A', 'A1')],
    );
    assert.equal(
      contextLine(context),
      'Fix · QA Account primary · device A (tabs A, A1)',
    );
  });

  test('a lone device A whose only tab is its name shows no device and no tab', () => {
    const context = runContext('fix', ['primary'], [at('A', 'A')]);
    assert.equal(contextLine(context), 'Fix · QA Account primary');
  });

  test('tabs with no device name the band line as tabs alone, and isRunContext still accepts that context', () => {
    const context: RunContext = {
      changeKind: 'fix',
      accounts: [],
      devices: [],
      tabs: ['B1', 'B2'],
    };
    assert.equal(isRunContext(context), true);
    assert.equal(contextLine(context), 'Fix · tabs B1, B2');
  });

  test('a run that stayed on one device other than A names that device and its tab', () => {
    const context = runContext('feature', [], [at('B', 'B1')]);
    assert.equal(contextLine(context), 'Feature · device B (tabs B1)');
  });

  test('three devices and four tabs name all three devices and every tab', () => {
    const context = runContext(
      'fix',
      ['primary', 'secondary'],
      [
        at('A', 'A1'),
        at('B', 'B1'),
        at('B', 'B2'),
        at('C', 'C1'),
        at('A', 'A1'),
      ],
    );
    assert.equal(
      contextLine(context),
      'Fix · QA Accounts primary, secondary · devices A, B, C (tabs A1, B1, B2, C1)',
    );
  });
});
