import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RULE_CATALOGUE_SCHEMA_VERSION,
  RULE_FAMILIES,
  RuleCatalogueError,
  assertRuleCatalogue,
  familyOf,
  loadRuleCatalogue,
  ruleById,
  ruleIds,
} from './rules.ts';
import { FINDING_AXES, FINDING_SEVERITIES } from './schema.ts';

const rule = (over = {}) => ({
  id: 'standard-example',
  family: 'standard',
  title: 'An example rule',
  axes: ['standards'],
  cites: 'AGENTS.md',
  ...over,
});

const catalogue = (rules) => ({
  schemaVersion: RULE_CATALOGUE_SCHEMA_VERSION,
  rules,
});

const rejects = (cat, fragment) =>
  assert.throws(
    () => assertRuleCatalogue(cat, 'fixture'),
    (err) => {
      assert.ok(err instanceof RuleCatalogueError);
      assert.match(err.message, fragment);
      return true;
    },
  );

test('a well-formed catalogue is returned unchanged', () => {
  const cat = catalogue([rule()]);
  assert.equal(assertRuleCatalogue(cat, 'fixture'), cat);
});

test('the schema version is pinned', () => {
  rejects(
    { ...catalogue([rule()]), schemaVersion: 99 },
    /unsupported schemaVersion 99/,
  );
  rejects(catalogue([]), /rules must be a non-empty array/);
});

test('ids are unique lowercase slugs that announce their own family', () => {
  rejects(catalogue([rule({ id: 'Standard-Example' })]), /lowercase slug/);
  rejects(catalogue([rule(), rule()]), /duplicate rule id standard-example/);
  // Each brief file lists its axis's ids in prose and the gate scans that
  // prose for them by prefix, so an id that hides its family is a gate
  // that quietly stops matching.
  rejects(
    catalogue([rule({ id: 'example-thing' })]),
    /id must start with "standard-"/,
  );
  rejects(catalogue([rule({ family: 'vibes' })]), /family must be one of/);
});

test('a rule names at least one axis, and names each one once', () => {
  rejects(catalogue([rule({ axes: [] })]), /axes must name at least one axis/);
  rejects(
    catalogue([rule({ axes: ['standards', 'standards'] })]),
    /duplicate axes/,
  );
});

test('a smell declares its cap and a standard cites its document', () => {
  rejects(
    catalogue([rule({ id: 'smell-x', family: 'smell', cites: undefined })]),
    /caps at should-fix and must say so/,
  );
  rejects(
    catalogue([rule({ cites: undefined })]),
    /must cite the document that holds it/,
  );
});

test('a family falls back at most once', () => {
  rejects(
    catalogue([
      rule({ id: 'standard-a', fallback: true }),
      rule({ id: 'standard-b', fallback: true }),
    ]),
    /standard already falls back to standard-a/,
  );
  rejects(catalogue([rule({ fallback: false })]), /either true or absent/);
});

test('familyOf reads the family off the id, and misses when there is none', () => {
  assert.equal(familyOf('smell-middle-man'), 'smell');
  assert.equal(familyOf('reach-through-shared-value-removed'), 'reach-through');
  assert.equal(familyOf('nothing'), undefined);
});

// The shipped catalogue, not a fixture: these are the invariants the finding
// contract leans on at parse time, and a broken one rejects real reports.
test('the shipped catalogue is loadable and every family is represented', () => {
  const cat = loadRuleCatalogue();
  const families = new Set(cat.rules.map((r) => r.family));
  for (const family of RULE_FAMILIES)
    assert.ok(families.has(family), `no ${family} rule in the catalogue`);
  assert.equal(new Set(ruleIds()).size, ruleIds().length);
});

test('every shipped rule speaks the finding contract vocabulary', () => {
  for (const r of loadRuleCatalogue().rules) {
    for (const axis of r.axes)
      assert.ok(FINDING_AXES.includes(axis), `${r.id}: unknown axis ${axis}`);
    if (r.maxSeverity)
      assert.ok(
        FINDING_SEVERITIES.includes(r.maxSeverity),
        `${r.id}: unknown severity ${r.maxSeverity}`,
      );
  }
});

test('ruleById resolves a shipped id and nothing else', () => {
  assert.equal(ruleById('smell-mysterious-name').family, 'smell');
  assert.equal(ruleById('spec-requirement-missing').axes.join(), 'spec');
  assert.equal(ruleById('standard-other').fallback, true);
  assert.equal(ruleById('no-such-rule'), undefined);
});
