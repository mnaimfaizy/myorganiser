---
name: design-brief
description: 'Design brief for a Designer agent — turns a request for a visual (diagram, animated walkthrough, explainer page) into a prompt someone else executes. Grounds every claim in real source constants when the subject is code; interviews the user when it is not.'
---

# Design Brief

Write the prompt. Do not write the design.

The deliverable is a Markdown brief handed to the Designer sub-agent
(`.github/agents/designer.agent.md`), which produces the artifact. If you find yourself choosing
colours or laying out a diagram, you have left this skill.

Dispatch to Designer, not to a general-purpose agent. Designer owns the house conventions — the
canonical `@font-face` block, the three-state theme tokens, the accessible-name pattern that does
not grow a tooltip — so the brief does not have to re-teach them, and `yarn design:hygiene` gates
what comes back. Briefing a generalist re-derives all of it, and shipped a full-canvas tooltip
that reached users before anyone reported it ([ADR 0046](../../../docs/adr/0046-house-explainer-pages-have-a-designer-and-a-gate.md)).

## Use This Skill When

- The user wants a diagram, animated walkthrough, explainer page, or architecture visual.
- The user asks for "a prompt for the Designer" or wants to brief a visual rather than build one.
- An existing design came back thin, wrong, or confusing and needs a corrective brief.

## Core Rules

- **A brief without a stated audience and one question is not finished.** See step 1.
- **Every factual claim must be traceable.** On the grounded branch that means `file:line`. On the
  ungrounded branch it means an assumption the user stated, recorded as an assumption.
- **Run the collision check.** Skipping it is how a wrong constant reaches a published page that
  readers then trust. See `GROUNDING.md`.
- Do not pad the brief with visual instructions the Designer is better at choosing. Give it facts,
  constraints, and the one question — then get out of the way.
- Do not let the brief grow a section per idea you had. Anti-goals are where scope is bought back.

## Workflow

### 1. Fix the audience and the one question

Write one sentence before anything else:

> A **[reader]** should be able to answer **[question]** from the artifact alone.

Examples that worked: _"An engineer onboarding to this repo should be able to answer: if I ask for
a new UI component with tests, which agents run and who can reject whom?"_ and _"A developer
should be able to answer: if I add this API call, does it cross the boundary?"_

If you cannot write that sentence, you have a topic, not a brief. Ask the user for the missing
half before continuing. Every later decision is judged against this sentence.

### 2. Choose the branch

Ask: **is there a source of truth that could prove this brief wrong?**

- **Yes — grounded.** Code, schema, config, logs, an API contract. The failure mode is _wrong
  facts_. Go to step 3a.
- **No — ungrounded.** A concept, a pitch, a proposed process nobody has written down. The failure
  mode is _vague facts_. Go to step 3b.

Mixed subjects are grounded. If any part of the brief can be checked against a file, check it.

### 3a. Grounded — do the legwork

**Read `GROUNDING.md` (sibling to this file) and follow it.** It is the long half of this skill
and the reason a grounded brief is worth more than a template.

Do not substitute documentation for source. Docs describe intent; the brief must describe
behaviour. Where the two disagree, the source wins and the disagreement is worth reporting to the
user.

### 3b. Ungrounded — interview until the abstractions have edges

The user is the only source of truth, so the brief can only be as sharp as their answers. Push on:

- **The one question** — if they cannot state who reads this and what it settles, nothing else
  matters yet.
- **The concrete referent** — for each element, what is it actually a picture _of_? "The user
  journey" is not an answer; "signup through first successful invoice" is.
- **The failure it prevents** — what does someone currently get wrong, and what does that cost?
- **What it is not** — the fastest way to find the edges of a fuzzy request.
- **Scale and shape** — how many things, how many steps, how many states. A brief that does not
  say "seven scenes" or "nineteen agents" leaves the Designer guessing at composition.

Record the answers in the brief as **stated assumptions**. Nothing here can be cited, so say so
plainly rather than implying a rigour the brief does not have.

### 4. Draft the brief

Use the anatomy below. Every section earns its place or is cut.

### 5. Verify before handing over

Run the completion criteria at the end of this file. On the grounded branch, the collision check
is not optional.

### 6. Close the loop (grounded only)

Require an embedded manifest so the artifact can be checked against the code later. See
**Machine-readable requirement** in the anatomy. Without it, the page starts rotting on the day it
is committed and no one finds out.

## The Brief Anatomy

Each section, in order. Cut any that is empty; do not invent filler to complete the set.

**What I want.** The artifact and its hard constraints. Default deliverable contract for this
repo: a self-contained HTML page, no CDN, no external assets, no network at load, correct in light
and dark. Add that a page with no template bindings ships far smaller, so interactivity should
earn its place.

**Why this exists.** State the concrete failure the artifact prevents, not the topic it covers.
"An engineer adds a convenience endpoint and quietly moves plaintext across a line they could not
see" produced a far better design than "document the vault architecture" would have. This section
is what makes the Designer choose the right hero.

**The system in one sentence.** If it takes two, the artifact probably needs to be two artifacts.

**The hero.** What must be visually obvious above everything else, and why it is the spine rather
than one element among many.

**Supporting panels.** One idea each. Name what each panel settles.

**Visual guidance.** Only what carries meaning: what must be distinguishable from what, what must
dominate, what must not be conveyed by motion or colour alone. Do not art-direct.

**Anti-goals.** What this is not. Always include the audience anti-goal where it applies — for
this repo, these pages are for humans, and the Designer should not compromise the reading
experience for machine consumption.

**Machine-readable requirement (grounded only).** One JSON block with the constants the artifact
asserts, so a check script can diff it against the exported source constants. Name the keys by
scope — `envelopeParseBytes`, `backendExportBytes` — never one ambiguous `maxBytes`. Ambiguous
names are how a wrong value survives review.

**Which facts go in it, and what to do with the rest.** A page states no claim it does not assert
([ADR 0085](../../../docs/adr/0085-an-artifact-states-no-claim-it-does-not-assert.md)). The test is
not "would a reader act on this number" — that is a judgment call the next brief re-litigates — but
whether the fact is _assertable_: could an extractor read it from the tree? If yes, the manifest
asserts it.

If a fact is assertable and not worth an extractor, **do not print it unasserted — state less**.
Prefer a universally-quantified claim to a counted one wherever a gate already proves the universal:
_"every `setup-node` step pins `'22'`"_ over _"14 `setup-node` steps pin `'22'`"_. The universal is
the stronger claim, needs no new key, and is already covered by the extractor that asserts sameness
across every match. The counted form was the weaker one, and it is the half that drifted — the page
said 14 while the tree held 18, for two weeks, with nothing noticing.

Brief the prose accordingly. A count the brief asks for is a count someone has to keep true.

**A `file:line` citation carries an expected-content anchor.** A citation is a claim about a line,
and a line number that still resolves is not a citation that is still true: all 19 stale citations
on `release-pipeline.html` pointed at lines that exist, and one of them claimed
`environment: production` over a line reading `rm -f "$RUNNER_TEMP/host_apply_key"`. So the page
carries a second JSON block, `id="citation-anchors"`, recording what it says is at each line:

```html
<script type="application/json" id="citation-anchors">
  {
    "note": "…what this block is, and the date it was verified against the tree…",
    "anchors": {
      "deploy-production.yml:128": {
        "file": ".github/workflows/deploy-production.yml",
        "start": "environment: production"
      },
      "deploy-production.yml:40-50": {
        "file": ".github/workflows/deploy-production.yml",
        "start": "- name: Validate release branch",
        "end": "exit 1"
      }
    }
  }
</script>
```

One block per page, holding one entry per **distinct** citation — the same `file:line` written in
four places is one claim, and one entry keeps it from disagreeing with itself. The key is
`name:line` or `name:start-end` with the name the citation resolves to, not the characters the page
happens to print: most citations on a page are bare (`:181`, `:126-141`) and inherit the last file
named ahead of them, so writing the key as printed would leave every one of them unkeyable and the
same line anchored twice under two spellings. `file` then resolves that name to a repo-relative
path, because `package.json` and `SKILL.md` each match several files and "some file of that name is
long enough" is not the claim. `start` is the literal text at the cited line and `end` the literal text at the
last line of a range — **both ends, so a range that grows or shrinks at either end is caught** —
whitespace-normalised on comparison, following `verifyCitation` in
`tools/scripts/review/obligations.ts`.

`file` is itself a claim, so the gate fails a citation whose `file` cannot be read or whose cited
line is past that file's end (`citation-anchor-unreadable`), rather than passing it unverified. An
anchor nobody can check asserts nothing, which is the state this whole block exists to leave.

The both-ends claim holds only as far as the end line says something. `release.mjs:16-24` ends on a
bare `}` and line 23 is `  }`, which normalises to the same string, so a one-line shrink there
verifies anyway. Prefer a range whose last line is distinctive; where the source offers none, the
anchor is weaker than the rule sounds, and writing that down costs less than discovering it from a
green check.

**The block holds an entry only for a citation the gate reads.** An entry that keys nothing is never
looked up, so it can quote anything while reading as though it had been checked; the gate fails it
as `citation-anchor-orphan`, and the anchor baseline does not excuse it. A block the gate cannot
read at all — invalid JSON, or no `anchors` map — fails as `citation-anchor-block-invalid`. What the
gate reads is narrower than what a reader sees, in two places a brief has to know about:

- **A continuation line needs its colon.** `main.mts:153, :205, :1642-1687` is three citations;
  `main.mts:153, 205, 1642-1687` is one, followed by two numbers the gate cannot read
  (`citation-continuation-unparsed`). Four sandcastle pages wrote the second form, and every anchor
  for the unread lines passed — some quoting text that was not at the line (#822).
- **A citation rendered from script data names its file in the same string.** The gate reads the
  string literals of every non-JSON `<script>` — a walkthrough's scenes, an edge table — so those
  citations resolve, carry anchors, and match like any other (#982). The grammar there is narrower
  than in markup, because script is full of `name:digit` shapes that are not citations: a name
  counts only with a known file extension, and a bare `:205` inherits only a file cited earlier in
  that same string. `refs: ['main.mts:153, :205']` is two citations; `code: '// :205'` beside it is
  none, and nothing reports it. A citation in a script comment is not read either. Where a string
  cannot carry the file name, the block's `note` says which lines it does not cover.

Why a block rather than an attribute beside each citation: citations arrive four or five to a text
node (`<td class="cite">deploy-production.yml:3-4, :128, :181, :293</td>`, an SVG `<text>` label),
so an inline anchor means splitting hand-tuned markup that `.prettierignore` exists to protect. The
block is also the one form that is identical across every markup a citation uses.

**Write the anchor from the page's claim, not from the line.** Copying whatever the line currently
says converts a stale citation into a permanently green one, which is worse than the drift: it
makes a false claim gate-backed. If the two disagree, the citation is wrong — fix the line number
first, in its own commit, and say why.

This is the marker ADR 0043 rejected only in shape, not in substance. That objection holds when the
marker is what makes a claim findable — a document that forgets it passes by being invisible. A
citation's `file:line` syntax cannot be dropped without it ceasing to be a citation, so a citation
carrying no anchor is detectable, and can be failed.

## Two Devices Worth Requesting

**The reading test.** A line inside the artifact that converts it from a poster into a review
tool: _"if your change adds an arrow leaving Zone A, it may carry ciphertext or metadata —
nothing else."_ Ask for one in every brief. It is what makes a diagram usable in a pull request.

**The halt.** If the artifact animates or steps through a process that pauses for a human in real
life, the artifact must pause too, and must not be advanceable past that point without an explicit
approval action. An animation that glides through a blocking gate teaches the opposite of the
truth.

## Splitting One Brief Into Two

A reference you consult and a story you watch once are different artifacts. Symptoms that a brief
is carrying both: the hero diagram needs a legend to be read at all; the page opens with a wall of
constants before any narrative; a single column has to show two opposite directions of flow.

When that happens, propose two canvases and say which is which. Do not silently write one brief
that tries to satisfy both readings.

## Completion Criteria

A brief is finished when all of these hold. State the branch you took when handing it over.

Both branches:

- [ ] The audience-and-one-question sentence is written and appears in the brief.
- [ ] Every section of the anatomy is present or deliberately cut.
- [ ] Anti-goals are stated.
- [ ] The brief specifies the artifact, not the aesthetics.

Grounded branch, additionally:

- [ ] Every number, identifier, and error code in the brief is traced to a `file:line`.
- [ ] **Every constant name has been searched repo-wide for a conflicting definition, and each
      distinct value is reported with its scope.**
- [ ] Source was read directly; no claim rests only on documentation.
- [ ] The machine-readable manifest requirement is included, with scope-qualified key names.
- [ ] Any contradiction found between docs and source has been surfaced to the user.

Ungrounded branch, additionally:

- [ ] Every element has a concrete referent, not a category.
- [ ] Assumptions are labelled as assumptions in the brief.
- [ ] Scale and shape are stated (how many things, steps, or states).
