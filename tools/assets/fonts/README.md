# Embedded fonts

The two typefaces used by [`docs/agents/orchestration-map.html`](../../../docs/agents/orchestration-map.html).
They are embedded as base64 data URIs in that page's `@font-face` block so it renders
identically from disk, offline, and inside a sandbox that blocks external hosts. Nothing at
render time touches the network. `tools/scripts/build-agent-map.ts` inlined them on first
import; that page is no longer reproducible from the importer (ADR 0052).

| File                          | Family    | Weights           | Subset |
| ----------------------------- | --------- | ----------------- | ------ |
| `caprasimo-400-latin.woff2`   | Caprasimo | 400               | latin  |
| `figtree-400-800-latin.woff2` | Figtree   | 400–800, variable | latin  |

Figtree is a variable font, so one file covers every weight the diagram uses — cheaper than
five static cuts. Only the latin subset is vendored; the page is English, and the font stacks
in the page CSS keep their fallbacks for anything outside that range.

## Licence

Both are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/), which
permits embedding and redistribution. Neither is sold, and neither is distributed under a
different name — the two conditions the OFL actually constrains.

- Caprasimo — <https://fonts.google.com/specimen/Caprasimo>
- Figtree — <https://fonts.google.com/specimen/Figtree>

## Refreshing

These are pinned copies of what Google Fonts served for the latin subset. To update, re-resolve
the woff2 URLs (the CSS endpoint returns different files depending on the requesting browser,
so a modern desktop User-Agent is required to get woff2 rather than ttf):

```bash
curl -sS -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400..800&display=swap"
```

Download the URLs under the `/* latin */` blocks, replace the files above, then re-embed them
into `docs/agents/orchestration-map.html`'s `@font-face` block — edit the page in place via
design-brief → Designer (ADR 0046). Do not rebuild with `build-agent-map.ts`.
Verify each download starts with the `wOF2` magic bytes (`774f4632`) before committing — an
error page saved as `.woff2` fails silently at render time.
