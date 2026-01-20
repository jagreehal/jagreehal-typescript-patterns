# TypeScript Patterns

Production-ready patterns for building **testable**, **type-safe**, and **observable** TypeScript applications.

## Documentation

**[Read the full documentation](https://jagreehal.github.io/jagreehal-typescript-patterns/)**

## The Core Pattern

Everything starts with a simple function signature:

```typescript
fn(args, deps)
```

- **args**: What varies per call (userId, input data)
- **deps**: Injected collaborators (database, logger, other functions)

This single pattern unlocks testability, composability, and clarity.
