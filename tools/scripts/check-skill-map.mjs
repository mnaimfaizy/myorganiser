#!/usr/bin/env node
// Asserts that docs/agents/skill-atlas.html still describes the skill system it claims to.
//
//   node tools/scripts/check-skill-map.mjs
//
// The atlas is a hand-designed page, so its layout and edge classifications cannot be
// generated. What can be checked is everything it asserts about the filesystem: the embedded
// #skill-atlas-manifest block must agree with .agents/skills, .github/agents and AGENTS.md,
// and — the check that matters most — every tooltip description must still be byte-identical
// to the `description:` in the skill's own frontmatter. That string is the exact text the
// model matches when deciding whether to load a skill, so a paraphrase on the page is a page
// that misreports routing.
//
// Two classes of assertion live here, and they fail differently:
//
//   DERIVED    — recomputed from source on every run. Drift is a hard failure.
//   REVIEWED   — a human classified something the filesystem cannot decide on its own (which
//                cross-reference is a prohibition vs a handoff; which substring match is a
//                real delegation). These cannot be recomputed, so instead the script watches
//                the *inputs* to that judgement and fails when they move, asking for a
//                re-review rather than silently trusting a stale classification.
//
// Exit 0 = in sync. Exit 1 = drift (fix the page). Exit 2 = the check could not run.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = 'docs/agents/skill-atlas.html';
const SKILLS_DIR = '.agents/skills';
const AGENTS_DIR = '.github/agents';
const AGENTS_MIRROR = '.claude/agents';
const AGENTS_MD = 'AGENTS.md';
const EXTERNAL_MD = join(SKILLS_DIR, 'EXTERNAL_SKILLS.md');
const SKILLS_LOCK = 'skills-lock.json';

const fail = (msg) => {
  console.error(`skill-map: ${msg}`);
  process.exit(2);
};

for (const p of [
  PAGE,
  SKILLS_DIR,
  AGENTS_DIR,
  AGENTS_MD,
  EXTERNAL_MD,
  SKILLS_LOCK,
]) {
  if (!existsSync(p)) fail(`${p} not found`);
}

const page = readFileSync(PAGE, 'utf8');
const findings = [];
const note = (msg) => findings.push(msg);

// ── Manifest ────────────────────────────────────────────────────────────────
const manifestRaw = page.match(
  /<script type="application\/json" id="skill-atlas-manifest">([\s\S]*?)<\/script>/,
);
if (!manifestRaw) fail(`no #skill-atlas-manifest block in ${PAGE}`);

let manifest;
try {
  manifest = JSON.parse(manifestRaw[1]);
} catch (err) {
  fail(`#skill-atlas-manifest is not valid JSON: ${err.message}`);
}

// ── Frontmatter ─────────────────────────────────────────────────────────────
// No YAML dependency in this repo, and the atlas only needs two scalars. Supports the four
// shapes actually used across .agents/skills: bare, quoted, `|` literal and `>-` folded.
function frontmatter(src) {
  if (!src.startsWith('---')) return null; // no block at all — a finding, not an error
  const end = src.indexOf('\n---', 3);
  if (end === -1) return null;
  const body = src.slice(3, end);
  const out = {};
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, rest] = m;
    if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      const folded = rest.startsWith('>');
      const block = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() !== '' && !/^\s{2,}/.test(lines[j])) break;
        block.push(lines[j].replace(/^ {2}/, ''));
      }
      i = j - 1;
      while (block.length && block[block.length - 1].trim() === '') block.pop();
      // Folded scalars join on single newlines and keep blank lines as paragraph breaks.
      out[key] = folded
        ? block
            .join('\n')
            .split(/\n{2,}/)
            .map((p) => p.split('\n').join(' ').trim())
            .join('\n\n')
        : block.join('\n');
    } else {
      out[key] = rest.replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return out;
}

const skillDirs = readdirSync(SKILLS_DIR)
  .filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory())
  .sort();

const skills = skillDirs.map((dir) => {
  const p = join(SKILLS_DIR, dir, 'SKILL.md');
  if (!existsSync(p)) fail(`${dir} has no SKILL.md`);
  const src = readFileSync(p, 'utf8');
  const fm = frontmatter(src);
  return {
    dir,
    fm,
    description: fm?.description ?? null,
    human: fm?.['disable-model-invocation'] === 'true',
  };
});

// ── DERIVED: node inventory ─────────────────────────────────────────────────
const eq = (label, actual, claimed) => {
  if (actual !== claimed)
    note(`${label}: source says ${actual}, page says ${claimed}`);
};
const eqList = (label, actual, claimed) => {
  const a = [...actual].sort().join(', ');
  const c = [...(claimed ?? [])].sort().join(', ');
  if (a !== c) note(`${label}: source says [${a}], page says [${c}]`);
};

eq('repoSkillDirCount', skillDirs.length, manifest.repoSkillDirCount);
// A skill without `name:`/`description:` frontmatter is not routable: the model matches on the
// description, so an absent one silently removes the skill from every chooser. This is checked
// against the source, not against the manifest — a page that faithfully records the defect would
// otherwise keep the check green forever.
const missingFm = skills.filter((s) => !s.fm?.name || !s.description);
for (const s of missingFm)
  note(
    `${s.dir}/SKILL.md is missing ${!s.fm?.name ? 'name:' : 'description:'} frontmatter — a skill with no description is unroutable`,
  );
eqList(
  'repoSkillsMissingFrontmatter',
  missingFm.map((s) => s.dir),
  manifest.repoSkillsMissingFrontmatter,
);
eqList(
  'repoSkillsHumanInvokeOnly',
  skills.filter((s) => s.human).map((s) => s.dir),
  manifest.repoSkillsHumanInvokeOnly,
);

const agentsMd = readFileSync(AGENTS_MD, 'utf8');
const absentFromChooser = skillDirs.filter(
  (d) => !agentsMd.includes(`${SKILLS_DIR}/${d}/`),
);
eq(
  'repoSkillsAbsentFromAgentsMdChooser',
  absentFromChooser.length,
  manifest.repoSkillsAbsentFromAgentsMdChooser,
);

const canonical = readdirSync(AGENTS_DIR).filter((f) =>
  f.endsWith('.agent.md'),
);
eq(
  'subAgentCanonicalFileCount',
  canonical.length,
  manifest.subAgentCanonicalFileCount,
);
if (existsSync(AGENTS_MIRROR)) {
  eq(
    'subAgentMirrorFileCount',
    readdirSync(AGENTS_MIRROR).filter((f) => f.endsWith('.md')).length,
    manifest.subAgentMirrorFileCount,
  );
} else {
  note(`${AGENTS_MIRROR} not found — run \`yarn agents:sync\``);
}

// Agent display names come from frontmatter, same as check-agent-map.ts.
const agentNames = canonical.map((f) => {
  const m = readFileSync(join(AGENTS_DIR, f), 'utf8').match(/^name:\s*(.+)$/m);
  if (!m) fail(`${f} has no name: in its frontmatter`);
  return m[1].trim().replace(/^['"]|['"]$/g, '');
});

// ── Skill → skill cross-references (DERIVED count) ──────────────────────────
const skillText = new Map(
  skillDirs.map((d) => {
    const chunks = [];
    (function walk(dir) {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else chunks.push(readFileSync(p, 'utf8'));
      }
    })(join(SKILLS_DIR, d));
    return [d, chunks.join('\n')];
  }),
);

// ── Upstream-Owned Skills (CONTEXT.md) ──────────────────────────────────────
// `skills-lock.json` is written by the Skills CLI and names every skill whose body is authored
// upstream. Their prose is someone else's writing, not this repo's routing configuration, so it
// is never scanned for outbound edges, sub-agent names, or `/slug` invocations. Reading the
// lockfile rather than hard-coding names means the next `skills add` needs no change here — and
// a skill copied in by hand, bypassing the CLI, is treated as repo-native and fails loudly for
// its missing description. That is the intended outcome: EXTERNAL_SKILLS.md says not to do that.
const upstreamOwned = new Set(
  Object.keys(JSON.parse(readFileSync(SKILLS_LOCK, 'utf8')).skills ?? {}),
);
for (const d of upstreamOwned)
  if (!skillDirs.includes(d))
    note(
      `skills-lock.json names ${d}, but ${SKILLS_DIR}/${d} does not exist — run \`npx skills update -p\``,
    );
const nativeDirs = skillDirs.filter((d) => !upstreamOwned.has(d));

let ssPairs = 0;
for (const from of nativeDirs) {
  for (const to of skillDirs) {
    if (from === to) continue;
    const re = new RegExp(`skills/${to}/|\`${to}\`|/${to}(?![A-Za-z0-9-])`);
    if (re.test(skillText.get(from))) ssPairs++;
  }
}
eq('skillToSkillEdgeCount', ssPairs, manifest.skillToSkillEdgeCount);

// `handoff` used to need a special case here: eight outbound references from one line that
// named skills as examples rather than routing, making it a false hub. It is now Upstream-Owned,
// so the general rule above excludes it and the page draws exactly what this counts. There is no
// longer a gap between found and rendered, which is why `skillToSkillEdgesRenderedCount` is gone.

// ── Skill → sub-agent (DERIVED, with a REVIEWED exclusion list) ─────────────
// Word boundaries are mandatory: a plain substring search for `TestRunner` matches the Nx CLI
// flag `--unitTestRunner=jest` 8 times in nx-monorepo-workflow. Even with boundaries, four
// agent names are ordinary English words and need the hand-verified exclusions below.
// Upstream-Owned Skills are excluded wholesale before this runs, so entries here cover only
// repo-native prose. The former `Audit: ['modern-web-guidance']` entry is gone with it: any of
// the 23 agent names can collide with upstream English, and enumerating those collisions one
// red check at a time does not scale.
const AGENT_FALSE_POSITIVES = {
  Docs: ['create-hooks', 'design-brief'], // a `## Docs` heading; the English word
  // "Commit/PR only if…", "5. Commit:", and — in upstream-brief — the
  // `**Commit:**` line the rendered brief carries, which names the git commit
  // every local citation was checked against, not the sub-agent.
  Commit: ['implement', 'release-and-deploy-workflow', 'upstream-brief'],
};

let agentEdges = 0;
const unreferenced = [];
for (const a of agentNames) {
  const re = new RegExp(`(?<![A-Za-z])${a}(?![A-Za-z])`);
  const excluded = AGENT_FALSE_POSITIVES[a] ?? [];
  const parents = nativeDirs.filter(
    (d) => re.test(skillText.get(d)) && !excluded.includes(d),
  );
  // A stale exclusion is as dangerous as a missing one: it silently drops a real edge.
  for (const x of excluded) {
    if (!re.test(skillText.get(x))) {
      note(
        `stale exclusion: ${a} is no longer mentioned in ${x} — drop it from AGENT_FALSE_POSITIVES`,
      );
    }
  }
  agentEdges += parents.length;
  if (parents.length === 0) unreferenced.push(a);
}
eq('skillToSubAgentEdgeCount', agentEdges, manifest.skillToSubAgentEdgeCount);
eqList(
  'subAgentsUnreferencedBySkills',
  unreferenced,
  manifest.subAgentsUnreferencedBySkills,
);

// ── REVIEWED: edge classification ───────────────────────────────────────────
// Which cross-reference is a prohibition, a handoff, a route or a vocabulary prerequisite is a
// reading of the prose — no script can decide it. So instead of recomputing, assert that the
// page's own classified set still sums to what its manifest claims, and that the prohibition
// count has not moved without someone re-reading the sources.
const classified = [...page.matchAll(/,\s*"([ABCD])",\s*"/g)].map((m) => m[1]);
if (classified.length === 0) {
  note(
    'could not read the classified edge list from the page — did its script change shape?',
  );
} else {
  eq(
    'skillToSkillEdgeCount (page)',
    classified.length,
    manifest.skillToSkillEdgeCount,
  );
  const warns = classified.filter((t) => t === 'C').length;
  eq(
    'skillToSkillWarnsOffEdgeCount',
    warns,
    manifest.skillToSkillWarnsOffEdgeCount,
  );
}

// ── DERIVED: external skills ────────────────────────────────────────────────
const ext = readFileSync(EXTERNAL_MD, 'utf8');
const section = (heading) => {
  const i = ext.indexOf(heading);
  if (i === -1) return '';
  const rest = ext.slice(i + heading.length);
  const j = rest.search(/\n## /);
  return j === -1 ? rest : rest.slice(0, j);
};
const pkgs = (s) =>
  [...s.matchAll(/`([\w.-]+\/[\w.-]+@[\w.-]+)`/g)].map((m) => m[1]);
// Project scope is the only approved scope (ADR 0032). A personal-scope tier would be an
// approval this repo cannot steward: not committed, not reviewable, and \u2014 as four months of
// an uninstalled list showed \u2014 silently decaying.
const projectScope = [
  ...new Set(
    pkgs(section('## Project Scope \u2014 Upstream-Owned, committed')),
  ),
];
eq(
  'upstreamOwnedSkillCount',
  upstreamOwned.size,
  manifest.upstreamOwnedSkillCount,
);
if (/^## Personal Scope/m.test(ext))
  note(
    'EXTERNAL_SKILLS.md has a Personal Scope section \u2014 ADR 0032 removed that tier; approve at project scope or not at all',
  );

// The project-scope tier and the lockfile are two records of one fact. They must agree, or the
// document is describing an install that did not happen (or missing one that did).
const projectNames = new Set(projectScope.map((p) => p.split('@').pop()));
for (const n of projectNames)
  if (!upstreamOwned.has(n))
    note(
      `EXTERNAL_SKILLS.md lists ${n} as project scope, but skills-lock.json does not \u2014 install it or remove the entry`,
    );
for (const n of upstreamOwned)
  if (!projectNames.has(n))
    note(
      `skills-lock.json contains ${n}, but EXTERNAL_SKILLS.md does not list it under project scope \u2014 every committed external needs an approval entry`,
    );

const approvedExternalSkills = new Set(
  projectScope.map((p) => p.split('@').pop()),
);

// ── DERIVED: dangling references ────────────────────────────────────────────
// Backticked `/slug` invocations that name no skill. Two are known aliases with no registry
// behind them, and `/tmp` is a filesystem path; the vendored third-party guides are upstream
// prose and are not scanned.
// Approved externals are named by their `owner/pkg@skill` entry in EXTERNAL_SKILLS.md and
// installed per-developer rather than committed here, so `/wayfinder` resolves at runtime for
// anyone who ran the install even though no directory backs it. Reading the approval list keeps
// approving an external from failing this check on the reference that approval legitimises.
const ALIASES = new Set(['commit', 'create-pr']);
const NOT_INVOCATIONS = new Set(['tmp']);
const dangling = new Set();
for (const d of nativeDirs) {
  for (const m of skillText.get(d).matchAll(/`\/([a-z][a-z0-9-]{2,})`/g)) {
    const s = m[1];
    if (
      skillDirs.includes(s) ||
      approvedExternalSkills.has(s) ||
      ALIASES.has(s) ||
      NOT_INVOCATIONS.has(s)
    )
      continue;
    dangling.add(s);
  }
}
eqList(
  'danglingSkillReferences',
  [...dangling],
  manifest.danglingSkillReferences,
);

// ── DERIVED: Upstream-Owned Skills are exempt from Prettier ────────────────
// Not cosmetic. Prettier's markdown normalisation rewrites upstream bodies on every commit,
// which is how the previous `codebase-design` fork came to differ from upstream by 3% of its
// lines with no intent behind any of it. An unignored upstream skill silently re-forks.
const prettierIgnore = existsSync('.prettierignore')
  ? readFileSync('.prettierignore', 'utf8')
  : '';
const gitAttributes = existsSync('.gitattributes')
  ? readFileSync('.gitattributes', 'utf8')
  : '';
for (const d of upstreamOwned) {
  if (!prettierIgnore.includes(`${SKILLS_DIR}/${d}/`))
    note(
      `${SKILLS_DIR}/${d}/ is Upstream-Owned but not in .prettierignore — formatting would re-fork it`,
    );
  if (!gitAttributes.includes(`${SKILLS_DIR}/${d}/`))
    note(
      `${SKILLS_DIR}/${d}/ is Upstream-Owned but not in .gitattributes — mark it linguist-generated`,
    );
}
// The same attribute must not be claimed for the tree as a whole: repo-native skills are
// hand-written instruction files, and marking them generated collapses their diffs in review.
if (/^\.agents\/skills\/\*\* .*linguist-generated/m.test(gitAttributes))
  note(
    '.gitattributes marks all of .agents/skills/** as linguist-generated — that hides repo-native skill diffs from review; scope it to the Upstream-Owned directories',
  );

// ── DERIVED: links from repo-native skills into Upstream-Owned Skills ───────
// The only silent failure mode this externalisation introduces. `improve-codebase-architecture`
// links `../codebase-design/DEEPENING.md`; if a future `npx skills update -p` renames or drops
// that file upstream, the link rots and nothing else notices — the skill still loads, it just
// points at nothing. Assert every such link resolves to a real file.
// `.github/prompts/*.prompt.md` links into skill directories too, from outside the skill tree.
// Those links are as breakable as the in-tree ones and were not covered until a prompt file was
// found pointing at an Upstream-Owned companion file.
const linkRoots = [
  ...nativeDirs.map((d) => join(SKILLS_DIR, d)),
  ...(existsSync('.github/prompts') ? ['.github/prompts'] : []),
];
for (const dir of linkRoots) {
  const walk = (d, out = []) => {
    for (const f of readdirSync(d)) {
      const q = join(d, f);
      if (statSync(q).isDirectory()) walk(q, out);
      else if (f.endsWith('.md')) out.push(q);
    }
    return out;
  };
  for (const file of walk(dir)) {
    const body = readFileSync(file, 'utf8');
    // Two link shapes: a relative hop between skill dirs, and a repo-rooted path used by the
    // prompt files. Both resolve to `.agents/skills/<skill>/<file>`.
    const links = [
      ...[...body.matchAll(/]\(\.\.\/([a-z0-9-]+)\/([^)#\s]+)/g)].map((m) => [
        m[1],
        m[2],
      ]),
      ...[
        ...body.matchAll(
          /`?\.agents\/skills\/([a-z0-9-]+)\/([A-Za-z0-9_.-]+\.md)`?/g,
        ),
      ].map((m) => [m[1], m[2]]),
    ];
    for (const [target, rel] of links) {
      if (!upstreamOwned.has(target)) continue;
      if (!existsSync(join(SKILLS_DIR, target, rel)))
        note(
          `${file} links ../${target}/${rel}, which no longer exists — ${target} is Upstream-Owned, so \`npx skills update -p\` can move it`,
        );
    }
  }
}

// ── DERIVED: no vestiges of the removed Tier 3 ──────────────────────────────
// ADR 0032 removed Tier 3. Deleting a branch mid-expression leaves code that still parses: the
// tier-3 arm of `tipHTML` was cut and its continuation lines survived as a dangling `+ …`
// statement, valid JavaScript that threw on `d.pkg` for every node and silently killed every
// tooltip. `node --check` cannot see that; a grep for the vestiges can.
for (const vestige of ['d.pkg', 'extNodes', 'tier === 3', 'd.optional'])
  if (
    new RegExp(`(?<![A-Za-z])${vestige.replace(/[.[\]]/g, '\\$&')}`).test(page)
  )
    note(
      `${PAGE} still references \`${vestige}\` — a Tier 3 leftover; that tier was removed in ADR 0032`,
    );

// ── DERIVED: the visible counters ───────────────────────────────────────────
// The manifest is checked; the prose beside it was not, and drifted — the header still claimed
// "thirteen approved third-party skills … uninstalled" after that tier was removed. A reader
// believes the big number, not the JSON, so assert the counters a human actually sees.
const counters = [
  ...page.matchAll(/<div class="count"><b>(\d+)<\/b><span>([^<]+)<\/span>/g),
].map((m) => [m[2].trim(), Number(m[1])]);
const expectedCounters = {
  'repo-native skills': nativeDirs.length,
  'upstream-owned': upstreamOwned.size,
  'sub-agents': canonical.length,
};
for (const [label, shown] of counters) {
  const want = expectedCounters[label];
  if (want !== undefined && want !== shown)
    note(`header counter "${label}": source says ${want}, page shows ${shown}`);
}
for (const label of Object.keys(expectedCounters))
  if (!counters.some(([l]) => l === label))
    note(`header counter "${label}" is missing from the page`);

// ── The reading test, enforced ──────────────────────────────────────────────
// Every Tier-1 tooltip must carry the description verbatim. This is the whole point of the
// page: the description is what the model matches on, so a drifted copy misreports routing.
const fmBlock = page.match(/const SKILL_FM = (\[[\s\S]*?\]);/);
if (!fmBlock) {
  note(
    'could not find the SKILL_FM block in the page — descriptions are unverifiable',
  );
} else {
  let embedded;
  try {
    embedded = JSON.parse(fmBlock[1]);
  } catch (err) {
    note(`SKILL_FM is not valid JSON: ${err.message}`);
    embedded = null;
  }
  if (embedded) {
    const byDir = new Map(embedded.map((e) => [e.dir, e]));
    for (const s of skills) {
      const e = byDir.get(s.dir);
      if (!e) {
        note(`${s.dir} is on disk but missing from the page`);
        continue;
      }
      const onPage = e.description ?? null;
      if (onPage !== s.description) {
        note(
          s.description === null
            ? `${s.dir}: SKILL.md has no description, but the page shows one — never invent a description`
            : onPage === null
              ? `${s.dir}: SKILL.md has a description, but the page shows none`
              : `${s.dir}: description on the page is not verbatim (${onPage.length} chars vs ${s.description.length} on disk)`,
        );
      }
    }
    for (const e of embedded) {
      if (!skillDirs.includes(e.dir))
        note(`page lists a skill that is not on disk: ${e.dir}`);
    }
  }
}

// Every sub-agent named in the manifest must actually be rendered, per check-agent-map.ts.
for (const a of manifest.subAgentsUnreferencedBySkills ?? []) {
  if (!page.includes(`"${a}"`))
    note(`${a} is in the manifest but never rendered in the page`);
}

// ── Report ──────────────────────────────────────────────────────────────────
if (findings.length > 0) {
  console.error(
    `skill-map: ${findings.length} finding(s) — ${PAGE} is out of date\n`,
  );
  for (const f of findings) console.error(`  - ${f}`);
  console.error(
    `\nUpdate the page (and its #skill-atlas-manifest) to match the filesystem.` +
      `\nIf an edge classification changed, re-read the source lines before editing the counts —` +
      `\nthe A/B/C/D types are a reading of the prose, not something this script can recompute.`,
  );
  process.exit(1);
}

console.log(
  `skill-map: OK — ${nativeDirs.length} repo-native + ${upstreamOwned.size} upstream-owned skills, ` +
    `${canonical.length} sub-agents, ${ssPairs} skill→skill, ${agentEdges} skill→agent, ` +
    `${projectScope.length} approved external; all ${
      skills.filter((s) => s.description).length
    } descriptions verbatim`,
);
