/**
 * Mechanical checks for House Explainer Pages — the self-contained HTML artifacts
 * the Designer sub-agent produces (`.github/agents/designer.agent.md`).
 *
 * This module is pure: every filesystem fact it needs is passed in. The CLI that
 * reads those facts is `tools/scripts/check-design-hygiene.mjs`.
 *
 * Each rule here exists because a real dispatch got it wrong, and because a model
 * asked to confirm "the page has no root-svg <title>" will glance at it and say
 * yes. See docs/adr/0046-house-explainer-pages-have-a-designer-and-a-gate.md.
 *
 * Deliberately NOT checked here — judgment, and the reason a human still reads
 * the page: whether the hero is the right hero, whether a panel earns its place,
 * whether the prose is true. An Assertion Gate compares two artifacts (ADR 0043);
 * "is this diagram clear" compares an artifact to a feeling.
 *
 * Rules are classified by kind (`RULE_KINDS`, ADR 0085). Every rule above the
 * citation rule is mechanical-hygiene: the `LEGACY` roster exempts a page from
 * these on the strength of one written reason. `checkCitations` carries the
 * factual-assertion rules — a citation must resolve, carry an expected-content
 * anchor, and match it, since resolution alone is necessary and not sufficient
 * (see its own comment) — and `LEGACY` does not exempt a page from them:
 * `scanDesignPage` runs everything for a `ROSTER` page, `scanFactualAssertions`
 * runs only these for a `LEGACY` one.
 */

import { createHash } from 'node:crypto';

import { blockAfter, citableLines, lineOf } from './source-scan.ts';

const blank = (match) => match.replace(/[^\n]/g, ' ');

/** Rewrites the body of every `<script>` and `<style>`, leaving markup untouched. */
function mapEmbeddedCode(source, transform) {
  return source.replace(
    /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_, open, __, body, close) => `${open}${transform(body)}${close}`,
  );
}

/**
 * Masks `/* … *\/` and `//` comments. Scoped to code, because in prose those byte
 * pairs are not comments at all.
 */
function maskCodeComments(code) {
  return (
    code
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      // `//` only where a colon does not precede it, so `https://` survives intact.
      // Without this pass a commented-out `localStorage.` reported as unguarded.
      .replace(
        /(^|[^:])(\/\/[^\n]*)/g,
        (_, before, comment) => before + blank(comment),
      )
  );
}

/**
 * Replaces every comment with spaces, keeping newlines so offsets and line numbers
 * survive. Both flavours matter: these pages explain their own rules in prose, in
 * HTML comments around the markup and in `/* … *\/` comments inside the inline
 * script. `gates.html` writes "a root-`<svg>` `<title>` is not a tooltip system"
 * in a script comment, and scanning raw source reports that warning as the very
 * violation it warns about.
 *
 * The code flavours are masked only inside `<script>` and `<style>`, and that scope
 * is the whole point. Applied document-wide, a glob in prose — `release/*`,
 * `.github/workflows/*.yml`, `docs/**\/*.html` — opens a comment that never closes
 * where the author meant it to, and everything up to the next `*\/` anywhere in the
 * file is blanked. Every rule below runs on this output, so the blanked region is
 * not merely unscanned by one check: it is invisible to all of them. It happened:
 * a `release/**` in an SVG label on `release-pipeline.html` swallowed ~41 KB and
 * the page's manifest block, and the gate reported PASS on a page it had stopped
 * reading. A gate that fails open is worse than no gate, because ADR 0046 exists
 * so nobody has to read these pages by eye.
 *
 * The hazard was already known when this was written document-wide — the `/* … *\/`
 * above had to be escaped to keep this very comment from eating itself.
 *
 * A `<script type="application/json">` body is masked like any other, and the one
 * rule that needs it intact — `checkManifest`, which parses it — reads the raw
 * bytes at the offsets it located here. It is deliberately not exempted at this
 * level: every rule below runs on this output, so an exemption here widens what
 * *all* of them see, not just the parser. Two are satisfied by presence
 * (`checkTipNoteBijection`, `checkThemeTokens`) and `fontBlock` slices from the
 * last `@font-face` it can see, so a block quoting any of those inside `/* … *\/`
 * would be answering a rule with text the page only quotes. That is a fail-open in
 * the same family as the document-wide one above, bought to fix a parse.
 */
export function maskHtmlComments(source) {
  return mapEmbeddedCode(
    source.replace(/<!--[\s\S]*?-->/g, blank),
    maskCodeComments,
  );
}

/**
 * Blanks the bodies of `<script>` and `<style>` while keeping their tags, for the
 * checks that are about markup rather than about code. Without it, a script that
 * mentions `<svg>` in a string or builds markup by concatenation moves the tag
 * scanner's depth counter and every later `<title>` looks nested.
 */
function maskEmbeddedCode(source) {
  return mapEmbeddedCode(source, blank);
}

/**
 * The page's `@font-face` block, sliced from the first `@font-face` to the closing
 * brace of the last `@font-face` rule and normalised to LF. Null when there is none.
 *
 * The slicing convention is the point of this function. Three separate dispatches
 * burned effort brute-forcing which bytes a quoted hash covered, because the brief
 * named a hash without naming the slice. Nobody agrees on a literal: pages are
 * compared, and spliced, through this one implementation.
 */
export function fontBlock(source) {
  // Comments are masked before the ends are located, so an `@font-face` named in
  // prose cannot move either one. Masking preserves offsets, so the slice is taken
  // from the raw source and the caller still gets bytes it can splice verbatim.
  const masked = maskHtmlComments(source);
  const first = masked.indexOf('@font-face');
  if (first === -1) return null;

  const last = masked.lastIndexOf('@font-face');
  const open = masked.indexOf('{', last);
  const lastRule = blockAfter(masked, last);
  if (open === -1 || !lastRule.endsWith('}')) return null;

  return source
    .slice(first, open + lastRule.length)
    .split('\r\n')
    .join('\n');
}

/** SHA-256 of `fontBlock(source)`, or null when the page carries no block. */
export function fontBlockHash(source) {
  const block = fontBlock(source);
  return block === null
    ? null
    : createHash('sha256').update(block).digest('hex');
}

// --- rules -------------------------------------------------------------------

/**
 * A `<title>` inside an `<svg>` is the accessible-name pattern every reference
 * recommends and the one that shipped a defect: browsers also render it as a
 * native tooltip, so a full-canvas diagram grows a tooltip covering the canvas.
 * The house pattern is `aria-label` for the name and `aria-describedby` → `<desc>`
 * for the long description, which produces no tooltip.
 *
 * Scans tags in document order with an `<svg>` depth counter, so the document
 * `<title>` (depth 0) is fine and a nested `<svg>` is still caught.
 */
function checkSvgTitles(code, findings) {
  const tags = code.matchAll(/<(\/?)(svg|title)\b([^>]*)>/gi);
  let depth = 0;
  for (const tag of tags) {
    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    const attrs = tag[3] ?? '';

    if (name === 'svg') {
      if (closing) depth = Math.max(0, depth - 1);
      else if (!attrs.trimEnd().endsWith('/')) depth++;
      continue;
    }
    if (!closing && depth > 0) {
      findings.push({
        rule: 'svg-title-tooltip',
        line: lineOf(code, tag.index),
        message:
          '<title> inside an <svg> renders as a native tooltip covering the whole canvas. Use aria-label for the name and aria-describedby → <desc> for the description.',
      });
    }
  }
}

/**
 * The Popover reads its text from static "Diagram notes" entries rather than from
 * strings embedded in the shapes, so a shape and its note are two halves of one
 * fact. An orphan in either direction is a shape that opens an empty popover or a
 * note no reader can reach.
 */
function checkTipNoteBijection(code, findings) {
  const tips = new Map();
  for (const m of code.matchAll(/data-tip="([^"]+)"/g)) {
    if (!tips.has(m[1])) tips.set(m[1], lineOf(code, m.index));
  }
  const notes = new Map();
  for (const m of code.matchAll(/id="note-([^"]+)"/g)) {
    if (!notes.has(m[1])) notes.set(m[1], lineOf(code, m.index));
  }

  for (const [key, line] of tips) {
    if (!notes.has(key)) {
      findings.push({
        rule: 'tip-note-bijection',
        line,
        message: `data-tip="${key}" has no matching #note-${key} entry — the shape opens an empty popover.`,
      });
    }
  }
  for (const [key, line] of notes) {
    if (!tips.has(key)) {
      findings.push({
        rule: 'tip-note-bijection',
        line,
        message: `#note-${key} has no matching data-tip="${key}" shape — no reader can reach it.`,
      });
    }
  }
}

/**
 * Self-containment. The pages preview from `file://` and inside sandboxes with no
 * network, so anything fetched at load is a blank region for some reader.
 *
 * Every `http(s)://` literal is reported, not only the ones in `src`/`href`/`url()`.
 * An attribute-shaped rule passes a bare `fetch('https://…')` or a dynamic
 * `import()` in the inline script, which is the same defect reached by a different
 * spelling.
 *
 * Two exemptions, both because they load nothing: XML namespace URIs, which are
 * declarations; and `<a href>`, because a link the reader chooses to follow is
 * navigation, and an explainer page citing the spec it explains is doing its job.
 * A bare URL sitting in prose is still reported — it should have been an anchor.
 */
function checkExternalResources(code, findings) {
  // A `<link href="https://…">` is one defect with one fix. Reporting it as both
  // a <link> and a remote href would double the count and make the total lie about
  // how much is wrong, so the tags are blanked before the URL scan runs.
  let rest = code;
  const erase = (at, text) =>
    (rest = rest.slice(0, at) + blank(text) + rest.slice(at + text.length));

  for (const m of code.matchAll(/<link\b[^>]*>/gi)) {
    findings.push({
      rule: 'external-resource',
      line: lineOf(code, m.index),
      message:
        '<link> loads an external stylesheet or asset. House pages inline everything.',
    });
    erase(m.index, m[0]);
  }
  for (const m of code.matchAll(/<a\b[^>]*>/gi)) erase(m.index, m[0]);
  for (const m of code.matchAll(/@import\b/g)) {
    findings.push({
      rule: 'external-resource',
      line: lineOf(code, m.index),
      message:
        '@import fetches a stylesheet at load. Inline the rules instead.',
    });
  }
  for (const m of rest.matchAll(/https?:\/\/[^\s"'`)<>\\]+/gi)) {
    const url = m[0];
    if (/^https?:\/\/(?:www\.)?w3\.org\//.test(url)) continue; // xmlns / xlink declarations
    findings.push({
      rule: 'external-resource',
      line: lineOf(code, m.index),
      message: `${url} is an external URL. House pages are self-contained — inline it as a data: URI, or drop it.`,
    });
  }
}

/**
 * Theme tokens live in three states because the viewer's setting has three:
 * an explicit light pin, an explicit dark pin, and the system default. Defining
 * dark only under `@media` loses the toggle; defining it only under `[data-theme]`
 * loses the system default; an unguarded `@media` block beats an explicit light pin.
 */
function checkThemeTokens(code, findings) {
  const missing = [];
  if (!/(^|[\s{}]):root\s*\{/m.test(code)) {
    missing.push(
      'a bare `:root { … }` block — the light palette every other state overrides',
    );
  }
  const media = code.match(
    /@media\s*\([^)]*prefers-color-scheme:\s*dark[^)]*\)/,
  );
  if (!media) {
    missing.push(
      '`@media (prefers-color-scheme: dark)` — the system-default dark palette',
    );
  } else {
    // The block's real extent, not a fixed window. A guessed character count both
    // missed a guard sitting past a long comment and accepted one that belonged to
    // a later, unrelated at-rule.
    const body = blockAfter(code, media.index);
    if (!/:root:not\(\[data-theme=['"]light['"]\]\)/.test(body)) {
      missing.push(
        "a `:root:not([data-theme='light'])` guard on the prefers-color-scheme block — without it the system setting overrides an explicit light pin",
      );
    }
  }
  if (!/:root\[data-theme=['"]dark['"]\]/.test(code)) {
    missing.push(
      "a `:root[data-theme='dark']` block — the explicit dark pin the toggle sets",
    );
  }

  for (const item of missing) {
    findings.push({
      rule: 'theme-tokens-incomplete',
      line: 1,
      message: `Theme tokens are incomplete: missing ${item}.`,
    });
  }
}

/**
 * Storage access throws `SecurityError` on an opaque origin — a `data:` URL, a
 * sandboxed iframe, some `file://` configurations — and these pages are read from
 * exactly those. An uncaught throw in the pre-paint theme block kills the rest of
 * it and the page loads unstyled.
 */
function checkStorageGuards(code, findings) {
  for (const m of code.matchAll(/\blocalStorage\s*\./g)) {
    if (!insideTry(code, m.index)) {
      findings.push({
        rule: 'unguarded-storage',
        line: lineOf(code, m.index),
        message:
          'localStorage access outside a try/catch. It throws SecurityError on an opaque origin (file://, sandboxed iframe), and these pages are read from there.',
      });
    }
  }
}

/**
 * True when `index` sits inside a `try { … }` block, at any nesting depth.
 *
 * Walks outward through every enclosing block rather than stopping at the innermost
 * one. The theme toggle's real shape is `try { if (pin) { … } else { … } } catch`,
 * so checking only the immediately enclosing block called a correct guard unguarded.
 */
function insideTry(code, index) {
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    const ch = code[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) {
        // An enclosing block opener. If `try` introduces it we are done; otherwise
        // keep walking out through its own enclosing blocks.
        if (/\btry\s*$/.test(code.slice(Math.max(0, i - 12), i))) return true;
      } else {
        depth--;
      }
    }
  }
  return false;
}

/**
 * The embedded manifest is what lets a check script diff the page's claims against
 * the source constants later. Without one the page starts rotting the day it lands
 * and nobody finds out (design-brief/SKILL.md, step 6).
 */
function checkManifest(code, source, findings) {
  // Attribute order is not fixed by anything, so matching `type` before `id` made a
  // perfectly good manifest report as missing. Every JSON block is parsed, not just
  // the first — a page carrying two and breaking the second would have passed.
  //
  // Blocks are located in the masked `code`, so a manifest inside an HTML comment
  // does not count as one, and the body is then read from `source` at the same
  // offsets — masking preserves length and newlines, so the two are byte-aligned.
  // That split is load-bearing: a citation anchor quotes source verbatim (ADR
  // 0085) and release-pipeline.html already quotes both `//` and `/*`. Parsing the
  // masked body reports a valid manifest as invalid when a quoted `//` blanks the
  // closing brace, and — worse, because it still parses — silently drops the keys
  // between a quoted `/*` and the next `*/`.
  let found = 0;
  for (const m of code.matchAll(
    /<script\b([^>]*\btype="application\/json"[^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    const id = m[1].match(/\bid="([^"]+)"/)?.[1] ?? '(no id)';
    // Only a `…-manifest` block answers this rule. A page may carry other JSON —
    // `citation-anchors` is the first — and counting those would let a page with
    // nothing asserting it pass the check whose message names the block it wants.
    if (id.endsWith('-manifest')) found++;
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    try {
      JSON.parse(source.slice(bodyStart, bodyStart + m[2].length));
    } catch (err) {
      findings.push({
        rule: 'manifest-invalid',
        line: lineOf(code, m.index),
        message: `#${id} is not valid JSON: ${err.message}`,
      });
    }
  }
  if (found === 0) {
    findings.push({
      rule: 'manifest-missing',
      line: 1,
      message:
        'No embedded <script type="application/json" id="…-manifest"> block. Without one, nothing can assert the page against the source it describes.',
    });
  }
}

/**
 * These pages are hand-tuned markup with meaningful whitespace inside <pre> and
 * inline SVG. Prettier reflows them, so an unlisted page is rewritten on the next
 * commit that touches anything.
 */
function checkPrettierIgnored(file, prettierIgnored, findings) {
  if (prettierIgnored) return;
  findings.push({
    rule: 'prettier-ignore-missing',
    line: 1,
    message: `${file} is not listed in .prettierignore — formatting will reflow its hand-tuned markup.`,
  });
}

/**
 * A page that cites an ADR by relative path is only as good as the path. ADR files
 * get renumbered before they merge (ADR 0042), which is exactly when these links
 * break.
 */
function checkAdrLinks(file, code, adrLinkExists, findings) {
  const dir = file.split('/').slice(0, -1).join('/');
  for (const m of code.matchAll(/(?:href|src)="([^"]*adr\/[^"]+)"/g)) {
    const raw = m[1];
    if (/^[a-z]+:/i.test(raw)) continue; // absolute URL — checkExternalResources owns it
    const target = raw.split('#')[0].split('?')[0];
    const resolved = resolveRelative(dir, target);
    if (!adrLinkExists(resolved)) {
      findings.push({
        rule: 'adr-link-broken',
        line: lineOf(code, m.index),
        message: `${raw} does not resolve (${resolved}). ADRs are renumbered before they merge — re-check the number.`,
      });
    }
  }
}

function resolveRelative(dir, target) {
  const segments = target.startsWith('/')
    ? target.slice(1).split('/')
    : [...dir.split('/').filter(Boolean), ...target.split('/')];
  const out = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/** Replaces every `<tag …>`, attributes included, with spaces — what is left is
 * the page's visible text in document order, whatever element carried it. */
function blankTags(code) {
  return code.replace(/<[^>]*>/g, blank);
}

// A citation's name is either a path with at least one `/` (extension optional,
// so `.github/CODEOWNERS` counts) or a single segment carrying an extension
// (`ci.yml`, `SKILL.md`). Neither shape appears in ordinary prose, which is what
// lets this scan the whole visible page instead of one tag at a time.
//
// The lookbehind pins a name to the start of its run of name characters. From a
// later start the same run was already tried whole, so the one thing it stops
// matching is a name glued to the digits of the citation before it
// (`a.ts:12b.ts`), which nothing writes. It is what keeps the scan linear:
// without it every position inside a long run rescans to the run's end, and
// 200 KB of unbroken word characters in a bundled script string took a minute
// (#982).
const NAME_RE = /(?<![\w.-])(?:(?:[\w.-]+\/)+[\w.-]+|[\w.-]+\.[A-Za-z0-9]+)/;
// Either a name (optionally followed by :line, whether or not it carries one —
// a panel heading routinely just names the file it is about) or, with no name,
// a bare :line on its own.
// The bare form refuses a colon that a digit precedes. `4:30am` and `2:30 pm`
// are clock times, and matching their `:30` attaches a citation to whatever file
// the page named last — inventing a claim about a line nobody cited. That is not
// hypothetical: resume.html carried two of them, and they were the only citations
// the scanner found on a page that cites nothing (#800). A real continuation is
// written after a separator — `main.mts:153, :205` — so nothing legitimate puts a
// digit immediately before the colon.
const TOKEN_RE = new RegExp(
  `(?<name>${NAME_RE.source})(?::(?<start>\\d+)(?:-(?<end>\\d+))?)?` +
    `|(?<![0-9]):(?<bareStart>\\d+)(?:-(?<bareEnd>\\d+))?`,
  'g',
);

/**
 * Character ranges of `<span class="src">…</span>` / `<text class="src">…</text>`
 * content — the house convention for a caption that names the file a panel or
 * section is about. Scoped to this class deliberately: prose and `<code>` are
 * full of dotted, sometimes slash-bearing tokens that are not files at all —
 * `github.ref`, `release/vX.Y.Z`, `inputs.apply_only` — and treating every one
 * of them as naming a file misattributes the citation after it. A `class="src"`
 * caption is short and deliberate; nothing here has ever named the wrong file.
 */
function srcRanges(code) {
  const ranges = [];
  for (const m of code.matchAll(
    /<(span|text)\b[^>]*\bclass="src"[^>]*>([\s\S]*?)<\/\1\s*>/gi,
  )) {
    const start = m.index + m[0].indexOf('>') + 1;
    ranges.push([start, start + m[2].length]);
  }
  return ranges;
}

function within(ranges, index) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

// Extensions a bare mention (no line of its own) is allowed to name a file by.
// Bounded deliberately: `github.ref`, `inputs.apply_only`, `needs.x.result` are
// GitHub Actions expressions with the same dotted shape a filename has, and an
// unbounded check would read every one of them as naming a file too.
const KNOWN_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'json',
  'yml',
  'yaml',
  'md',
  'mdx',
  'html',
  'css',
  'toml',
  'py',
]);

function knownExtension(name) {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1];
  return ext !== undefined && KNOWN_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Every `file:line` citation on the page: those in the markup in document
 * order, then those in script data in document order. In the markup it does not
 * matter which element carries one — a `cite`/`src` span, a table cell, inline
 * `<code>`, or SVG label text are all just visible text once tags and embedded
 * code are blanked out (ADR 0085: "finds citations in every markup form a page
 * uses").
 *
 * A bare `:line` or `:line-line` carries no name of its own; it resolves against
 * the filename most recently *named* on the page. A citation (`name:line`)
 * always names its file, wherever it sits. A bare *mention* — the file with no
 * line — counts in two narrower cases, because most dotted or slashed tokens in
 * prose are not files at all:
 *   - inside a `class="src"` caption (`srcRanges`): a panel heading routinely
 *     writes `<span class="src">… &middot; ci.yml</span>` once and leaves every
 *     citation under it bare, sometimes many elements later.
 *   - immediately beside the bare citation it names — nothing between them but
 *     blanked tags and punctuation, no actual word — and carrying a known file
 *     extension. `<code>ApiTokens.ts</code> (:36 access, …)` qualifies;
 *     `<code>github.ref</code> <span class="cite">:88</span>` sits just as close
 *     but `.ref` is not a file extension, and `RELEASE_NOTES.md` read from the
 *     tagged commit, so re-running it is safe (:79-100)` carries a real
 *     extension but a whole clause between it and the citation, so neither
 *     counts. A bare citation with nothing named yet ahead of it is not a
 *     citation — `16:9` in plain prose does not become one just because a regex
 *     can parse it as one — so it is silently skipped.
 *
 * Followed by the citations a page renders from script data (#982), which obey
 * the narrower grammar `locateScriptCitations` describes.
 */
export function findCitations(source) {
  return locateCitations(source).map(({ citation }) => citation);
}

/**
 * `findCitations`, plus, for each citation, the offset it ends at and the run of
 * text it was read from — which is what `findUnparsedContinuations` needs to
 * read what follows it. A run is `text`, aligned with the page offset for
 * offset, and `unbroken(from, to)`: whether that span is one stretch of prose.
 */
function locateCitations(source) {
  return [...locateMarkupCitations(source), ...locateScriptCitations(source)];
}

/** One located citation: the match `m`, found at `index` of `run.text`. */
function citationAt(run, index, m, name) {
  const start = m.groups.start ?? m.groups.bareStart;
  const end = m.groups.end ?? m.groups.bareEnd;
  return {
    citation: {
      name,
      line: Number(start),
      endLine: end ? Number(end) : Number(start),
      sourceLine: lineOf(run.text, index),
      raw: m[0],
    },
    end: index + m[0].length,
    run,
  };
}

/**
 * The citations in `run.text` between `from` and `to`, under the one grammar
 * the markup and script data share. The two differ only in what they take a
 * name to be:
 *   - `isFile(name)`: whether a name carrying a line is a file at all. One that
 *     is not still named something, so it clears the file in force — the bare
 *     `:9` after `.github/CODEOWNERS:5` is that name's line, not the line of
 *     whichever file came before it.
 *   - `inCaption(index)`: whether a bare mention at `index` names a file by
 *     sitting where the page puts file names.
 */
function readCitations(run, from, to, { isFile, inCaption }) {
  const text = run.text.slice(from, to);
  const matches = [...text.matchAll(TOKEN_RE)];
  const located = [];
  let lastName = null;
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const { name } = m.groups;
    const start = m.groups.start ?? m.groups.bareStart;

    if (name && start === undefined) {
      const next = matches[i + 1];
      const adjacentBareCitation =
        next &&
        next.groups.name === undefined &&
        !/\w/.test(text.slice(m.index + m[0].length, next.index));
      if (
        inCaption(from + m.index) ||
        (adjacentBareCitation && knownExtension(name))
      ) {
        lastName = name;
      }
      continue;
    }
    if (name) lastName = isFile(name) ? name : null;
    if (start === undefined || !lastName) continue;

    located.push(citationAt(run, from + m.index, m, lastName));
  }
  return located;
}

function locateMarkupCitations(source) {
  const code = maskEmbeddedCode(maskHtmlComments(source));
  const ranges = srcRanges(code);
  const flat = blankTags(code);
  // `flat` is `code` with every tag blanked, so the two differ over a span
  // exactly when a tag sits inside it — the next table cell, the next list item.
  const run = {
    text: flat,
    unbroken: (from, to) => code.slice(from, to) === flat.slice(from, to),
  };
  return readCitations(run, 0, flat.length, {
    isFile: () => true,
    inCaption: (index) => within(ranges, index),
  });
}

// --- script string literals ---------------------------------------------------
//
// A lexer, not a parser: enough JavaScript to tell a string from the code,
// comments and regex literals around it, and no more. `maskNonCode` in
// source-scan.ts walks the same states and is deliberately not shared — it
// blanks strings where this collects them, and it has no need of the two things
// that make this one longer, nested templates and regex literals.

/**
 * Where the closing quote of the `'` or `"` literal opened at `open` sits, or
 * -1 when what opened there is not a string: a quote that reaches the end of
 * its line unclosed is an apostrophe in a comment-less corner the lexer
 * misread, and reading on to the next quote below would swallow real strings.
 */
function closingQuote(js, open) {
  const quote = js[open];
  for (let i = open + 1; i < js.length; i += 1) {
    const ch = js[i];
    if (ch === '\\') i += 1;
    else if (ch === quote) return i;
    else if (ch === '\n') return -1;
  }
  return -1;
}

const REGEX_PRECEDING_KEYWORD =
  /\b(?:return|typeof|case|in|of|void|delete|do|else|throw|yield|await)$/;

/**
 * Whether the `/` at `at` opens a regex literal rather than dividing: decided,
 * as every lexer without a parser decides it, by what comes before. After an
 * operator, an opening bracket or a keyword a value is expected, so it is a
 * regex; after an identifier, a number or a closing `)` or `]` it divides.
 */
function opensRegex(js, at) {
  let i = at - 1;
  while (i >= 0 && /\s/.test(js[i])) i -= 1;
  if (i < 0) return true;
  if ('(,=:[!&|?{};+-*%<>~^}'.includes(js[i])) return true;
  return REGEX_PRECEDING_KEYWORD.test(js.slice(Math.max(0, i - 9), i + 1));
}

/** The offset just past the regex literal opened at `open`, or -1 if it never closes on its line. */
function regexLiteralEnd(js, open) {
  let inClass = false;
  for (let i = open + 1; i < js.length; i += 1) {
    const ch = js[i];
    if (ch === '\n') return -1;
    if (ch === '\\') i += 1;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return i + 1;
  }
  return -1;
}

// A template nested deeper than this is not JavaScript anyone wrote; it is the
// lexer chasing backticks through something that is not a script.
const MAX_TEMPLATE_NESTING = 32;

/**
 * The content range of every string literal in a script body, in order.
 *
 * Gives up locally rather than globally: a quote, a regex or a template that
 * does not close is stepped over as one character of code. A template found
 * not to close is remembered, so the lexer never walks to the end of the script
 * from the same backtick twice.
 */
function stringLiteralRanges(js) {
  const unclosed = new Set();
  let nesting = 0;

  /**
   * Collects the ranges in the code starting at `from` and returns where it
   * stopped: the end of the script, or, inside a template's `${ … }`, just past
   * the brace that closes it (-1 if none does).
   */
  function lexCode(from, ranges, inTemplateExpression) {
    let depth = 0;
    let i = from;
    while (i < js.length) {
      const ch = js[i];
      const next = js[i + 1];
      if (ch === '/' && next === '/') {
        const eol = js.indexOf('\n', i);
        i = eol === -1 ? js.length : eol;
      } else if (ch === '/' && next === '*') {
        const close = js.indexOf('*/', i + 2);
        i = close === -1 ? js.length : close + 2;
      } else if (ch === '/' && opensRegex(js, i)) {
        const end = regexLiteralEnd(js, i);
        i = end === -1 ? i + 1 : end;
      } else if (ch === "'" || ch === '"') {
        const close = closingQuote(js, i);
        if (close !== -1) ranges.push([i + 1, close]);
        i = close === -1 ? i + 1 : close + 1;
      } else if (ch === '`') {
        const end = lexTemplate(i + 1, ranges);
        i = end === -1 ? i + 1 : end;
      } else if (inTemplateExpression && ch === '}' && depth === 0) {
        return i + 1;
      } else {
        if (inTemplateExpression && ch === '{') depth += 1;
        if (inTemplateExpression && ch === '}') depth -= 1;
        i += 1;
      }
    }
    return inTemplateExpression ? -1 : i;
  }

  /**
   * Lexes the template literal whose text starts at `from`, just past its
   * opening backtick. Each stretch of text between `${ … }` expressions is its
   * own range, and the expressions are lexed as code, so a template nested
   * inside one is found too. Returns the offset past the closing backtick, or
   * -1 — committing nothing to `ranges` — when the template never closes.
   */
  function lexTemplate(from, ranges) {
    if (unclosed.has(from) || nesting >= MAX_TEMPLATE_NESTING) return -1;
    const found = [];
    let chunk = from;
    let i = from;
    nesting += 1;
    try {
      while (i < js.length) {
        const ch = js[i];
        if (ch === '\\') {
          i += 2;
        } else if (ch === '`') {
          found.push([chunk, i]);
          ranges.push(...found);
          return i + 1;
        } else if (ch === '$' && js[i + 1] === '{') {
          found.push([chunk, i]);
          const after = lexCode(i + 2, found, true);
          if (after === -1) break;
          chunk = after;
          i = after;
        } else {
          i += 1;
        }
      }
      unclosed.add(from);
      return -1;
    } finally {
      nesting -= 1;
    }
  }

  const ranges = [];
  lexCode(0, ranges, false);
  return ranges;
}

// An escape sequence inside a string literal. Blanked before the literal is
// scanned: `'rollback\nAuthController.ts:323'` would otherwise name a file
// called `nAuthController.ts`.
const ESCAPE_RE =
  /\\(?:u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[^\n])/g;

// The `type` of a `<script>`, however it is quoted, and the anchor block's id.
// `(?<![\w-])` keeps `data-type="json"` from reading as a type.
const SCRIPT_TYPE_RE =
  /(?<![\w-])type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ANCHOR_BLOCK_ID_RE = /(?<![\w-])id\s*=\s*["']?citation-anchors(?![\w-])/i;

/**
 * Whether a `<script>` is data about the page rather than text on it: a JSON
 * block of any type spelling, and the anchor block whatever its type says. The
 * anchor block's own keys have exactly the citation shape, so reading it would
 * make every entry the citation it is checked against — an orphan vouching for
 * itself.
 */
function isDataBlock(attrs) {
  const type = SCRIPT_TYPE_RE.exec(attrs);
  return (
    /json/i.test(type?.[1] ?? type?.[2] ?? type?.[3] ?? '') ||
    ANCHOR_BLOCK_ID_RE.test(attrs)
  );
}

/**
 * The citations a page renders from script data (#982): a walkthrough's scenes,
 * an edge table. The scanner used to blank every script body, so these were
 * claims on the rendered page that nothing checked — session-lifecycle.html
 * carried nineteen distinct ones and skill-atlas.html forty-one — and since
 * #822 an anchor written for one failed as an orphan.
 *
 * Script code is full of `name:digit` shapes that are not citations
 * (`{ opacity:0 }`, `flag ? a.b:1 : 2`), so the grammar is narrower than the
 * markup one, and each bound is a shape this does NOT read:
 *   - only string and template literals, never code and never a comment. A
 *     comment is not rendered; a string may not be either, and is read anyway,
 *     because the scanner cannot tell and an unread claim is the worse error.
 *   - a name counts only with a known file extension. `'localhost:3000'` and
 *     `'github.ref:88'` are not files; neither, here, is `.github/CODEOWNERS`.
 *   - a bare `:line` inherits only a file cited earlier in the same literal, or
 *     one mentioned immediately beside it. Nothing leaks in from the markup or
 *     from the string before, so `'padding :4'` is never a citation, and
 *     `'serve index.html on localhost:4200'` is not one either.
 *   - every `<script>` that is not a data block (`isDataBlock`). A type
 *     allowlist would be the wrong bound the other way: session-lifecycle.html
 *     keeps its scenes in a `text/x-dc` script.
 *   - what the lexer can classify. It tells a regex literal from a division by
 *     what precedes the `/`, which is a heuristic: where it guesses wrong, a
 *     quote or `//` inside the regex can cost the strings that follow it.
 *
 * Scripts are located with HTML comments blanked and nothing else: the script
 * comment masking `maskHtmlComments` applies is not string-aware, and blanks
 * the rest of the line after a `//` inside a code sample. `<style>` is matched
 * alongside so that a `<script>` named in a stylesheet comment starts nothing.
 */
function locateScriptCitations(source) {
  const html = source.replace(/<!--[\s\S]*?-->/g, blank);
  const literals = [];
  for (const m of html.matchAll(
    /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
  )) {
    if (m[1].toLowerCase() !== 'script' || isDataBlock(m[2])) continue;
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    for (const [start, end] of stringLiteralRanges(m[3])) {
      literals.push([bodyStart + start, bodyStart + end]);
    }
  }
  if (literals.length === 0) return [];

  // The page with everything blanked but the contents of those literals, so an
  // offset here is an offset in the page and `lineOf` needs no translation.
  const pieces = [];
  let at = 0;
  for (const [start, end] of literals) {
    pieces.push(blank(html.slice(at, start)));
    pieces.push(html.slice(start, end).replace(ESCAPE_RE, blank));
    at = end;
  }
  pieces.push(blank(html.slice(at)));
  const text = pieces.join('');

  return literals.flatMap(([start, end]) =>
    // A continuation stays inside the literal its citation is in: the comma in
    // `['ci.yml:12,', '3 jobs']` does not join two array entries into one list.
    readCitations({ text, unbroken: (from, to) => to <= end }, start, end, {
      isFile: knownExtension,
      inCaption: () => false,
    }),
  );
}

// What follows a citation when a continuation was written without its colon: a
// comma, then a bare line or range. The lookahead refuses a number that is
// visibly something else — `4:30am`, `3.5 seconds`, `30%`, `2026-10-01`, `22x`,
// `404.html`. A number followed by a plain word is NOT refused, because the real
// defect has that shape (`AuthController.ts:345,373 serve these routes`), so
// `ci.yml:12, 3 jobs` is reported too. That prose is rare, and rewording it
// costs less than a cited line nothing reads.
const CONTINUATION_RE = /\s*,\s*(?<range>\d+(?:-\d+)?)(?![\w%:/-]|\.\w)/y;

/**
 * Every bare number written after a citation as though it continued it —
 * `main.mts:153, 205, 1642-1687` — which `TOKEN_RE` does not read, because a
 * continuation is a citation only when a colon leads it (`:205`). The reader
 * sees three cited lines and the gate sees one; four sandcastle pages wrote
 * this, and every anchor entry for the unread lines was an orphan that passed
 * (#822).
 *
 * Walks forward from the end of each citation, so a run of them is found whole
 * and one written after a bare `:205` is attributed to the file that inherited.
 * Takes what `locateCitations` returned, so the page is flattened once.
 *
 * Bounded on purpose, and each bound is a shape this does NOT report:
 *   - only a comma joins a continuation here. `153 and 205`, `153 · 205` are
 *     not read by `TOKEN_RE` either, and nothing says so.
 *   - the comma and the number sit in the same run of text as the citation. A
 *     tag between them — the next table cell, the next list item — ends the
 *     walk, because `<td>ci.yml:12</td><td>, 5 retries</td>` is two cells and
 *     not a list of lines; so does the end of a script string. A continuation
 *     split across elements, or across strings, is missed.
 */
function findUnparsedContinuations(located) {
  const continuations = [];
  for (const { citation, end, run } of located) {
    CONTINUATION_RE.lastIndex = end;
    for (
      let m = CONTINUATION_RE.exec(run.text);
      m !== null;
      m = CONTINUATION_RE.exec(run.text)
    ) {
      if (!run.unbroken(m.index, m.index + m[0].length)) break;
      const { range } = m.groups;
      continuations.push({
        name: citation.name,
        range,
        sourceLine: lineOf(run.text, m.index + m[0].length - range.length),
      });
    }
  }
  return continuations;
}

/** The key a citation is anchored under: `name:line` or `name:start-end`. */
function citationKey(citation) {
  return citation.endLine !== citation.line
    ? `${citation.name}:${citation.line}-${citation.endLine}`
    : `${citation.name}:${citation.line}`;
}

/**
 * Normalizes text for anchor comparison by:
 * - Collapsing consecutive whitespace to single spaces
 * - Trimming leading/trailing whitespace
 * - Unescaping HTML entities
 * - Removing trailing newlines
 */
function normalizeAnchorText(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();
}

/**
 * Extracts the citation-anchors JSON block from a page if present.
 * Returns the map keyed by citation name (e.g., "file.yml:42" or "file.yml:42-50")
 * with values containing the expected anchor text, and `lineOfKey`, which says
 * where in the page an entry is written so a finding about it can land there.
 *
 * Null means the page carries no block. A block that is there and cannot be
 * read comes back as `{ invalid, line }` with an empty map — it must not be
 * mistaken for an absent one, because it is a block that asserts nothing.
 */
function extractAnchorBlock(source) {
  const match = source.match(
    /<script\b[^>]*\bid="citation-anchors"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;

  const body = match[1];
  const bodyStart = match.index + match[0].indexOf('>') + 1;
  const unreadable = (invalid) => ({
    anchors: {},
    invalid,
    line: lineOf(source, match.index),
  });

  let json;
  try {
    json = JSON.parse(body);
  } catch (err) {
    return unreadable(`is not valid JSON (${err.message})`);
  }
  const anchors = json?.anchors;
  if (!anchors || typeof anchors !== 'object' || Array.isArray(anchors)) {
    return unreadable('has no "anchors" object keyed by citation');
  }
  return {
    anchors,
    lineOfKey(key) {
      // The quoted key where a colon follows it — the same string can also
      // sit in a value, such as the block's own note.
      const quoted = JSON.stringify(key);
      let at = body.indexOf(quoted, body.search(/"anchors"\s*:/));
      while (at !== -1 && !/^\s*:/.test(body.slice(at + quoted.length))) {
        at = body.indexOf(quoted, at + 1);
      }
      return lineOf(source, bodyStart + Math.max(at, 0));
    },
  };
}

/**
 * A factual-assertion rule (ADR 0085): it runs over `LEGACY` pages as well as
 * `ROSTER` ones, because none of the five `LEGACY` reasons are about being wrong.
 *
 * Resolving a citation here is necessary and not sufficient — it proves the claim
 * is *possible*, not that it is *true*. `resolveCitation` is asked only whether
 * some file named `name` exists with enough lines; it is not asked whether that
 * file is the right one, which needs the citation to carry the content it names
 * (#788's anchoring). A bare name with several same-named candidates in the tree
 * (`package.json`, `SKILL.md`) resolves if any one of them is long enough — this
 * step can tell an impossible citation from a possible one, not a right file from
 * a coincidentally long wrong one.
 *
 * Each citation is further checked against its expected-content anchor: the text
 * at the cited line(s) must be what the page claims is there. A citation carrying
 * no anchor is itself a finding (ADR 0085) — the requirement is per CITATION, not
 * per page. Keying it off the presence of a `citation-anchors` block would hold
 * only the pages that already opted in, so a page with no block at all would pass
 * by carrying nothing, which is the shape ADR 0043's marker objection warns about.
 *
 * `requireAnchors` is the migration hatch and nothing more: a page named in the
 * anchor baseline still has its citations resolved and any anchors it does carry
 * compared, it is simply not yet failed for the anchors it lacks. The baseline can
 * only shrink, so the hatch closes.
 *
 * The block is held to its citations in the other direction too (#822): an entry
 * that keys no citation this function extracts is never looked up above, so it
 * can quote anything — including something false — while reading, to a human, as
 * though the gate had checked it. That is an unasserted claim (ADR 0085), and
 * `requireAnchors` deliberately does NOT suppress it: the hatch excuses an anchor
 * that is absent, and an orphan is about what the block itself asserts. A page
 * owes nothing it has not written, so no page needs time to migrate out of it.
 *
 * "Extracts" is the operative word, and it bounds the claim. A citation the
 * scanner cannot read keys nothing, so its anchor is an orphan however true:
 *   - a continuation written without its colon (`main.mts:153, 205`) — which,
 *     in the comma-separated form `findUnparsedContinuations` reads, is also
 *     reported in its own right as `citation-continuation-unparsed`, since the
 *     reader sees a cited line the gate does not;
 *   - a citation in a `<script>` body that `locateScriptCitations` does not read:
 *     one in a comment, in code, or under a name with no known file extension.
 *     Nothing reports those themselves. A citation in a script string IS read
 *     (#982), and is held to every rule here like one in the markup.
 *
 * A block that is present and unreadable — invalid JSON, or no `anchors` map —
 * asserts nothing at all, and fails as `citation-anchor-block-invalid` rather
 * than being treated as a page with no block (#982). On a `ROSTER` page invalid
 * JSON is reported by `manifest-invalid` as well; a `LEGACY` page never runs
 * that rule, so this one cannot lean on it.
 */
function checkCitations(
  source,
  findings,
  resolveCitation,
  getFileContent,
  requireAnchors = true,
) {
  const anchorBlock = extractAnchorBlock(source);
  const anchors = anchorBlock?.anchors ?? {};
  const located = locateCitations(source);
  const citations = located.map(({ citation }) => citation);

  if (anchorBlock?.invalid) {
    findings.push({
      rule: 'citation-anchor-block-invalid',
      line: anchorBlock.line,
      message: `The citation-anchors block ${anchorBlock.invalid}, so it asserts nothing about any citation on this page.`,
    });
  }

  const cited = new Set(citations.map(citationKey));
  for (const key of Object.keys(anchors)) {
    if (cited.has(key)) continue;
    findings.push({
      rule: 'citation-anchor-orphan',
      line: anchorBlock.lineOfKey(key),
      message: `Anchor ${key} keys no citation this gate reads on the page, so nothing ever compares it — it asserts nothing while reading as though it did. Remove it, or write the citation it is for where the gate reads it: a continuation line needs its colon (", :205"), and in a <script> only a string that names the file is read — never a comment, and never a bare line on its own.`,
    });
  }

  for (const continuation of findUnparsedContinuations(located)) {
    findings.push({
      rule: 'citation-continuation-unparsed',
      line: continuation.sourceLine,
      message: `"${continuation.range}" follows a citation of ${continuation.name} with no leading colon, so the gate cannot read it as a line of that file and nothing checks it. Write ":${continuation.range}" if it cites ${continuation.name}; reword the sentence if it is not a line number.`,
    });
  }

  for (const citation of citations) {
    const result = resolveCitation(citation);
    if (!result.ok) {
      findings.push({
        rule: 'citation-unresolved',
        line: citation.sourceLine,
        message: result.reason,
      });
      continue;
    }

    if (getFileContent) {
      const key = citationKey(citation);

      const anchor = anchors[key];
      if (!anchor) {
        if (requireAnchors) {
          findings.push({
            rule: 'citation-missing-anchor',
            line: citation.sourceLine,
            message: `Citation ${key} has no anchor in citation-anchors. Without an anchor, nothing asserts what this citation names.`,
          });
        }
      } else {
        // The anchor's own `file` disambiguates among same-named files, so it is
        // what gets read — and it is a claim in its own right. A file that
        // cannot be read, or a cited line past its end, is an unverifiable
        // anchor, not an absent one: falling through with no finding would let a
        // citation pass by naming a file nobody can check, which is the failure
        // this rule exists to stop.
        const filePath = anchor.file || result.filePath;
        const fileContent = filePath ? getFileContent(filePath) : null;
        if (fileContent === null || fileContent === undefined) {
          findings.push({
            rule: 'citation-anchor-unreadable',
            line: citation.sourceLine,
            message: `Citation ${key} names ${filePath ?? 'no file'} in citation-anchors, which cannot be read. Nothing can verify what this citation claims.`,
          });
          continue;
        }

        const lines = citableLines(fileContent);
        const startIdx = citation.line - 1;
        const endIdx = citation.endLine - 1;
        const lastCitedIdx =
          citation.endLine !== citation.line && anchor.end !== undefined
            ? endIdx
            : startIdx;

        if (startIdx < 0 || lastCitedIdx >= lines.length) {
          findings.push({
            rule: 'citation-anchor-unreadable',
            line: citation.sourceLine,
            message: `Citation ${key} is outside ${filePath}, which has ${lines.length} line(s). Nothing can verify what this citation claims.`,
          });
          continue;
        }

        const actualStartText = normalizeAnchorText(lines[startIdx]);
        const expectedStartText = normalizeAnchorText(anchor.start);

        if (actualStartText !== expectedStartText) {
          findings.push({
            rule: 'citation-anchor-mismatch',
            line: citation.sourceLine,
            message: `Citation ${key} anchor does not match: expected "${expectedStartText}" but found "${actualStartText}".`,
          });
          continue;
        }

        // A range drifts at either end, so both are compared.
        if (citation.endLine !== citation.line && anchor.end !== undefined) {
          const actualEndText = normalizeAnchorText(lines[endIdx]);
          const expectedEndText = normalizeAnchorText(anchor.end);

          if (actualEndText !== expectedEndText) {
            findings.push({
              rule: 'citation-anchor-mismatch',
              line: citation.sourceLine,
              message: `Citation ${key} anchor (end) does not match: expected "${expectedEndText}" but found "${actualEndText}".`,
            });
          }
        }
      }
    }
  }
}

/**
 * Which rules honour the `LEGACY` exemption and which do not (ADR 0085). A
 * mechanical-hygiene rule is about how the page is built — font blocks, storage
 * guards, self-containment — and a `LEGACY` reason is always one of those, so
 * `LEGACY` pages skip these. A factual-assertion rule is about whether the page
 * still describes the tree, and no styling exemption is a reason to stop checking
 * that: these run over `ROSTER` and `LEGACY` pages alike.
 */
export const RULE_KINDS = {
  'svg-title-tooltip': 'mechanical-hygiene',
  'tip-note-bijection': 'mechanical-hygiene',
  'external-resource': 'mechanical-hygiene',
  'theme-tokens-incomplete': 'mechanical-hygiene',
  'unguarded-storage': 'mechanical-hygiene',
  'manifest-missing': 'mechanical-hygiene',
  'manifest-invalid': 'mechanical-hygiene',
  'prettier-ignore-missing': 'mechanical-hygiene',
  'adr-link-broken': 'mechanical-hygiene',
  'font-block-drift': 'mechanical-hygiene',
  'citation-unresolved': 'factual-assertion',
  'citation-missing-anchor': 'factual-assertion',
  'citation-anchor-mismatch': 'factual-assertion',
  'citation-anchor-unreadable': 'factual-assertion',
  'citation-anchor-orphan': 'factual-assertion',
  'citation-continuation-unparsed': 'factual-assertion',
  'citation-anchor-block-invalid': 'factual-assertion',
};

/**
 * Runs only the factual-assertion rules — every rule `checkCitations` carries,
 * which `RULE_KINDS` lists — over a page the `LEGACY` exemption otherwise skips
 * entirely (ADR 0085).
 *
 * @param {object} input
 * @param {string} input.source raw page text
 * @param {(citation: {name: string, line: number, endLine: number}) => {ok: boolean, reason?: string, filePath?: string}} input.resolveCitation
 * @param {(filePath: string) => string | null} input.getFileContent function to read file content by path
 * @returns {Array<{rule: string, line: number, message: string}>}
 */
export function scanFactualAssertions({
  source,
  resolveCitation,
  getFileContent,
  requireAnchors = true,
}) {
  const findings = [];
  checkCitations(
    source,
    findings,
    resolveCitation,
    getFileContent,
    requireAnchors,
  );
  return findings.sort((a, b) => a.line - b.line);
}

// --- entry point -------------------------------------------------------------

/**
 * Runs every rule over one House Explainer Page.
 *
 * @param {object} input
 * @param {string} input.file              repo-relative POSIX path, used in messages and to resolve links
 * @param {string} input.source            the page's raw text
 * @param {string} input.canonicalFontHash `fontBlockHash` of the canonical page
 * @param {string|null} input.pageFontHash `fontBlockHash` of this page
 * @param {boolean} input.prettierIgnored  whether .prettierignore covers this file
 * @param {(resolved: string) => boolean} input.adrLinkExists
 * @param {(citation: {name: string, line: number, endLine: number}) => {ok: boolean, reason?: string, filePath?: string}} input.resolveCitation
 * @param {(filePath: string) => string | null} input.getFileContent function to read file content by path
 * @returns {Array<{rule: string, line: number, message: string}>} findings, in file order
 */
export function scanDesignPage({
  file,
  source,
  canonicalFontHash,
  pageFontHash,
  prettierIgnored,
  adrLinkExists,
  resolveCitation,
  getFileContent,
  requireAnchors = true,
}) {
  const code = maskHtmlComments(source);
  const findings = [];

  checkSvgTitles(maskEmbeddedCode(code), findings);
  checkTipNoteBijection(code, findings);
  checkExternalResources(code, findings);
  checkThemeTokens(code, findings);
  checkStorageGuards(code, findings);
  checkManifest(code, source, findings);
  checkPrettierIgnored(file, prettierIgnored, findings);
  checkAdrLinks(file, code, adrLinkExists, findings);
  checkCitations(
    source,
    findings,
    resolveCitation,
    getFileContent,
    requireAnchors,
  );

  if (pageFontHash === null) {
    findings.push({
      rule: 'font-block-drift',
      line: 1,
      message:
        'The page carries no @font-face block, so its typography falls back to system stacks while every sibling page uses the house faces.',
    });
  } else if (pageFontHash !== canonicalFontHash) {
    findings.push({
      rule: 'font-block-drift',
      line: 1,
      message: `The @font-face block differs from the canonical page (${pageFontHash.slice(0, 12)}… vs ${canonicalFontHash.slice(0, 12)}…). Splice the block across verbatim; do not re-encode or re-subset it.`,
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}
