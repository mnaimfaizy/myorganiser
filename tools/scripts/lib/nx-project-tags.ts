/**
 * Project tag discipline: every Nx project carries exactly one tag from each
 * dimension in `tools/config/nx-project-tags.json`, and nothing else in the
 * `<dimension>:` namespace. Consumed by `check-nx-project-tags.mjs`.
 *
 * Why a gate rather than a convention: `@nx/enforce-module-boundaries` only
 * constrains projects whose tags match a constraint. An untagged project
 * matches nothing and may import anything, so "add tags to the new lib" is
 * exactly the kind of instruction that decays. The Review Tier classifier
 * (ADR 0070) treats a missing `tier:*` as `human`, which is safe but hides
 * that the tag was forgotten.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const NX_PROJECT_TAGS_CONFIG_PATH = join(
  'tools',
  'config',
  'nx-project-tags.json',
);

export type TagVocabulary = Record<string, string[]>;

interface RawNxProjectTagsConfig {
  schemaVersion: number;
  dimensions: Record<string, Record<string, unknown>>;
}

export const loadTagVocabulary = (
  path: string = NX_PROJECT_TAGS_CONFIG_PATH,
): TagVocabulary => {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawNxProjectTagsConfig;
  if (raw.schemaVersion !== 1)
    throw new Error(`${path}: unsupported schemaVersion ${raw.schemaVersion}`);
  return Object.fromEntries(
    Object.entries(raw.dimensions).map(([dim, values]) => [
      dim,
      Object.keys(values),
    ]),
  );
};

export interface NxProjectTagInput {
  name: string;
  path: string;
  tags?: string[];
}

/** @returns findings, empty when every project is well-tagged */
export const assertProjectTags = (
  projects: readonly NxProjectTagInput[],
  vocabulary: TagVocabulary,
): string[] => {
  const findings: string[] = [];
  const dimensions = Object.keys(vocabulary);
  for (const p of projects) {
    const tags = Array.isArray(p.tags) ? p.tags : [];
    for (const dim of dimensions) {
      const prefix = `${dim}:`;
      const present = tags.filter((t) => t.startsWith(prefix));
      if (present.length === 0) {
        findings.push(`${p.path}: missing a ${dim}:* tag`);
        continue;
      }
      if (present.length > 1) {
        findings.push(
          `${p.path}: more than one ${dim}:* tag (${present.join(', ')})`,
        );
      }
      for (const tag of present) {
        const value = tag.slice(prefix.length);
        if (!vocabulary[dim].includes(value))
          findings.push(
            `${p.path}: "${tag}" is not in the vocabulary (${dim}: ${vocabulary[dim].join(', ')})`,
          );
      }
    }
    for (const tag of tags) {
      const dim = tag.split(':')[0];
      if (!dimensions.includes(dim))
        findings.push(
          `${p.path}: "${tag}" uses an unknown dimension (known: ${dimensions.join(', ')})`,
        );
    }
  }
  return findings;
};
