#!/usr/bin/env node
// Converts a dc-runtime design export into a single self-contained page under docs/.
//
//   node tools/scripts/build-agent-map.ts <export-dir> <file.dc.html> <out-file>
//
// The exports ship as `<name>.dc.html` + `support.js` + a design-system stylesheet, and expect
// React to arrive from a CDN at load time. Neither can hold for a page that must render from
// disk and inside a sandbox, so everything is inlined. Content is copied verbatim; delivery
// changes:
//
//   - inline the design-system stylesheet, minus its Google-Fonts @import, plus the woff2 faces
//   - re-express a `prefers-color-scheme` block so an explicit theme choice wins both ways
//   - carry through the page's own manifest, or generate the agent one when it declares none
//
// Nothing here is page-specific. Two things are decided by the export rather than by a flag:
//
//   Runtime. A page with no `{{ }}` bindings is plain DOM: React is dropped and the export's
//   DCLogic class is unwrapped into an IIFE with a minimal shim. A page that binds templates
//   gets React, ReactDOM and support.js inlined ahead of it, with <x-dc> left intact.
//
//   Manifest. A page that declares its own `application/json` manifest keeps it. A page that
//   declares none gets the agent-fleet manifest generated from agent-model-policy.json.
//
// This is a one-time importer, not a rebuild path. No `.dc.html` export has ever been committed
// to this repository, and the pages built from them have been corrected in place since against
// the source constants — so re-importing an old export would revert those corrections rather
// than reproduce the page. An existing House Explainer Page is changed by editing it, briefed
// through `design-brief` and executed by the Designer sub-agent (ADR 0046, ADR 0052, issue #534).
//
// Note: docs/agents/orchestration-map.html was produced by an earlier revision of this script
// that carried a hand-written interaction script, and its source export no longer exists, so
// that page is not reproducible from here either. It remains covered by check-agent-map.ts.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_MAP_MANIFEST_NOTE } from './lib/agent-map-manifest-note.ts';

const [srcDir, dcFile, outFile] = process.argv.slice(2);
if (!srcDir || !dcFile || !outFile) {
  console.error(
    'usage: build-agent-map.ts <export-dir> <file.dc.html> <out-file>',
  );
  process.exit(64);
}
if (!readdirSync(srcDir).includes(dcFile)) {
  console.error(`${dcFile} not found in ${srcDir}`);
  process.exit(65);
}

const repoRoot = process.cwd();
const html = readFileSync(join(srcDir, dcFile), 'utf8');

// Exports have moved the design-system stylesheet around between revisions: older ones use
// `ds/styles.css`, newer ones nest it under `_ds/<theme-id>/styles.css`.
function findDesignStyles(dir: string): string {
  const direct = join(dir, 'ds', 'styles.css');
  if (existsSync(direct)) return direct;

  const dsRoot = join(dir, '_ds');
  if (existsSync(dsRoot)) {
    for (const themeDir of readdirSync(dsRoot)) {
      const nested = join(dsRoot, themeDir, 'styles.css');
      if (existsSync(nested)) return nested;
    }
  }
  console.error(`no styles.css found under ${dir} (looked in ds/ and _ds/*/)`);
  process.exit(65);
}

let ds = readFileSync(findDesignStyles(srcDir), 'utf8');

// A page that binds `{{ }}` cannot be served without the template runtime.
const needsRuntime = html.includes('{{');

// Design-system tokens. The remote @import cannot resolve in a sandboxed page, so the two
// families are embedded below instead; the stacks keep fallbacks for the base64-stripped case.
ds = ds
  .replace(/@import url\([^)]*\);\s*/g, '')
  .replace(
    '--font-heading: "Caprasimo", system-ui, sans-serif;',
    '--font-heading: "Caprasimo", Georgia, "Iowan Old Style", "Palatino Linotype", serif;',
  )
  .replace(
    '--font-body: "Figtree", system-ui, sans-serif;',
    '--font-body: "Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;',
  );

// The design's own typefaces, embedded as data URIs so the page renders identically offline,
// behind a CSP, and from disk. Latin subset only; Figtree is variable across 400-800, which is
// the range the diagrams actually use. See tools/assets/fonts/README.md for provenance.
const fontDir = join(repoRoot, 'tools/assets/fonts');
const embed = (file: string): string =>
  readFileSync(join(fontDir, file)).toString('base64');
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, ' +
  'U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, ' +
  'U+2212, U+2215, U+FEFF, U+FFFD';
const fontFaces = `
@font-face {
  font-family: 'Caprasimo';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  unicode-range: ${LATIN};
  src: url(data:font/woff2;base64,${embed('caprasimo-400-latin.woff2')}) format('woff2');
}
@font-face {
  font-family: 'Figtree';
  font-style: normal;
  font-weight: 400 800;
  font-display: swap;
  unicode-range: ${LATIN};
  src: url(data:font/woff2;base64,${embed('figtree-400-800-latin.woff2')}) format('woff2');
}
`.trim();

const pageStyle = html.match(
  /<helmet>[\s\S]*?<style>([\s\S]*?)<\/style>[\s\S]*?<\/helmet>/,
)![1];

// `prefers-color-scheme` alone cannot be overridden by a viewer toggle, so where a page relies
// on it, mirror the dark declarations onto [data-theme="dark"] and guard the media query with
// [data-theme="light"]. Pages that set data-theme from script already win in both directions
// and are left untouched.
const darkBlock = pageStyle.match(
  /@media \(prefers-color-scheme: dark\)\{\s*:root\{([\s\S]*?)\}\s*\}/,
);
const themedStyle = darkBlock
  ? pageStyle.replace(
      /@media \(prefers-color-scheme: dark\)\{\s*:root\{[\s\S]*?\}\s*\}/,
      `@media (prefers-color-scheme: dark){\n  :root:not([data-theme="light"]){${darkBlock[1]}}\n}\n` +
        `:root[data-theme="dark"]{${darkBlock[1]}}`,
    )
  : pageStyle;

// A runtime-backed page keeps <x-dc> and its `text/x-dc` island — the runtime parses both.
// A plain-DOM page is unwrapped, and its island is rewritten below as an ordinary IIFE.
const inner = html
  .match(/<x-dc>([\s\S]*?)<\/x-dc>/)![1]
  .replace(/<helmet>[\s\S]*?<\/helmet>/, '')
  .trim();
const dcIsland = needsRuntime
  ? html.match(/<script type="text\/x-dc"[\s\S]*?<\/script>/)![0]
  : '';
const body = needsRuntime ? `<x-dc>\n${inner}\n</x-dc>\n${dcIsland}` : inner;

// React is fetched from a CDN by support.js unless the globals already exist, so inlining the
// two UMD builds ahead of it short-circuits that fetch. Versions and integrity are pinned by
// the runtime itself; tools/assets/dc-runtime/README.md records the verification.
const runtimeDir = join(repoRoot, 'tools/assets/dc-runtime');

// The runtime finds its template by regex-scanning raw document text for `<x-dc>`. Inlining
// support.js puts that literal — which it carries in an error message — earlier in the document
// than the real element, so it matches its own source and renders itself as the page. Escaping
// the `d` leaves the evaluated string identical and the raw bytes unmatchable.
const vendor = (f: string): string =>
  readFileSync(join(runtimeDir, f), 'utf8').replace(/<x-dc>/g, '<x-\\x64c>');
const runtimeScripts = needsRuntime
  ? ['react.production.min.js', 'react-dom.production.min.js', 'support.js']
      .map((f) => `<script>/* ${f} */\n${vendor(f)}\n</script>`)
      .join('\n')
  : '';

// A manifest is the page's machine-readable claim about what it asserts, so a check script can
// diff it against source and fail the build instead of letting the page rot. Newer exports
// declare their own; the agent pages did not, so one is generated from the policy file.
const declaredManifest = html.match(
  /<script type="application\/json" id="[a-zA-Z0-9-]*manifest">[\s\S]*?<\/script>/,
);

/** The subset of `tools/config/agent-model-policy.json` this generator reads. */
interface AgentMapPolicy {
  reviewedAt: string;
  agents: Record<string, { tier: string }>;
}

function generateAgentManifest(): string {
  const policy = JSON.parse(
    readFileSync(
      join(repoRoot, 'tools/config/agent-model-policy.json'),
      'utf8',
    ),
  ) as AgentMapPolicy;
  const agentsDir = join(repoRoot, '.github/agents');
  const displayNames: Record<string, string> = Object.fromEntries(
    readdirSync(agentsDir)
      .filter((f) => f.endsWith('.agent.md'))
      .map((f): [string, string] => [
        f.replace('.agent.md', ''),
        readFileSync(join(agentsDir, f), 'utf8')
          .match(/^name:\s*(.+)$/m)![1]
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]),
  );
  const manifest = {
    note: AGENT_MAP_MANIFEST_NOTE,
    policyReviewedAt: policy.reviewedAt,
    agents: Object.fromEntries(
      Object.entries(policy.agents)
        .map((entry): [string, string] => [
          displayNames[entry[0]] ?? entry[0],
          entry[1].tier,
        ])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  return `<script type="application/json" id="agent-map-manifest">\n${JSON.stringify(
    manifest,
    null,
    2,
  )}\n</script>`;
}

const manifestBlock = declaredManifest
  ? declaredManifest[0]
  : generateAgentManifest();

// Only the plain-DOM path needs this. The export's DCLogic subclass is ordinary JS once it has
// a base class to extend, props to read, and a setState that re-runs componentDidUpdate — so
// provide exactly that rather than reimplementing each page's behaviour by hand.
function unwrapDcLogic(source: string): string {
  const classSource = source.match(
    /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!classSource) return '';

  // `data-props` is HTML-escaped, and its real quotes are all entities, so the attribute value
  // never contains a raw `"`. Each entry's `default` is what the export renders with.
  const rawProps = source.match(/data-props="([^"]*)"/);
  let props: Record<string, unknown> = {};
  if (rawProps) {
    const decoded = rawProps[1]
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const decodedProps = JSON.parse(decoded) as Record<
      string,
      { default: unknown }
    >;
    props = Object.fromEntries(
      Object.entries(decodedProps).map((entry): [string, unknown] => [
        entry[0],
        entry[1].default,
      ]),
    );
  }

  return `
(function(){
  function DCLogic(){}
  DCLogic.prototype.setState = function(patch){
    this.state = Object.assign({}, this.state, patch);
    if (typeof this.componentDidUpdate === 'function') this.componentDidUpdate();
  };

${classSource[1].trim()}

  var instance = new Component();
  instance.props = ${JSON.stringify(props)};
  if (!instance.state) instance.state = {};
  if (typeof instance.componentDidMount === 'function') instance.componentDidMount();
})();
`.trim();
}

const script = needsRuntime ? '' : unwrapDcLogic(html);

const title = dcFile.replace('.dc.html', '');

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — MyOrganiser</title>
${manifestBlock}
${runtimeScripts}
<style>
${fontFaces}
</style>
<style>
${ds.trim()}
</style>
<style>
${themedStyle.trim()}
[data-map-root]{overflow-x:hidden}
@media (max-width:900px){
  [data-map-root] section > div[style*="grid-template-columns"]{overflow-x:auto}
}
</style>
</head>
<body>

${body}
${script ? `<script>\n${script}\n</script>` : ''}
</body>
</html>
`;

writeFileSync(outFile, out, 'utf8');
console.log(
  `wrote ${outFile} (${(out.length / 1024).toFixed(1)} KB, ${needsRuntime ? 'runtime inlined' : 'plain DOM'})`,
);
console.log(
  `manifest: ${declaredManifest ? 'carried through from the export' : 'generated from agent-model-policy.json'}`,
);
