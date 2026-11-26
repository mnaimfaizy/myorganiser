# grill-with-docs Skill

**What**: A grilling session that stress-tests your plan against the project's domain model, terminology, and documented decisions.

**When to use**:

- You have a plan and want to challenge it against MyOrganiser's existing language and architecture
- You want to sharpen fuzzy design decisions before committing to code
- You're designing a new feature and need to align terminology across the team
- You want to capture architectural decisions as ADRs

**How to invoke**:

- In Claude: Reference this skill when you want to grill a plan
- In Cursor/GitHub Copilot: Ask to "grill this plan" or "stress-test against docs"
- In Google Antigravity: Reference this skill (auto-discovered from `.agents/skills/`) for domain-driven design conversations

## Key Files

- **SKILL.md** - Main skill definition with interview approach
- **CONTEXT-FORMAT.md** - How to write and structure domain glossaries
- **ADR-FORMAT.md** - How to write architecture decision records

## How It Works

1. **Relentless interviewing** - Ask one question at a time, providing recommended answers
2. **Code exploration** - Check claims against actual codebase (don't just ask)
3. **Terminology sharpening** - Challenge fuzzy language and align with CONTEXT.md
4. **Inline documentation** - Update CONTEXT.md and create ADRs as decisions are made

## MyOrganiser-specific

The skill is pre-configured with:

- MyOrganiser's key domain terms (Vault, Todo, Subscription, User, Organization, Ciphertext)
- Project structure (single-context, Nx monorepo, DDD-influenced)
- Technology stack (Next.js, Express, Prisma, TSOA, Playwright)
- Key architectural constraints (vault = ciphertext-only on server)
