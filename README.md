# TypeScript Patterns

Production-ready patterns for building **testable**, **type-safe**, and **observable** TypeScript applications.

## Documentation

**[Read the full documentation](https://jagreehal.github.io/jagreehal-typescript-patterns/)**

## Agent Skills

[![skills.sh](https://skills.sh/b/jagreehal/jagreehal-typescript-patterns)](https://skills.sh/jagreehal/jagreehal-typescript-patterns)

The patterns ship as [Agent Skills](./skills) for Claude Code, Cursor, Codex and other agents:

```bash
npx skills add jagreehal/jagreehal-typescript-patterns            # pick from the list
npx skills add jagreehal/jagreehal-typescript-patterns --skill ts-errors
```

## The Core Pattern

Everything starts with one function signature:

```typescript
fn(args, deps)
```

- **args**: What varies per call (userId, input data)
- **deps**: Injected collaborators (database, logger, other functions)

This signature makes each function testable and composable, and puts its dependencies in plain sight.
