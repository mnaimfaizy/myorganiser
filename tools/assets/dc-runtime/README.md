# Vendored design-canvas runtime

[`docs/agents/agent-journey.html`](../../../docs/agents/agent-journey.html) is an interactive
page: it binds `{{ }}` templates, `<sc-for>` and `<sc-if>`, so it needs the design tool's runtime
to render at all. `tools/scripts/build-agent-map.ts` inlines these three files ahead of the
page's markup. [`orchestration-map.html`](../../../docs/agents/orchestration-map.html) binds
nothing and is plain DOM, so it gets none of this — the builder decides per page.

| File                            | Source                                              |
| ------------------------------- | --------------------------------------------------- |
| `react.production.min.js`       | `https://unpkg.com/react@18.3.1/umd/…`              |
| `react-dom.production.min.js`   | `https://unpkg.com/react-dom@18.3.1/umd/…`          |
| `support.js`                    | Emitted by the design tool alongside each `.dc.html` |

React and ReactDOM are MIT licensed. Both were verified on download against the SRI hashes
`support.js` itself pins for them — the runtime fetches these exact builds from a CDN when the
globals are absent, so inlining them ahead of it makes that fetch short-circuit:

```
sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z  react
sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1  react-dom
```

Recompute with `openssl dgst -sha384 -binary <file> | openssl base64 -A` after any update, and
check the hashes still match the `REACT_URL` / `REACT_SRI` constants in `support.js`.

## The `<x-dc>` escape, and why the build applies it

`support.js` locates the page's template by regex-scanning raw document text for `<x-dc>`. It
also carries that literal inside an error message. Inlining it therefore places a matching
`<x-dc>` *earlier in the document than the real element*, and the runtime binds to its own
source — rendering a wall of minified JavaScript instead of the page.

The builder rewrites `<x-dc>` to `<x-\x64c>` in the vendored copy as it inlines. The escape is
resolved by the JavaScript parser, so every evaluated string is byte-identical; only the raw
source stops matching. If a future runtime version introduces another such literal, the symptom
is unmistakable — the page renders its own source — and the fix is the same escape.

## Babel is not fetched

`support.js` also pins a Babel URL, but `ensureBabel()` runs only for external modules of kind
`jsx`. These pages have none, so it never loads. Nothing here touches the network at render time;
that is verified by loading the page with no console errors and no outbound requests.
