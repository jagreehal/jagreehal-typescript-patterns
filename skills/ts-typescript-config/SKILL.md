---
name: ts-typescript-config
description: "Use when configuring tsconfig.json with strict safety flags, ts-reset, and type-level patterns like satisfies and as const for production TypeScript projects."
---

## Overview

Go beyond `strict: true`. Add compiler flags that enforce type safety, native runtime compatibility, and boundary validation. Pair with `ts-reset` and type-level patterns to make unsafe code a compile error.

## tsconfig.json Reference

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

## Key Flags

- **`noUncheckedIndexedAccess`**: Array/object indexing returns `T | undefined`, forcing explicit handling of missing elements.
- **`exactOptionalPropertyTypes`**: `{ id?: string }` means the key is missing, not `undefined`. Prevents `{ id: undefined }`.
- **`erasableSyntaxOnly`** (TS 5.8+): Bans enums and parameter properties. Code must be strippable by native runtimes (Node 22+, Bun, Deno).
- **`verbatimModuleSyntax`**: Forces `import type` for types. Enforces dependency injection over runtime imports of infrastructure.
- **`noUncheckedSideEffectImports`**: Verifies side-effect imports (`import "./polyfills"`) resolve to real files.

## ts-reset

Install `@total-typescript/ts-reset` to fix standard library `any` leaks:

```bash
npm install -D @total-typescript/ts-reset
```

Create `reset.d.ts`:
```typescript
import "@total-typescript/ts-reset";
```

Effect: `JSON.parse` returns `unknown` instead of `any`, forcing validation. `.filter(Boolean)` narrows types.

## Type-Level Patterns

**`satisfies`**: validate shape without widening types:
```typescript
const routes = {
  home: { path: '/', handler: () => {} },
  about: { path: '/about', handler: () => {} },
} satisfies Record<string, Route>;
routes.typo;  // Error -- keeps literal keys
```

**`as const`**: extract union types from arrays:
```typescript
const ROLES = ['admin', 'user', 'guest'] as const;
type Role = (typeof ROLES)[number]; // "admin" | "user" | "guest"
```

**Enum replacement** (required by `erasableSyntaxOnly`):
```typescript
const Status = { Active: 'active', Inactive: 'inactive' } as const;
type Status = (typeof Status)[keyof typeof Status];
```

## Rules

1. Always enable `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` beyond `strict: true`.
2. Install `ts-reset` to turn `any` into `unknown` for JSON.parse, fetch .json(), and other I/O.
3. Use `erasableSyntaxOnly`: no enums, no parameter properties, no namespaces.
4. Use `verbatimModuleSyntax` to enforce `import type` for type-only imports.
5. Prefer `satisfies` over type annotations to preserve literal type inference.
6. Use `as const` with arrays/objects to derive union types instead of defining them by hand.
