# Storybook Setup

This project uses [Storybook](https://storybook.js.org/) for developing and showcasing UI components in isolation.

## Local Development

### Running Storybook

To start the Storybook development server:

```bash
yarn storybook
```

This will start Storybook on `http://localhost:4400` (default port may vary).

Alternatively, you can use the Nx command directly:

```bash
npx nx storybook web-ui
```

### Building Storybook

To build a static version of Storybook:

```bash
yarn build-storybook
```

The static files will be generated in `libs/web/ui/storybook-static/`.

### Running story play tests

`play` functions are executed by [`@storybook/test-runner`](https://storybook.js.org/docs/writing-tests/test-runner) against a served static build:

```bash
yarn build-storybook
```

```bash
corepack yarn dlx http-server libs/web/ui/storybook-static -p 6199 --silent
```

```bash
yarn test-storybook --url http://127.0.0.1:6199
```

Append a pattern to narrow the run, e.g. `yarn test-storybook --url http://127.0.0.1:6199 Sidebar`.

The runner reads `libs/web/ui/.storybook/test-runner.ts`, whose `preVisit` hook applies each story's `viewport` parameter to the Playwright page — see [`docs/ui/STORYBOOK-PATTERNS.md`](../ui/STORYBOOK-PATTERNS.md) §11 for what a width-dependent story has to declare.

Note that `nx lint web-ui` lints the generated `libs/web/ui/storybook-static/` directory if it is left on disk; remove the build output when you are done.

## Writing Stories

> **Authoring patterns live in [`docs/ui/STORYBOOK-PATTERNS.md`](../ui/STORYBOOK-PATTERNS.md)** — compound-component wrappers, controlled primitives, Radix portals, `play` functions, required coverage, accessibility, and the anti-pattern table. This file covers setup and commands only.

Stories are located alongside components in the `libs/web/ui/src/lib/components/` directory.

### AI Delegation Workflow

When using AI agents for Storybook tasks, route requests through the Storybook delegation workflow instead of editing stories inline in the main agent context.

- Skill: `.agents/skills/storybook-delegation-workflow/SKILL.md`
- Copilot sub-agent: `.github/agents/storybook-curator.agent.md`
- Claude sub-agent: `.claude/agents/storybook-curator.md`
- Gemini sub-agent: `.gemini/agents/storybook-curator.md`

The sub-agent must analyze requirement quality before file edits, request clarification when requirements are incomplete, and may challenge weak requirements to keep UX/accessibility quality high.

### Example Story Structure

Create a file with the `.stories.tsx` extension next to your component:

```typescript
import type { Meta, StoryObj } from '@storybook/react';
import { YourComponent } from './YourComponent';

const meta: Meta<typeof YourComponent> = {
  component: YourComponent,
  title: 'Components/YourComponent',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof YourComponent>;

export const Default: Story = {
  args: {
    // component props
  },
};
```

See `libs/web/ui/src/lib/components/Button/Button.stories.tsx` for a complete example of a single component with variants, and `Dialog/Dialog.stories.tsx` for a compound component. Note that the shape above only works for single components — a compound component needs the wrapper pattern (`STORYBOOK-PATTERNS.md` §4).

## Project Structure

```
libs/web/ui/
├── .storybook/
│   ├── main.ts              # Storybook configuration
│   ├── preview.ts           # Global decorators and parameters
│   └── preview-styles.css   # Global styles (Tailwind CSS)
├── src/
│   └── lib/
│       └── components/
│           └── Button/
│               ├── Button.tsx
│               └── Button.stories.tsx
├── tailwind.config.js       # Tailwind configuration
└── postcss.config.js        # PostCSS configuration
```

## Available Storybook Addons

The following addons are pre-configured:

- **@storybook/addon-essentials**: Essential addons including:
  - Controls: Dynamic component prop editing
  - Actions: UI feedback for component events
  - Docs: Auto-generated documentation
  - Viewport: Responsive design testing
  - Backgrounds: Background color testing
  - Toolbars: Custom toolbar buttons
  - Measure & Outline: Layout debugging

- **@storybook/addon-interactions**: Testing user interactions

## Next Steps

1. Add stories for any new UI Primitive or Vault UI Component (see [STORYBOOK-PATTERNS.md](../ui/STORYBOOK-PATTERNS.md)).

## Useful Commands

| Command                          | Description                              |
| -------------------------------- | ---------------------------------------- |
| `yarn storybook`                 | Start Storybook dev server               |
| `yarn build-storybook`           | Build static Storybook (Vite stats JSON) |
| `npx nx test-storybook web-ui`   | Run interaction tests                    |
| `npx nx static-storybook web-ui` | Serve built Storybook                    |

## Troubleshooting

### Styles not loading

Make sure Tailwind CSS is configured properly:

- Check `libs/web/ui/tailwind.config.js` includes Storybook paths
- Verify `libs/web/ui/.storybook/preview-styles.css` is imported in `preview.ts`

### Component not rendering

- Ensure the component is exported from `libs/web/ui/src/index.ts`
- Check that the story file follows the `*.stories.tsx` naming convention
- Verify the story file is in the `libs/web/ui/src/lib/` directory

## Resources

- [Storybook Documentation](https://storybook.js.org/docs)
- [Nx Storybook Plugin](https://nx.dev/recipes/storybook)
