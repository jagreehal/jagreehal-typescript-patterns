---
name: ts-ai-agents
description: "Use when writing specifications, prompts, or project rules for AI coding agents so they follow your TypeScript architecture patterns and produce consistent output."
---

## Overview

AI agent specs fail in two ways: no structure (agent does whatever it wants) or information overload (agent loses focus). Fix both with modular specs that cover six core areas and set explicit autonomy boundaries.

## Plan Mode: Vision First, Details Second

Always use two phases. Never jump straight to implementation details.

**Phase 1, Vision:** Describe what and why. Let the agent draft a plan (use read-only/plan mode).

```
"I need user management handling registration, profile updates, and
account deletion with email confirmations. Draft a plan for structure."
```

**Phase 2, Execution:** Review the plan, correct course, then implement piece by piece.

```
"Plan looks good. Start with createUser following our fn(args, deps)
pattern. Here's an example from the codebase..."
```

## Six Core Spec Areas

| Area | What to Include |
|------|----------------|
| **Commands** | Exact executable commands: `pnpm build`, `pnpm test`, `pnpm lint --fix`, `pnpm tsc --noEmit` |
| **Testing** | Framework (vitest), mock strategy (vitest-mock-extended, no vi.mock), file naming (`*.test.ts` alongside source) |
| **Project Structure** | Directory map: `domain/` (pure logic), `infra/` (I/O), `api/` (handlers), `lib/` (shared utils) |
| **Code Style** | Show examples of `fn(args, deps)`, `Result<T, E>` returns, Zod validation, branded types |
| **Git Workflow** | Conventional commits (`feat:`, `fix:`, `refactor:`), feature branches, tests before commit |
| **Boundaries** | Three-tier autonomy levels (see below) |

## Three-Tier Boundaries

**ALWAYS (Autonomous):** Follow `fn(args, deps)` pattern. Write unit tests. Use `Result<T, E>`, never throw. Validate with Zod at boundaries. Use branded types. Run lint and test before presenting code.

**ASK FIRST (Collaborative):** New database tables/migrations. Adding npm dependencies. Changing public API contracts. Modifying auth logic. Refactoring outside current scope.

**NEVER (Forbidden):** Commit `.env` or secrets. Use `vi.mock()` for app code. Skip tests. Force push to protected branches. Use `@ts-ignore` or untyped `any`. Delete data without soft-delete.

## Context Budget (40/30/20/10)

Context windows are finite. Split each task's budget like this:

| 40% Current Task | Specific requirements and acceptance criteria |
|---|---|
| **30% Relevant Patterns** | Examples of similar code from your codebase |
| **20% Boundaries** | Rules, constraints, style requirements |
| **10% History** | Previous decisions relevant to this task |

Break complex features into focused tasks. Give each task its own context and a single goal. Start a fresh session when the agent confuses tasks or output quality degrades.

## Self-Verification Loop

Require the agent to run checks before presenting code as complete:

1. `pnpm tsc --noEmit`: types pass
2. `pnpm lint`: no lint errors
3. `pnpm test`: tests pass
4. Pattern check: `fn(args, deps)` signature, `Result` returns, Zod validation at boundaries

If any check fails, fix before presenting. Never present code with known issues.

## Spec-Driven Development Phases

| Phase | Human Role | Agent Role |
|-------|-----------|------------|
| **Foundation** | Define patterns, boundaries, examples | Suggest structure |
| **Iteration** | Review output, correct mistakes, refine spec | Learn from corrections |
| **Automation** | Spot-check, handle edge cases | Execute routine tasks consistently |
| **Evolution** | Update spec when patterns change | Flag outdated guidance |

Refine by observation: wrong pattern repeated = add explicit example; unnecessary questions = move to ALWAYS tier; dangerous changes = add to NEVER tier.

## Key Rules

1. Vision first, details second: plan before implementing.
2. Modular beats monolithic: one task per prompt.
3. Define boundaries explicitly: the Always/Ask First/Never tiers tell the agent when to act, ask, or stop.
4. Build verification into the spec: self-checks before human review.
5. Context is finite: use the 40/30/20/10 budget, cut what does not serve the task.
6. Keep the spec current: version control it and review changes to it.
