# A screen scenario's QA Artifact is a Storyboard

## Status

accepted

Partly supersedes [ADR 0147](0147-a-qa-plans-scenarios-are-scripted-and-run-on-the-code-before-and-after-the-change.md): decision 5 entirely, and what `video` and `screenshot` mean in decision 4. The rest of ADR 0147 stands, including decision 6's upload rules.

## Context

ADR 0147 combined a fix's Before and After into one labelled side-by-side image, or a side-by-side MP4 plus a GIF preview. Run for real, the files did not stand alone. Someone holding only the file could not tell which scenario it was, what each side was expected to show, or which step a frame belonged to. The GIF was too small to read, and a scenario that opened a second device or tab had no way to show it.

## Decision

1. **A screen scenario's QA Artifact is a Storyboard.** A scenario whose `Capture:` is `video` or `screenshot` keeps a Storyboard PNG: its numbered steps, each a still cropped to what the step is about, under a band naming the scenario, what each side was expected to show and what it did, and the result (see **Storyboard** in `CONTEXT.md`). There is a column per side that ran, except that one column, After's, stands for both when the expected results are identical and both sides showed them. A run of After only has one column. In the one-column form each row carries a Before note: Before's caption when it differs from After's, or "Before: same step" when they match.
2. **A `video` scenario also keeps an annotated MP4.** It follows one tab, the one the scenario names, with the step captions and the Storyboard's band drawn on it. `screenshot` now means a Storyboard with no MP4, and `video` a Storyboard plus the MP4. The GIF preview, the labelled side-by-side pair and the bare pair are retired.
3. **A screen scenario declares what it is.** It declares its `title` and its per-side expected results, `expected.after` always and `expected.before` when Before runs, copied from the QA Plan. A `video` scenario also declares `tab`. The runner refuses a malformed script before the stack starts. A `transcript` or `none` scenario declares none of this.
4. **The runner owns devices and tabs.** A scenario reaches them through `device(name).tab(name)` and records each step with `step(page, caption, { subject })`. The runner opens, records, labels and closes every device and tab, so a scenario with two devices needs no recording code of its own.
5. **A Storyboard's text is checked before it is kept.** `qa:run` refuses a run with zero steps, and a run whose title, captions, expected or observed text contain a QA Account's password or vault passphrase, any value passed to `secret()`, or a match of the Request Transcript redactor's Bearer and JWT detectors. The check is a deny-list of exact substrings on purpose. It does not catch encoded, split or transformed variants: captions are written by the scenario's own author, the values are known exactly, and pixels already rely on "QA Accounts only" (ADR 0147 decision 6).
6. **`qa:combine` re-renders from saved step records.** `qa:run` saves each step record under `<out>/steps` beside the stills and recordings it kept. `qa:combine` re-renders a scenario's Storyboard, and its MP4 for a video scenario, from them, all or nothing. A bare Before/After file pair is refused.
7. **Upload eligibility is unchanged.** Only a combined file, now the Storyboard PNG or the annotated MP4, may be offered for upload, and ADR 0147 decision 6 decides which results. A lone Before or After is never offered.

## Considered Options

- **Keep the labelled pair and add captions to it.** A pair of whole screens still hides which part of the screen a step is about, and a GIF is too small to read.
- **Keep the GIF as the inline preview.** The Storyboard PNG shows inline already and is readable. A lossy palette-limited GIF added nothing.
- **Let each scenario script drive its own extra devices and recording.** It repeats the same boilerplate in every script and lets a script forget to label or close a device.
- **Catch encoded variants of a secret in captions.** Out of scope, as decision 5 says. File an issue if it matters.
