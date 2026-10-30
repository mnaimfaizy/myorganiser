# Development Guide - MyOrganiser Monorepo

This guide provides comprehensive documentation for developing in the MyOrganiser monorepo. Whether you're a new contributor or a seasoned developer, this guide will help you get started and navigate the development workflow.

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Initial Setup](#initial-setup)
- [Starting Local Development Dependencies and Services](#starting-local-development-dependencies-and-services)
  - [Starting Dependencies (Docker)](#starting-dependencies-docker)
  - [Starting the Backend](#starting-the-backend)
  - [Starting the Frontend](#starting-the-frontend)
  - [Starting the Mobile App (iOS)](#starting-the-mobile-app-ios)
  - [Starting Storybook](#starting-storybook)
  - [Accessing Services](#accessing-services)
- [Monorepo Structure](#monorepo-structure)
  - [Tools & Configuration](#tools--configuration)
- [Frontend Architecture (Web Page Libraries)](#frontend-architecture-web-page-libraries)
- [Development Workflow](#development-workflow)
  - [Creating a Feature](#creating-a-feature)
  - [Working with the Database](#working-with-the-database)
  - [Working with APIs](#working-with-apis)
  - [Code Quality](#code-quality)
- [Creating Issues and Pull Requests](#creating-issues-and-pull-requests)
  - [Creating an Issue](#creating-an-issue)
  - [Creating a Pull Request](#creating-a-pull-request)
  - [PR Review Process](#pr-review-process)
- [Testing](#testing)
  - [Unit Testing](#unit-testing)
  - [E2E Testing](#e2e-testing)
  - [Test Coverage](#test-coverage)
- [Building for Production](#building-for-production)
  - [Building the Backend](#building-the-backend)
  - [Building the Frontend](#building-the-frontend)
- [Common Tasks](#common-tasks)
  - [Adding a New Library](#adding-a-new-library)
  - [Adding a New Application](#adding-a-new-application)
  - [Updating Dependencies](#updating-dependencies)
  - [Visualizing Dependencies](#visualizing-dependencies)
- [Troubleshooting](#troubleshooting)
- [Additional Resources](#additional-resources)

## Overview

MyOrganiser is a full-stack web application built as an Nx monorepo. It consists of:

- **Frontend**: Next.js application with React and Tailwind CSS
- **Backend**: Express.js REST API with TypeScript, Prisma ORM
- **Shared Libraries**: Reusable components, utilities, and API clients
- **Development Tools**: Storybook for UI development, Docker for local services

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** - [Download](https://nodejs.org/)
- **Corepack-managed Yarn** - Use `corepack yarn ...` directly, or enable Corepack shims if your installation permits it
- **Git** - [Download](https://git-scm.com/)
  - **Windows only**: tick the symlink option during install, or run `git config --global core.symlinks true` before cloning, and enable Developer Mode (**Settings → System → For developers**). The repo ships one committed symlink, `.claude/skills`; without symlink support it checks out as a plain text file and Claude Code loads none of the repo skills. See [Windows: Repo Skills Not Loading](#windows-repo-skills-not-loading).
- **Docker & Docker Compose** - [Download](https://www.docker.com/get-started)
- **Code Editor** - We recommend [VS Code](https://code.visualstudio.com/) with the Nx Console extension
- **iOS development only (macOS)** - Xcode with its command line tools, and a Ruby newer than the one macOS ships. See [Starting the Mobile App (iOS)](#starting-the-mobile-app-ios); nothing here is needed for backend, web, or Android work.

### Initial Setup

1. **Clone the Repository**

   ```bash
   git clone https://github.com/mnaimfaizy/myorganiser.git
   cd myorganiser
   ```

2. **Install Dependencies**

   ```bash
   corepack yarn install --immutable
   ```

   This repository is Yarn-first. Keep `yarn.lock` committed and avoid introducing `package-lock.json` or `pnpm-lock.yaml` changes.

3. **Set Up Environment Variables**

   ```bash
   cp .env.example .env
   ```

   Edit the `.env` file and configure the environment variables. Key variables include:

   ```env
   # Application
   APP_FRONTEND_URL=http://localhost:4200

   # Server
   NODE_ENV=development
   PORT=3000
   ROUTER_PREFIX=/api/v1

   # Security - Generate secure random strings for production
   ACCESS_JWT_SECRET=your-access-secret
   REFRESH_JWT_SECRET=your-refresh-secret
   VERIFY_JWT_SECRET=your-verify-secret
   RESET_JWT_SECRET=your-reset-secret

   # Database
   DATABASE_USER=postgres
   DATABASE_PASSWORD=Admin@123
   DATABASE_NAME=myorganiser
   DATABASE_URL=postgresql://postgres:Admin%40123@localhost:5453/myorganiser

   # PgAdmin (for database management GUI)
   PGADMIN_DEFAULT_EMAIL=admin@myorganiser.com
   PGADMIN_DEFAULT_PASSWORD=Admin@123

   # CORS - Comma-separated list
   CORS_ORIGINS=http://localhost:3000,http://localhost:4200

   # Mail - SMTP Configuration
   MAIL_SERVICE=smtp
   DEFAULT_EMAIL_PROVIDER=smtp
   MAIL_HOST=localhost
   MAIL_PORT=1453
   MAIL_SECURE=false
   MAIL_USERNAME=
   MAIL_PASSWORD=
   EMAIL_SENDER=no-reply@myorganiser.local

   # Frontend
   API_BASE_URL=http://localhost:3000/api/v1
   NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
   ```

   **Note**: For production, generate secure random secrets using:

   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
   ```

4. **Start Docker Dependencies**

   ```bash
   docker-compose up -d
   ```

   This starts PostgreSQL, MailHog (email testing), and PgAdmin.

5. **Set Up the Database**

   ```bash
   cd apps/backend/src
   npx prisma generate
   npx prisma migrate dev
   cd ../../..
   ```

   This generates the Prisma client and runs database migrations.

6. **Verify Installation**

   ```bash
   yarn nx graph
   ```

   This opens a visual representation of your project structure and dependencies.

## Starting Local Development Dependencies and Services

### Starting Dependencies (Docker)

The application uses Docker Compose to run local development dependencies:

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d myorganiser_db
docker-compose up -d mailhog

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (caution: deletes data)
docker-compose down -v
```

**Containers from before the product rename.** [ADR 0132](docs/adr/0132-one-product-name-aligned-while-there-were-no-users.md) renamed the database service, the network and every container. A machine set up earlier still runs the old containers, and the old database container holds port 5453, so a plain `docker-compose up -d` fails on the port clash. Recreate once with:

```bash
docker-compose up -d --remove-orphans
```

`--remove-orphans` removes the containers whose service no longer exists and starts `myorganiser_db`, `myorganiser_mailhog` and `myorganiser_pgadmin` in their place. Your data is kept: the database still mounts the same `.database/` folder.

**Services included**:

- **PostgreSQL** (myorganiser_db): Database server on port 5453
- **MailHog**: Email testing server on host ports 1453 (SMTP) and 8453 (Web UI)
- **PgAdmin**: Database GUI on host port 8853

### Starting the Backend

```bash
# From the root directory
yarn start:backend

# Or using Nx directly
yarn nx serve backend

# The backend API will be available at http://localhost:3000
```

The development server features:

- Hot reload on file changes
- Automatic TypeScript compilation
- API documentation at http://localhost:3000/docs

### Starting the Frontend

```bash
# From the root directory
yarn start:web

# Or using Nx directly
yarn nx dev web

# The frontend will be available at http://localhost:4200
```

The development server features:

- Fast refresh for React components
- Hot module replacement
- Next.js development features

### Starting Both Backend and Frontend

For the best development experience, run these in separate terminal windows:

**Terminal 1 - Backend:**

```bash
yarn start:backend
```

**Terminal 2 - Frontend:**

```bash
yarn start:web
```

### Starting the Mobile App (iOS)

iOS builds require macOS. The JavaScript half of the app is managed by Yarn, but the native half is managed by CocoaPods, which is a Ruby program: `apps/mobile/ios/Podfile` is Ruby source that `pod install` evaluates, and it shells out to Node to locate React Native's autolinking script. A working iOS setup therefore needs both toolchains. Android and web need none of this.

#### One-time Ruby setup

macOS ships a frozen Ruby 2.6, which is older than the Gemfile's `ruby ">= 3.1.0"`. Install a current Ruby with a version manager — `apps/mobile/Gemfile` points at rbenv:

```bash
brew install rbenv ruby-build
```

```bash
rbenv install $(rbenv install -l | grep -E '^3\.[0-9]+\.[0-9]+$' | tail -1)
```

Activate rbenv and select the version it should use. Both halves matter: `rbenv init` alone falls back to the system Ruby unless a global or local version is set, so skipping the second command silently leaves you on 2.6:

```bash
eval "$(rbenv init - "$(basename "$SHELL")")" && rbenv global "$(rbenv versions --bare | tail -1)" && ruby -v
```

That must print a 3.x version. Add the `eval` line to your shell profile so it survives a new terminal — otherwise the next session drops back to the system Ruby and `bundle` fails again:

```bash
printf '
eval "$(rbenv init - %s)"
' "$(basename "$SHELL")" >> ~/."$(basename "$SHELL")rc"
```

#### Installing pods

**Order matters.** `pod install` autolinks native modules by reading `node_modules`, so the JavaScript install must be current first. Running it against a stale tree links pods for packages the branch no longer has, or misses ones it added:

```bash
corepack yarn install --immutable
```

```bash
cd apps/mobile/ios && bundle install && bundle exec pod install
```

Always go through `bundle exec`, never a bare `pod`. The Gemfile pins CocoaPods and several of its gems deliberately — some for build failures, `activesupport` for CVEs — and a Homebrew or system CocoaPods ignores all of it. Different CocoaPods versions also serialise `Podfile.lock` differently, so bypassing bundler produces lockfile churn that has nothing to do with your change.

#### Running the app

```bash
yarn nx run-ios mobile
```

Metro can be started on its own when you only need the bundler:

```bash
yarn nx start mobile
```

#### Which backend a debug build talks to

A debug build talks to the API and web app on your machine: `localhost:3000` and `localhost:4200`, or `10.0.2.2` from an Android emulator. To point it at Production instead, start Metro with the bundle-time switch, and restart Metro without it to switch back:

```bash
MYORGANISER_MOBILE_BACKEND=production yarn nx start mobile
```

A release build talks to Production over HTTPS and ignores the switch; no build has a switcher at runtime. When a launch finds a different backend from the one its local data came from, the app signs out and clears that data first. Device Settings stay.

Do not use `nx run mobile:bundle` as a verification step — see [ADR 0005](docs/adr/0005-react-native-bare-with-nx.md). The verification gate for mobile is lint, typecheck, and format, per [apps/mobile/AGENTS.md](apps/mobile/AGENTS.md).

#### When to re-run `pod install`

Re-run it whenever the set of native dependencies changes — adding or removing a package with a native module, or switching to a branch that does. Then commit the regenerated `apps/mobile/ios/Podfile.lock` alongside the manifest change that caused it, so the two never disagree.

What to commit when the pod graph or the pod toolchain changes:

| Path                           | Commit it? | Why                                                       |
| ------------------------------ | ---------- | --------------------------------------------------------- |
| `apps/mobile/ios/Podfile.lock` | yes        | The resolved native dependency graph                      |
| `apps/mobile/Gemfile`          | yes        | Which CocoaPods, and its pinned gems                      |
| `apps/mobile/Gemfile.lock`     | yes        | Stops the pod toolchain resolving differently per machine |
| `apps/mobile/ios/Pods/`        | never      | Gitignored build output, regenerated by `pod install`     |

If you change native dependencies from a machine without macOS, say so in the pull request: the `Podfile.lock` cannot be regenerated from Windows or Linux, and an iOS build against a stale one fails looking for a pod that is no longer installed.

### Starting Storybook

Storybook allows you to develop and test UI components in isolation:

```bash
yarn storybook

# This will open Storybook at http://localhost:6006
```

For more information, see [docs/storybook/README.md](docs/storybook/README.md).

### Accessing Services

Once everything is running, you can access:

| Service     | URL                          | Description              |
| ----------- | ---------------------------- | ------------------------ |
| Frontend    | http://localhost:4200        | Main application         |
| Backend API | http://localhost:3000/api/v1 | REST API                 |
| API Docs    | http://localhost:3000/docs   | Swagger UI documentation |
| Storybook   | http://localhost:6006        | UI component library     |
| MailHog     | http://localhost:8453        | Email testing interface  |
| PgAdmin     | http://localhost:8853        | Database management      |

**PgAdmin Credentials** (from .env):

- Email: admin@myorganiser.com
- Password: Admin@123

## Monorepo Structure

This is an Nx monorepo. The layout — every app and top-level library, with one line on what it holds — is the [Repository layout](./README.md#repository-layout) section of the README. It is not restated here: `yarn readme:check` asserts that section against the tree in both directions, and a second copy is the one that goes stale.

For more than one line on a project, read the `AGENTS.md` (and, where one exists, the `README.md`) inside its own directory — for example [apps/backend/README.md](apps/backend/README.md). The documentation index is the README's [Documentation](./README.md#documentation) table.

### Tools & Configuration

- `.github/workflows/` - CI/CD pipelines
- `tools/scripts/` - Build and deployment scripts
- `eslint.config.js` - ESLint configuration
- `jest.config.ts` - Jest testing configuration
- `.prettierrc` - Code formatting rules
- `nx.json` - Nx workspace configuration

## Frontend Architecture (Web Page Libraries)

MyOrganiser enforces a simple rule for the Next.js App Router:

- Files under `apps/web/src/app/**` are **thin route wrappers** only.
- All page/domain logic lives in Nx libraries under `libs/web/pages/<route>/`.

Next.js request conventions (`proxy.ts`, async request APIs, do not suggest `next lint`) live in [AGENTS.md](./AGENTS.md). Package versions live in [TECH_STACK.md](./TECH_STACK.md). Do not add a Next.js Proxy unless a ticket explicitly asks — [ADR 0019](./docs/adr/0019-nextjs-proxy-is-not-a-session-layer.md).

This keeps pages reusable and testable, and prevents app-local “shared code” from spreading.

### What goes where

- Route wrappers: `apps/web/src/app/<route>/page.tsx`
  - Keep minimal: route segment wiring, metadata, and importing the page component from the library.
- Page implementation: `libs/web/pages/<route>/src/**`
  - Actual React components, data fetching (via generated client), form logic, and page-specific helpers.
- Shared UI primitives: `libs/web/ui/`
- Encrypted vault logic: `libs/web/vault/` and `libs/web/vault-ui/`

### Adding a new frontend page

1. Create a new React library under `libs/web/pages/<route>/` with import path `@myorganiser/web-pages/<route>`.
2. Export the page entry from the library’s `src/index.ts`.
3. Add a thin wrapper at `apps/web/src/app/<route>/page.tsx` that renders/exports the library page.

Examples of existing page libraries:

- `@myorganiser/web-pages/account`
- `@myorganiser/web-pages/subscriptions`

### Forms

- Use React Hook Form + Zod for any new form.
- Prefer keeping the validation schema next to the page feature (inside the page library).

## Development Workflow

### Creating a Feature

1. **Create a Feature Branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

   Branch naming conventions:
   - `feature/` - New features
   - `fix/` - Bug fixes
   - `docs/` - Documentation updates
   - `refactor/` - Code refactoring
   - `test/` - Test additions/updates

2. **Make Your Changes**
   - Follow the existing code style
   - Write tests for new features
   - Update documentation as needed

3. **Run Code Quality Checks**

   ```bash
   # Format code
   yarn format:write

   # Lint code
   yarn nx run-many -t lint

   # Run tests
   yarn nx run-many -t test
   ```

4. **Commit Your Changes**

   Stage the specific files for this change (never `git add .`), then:

   ```bash
   corepack yarn ai:commit --message "feat: add your feature description"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `style:` - Code style changes (formatting)
   - `refactor:` - Code refactoring
   - `test:` - Test updates
   - `chore:` - Build process or auxiliary tool changes

5. **Push Your Branch**

   ```bash
   git push origin feature/your-feature-name
   ```

### Working with the Database

#### Running Migrations

```bash
cd apps/backend/src

# Create a new migration
npx prisma migrate dev --name describe_your_changes

# Apply migrations
npx prisma migrate dev

# Generate Prisma Client (after schema changes)
npx prisma generate

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

#### Using Prisma Studio

Prisma Studio provides a GUI to view and edit database data:

```bash
cd apps/backend/src
npx prisma studio
```

This opens Prisma Studio at http://localhost:5555.

#### Schema Management

Prisma schemas are located in `apps/backend/src/prisma/schema/`:

- `schema.prisma` - Main configuration
- `user.prisma` - User model
- `vault.prisma` - Vault ciphertext model

After modifying schemas, always run:

```bash
npx prisma format
npx prisma generate
npx prisma migrate dev --name your_change_description
```

### Working with APIs

#### Generating API Documentation

The backend uses TSOA to auto-generate API documentation from TypeScript:

```bash
# Generate JSON Swagger spec
yarn json-api:generate

# Generate YAML Swagger spec
yarn yaml-api:generate

# Generate both
yarn api-docs:generate
```

Generated files are in `apps/backend/src/swagger/`.

#### Syncing OpenAPI Specs

When you update API endpoints:

```bash
# Sync OpenAPI spec and regenerate TypeScript client
yarn openapi:sync

# Verify no drift (useful in CI)
yarn openapi:check
```

This ensures:

1. Backend specs are up-to-date (both `swagger.json` and `swagger.yaml`)
2. `libs/api-specs` contains the latest spec
3. `libs/app-api-client` is regenerated with new types

#### Generating API Client

The frontend uses an auto-generated TypeScript client for type-safe API calls:

```bash
yarn api:generate
```

This regenerates `libs/app-api-client` based on the OpenAPI spec.

### Code Quality

#### Linting

```bash
# Lint all code
yarn nx run-many -t lint

# Lint specific project
yarn nx lint backend
yarn nx lint web

# Auto-fix linting issues in one project
yarn nx lint backend --fix

# Auto-fix across every ESLint project
yarn nx run-many -t lint --fix --exclude=api-specs,app-api-client
```

`api-specs` and `app-api-client` alias their `lint` target to
`tools/scripts/check-openapi-artifacts.ts`, an artifact checker that takes no `--fix` and treats the
flag as a path. A bare `yarn nx run-many -t lint --fix` therefore fails on those two projects; exclude
them, or fix per project. Plain `yarn lint` passes no flags and covers all of them.

#### Formatting

```bash
# Check formatting
yarn format:check

# Fix formatting issues
yarn format:write

# Format specific files
yarn nx format:write --files=path/to/file.ts

# Also sort the tsconfig.base.json path mappings
yarn nx format:write --sort-root-tsconfig-paths
```

Since Nx 22.0.0, `nx format` no longer sorts `tsconfig.base.json` path mappings by default, and neither
do the generators. Aliases added by hand stay wherever they were typed unless you pass
`--sort-root-tsconfig-paths`, so the block drifts out of order silently.

#### Type Checking

Every project has a cacheable `typecheck` target, inferred by the local Nx plugin at
`tools/scripts/nx/typecheck-plugin.ts` ([ADR 0141](docs/adr/0141-typecheck-is-a-cached-per-project-inferred-target.md)).
It compiles each project's lib, app, web, and spec tsconfig, wherever one exists; a project with no
lib, app, or web config, such as the Next.js app, is compiled from its `tsconfig.json`. A new
project gets the target with no wiring.

`yarn typecheck:check` is the whole-tree command: `nx run-many -t typecheck` plus
`tools/scripts/tsconfig.json`, which is a fixed job because `tools/scripts` carries no
`project.json` on purpose ([ADR 0135](docs/adr/0135-tooling-scripts-are-typescript-run-by-node-and-tested-by-node-test.md))
and the plugin keys inference on that file.
CI runs `nx affected -t typecheck` on a pull request and the whole tree on a push to `main`, with
the fixed job as its own path-gated step, `yarn typecheck:tools-scripts`.

```bash
# apps/backend/src/prisma is generated and gitignored, so a fresh checkout needs it first.
# The backend's typecheck target declares this dependency, so nx generates it for you.
yarn nx run backend:generate-types

# Check types across the workspace
yarn typecheck:check

# Just one project, or just the projects your branch can reach
yarn nx run web-pages-legal:typecheck
yarn nx affected -t typecheck
```

## Creating Issues and Pull Requests

### Creating an Issue

Good issues help maintainers understand and address problems quickly. Here's how to create effective issues:

1. **Navigate to the Repository**

   Go to https://github.com/mnaimfaizy/myorganiser/issues

2. **Click "New Issue"**

3. **Choose an Issue Type** (if templates are available)
   - Bug Report
   - Feature Request
   - Documentation
   - Question

4. **Provide a Clear Title**

   Good: `Backend API returns 500 error when saving a tasks vault blob`

   Bad: `API broken`

5. **Fill in the Description**

   For **Bug Reports**, include:
   - **Description**: What is the problem?
   - **Steps to Reproduce**:
     1. Start the backend
     2. Send `PUT /api/v1/vault/blob/tasks` with an invalid payload
     3. Observe 500 error
   - **Expected Behavior**: Should return 400 with validation error
   - **Actual Behavior**: Returns 500 internal server error
   - **Environment**:
     - OS: macOS 13.0
     - Node.js: v18.16.0
     - Browser: Chrome 120 (if applicable)
   - **Screenshots/Logs**: Include relevant error messages or screenshots

   For **Feature Requests**, include:
   - **Description**: What feature do you want?
   - **Use Case**: Why is this feature needed?
   - **Proposed Solution**: How should it work?
   - **Alternatives**: What alternatives have you considered?

   For **Documentation**, include:
   - **Description**: What needs to be documented?
   - **Location**: Where should this documentation go?
   - **Current Gap**: What's missing or unclear?

6. **Add Labels** (if you have permission)
   - `bug` - Something isn't working
   - `enhancement` - New feature or request
   - `documentation` - Documentation improvements
   - `good first issue` - Good for newcomers
   - `help wanted` - Extra attention needed

7. **Submit the Issue**

### Creating a Pull Request

1. **Fork and Clone** (for external contributors)

   ```bash
   # Fork the repository on GitHub, then:
   git clone https://github.com/YOUR_USERNAME/myorganiser.git
   cd myorganiser
   git remote add upstream https://github.com/mnaimfaizy/myorganiser.git
   ```

2. **Create a Feature Branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Your Changes**
   - Write clean, readable code
   - Follow existing code style
   - Add tests for new features
   - Update documentation

4. **Test Your Changes**

   ```bash
   # Run all tests
   yarn nx run-many -t test

   # Run specific tests
   yarn nx test backend
   yarn nx test web

   # Run E2E tests
   yarn nx e2e web-e2e

   # Check code quality
   yarn format:write
   yarn nx run-many -t lint
   ```

5. **Commit Your Changes**

   Stage the specific files for this change (never `git add .`), then:

   ```bash
   corepack yarn ai:commit --message "feat: add user profile settings page"
   ```

   Use [Conventional Commits](https://www.conventionalcommits.org/) format.
   The shared commit workflow waits for Husky pre-commit checks to finish and uses static Nx output so lint failures stay readable in terminal-based AI tools.
   If the command fails, read the `ai:commit: failed` trailer, fix the hinted formatting or lint slice, and retry.

6. **Keep Your Branch Up to Date**

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

7. **Push Your Branch**

   ```bash
   git push origin feature/your-feature-name
   ```

8. **Create the Pull Request**
   - Agent sessions draft first with the `PrAuthor` sub-agent, then pass that draft into the shared runner:

     ```bash
     corepack yarn ai:create-pr --title "feat(scope): short summary" --body-file /tmp/pr-body.md --merge-base <sha>
     ```

   - `--merge-base` is the `MERGE-BASE:` SHA from the `PrAuthor` draft. The runner recomputes the
     merge base and rejects the draft if the SHA is missing or does not match, which is what stops a
     PR body that was written without ever reading the branch. Pass the agent's SHA; do not compute
     one to satisfy the check.

   - Humans may still run the runner with no title/body; it then builds a thin description from commit subjects:

     ```bash
     corepack yarn ai:create-pr
     ```

   - Add Surface Labels only when you have them (kind/area from `tools/config/github-labels.json`; default is unlabeled):

     ```bash
     corepack yarn ai:create-pr --label documentation --label tooling
     ```

   - Add reviewers only when you need them:

     ```bash
     corepack yarn ai:create-pr --reviewer teammate-login
     ```

   - The shared PR workflow:
     - pushes the branch upstream if it is not already tracked
     - uses `--title` / `--body-file` when provided (agent path), otherwise a commit-derived fallback
     - requires a matching `--merge-base` on the agent path; the bare human/CI path needs none
     - applies `--label` Surface Labels when provided (ADR 0025); default is none
     - assigns the authenticated GitHub user to the PR
     - leaves reviewers empty unless you explicitly pass one
     - returns only the PR URL on success

9. **Submit the Pull Request**

### PR Review Process

1. **Automated Checks**
   - CI/CD pipeline runs automatically
   - Tests must pass
   - Linting must pass
   - Build must succeed

2. **Code Review**
   - Maintainers will review your code
   - Address feedback by pushing new commits
   - Engage in discussion if you disagree

3. **Making Changes After Review**

   ```bash
   # Make requested changes
   # Stage the specific files for this change (never git add .)
   corepack yarn ai:commit --message "fix: address review feedback"
   git push origin feature/your-feature-name
   ```

4. **Approval and Merge**
   - Once approved, a maintainer will merge your PR
   - You can delete your branch after merging

## Testing

### Unit Testing

The monorepo uses Jest for unit testing.

For Jest unit tests, Jest integration tests, React hook/component integration tests, and Playwright E2E rules, use `docs/testing/README.md` as the index and `docs/testing/projects/<project>.md` as the per-project guide. Before writing or delegating tests, read the implementation under test, build a behavior matrix, and avoid unsupported retry, concurrency, timeout, or thrown-error scenarios.

#### Running Tests

```bash
# Run all tests
yarn nx run-many -t test

# Run tests for specific project
yarn nx test backend
yarn nx test web
yarn nx test web-ui

# Run tests in watch mode
yarn nx test backend --watch

# Run tests with coverage
yarn nx test backend --coverage
```

#### Writing Tests

Tests are located next to the source files with `.spec.ts` or `.test.ts` extensions.

For generated or delegated suites, require focused tests, deterministic mocks, duplicate `describe`/helper checks, the full affected run, and linting before accepting the change.

**Example (Backend)**:

```typescript
// apps/backend/src/services/UserService.spec.ts
import { UserService } from './UserService';

describe('UserService', () => {
  let userService: UserService;

  beforeEach(() => {
    userService = new UserService();
  });

  it('should create a user', async () => {
    const user = await userService.createUser({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    });

    expect(user).toBeDefined();
    expect(user.email).toBe('test@example.com');
  });
});
```

**Example (Frontend)**:

```typescript
// libs/web/ui/src/components/Button.spec.tsx
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders with text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    const button = screen.getByText('Click me');
    button.click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

### E2E Testing

End-to-end tests use Playwright and are located in `apps/web-e2e`.

```bash
# Run E2E tests
yarn nx e2e web-e2e

# Run E2E tests in UI mode (interactive)
yarn nx e2e web-e2e --ui

# Run E2E tests for CI
yarn nx e2e-ci web-e2e
```

**Writing E2E Tests**:

```typescript
// apps/web-e2e/src/example.spec.ts
import { test, expect } from '@playwright/test';

test('user can log in', async ({ page }) => {
  await page.goto('/login');

  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('h1')).toContainText('Dashboard');
});
```

### Test Coverage

```bash
# Generate coverage report
yarn nx test backend --coverage
yarn nx test web --coverage

# View coverage in browser
# Reports are in coverage/ directory
open coverage/apps/backend/index.html
```

## Building for Production

### Building the Backend

```bash
# Build backend
yarn build:backend

# Or using Nx
yarn nx build backend

# Output is in dist/apps/backend/
```

**Running Production Build**:

```bash
cd dist/apps/backend
npm install --production
node main.js
```

**Environment Requirements**:

- `NODE_ENV=production`
- All JWT secrets configured
- Production database URL
- SMTP configuration for emails

### Building the Frontend

```bash
# Build frontend
yarn build:web

# Or using Nx
yarn nx build web

# Output is in apps/web/.next/
```

**Running Production Build**:

```bash
# Builds (or restores the build from cache), then runs `next start`
yarn start:web:prod
```

To produce the self-hosted deploy bundle in `dist/deploy/web/`, run
`yarn nx run web:package`.

### Building Storybook

```bash
yarn build-storybook

# Output is in dist/storybook/web-ui/
```

## Common Tasks

### Adding a New Library

```bash
# React library
yarn nx g @nx/react:lib my-new-lib

# Node.js library
yarn nx g @nx/node:lib my-new-lib

# TypeScript library
yarn nx g @nx/js:lib my-new-lib
```

### Adding a New Application

```bash
# Next.js application
yarn nx g @nx/next:app my-new-app

# Express application
yarn nx g @nx/express:app my-new-api
```

### Updating Dependencies

```bash
# Update Nx and plugins
yarn nx migrate latest

# Apply migrations
yarn nx migrate --run-migrations

# Update other dependencies
yarn upgrade-interactive

# Update specific package
yarn upgrade package-name@latest
```

### Visualizing Dependencies

```bash
# Open dependency graph
yarn nx graph

# Show affected projects
yarn nx show projects --affected

# Open the graph scoped to the affected projects
yarn nx graph --affected
```

## Troubleshooting

### iOS / CocoaPods Issues

**Problem**: `Your Ruby version is 2.6.10, but your Gemfile specified >= 3.1.0`

You are on the Ruby macOS ships, because no version manager is active in this shell. This also appears as `Could not find 'bundler' (x.y.z) required by your Gemfile.lock`, which names bundler but means the same thing — the gems were installed under a Ruby you are no longer running. See [One-time Ruby setup](#one-time-ruby-setup):

```bash
eval "$(rbenv init - "$(basename "$SHELL")")" && rbenv global "$(rbenv versions --bare | tail -1)" && ruby -v
```

If this keeps recurring in new terminals, the `eval` line is missing from your shell profile.

**Problem**: `LoadError - cannot load such file -- kconv` (or another module that used to be in the standard library)

Ruby 3.4 moved several modules out of the default gems, and CocoaPods' dependencies still require them at load time. `apps/mobile/Gemfile` carries a block for exactly this, commented "Ruby 3.4.0 removed these from the standard library". If a `LoadError` names a module that block does not already list, add it there rather than downgrading Ruby.

**Problem**: `The version of CocoaPods used to generate the lockfile (X) is higher than the version of the current executable (Y)`

The committed `Podfile.lock` was produced by a CocoaPods that did not come from the Gemfile. Regenerate through bundler so the two agree:

```bash
cd apps/mobile/ios && bundle exec pod install
```

**Problem**: The build fails on a pod that was removed, or misses one that was added

`node_modules` and the pod graph are out of step, usually after switching branches. Reinstall in order — JavaScript first, then pods:

```bash
corepack yarn install --immutable
```

```bash
cd apps/mobile/ios && bundle exec pod install
```

### Docker Issues

**Problem**: Containers not starting

```bash
# Solution: Check Docker is running
docker ps

# Restart containers
docker-compose down
docker-compose up -d

# View logs
docker-compose logs -f myorganiser_db
```

**Problem**: `Bind for 0.0.0.0:5453 failed: port is already allocated` after pulling the product rename

```bash
# Solution: remove the containers created before the rename, keeping your data
docker-compose up -d --remove-orphans
```

See [Starting Dependencies (Docker)](#starting-dependencies-docker).

### Database Issues

**Problem**: Cannot connect to database

```bash
# Solution 1: Check database is running
docker ps | grep myorganiser_db

# Solution 2: Verify DATABASE_URL in .env
# Should match docker-compose.yml settings

# Solution 3: Recreate database
docker-compose down -v
docker-compose up -d
```

**Problem**: Prisma Client not found

```bash
# Solution: Generate Prisma Client
cd apps/backend/src
npx prisma generate
```

**Problem**: Migration fails

```bash
# Solution: Check migration files for errors
# Reset database (WARNING: deletes all data)
cd apps/backend/src
npx prisma migrate reset
```

### Port Conflicts

**Problem**: Port already in use

```bash
# Solution 1: Change ports in .env
# For backend, change PORT
# For frontend, change in nx.json or project.json

# Solution 2: Kill process using port
# Linux/Mac
lsof -ti:3000 | xargs kill -9

# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```

### Build Issues

**Problem**: Build fails with type errors

```bash
# Solution: Clean Nx cache and rebuild
yarn nx reset
yarn install
yarn nx build backend --skip-nx-cache
```

**Problem**: Out of memory errors

```bash
# Solution: Increase Node.js memory
export NODE_OPTIONS="--max-old-space-size=4096"
yarn nx build backend
```

### Git Issues

**Problem**: Merge conflicts

```bash
# Solution: Resolve conflicts manually
git fetch upstream
git merge upstream/main

# Edit files to resolve conflicts
# Then:
git add <resolved-files>
git commit
```

### Windows: Repo Skills Not Loading

**Problem**: Claude Code does not offer the repo skills (`/upstream-brief`, `/to-prd`, `/commit-change-workflow`, …), and `.claude/skills` is a small text file instead of a directory.

`.agents/skills` is the single source of truth for repo skills — VS Code and Copilot read that path natively. `.claude/skills` is a committed symlink pointing at it, and it is the only tracked symlink in the repository. Git for Windows sets `core.symlinks=false` unless the symlink option is ticked during install, and that value is copied into `.git/config` when you clone. With it off, Git checks the symlink out as a plain file whose _contents_ are the link target (`../.agents/skills`). Claude Code then finds a file where it expects a directory and discovers zero project skills.

macOS and Linux default to `core.symlinks=true`, so this only affects Windows clones.

```bash
# Diagnose: prints "../.agents/skills" instead of listing skill directories
cat .claude/skills
git config --show-origin --get-all core.symlinks
```

**Solution**:

1. Enable **Settings → System → For developers → Developer Mode**. This lets Windows create symlinks without elevation.

2. Turn symlinks on for this clone and for future ones:

   ```bash
   git config --global core.symlinks true
   git config --local core.symlinks true
   ```

3. Replace the stub file with the real symlink:

   ```bash
   rm .claude/skills
   git checkout -- .claude/skills
   ```

4. Verify — all three checks should pass:

   ```bash
   test -L .claude/skills && echo "symlink ok"
   test -d .claude/skills && echo "resolves ok"
   git status --porcelain   # must be empty
   ```

Restart Claude Code if the skills do not appear right away.

Notes:

- The system-wide `C:\Program Files\Git\etc\gitconfig` may still read `false`. Leave it — changing it needs admin rights, and the `--global` and `--local` values take precedence.
- If you previously worked around this with a directory junction, remove it with `rmdir .claude/skills` (or `cmd //c rmdir`), **never** `rm -rf`. `rm -rf` follows the junction and deletes the contents of `.agents/skills`.

### Common Errors

**Error**: `Cannot find module '@myorganiser/...'`

```bash
# Solution: Rebuild TypeScript paths
yarn install
yarn nx reset
```

**Error**: `ENOSPC: System limit for number of file watchers reached`

```bash
# Solution (Linux): Increase inotify watchers
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

**Error**: Husky hooks not working

```bash
# Solution: Reinstall Husky
yarn husky install
```

## Additional Resources

### Documentation

- [Main README](README.md) - Project overview and quick start
- [Backend Documentation](apps/backend/README.md) - Detailed backend guide
- [Authentication Guide](docs/authentication/README.md) - JWT strategy and auth flow
- [Storybook Guide](docs/storybook/README.md) - UI component development
- [Deployment Guides](docs/deployment/) - Platform-specific deployment instructions

### External Resources

- [Nx Documentation](https://nx.dev) - Monorepo tools and best practices
- [Next.js Documentation](https://nextjs.org/docs) - Frontend framework
- [Express.js Guide](https://expressjs.com/en/guide/routing.html) - Backend framework
- [Prisma Documentation](https://www.prisma.io/docs) - Database ORM
- [TSOA Documentation](https://tsoa-community.github.io/docs/) - API documentation
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) - TypeScript guide
- [React Documentation](https://react.dev) - React library
- [Tailwind CSS](https://tailwindcss.com/docs) - CSS framework
- [Conventional Commits](https://www.conventionalcommits.org/) - Commit message format

### Community

- **GitHub Issues**: Report bugs and request features
- **Pull Requests**: Contribute code improvements
- **Discussions**: Ask questions and share ideas (if enabled)

### Getting Help

If you encounter issues not covered in this guide:

1. Check existing [GitHub Issues](https://github.com/mnaimfaizy/myorganiser/issues)
2. Search the documentation
3. Review recent Pull Requests for similar changes
4. Create a new issue with detailed information

---

**Happy coding!** 🚀

If you have questions or suggestions for improving this guide, please open an issue or submit a pull request.
