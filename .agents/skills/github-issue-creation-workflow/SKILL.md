---
name: github-issue-creation-workflow
description: 'Use when the user asks to create a standalone GitHub issue for an ad-hoc bug, task, or follow-up in MyOrganiser. Do not use for PRD Issues, PRD slices, or publishing a grill/to-prd plan — those use to-prd or to-issues. Delegate to IssueCreator for duplicate checks, detail collection, label validation, and issue creation.'
---

# GitHub Issue Creation Workflow

## Use This Skill When

- The user asks to create a standalone GitHub issue for an ad-hoc bug, task, or follow-up.
- The issue is **not** a PRD, **not** a PRD slice, and **not** the published outcome of a grill or `to-prd` session.
- Another agent needs to offload ad-hoc issue creation into a dedicated, isolated sub-agent.

## Do Not Use When

- The user wants to plan a feature, write a spec, or publish a grill outcome as tracked work → `.agents/skills/to-prd/SKILL.md` (not IssueCreator).
- A PRD Issue already exists and needs slice tickets → `.agents/skills/to-issues/SKILL.md`.
- An existing issue or external PR needs the triage state machine → `.agents/skills/my-triage/SKILL.md`.

## Core Rules

- Always delegate issue creation work to the `IssueCreator` custom agent.
- If the request is a planned feature, PRD, spec, or grill publish, **stop** and load `to-prd` instead. Do not call IssueCreator.
- The target repository is `mnaimfaizy/myorganiser`. If the context is ambiguous or the user references a different repo, confirm the owner/repo with the user before delegating.
- The sub-agent must not invent missing facts. If details are incomplete, it must ask for clarification first. If the user does not provide required details after one clarification prompt, return `UNSUCCESS: insufficient details`.
- The sub-agent must check for duplicate issues before creating a new one. A near match is defined as: any open or closed issue sharing ≥2 significant title keywords or matching the core intent. Present up to 3 candidates and require the user to confirm before proceeding. If the user confirms an existing issue is a duplicate, return `UNSUCCESS: duplicate of <issue-url>` and do not create a new issue.
- Use the repository template at `.github/ISSUE_TEMPLATE/ai-task-or-bug.md` as the source format. If the template file is missing, the GitHub API is unreachable, or the agent lacks write permissions, return `UNSUCCESS: <specific reason>`.
- If a requested label does not exist in the repository, return `UNSUCCESS: missing label <name>`, unless the user explicitly approves substituting or omitting it.
- Surface all clarification questions and duplicate confirmations to the user during the workflow. Once the workflow terminates, return only the final status line:
  - `SUCCESS: <issue-url>`
  - `UNSUCCESS: <reason>`

## Workflow

1. Confirm the target repository is `mnaimfaizy/myorganiser`; ask user to confirm if context is ambiguous.
2. Delegate to `IssueCreator` with all known issue context (title hint, bug/feature type, body details, labels, target area).
3. Let `IssueCreator` perform:
   - duplicate search and user confirmation (presenting up to 3 near matches by title keyword overlap)
   - required-detail collection, with one clarification prompt per missing field
   - label existence validation, blocking on any missing label unless user approves omission
   - issue creation using the standard template structure
4. Surface any clarification questions or confirmations to the user during the workflow.
5. Return only the sub-agent final status line once the workflow terminates.

## References

- `.github/agents/issue-creator.agent.md`
- `.github/ISSUE_TEMPLATE/ai-task-or-bug.md`
