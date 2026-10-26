# Next.js Proxy is not a Session or authorization layer

Next.js 16 renamed `middleware.ts` to `proxy.ts` (Node.js runtime only). Tutorials still treat that file as the place to put auth gates. MyOrganiser already has a Session on Express and Vault Unlock on the client. We will not add a Next.js Proxy (or deprecated `middleware.ts`) as a Session or authorization layer.

## Status

accepted

## Decision

- This app has no `proxy.ts` or Next.js `middleware.ts`. Agents must not add one unless a ticket **explicitly** asks for Next.js request interception.
- If interception is required, the only live convention is `proxy.ts` (Node.js only). Do not teach or create `middleware.ts`, including the deprecated Edge hatch.
- Prefer `next.config` `redirects` / `rewrites` for static routing. Proxy is a last resort.
- Auth remains Express (Session, Access Token, Refresh Token) and client Vault Unlock / Master Key. Next.js Proxy is not a substitute for those.

Instruction truth for this pin lives in `AGENTS.md`. Other instruction files point there; they do not duplicate a proxy paragraph. Component hygiene scripts do not enforce this — they own component shape, not the Next.js app root ([ADR 0014](0014-component-pipeline-guardrails.md)).

## Considered Options

- **Record both official lines and pick no winner** (`proxy` equals middleware vs Node-only / keep Edge `middleware`) — rejected. Agents invent `middleware.ts`. This app has no Edge requirement. “Middleware” here already means Express.
- **Teach `proxy.ts` as the default place for auth checks** — rejected. Upstream itself says Proxy is not a full session or authorization solution. Session and Vault Unlock already have homes.
- **Hard-ban any future Proxy** — rejected. A later ticket may need request interception. The standing constraint is “do not add the layer unless asked,” not “the file is forbidden forever.”
- **Enforce “no Proxy” in `check-component-hygiene.ts`** — rejected. That script never scans `apps/web`. A layout invariant at the wrong layer is ADR 0014’s false-positive class.

## Consequences

- Missing `middleware.ts` is deliberate, not an omission.
- A drive-by `proxy.ts` is an architecture change, not instruction-following.
- Version claims stay in `TECH_STACK.md` ([ADR 0001](0001-tech-stack-single-source-of-truth.md)). Next.js API-shape claims stay in `AGENTS.md`.
