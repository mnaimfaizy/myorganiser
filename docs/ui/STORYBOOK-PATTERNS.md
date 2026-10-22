# Storybook Authoring Patterns

> Code-level patterns for writing `*.stories.tsx` in this repo.
> Setup, Chromatic, and commands live in [`docs/storybook/README.md`](../storybook/README.md).
> Component rules live in [`GUIDELINES.md`](./GUIDELINES.md).
> This file is the single home for story patterns — `StorybookCurator` reads it instead of carrying copies in its prompt.

A colocated story is required for every UI Primitive and every Vault UI Component the glob is meant to show. Follow the patterns here rather than generalising from whichever story you happened to open. Feature Components stay out of Storybook. Non-UI `web-vault-ui` exports (`session`, `vaultGate`, `reconcileRunner`) are not this rule.

---

## 1. Where stories live

| Library             | Story location                                                        | Picked up by                                  |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| `libs/web/ui`       | Next to the component: `src/lib/components/<Name>/<Name>.stories.tsx` | `../src/lib/**/*.stories.@(js\|jsx\|ts\|tsx)` |
| `libs/web/vault-ui` | Next to the component under `src/lib/`                                | Also globbed by the `web-ui` Storybook config |

Both libraries are served by the **same** Storybook instance (`libs/web/ui/.storybook/main.ts`). A story placed outside `src/lib/` is silently never loaded — no error, it just does not appear.

**Standing rule.** If the glob is meant to show the component, the component ships with a story:

- UI Primitives in `libs/web/ui` — required (GUIDELINES §1).
- Vault UI Components in `libs/web/vault-ui` (`CloudBackupCard`, `LastBackupCard`) — required. They know vault domain, so they are not primitives; they still must be mock-props-expressible.
- Non-UI modules in `web-vault-ui` (`session`, `vaultGate`, `reconcileRunner`, error-message helpers) — no story.

Feature Components in `libs/web/pages/` default to no story. They depend on domain state, so they belong in tests. If a feature component seems worth a story, that is usually a signal it should have been a UI Primitive or a Vault UI Component — raise it.

The glob reaches `libs/web/pages/*/src/**` for the exceptions an issue asks for by name: a state carried by colour, which Jest cannot see (the groceries selection states), and the dashboard shell chrome (sidebar, header and account menu, phone tab bar, app bar and More, #1276). Such a story mounts the contexts the component reads — pathname, router, Vault Session, current user — from one fixtures file beside it; it does not mock modules.

## 2. Title and metadata

```typescript
const meta: Meta<typeof Card> = {
  component: Card,
  title: 'Components/Card', // always Components/<ComponentName>
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Card>;
```

`title` is `Components/<Name>` for UI Primitives — the sidebar grouping depends on it. Vault UI Components use `Vault/<Name>` (see `LastBackupCard`). The dashboard shell's page-library stories (§1) use `Dashboard/Shell/<Name>`, so the chrome sits together. `tags: ['autodocs']` is standard for every story file here.

## 3. Pattern A — single component with CVA variants

Use `args` and `argTypes`. This is the only case where plain `args` is the right tool.

Enumerate every CVA variant and size in `argTypes.options` so the Controls panel is explorable, then export one named story per variant that a reviewer would actually want to compare side by side. `Button.stories.tsx` is the reference implementation.

```typescript
const meta: Meta<typeof Badge> = {
  component: Badge,
  title: 'Components/Badge',
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'destructive', 'outline'],
      description: 'The visual style variant of the badge',
    },
  },
};

export const Destructive: Story = {
  args: { children: 'Overdue', variant: 'destructive' },
};
```

Prefer realistic content over placeholder text. `children: 'Overdue'` tells a reviewer what a destructive badge is _for_; `children: 'Badge'` does not.

## 4. Pattern B — compound components need a wrapper

**A compound component cannot be driven by `args`.** `Card`, `Dialog`, `Select`, `Table`, `DropdownMenu`, and `Form` are composed of a JSX tree, and a tree is not a prop. Passing `children` through `args` gives you an unreadable story and a useless Controls panel.

Write a wrapper component in the story file and type `Meta` against **the wrapper**, not the primitive:

```typescript
function DialogExample() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm action</DialogTitle>
          <DialogDescription>Review the details before confirming.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>OK</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const meta: Meta<typeof DialogExample> = {
  component: DialogExample,
  title: 'Components/Dialog',
  tags: ['autodocs'],
};
```

`Dialog.stories.tsx` is the reference. It must include an **open** story (`defaultOpen` on Root, or `play`) so portalled content is visible — a closed `Default` trigger-only set is not finished work. Where several arrangements are worth showing (a Card with and without a footer, say), write one wrapper per arrangement rather than one wrapper with boolean props — the point of the story is to show the composition.

The trade-off: `argTypes` controls are lost, because the wrapper has no interesting props. That is correct. Anyone exploring a compound component is exploring its structure, not its prop surface.

## 5. Pattern C — controlled and stateful primitives

`Checkbox`, `Select`, `Combobox`, `Popover`, `Collapsible`, and `Sheet` are controlled. A story with a static `checked` value renders a control that visibly does not respond to clicks, which reads as a bug.

Use `render` with local state:

```typescript
export const Interactive: Story = {
  render: function Render() {
    const [checked, setChecked] = useState(false);
    return <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />;
  },
};
```

Declare `render` as a **named function** (`function Render()`), not an arrow — hooks inside an anonymous arrow trip the rules-of-hooks lint.

### Mount-point primitives (`Toaster`)

`Toaster` is a UI Primitive that reads `useToast()` and mounts `Toast` + `ToastViewport`. Cover Toast visuals on `Toast`. Prove `Toaster` has no domain knowledge with a Pattern C story whose `play` function calls `toast({ title, description })` (exported next to `useToast`). Do not skip it as "not visual."

```typescript
import { toast } from '../../hooks/use-toast';
import { Toaster } from './Toaster';

export const ShowsToast: Story = {
  render: function Render() {
    return <Toaster />;
  },
  play: async () => {
    toast({ title: 'Backup complete', description: 'Last snapshot is ready to restore.' });
    await expect(within(document.body).getByText('Backup complete')).toBeVisible();
  },
};
```

## 6. Radix portals

`Dialog`, `Sheet`, `Popover`, `Tooltip`, `Select`, and `DropdownMenu` render their content through a portal, attached to `document.body` rather than inside the story canvas.

Consequences to plan for:

- The autodocs snapshot shows **only the trigger** — the interesting part is invisible until opened.
- Chromatic captures the closed state unless the story opens the content.

To show the open state, either set the primitive's `open`/`defaultOpen` prop in the wrapper, or drive it with a `play` function (§7). Prefer `defaultOpen` for a pure visual story; use `play` when the opening interaction itself is what you are documenting.

## 7. Interaction tests with `play`

`@storybook/test` and `@storybook/addon-interactions` are installed. A `play` function turns a story into an assertion that runs under `npx nx test-storybook web-ui`.

```typescript
import { expect, userEvent, waitFor, within } from '@storybook/test';

export const OpensOnClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Open dialog' }));
    // Portalled content lives outside canvasElement — query the document body.
    // waitFor: enter animations (`fade-in-0`) start at opacity 0; one-shot
    // toBeVisible() fails mid-animation even when data-state is already open.
    await waitFor(() => {
      expect(within(document.body).getByRole('dialog')).toBeVisible();
    });
  },
};
```

The portal caveat matters here: `within(canvasElement)` will not find portalled content. Query `document.body` for anything Radix portals out.

Add `play` for behaviour a static image cannot show — open/close, validation appearing, a disabled control refusing input. Do not re-test logic that already has Jest coverage.

## 8. Required coverage

A story set is not done at "Default". Cover what a reviewer needs to make a judgment:

| Applies when                             | Story to add                                                       |
| ---------------------------------------- | ------------------------------------------------------------------ |
| The component has CVA variants           | One per variant, plus every size                                   |
| The component can be disabled            | `Disabled`                                                         |
| It accepts user input                    | Error/invalid state, and empty state                               |
| It renders a collection                  | Empty, one item, many items                                        |
| It renders user-supplied text            | Long-content overflow — the truncation/wrap behaviour is the point |
| It has an async or loading state         | Loading/skeleton                                                   |
| It is interactive (opens, toggles, etc.) | Open/expanded state, via `defaultOpen` or `play`                   |

Long-content and empty states are the two most often skipped and the two that most often expose layout bugs.

### A state that renders nothing gets no story

The table above says which states are worth showing. It does not say every state is. **If a state renders no visible output, it does not get a story** — delete it rather than explaining it.

A story of such a state is a blank canvas. It is indistinguishable from a story that failed to load, it is identical to every other state that also renders nothing, and it spends a Chromatic snapshot asserting the absence of pixels. Two blank stories side by side are worse still: a reviewer cannot tell them apart, so the catalogue implies a difference it cannot show.

Rendering nothing is often a real contract — a healthy status indicator that deliberately adds no chrome, a banner that stays absent until something is wrong. Assert it in the component's spec, where an assertion can name the DOM it expects. Storybook is a visual catalogue; a thing with no appearance has no entry in it.

Where the absence is surprising enough that a reader would otherwise add the story back, say so once in a comment on `meta` and point at the spec that covers it.

Do not reach for a decorator, a wrapper, or a caption to make the blankness legible. That makes the _story_ visible, not the component, and it puts Storybook furniture in a catalogue of production output.

## 9. Accessibility in stories

Stories are where a11y defects become visible, so do not encode them into the examples.

**Every icon-only control needs an accessible name.** Do not use emoji as the sole label of an icon button:

```typescript
// ❌ no accessible name
export const Icon: Story = {
  args: { children: '🔍', size: 'icon' },
};
```

That violates GUIDELINES §7 and teaches the wrong pattern to anyone copying it. The correct form:

```typescript
export const Icon: Story = {
  args: {
    children: <Search aria-hidden="true" className="h-4 w-4" />,
    size: 'icon',
    'aria-label': 'Search',
  },
};
```

Also: label every form input in a story the way a real page would, and prefer `lucide-react` icons over emoji — emoji are announced by screen readers with their unicode name.

## 10. Determinism

Stories are rendered by Chromatic and the test-runner, so anything non-deterministic becomes a flaky diff.

- No `fetch`, no API clients, no `@myorganiser/app-api-client`. Pass data as props.
- No `new Date()`, `Date.now()`, `Math.random()`, or `crypto.randomUUID()` — pin a fixed date and fixed ids.
- No live Vault, no decryption. UI Primitives must not take domain records. Vault UI Components may take mock backup/restore props (GUIDELINES §1). If a `web-ui` primitive appears to need vault data, it does not belong there.
- No `setTimeout`-driven visual states.

## 11. Viewport-dependent stories

A story whose behaviour depends on width declares it twice — once for the test-runner, once for Chromatic:

```tsx
export const OpensOnClick: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    chromatic: { viewports: [320] },
  },
  play: async ({ canvasElement }) => {
    /* … */
  },
};
```

Neither parameter is decoration, and neither one covers the other:

- **`viewport`** is read by the `preVisit` hook in `libs/web/ui/.storybook/test-runner.ts`, which resizes the Playwright page **before** the story renders. Without it the runner loads every story at its own page size, nothing reads `defaultViewport`, and a width-sensitive hook such as `useIsMobile` stays false while a `play` function waits for a mobile-only element. The hook also resets to a desktop size for every story that names no viewport, so a mobile story cannot leak its width into the next one on the same page.
- **`chromatic.viewports`** is read by Chromatic, which builds the Storybook from `main.ts` and `preview.ts` and never loads `test-runner.ts`. A `play` function that needs a narrow width fails in Chromatic without it. Give it one width, not a list — each extra width is another snapshot against the plan cap (ADR 0027).

Consequences for authors:

- Named viewports must be one of `mobile1`, `mobile2`, `tablet`, or declared inline under `parameters.viewport.viewports` with `px` dimensions. Anything else fails the story loudly rather than silently rendering at desktop width.
- Do not assert on width in a `play` function without declaring both parameters — the runner default is 1280×720 and the Chromatic default is wider still.
- The resolver behind the hook is unit tested in `libs/web/ui/.storybook/viewport-page-size.test.ts`.

Running the play tests locally: see [`docs/storybook/README.md`](../storybook/README.md).

## Anti-patterns

| Anti-pattern                                                             | Why it fails                                                         | Instead                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `args: { children: <CardHeader>…</CardHeader> }` on a compound component | Unreadable story, useless controls                                   | Wrapper component (§4)                                           |
| Static `checked`/`value` on a controlled primitive                       | Control appears broken                                               | `render` with local state (§5)                                   |
| Story file outside `src/lib/`                                            | Silently never loaded                                                | Colocate with the component (§1)                                 |
| `render: () => { const [x] = useState() … }`                             | Rules-of-hooks violation in an anonymous arrow                       | `render: function Render() { … }` (§5)                           |
| `within(canvasElement)` for portalled content                            | Radix renders to `document.body`; the query finds nothing            | `within(document.body)` (§7)                                     |
| Only a `Default` story                                                   | Reviewers cannot see the states that break                           | Coverage table (§8)                                              |
| Emoji or bare icon as the whole button label                             | No accessible name                                                   | Icon + `aria-label` (§9)                                         |
| Skipping `Toaster` because it is a mount point                           | Never tests GUIDELINES §1 for that primitive                         | `play` that calls `toast()` (§5)                                 |
| Fetching or generating data in a story                                   | Non-deterministic Chromatic diffs                                    | Fixed props (§10)                                                |
| `play` asserting mobile behaviour with no `viewport` parameter           | Page renders at 1280×720; the assertion times out                    | Declare `parameters.viewport` (§11)                              |
| A story for a `libs/web/pages/` component no issue asked for             | Depends on domain state; tests cover it                              | Test it, or promote it to a primitive or Vault UI Component (§1) |
| A story for a state that renders nothing                                 | Blank canvas; reads as broken, and two of them are indistinguishable | Delete it; assert the absence in the spec (§8)                   |
| A decorator or caption added to make an empty story legible              | Makes the story visible, not the component                           | Delete the story (§8)                                            |
