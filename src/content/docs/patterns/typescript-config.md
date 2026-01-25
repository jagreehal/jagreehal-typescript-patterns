---
title: Enforcing Patterns with TypeScript
description: Use strict TypeScript compiler flags to enforce patterns at compile time. Beyond strict mode with noUncheckedIndexedAccess.
---

*Previously: [API Design Patterns](..//api). We've built the complete application architecture. Now let's enforce it.*

---

You've defined patterns. Functions take object parameters. Dependencies are injected, not imported. Infrastructure stays separate from business logic.

But here's the problem: **patterns without enforcement are just suggestions.**

You can write documentation. You can add comments. You can hope people remember. But in practice, especially with AI-generated code, patterns get violated. Almost-correct code slips through review.

TypeScript can enforce patterns at compile time. Not suggestions. Not hopes. **Enforcement.**

---

## Beyond `strict: true`

Many developers believe `strict: true` is the final boss of safety. It isn't.

In 2025, the standard for "strict" has shifted toward **total type safety** -where even the built-in library's defaults are questioned. To enforce the "Never Throw" and "Validation at the Boundary" patterns, you need these additional flags.

### Array & Object Safety

**`noUncheckedIndexedAccess`**: By default, TypeScript assumes `myArray[0]` always exists. This is a lie.

```typescript
const users = ['Alice', 'Bob'];

// Without noUncheckedIndexedAccess:
const first = users[0];  // string ← TypeScript lies, this could be undefined

// With noUncheckedIndexedAccess:
const first = users[0];  // string | undefined ← Now you must handle it
//    ^? const first: string | undefined

if (first) {
  console.log(first.toUpperCase());  // Safe
}
```

A customer reports: "The app crashes when I have no items in my cart." You check the code: `const firstItem = cart.items[0]`. TypeScript said it was `CartItem`. But the cart was empty. `firstItem` was `undefined`. You called `firstItem.price` and crashed. TypeScript's default behavior let you write code that crashes on empty arrays.

This aligns with the "Never Throw" philosophy: missing data becomes explicit, not a runtime crash.

**`exactOptionalPropertyTypes`**: Ensures that `{ id?: string }` truly means the key is *missing*, not that it exists with value `undefined`.

```typescript
type User = { id?: string };

// Without exactOptionalPropertyTypes:
const user: User = { id: undefined };  // ✓ Allowed (but causes issues with Object.keys)

// With exactOptionalPropertyTypes:
const user: User = { id: undefined };  // ❌ Error: undefined is not assignable
const user: User = {};                 // ✓ Correct: key is missing
```

This prevents subtle bugs with database serialization and object iteration.

### Native Compatibility (TS 5.8+)

In 2025, the TypeScript ecosystem is shifting toward a **"type-annotations only"** approach. Node.js 22+, Bun, and Deno can now run TypeScript files directly by simply stripping types -no heavy build step required. This changes what "valid TypeScript" means.

**`erasableSyntaxOnly`**: This flag is now mandatory for modern backends. It ensures your code is strictly "erasable" -compatible with native runtimes that strip types without transpilation.

```typescript
// ❌ With erasableSyntaxOnly, these fail:
enum Status { Active, Inactive }        // Emits JavaScript code
class User {
  constructor(public name: string) {}   // Parameter properties emit code
}

// ✅ Use erasable alternatives:
const Status = { Active: 'active', Inactive: 'inactive' } as const;
type Status = (typeof Status)[keyof typeof Status];

class User {
  name: string;
  constructor(name: string) {
    this.name = name;  // Explicit assignment, no magic
  }
}
```

**Why this matters:** Your TypeScript source becomes directly executable. No transpiler surprises. No divergence between what you write and what runs. The runtime behavior matches the source code exactly.

### Guarding Against Ghost Imports

**`noUncheckedSideEffectImports`**: A critical safety flag that catches "ghost imports" -side-effect imports that reference files that no longer exist.

```typescript
// Side-effect imports don't bind any values:
import "./styles.css";
import "reflect-metadata";
import "./polyfills";

// The problem: If you move or delete polyfills.ts...
// TypeScript historically did NOT error. Your build passes locally,
// then fails in CI, or worse -fails silently in production.
```

With `noUncheckedSideEffectImports` enabled, every side-effect import is verified against an actual file on disk:

```typescript
import "./polyfills";  // ❌ Error: Cannot find module './polyfills'
```

This is especially important in large codebases where files get reorganized, or when using bundler plugins that handle CSS/asset imports -you'll know immediately if those files are missing.

---

## Fixing Standard Library Leaks

Here's a harsh truth: `strict: true` is insufficient. TypeScript's standard library still leaks `any` through `JSON.parse`, `fetch`, and other I/O functions. This silently bypasses your [Validation at the Boundary](..//validation) pattern.

```typescript
// The problem: JSON.parse returns any
const data = JSON.parse(input);  // any ← Bypasses all your validation!
data.whatever.you.want;           // No error. Runtime crash waiting to happen.

// Same with fetch:
const response = await fetch('/api/user');
const user = await response.json();  // any ← All your careful types, gone.
```

You spent a week building a type-safe API client. Every endpoint has perfect types. You ship it. Production crashes: `Cannot read property 'id' of undefined`. You trace it to a `fetch` call. The API returned `{ data: { user: null } }` but your code expected `{ user: { id: ... } }`. TypeScript didn't warn you. The response was `any` -you could access any property, and TypeScript believed you.

### The Solution: `ts-reset`

Install [@total-typescript/ts-reset](https://github.com/total-typescript/ts-reset) to fix these defaults globally:

```bash
npm install -D @total-typescript/ts-reset
```

Create a `reset.d.ts` in your project:

```typescript
// reset.d.ts
import "@total-typescript/ts-reset";
```

Now the standard library is safe:

```typescript
const data = JSON.parse(input);
//    ^? const data: unknown

// You're forced to validate:
const user = UserSchema.parse(data);  // Now it's typed
```

**This is the key insight:** By forcing `JSON.parse` to return `unknown`, `ts-reset` makes your [Validation at the Boundary](..//validation) pattern not just a best practice, but a **compiler requirement**. You literally cannot use parsed data without validating it first. The Zod boundary becomes inescapable.

It also fixes other annoyances:

```typescript
// Before ts-reset:
const filtered = [1, undefined, 2].filter(Boolean);  // (number | undefined)[]

// After ts-reset:
const filtered = [1, undefined, 2].filter(Boolean);  // number[]
```

---

## Type-Level Patterns

Beyond compiler flags, TypeScript has features that create inescapable type constraints.

### The `satisfies` Operator

Use `satisfies` to ensure an object matches a type without losing specific type inference:

```typescript
type Route = { path: string; handler: () => void };

// Without satisfies: loses literal types
const routes: Record<string, Route> = {
  home: { path: '/', handler: () => {} },
  about: { path: '/about', handler: () => {} },
};
routes.typo;  // No error! Record<string, Route> accepts any key.

// With satisfies: keeps literal types, validates shape
const routes = {
  home: { path: '/', handler: () => {} },
  about: { path: '/about', handler: () => {} },
} satisfies Record<string, Route>;

routes.typo;  // ❌ Error: Property 'typo' does not exist
routes.home;  // ✓ Autocomplete works
```

It's a "fail-fast" check that doesn't widen your types.

### `as const` Assertions

Essential for literal types and extracting array element types:

```typescript
const ROLES = ['admin', 'user', 'guest'] as const;
//    ^? const ROLES: readonly ["admin", "user", "guest"]

type Role = (typeof ROLES)[number];
//   ^? type Role = "admin" | "user" | "guest"

// Now you can validate at runtime and get type safety:
function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
```

---

## Enforcing Type-Only Imports

This is the compiler flag that enforces the `fn(args, deps)` pattern from [Functions Over Classes](..//functions).

The pattern says: infrastructure should only be imported as *types*, never at runtime. Your functions receive infrastructure through `deps`, not through imports.

```typescript
// ✅ Good: type-only import, infrastructure injected via deps
import type { Database } from '../infra/database';

type GetUserDeps = { db: Database };

async function getUser(args: { userId: string }, deps: GetUserDeps) {
  return deps.db.findUser(args.userId);  // Injected, testable
}

// ❌ Bad: runtime import creates hidden dependency
import { db } from '../infra/database';

async function getUser(args: { userId: string }) {
  return db.findUser(args.userId);  // Hidden, hard to test
}
```

Enable `verbatimModuleSyntax` to enforce this:

```json
{
  "compilerOptions": {
    "verbatimModuleSyntax": true
  }
}
```

Now TypeScript *forces* you to use `import type` for types. If you try to import a runtime value from infrastructure, the compiler errors. You can't accidentally couple your business logic to infrastructure.

This is why the pattern works: the compiler enforces the separation that makes your functions testable.

---

## The Complete Configuration

Here's the 2025 `tsconfig.json` that enforces these patterns:

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

Each flag serves a purpose:

| Flag | Enforces |
| ---- | -------- |
| `noUncheckedIndexedAccess` | Handle missing array/object elements |
| `exactOptionalPropertyTypes` | Optional means missing, not undefined |
| `verbatimModuleSyntax` | Type-only imports stay type-only (faster compilation) |
| `erasableSyntaxOnly` | No enums, no parameter properties, native runtime compatible |
| `noUncheckedSideEffectImports` | Catch ghost imports (moved/deleted files) |

---

## Essential Type Libraries

### ts-reset

We covered this above: [@total-typescript/ts-reset](https://github.com/total-typescript/ts-reset) fixes the standard library's `any` leaks. Install it, create `reset.d.ts`, and `JSON.parse` returns `unknown` instead of `any`.

### type-fest

[type-fest](https://github.com/sindresorhus/type-fest) fills gaps in TypeScript's built-in utility types:

```bash
npm install type-fest
```

Useful types for this architecture:

```typescript
import type { Simplify, SetRequired, PartialDeep, ReadonlyDeep } from 'type-fest';

// Simplify: flatten complex intersections for readable hover types
type UserWithPosts = Simplify<User & { posts: Post[] }>;

// SetRequired: make specific optional keys required
type CreateUserArgs = SetRequired<Partial<User>, 'email' | 'name'>;

// PartialDeep: recursive Partial (built-in only goes one level)
type UserPatch = PartialDeep<User>;

// ReadonlyDeep: recursive Readonly for immutable data
type ImmutableUser = ReadonlyDeep<User>;
```

These complement the `fn(args, deps)` pattern by making args types precise and explicit.

---

## Developer Experience

Complex type errors are a primary cause of pattern abandonment. Two tools help:

**[Total TypeScript VS Code Extension](https://www.totaltypescript.com/vscode-extension)**: Translates obtuse TypeScript errors into plain language directly in the IDE. One user called it "the single best improvement to my DX in many years." Essential when working with complex generics like `createWorkflow` error unions.

**Type queries**: Use `// ^?` comments to show types inline in your editor and documentation:

```typescript
const user = { id: '123', role: 'admin' } as const;
//    ^? const user: { readonly id: "123"; readonly role: "admin"; }
```

This helps engineers understand complex generics and ensures code samples are truthful.

---

## The Native Compiler Future

As of late 2025, the TypeScript team is porting the compiler to native code (the "tsgo" project) to achieve up to 10x speedups. This native compiler uses multi-threading and optimized memory layouts.

**Why stricter flags matter for performance:** Flags like `verbatimModuleSyntax` and `erasableSyntaxOnly` reduce the "heuristics" the compiler needs to perform. When the compiler doesn't have to guess whether an import is type-only, or whether a feature needs transpilation, it can take faster code paths.

```typescript
// With verbatimModuleSyntax, the compiler knows immediately:
import type { User } from './types';  // Type-only, strip entirely
import { db } from './database';       // Runtime, keep as-is

// Without it, the compiler must analyze usage across the codebase
// to determine if an import is actually used at runtime
```

The flags we recommend aren't just about safety -they're also about performance. Stricter code is faster to compile because it's more explicit about intent.

---

## What TypeScript Can't Enforce

TypeScript catches type errors. It doesn't catch:

- Architectural boundaries (infra vs domain)
- Function signatures (object params vs positional)
- Import patterns (which modules can import which)

For those, you need ESLint.

---

## The Rules

1. **Go beyond `strict: true`.** Enable `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
2. **Fix the standard library.** Use `ts-reset` to turn `any` into `unknown` for all I/O functions.
3. **Erasable syntax only.** Avoid enums and namespaces for Node.js compatibility.
4. **Use `verbatimModuleSyntax`.** Enforce type-only imports.
5. **Leverage `satisfies` and `as const`.** Keep literal types, validate shapes.

TypeScript is your first line of defense. Make it ruthless.

---

## What's Next

TypeScript enforces types. But patterns need more: architectural boundaries, function signatures, import rules.

That's where ESLint comes in.

---

*Next: [Enforcing Patterns with ESLint](..//eslint). Rules that catch violations TypeScript can't.*

