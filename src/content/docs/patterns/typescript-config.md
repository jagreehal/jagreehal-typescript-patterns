---
title: Enforcing Patterns with TypeScript
description: Use strict TypeScript compiler flags to enforce patterns at compile time. Beyond strict mode with noUncheckedIndexedAccess.
---

*Previously: [API Design Patterns](..//api). We've built the complete application architecture. This chapter enforces it.*

---

You've defined patterns. Functions take object parameters. You inject dependencies instead of importing them. Infrastructure stays separate from business logic.

Without enforcement, those patterns stay suggestions.

You can document patterns, add comments, and hope people remember them. In practice people violate them, especially with AI-generated code, and almost-correct code slips through review.

The TypeScript compiler can enforce them at compile time.

---

## Beyond `strict: true`

Many developers treat `strict: true` as the ceiling for type safety, but it leaves gaps.

In 2025, the standard for "strict" has shifted toward **total type safety**, where you question even the built-in library's defaults. To enforce the "Never Throw" and "Validation at the Boundary" patterns, you need these additional flags.

### Array & Object Safety

**`noUncheckedIndexedAccess`**: By default, TypeScript assumes `myArray[0]` exists. It might not.

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

This aligns with the "Never Throw" philosophy: missing data shows up in the types instead of crashing at runtime.

**`exactOptionalPropertyTypes`**: Ensures `{ id?: string }` means the key is *missing*, not present with value `undefined`.

```typescript
type User = { id?: string };

// Without exactOptionalPropertyTypes:
const user: User = { id: undefined };  // ✓ Allowed (but causes issues with Object.keys)

// With exactOptionalPropertyTypes:
const user: User = { id: undefined };  // ❌ Error: undefined is not assignable
const user: User = {};                 // ✓ Correct: key is missing
```

This prevents subtle bugs with database serialization and object iteration.

### Native Compatibility

Node.js 22+, Bun, and Deno run TypeScript files by stripping the types, with no build step. That changes what "valid TypeScript" means: syntax that emits JavaScript (enums, parameter properties, namespaces) does not run.

**`erasableSyntaxOnly`**: This flag is mandatory for modern backends. It ensures your code stays "erasable", compatible with native runtimes that strip types without transpilation.

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

Your TypeScript source runs as-is. The runtime behavior matches your source, with no transpiler step between what you write and what runs.

### Guarding Against Ghost Imports

**`noUncheckedSideEffectImports`**: Catches "ghost imports", side-effect imports that reference files that no longer exist. TypeScript 7 turns it on by default; set it anyway so a TypeScript 6 checker in the same repo agrees.

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

The flag helps most in large codebases where you reorganize files, or when bundler plugins handle CSS/asset imports. You'll know at compile time if those files are missing.

---

## Fixing Standard Library Leaks

`strict: true` is insufficient. TypeScript's standard library still leaks `any` through `JSON.parse`, `fetch`, and other I/O functions, bypassing your [Validation at the Boundary](..//validation) pattern.

```typescript
// The problem: JSON.parse returns any
const data = JSON.parse(input);  // any ← Bypasses all your validation!
data.whatever.you.want;           // No error. Runtime crash waiting to happen.

// Same with fetch:
const response = await fetch('/api/user');
const user = await response.json();  // any ← All your careful types, gone.
```

You spent a week building a type-safe API client. Every endpoint has perfect types. You ship it. Production crashes: `Cannot read property 'id' of undefined`. You trace it to a `fetch` call. The API returned `{ data: { user: null } }` but your code expected `{ user: { id: ... } }`. TypeScript didn't warn you. The response was `any`, so you could access any property, and TypeScript believed you.

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

By forcing `JSON.parse` to return `unknown`, `ts-reset` turns your [Validation at the Boundary](..//validation) pattern into a **compiler requirement**. You cannot use parsed data without validating it first.

It also fixes other annoyances:

```typescript
// Before ts-reset:
const filtered = [1, undefined, 2].filter(Boolean);  // (number | undefined)[]

// After ts-reset:
const filtered = [1, undefined, 2].filter(Boolean);  // number[]
```

---

## Type-Level Patterns

Beyond compiler flags, TypeScript has features that add type constraints the compiler checks.

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

AI-generated code prefers the annotated version because it looks tidier. It also throws away the key names the compiler had inferred. Treat `const x: Record<string, T> = {...}` as a smell, and treat any `as` other than `as const` the same way: a cast is a claim you make on the compiler's behalf, so write the invariant next to it (`// SAFETY: parsed by UserSchema two lines up`). A linter can catch the uncommented cast and the value widened to `unknown` and asserted back; the [Oxlint chapter](../lint#lint-for-discarded-evidence) lists the rules.

### `as const` Assertions

Use it for literal types and for extracting array element types:

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

One compiler flag enforces the `fn(args, deps)` pattern from [Functions Over Classes](..//functions).

The pattern: import infrastructure only as *types*, never at runtime. Your functions receive infrastructure through `deps`.

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

Now TypeScript *forces* you to use `import type` for types. If you try to import a runtime value from infrastructure, the compiler errors. You can't couple your business logic to infrastructure by accident.

The compiler enforces the separation that makes your functions testable.

---

## The Complete Configuration

The TypeScript 7 `tsconfig.json` that enforces these patterns:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "esnext",
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

What each flag enforces:

| Flag | Enforces |
| ---- | -------- |
| `noUncheckedIndexedAccess` | Handle missing array/object elements |
| `exactOptionalPropertyTypes` | Optional means missing, not undefined |
| `verbatimModuleSyntax` | Type-only imports stay type-only (faster compilation) |
| `erasableSyntaxOnly` | No enums, no parameter properties, native runtime compatible |
| `noUncheckedSideEffectImports` | Catch ghost imports (moved/deleted files) |

TypeScript 7 defaults `strict`, `module: esnext` and `noUncheckedSideEffectImports` to on, so you could leave them out. Keep them: an explicit flag survives a teammate opening the project with an older compiler, and a config that reads the same as the book is easier to diff.

---

## Essential Type Libraries

### ts-reset

As covered above, [@total-typescript/ts-reset](https://github.com/total-typescript/ts-reset) fixes the standard library's `any` leaks. Install it, create `reset.d.ts`, and `JSON.parse` returns `unknown` instead of `any`.

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

Teams often abandon these patterns when type errors get hard to read. Two tools help:

**[Total TypeScript VS Code Extension](https://www.totaltypescript.com/vscode-extension)**: Translates obtuse TypeScript errors into plain language in the IDE. One user called it "the single best improvement to my DX in many years." It helps most with complex generics like `createWorkflow` error unions.

**Type queries**: Use `// ^?` comments to show types inline in your editor and documentation:

```typescript
const user = { id: '123', role: 'admin' } as const;
//    ^? const user: { readonly id: "123"; readonly role: "admin"; }
```

This helps engineers understand complex generics and keeps code samples accurate.

---

## TypeScript 7 Is the Native Compiler

TypeScript 7.0 shipped in July 2026 as a port of the compiler to Go. It arrives in the same `typescript` package with the same `tsc` command, checks a large project about ten times faster than 6.0, and runs the language server across threads. Upgrading costs you the options TypeScript 6 deprecated, which 7 turns into hard errors:

- `baseUrl` is gone; write `paths` relative to the config file (`./src/*`).
- `moduleResolution: node` and `node10` are gone; use `nodenext` for Node packages and `bundler` for everything that goes through a bundler.
- `target: es5`, `downlevelIteration`, and the `amd`/`umd`/`system` module formats are gone.
- `esModuleInterop`, `allowSyntheticDefaultImports` and `alwaysStrict` can no longer be turned off.
- `types` defaults to `[]` instead of every `@types` package in `node_modules`; list what you use.

Run `tsc` under 7 once, fix the option errors it prints, and the rest of this chapter applies unchanged. If a package cannot move yet, `@typescript/typescript6` installs the old compiler as `tsc6` beside the new one.

**Stricter flags help performance.** Flags like `verbatimModuleSyntax` and `erasableSyntaxOnly` reduce the "heuristics" the compiler needs to perform. When the compiler doesn't have to guess whether an import is type-only, or whether a feature needs transpilation, it can take faster code paths.

```typescript
// With verbatimModuleSyntax, the compiler knows immediately:
import type { User } from './types';  // Type-only, strip entirely
import { db } from './database';       // Runtime, keep as-is

// Without it, the compiler must analyze usage across the codebase
// to determine if an import is actually used at runtime
```

These flags help performance as well as safety. Explicit code compiles faster because the compiler has less to infer.

---

## What TypeScript Can't Enforce

TypeScript catches type errors. It doesn't catch:

- Architectural boundaries (infra vs domain)
- Function signatures (object params vs positional)
- Import patterns (which modules can import which)

For those, you need a linter.

---

## The Rules

1. **Go beyond `strict: true`.** Enable `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
2. **Fix the standard library.** Use `ts-reset` to turn `any` into `unknown` for all I/O functions.
3. **Erasable syntax only.** Avoid enums and namespaces for Node.js compatibility.
4. **Use `verbatimModuleSyntax`.** Enforce type-only imports.
5. **Leverage `satisfies` and `as const`.** Keep literal types, validate shapes.
6. **Every cast carries its proof.** No `as` without a `// SAFETY:` comment naming the invariant.

Treat the compiler as your first line of defense and configure it to be strict.

---

## What's Next

TypeScript enforces types. Architectural boundaries, function signatures, and import rules need a linter, and Oxlint covers them.

---

*Next: [Enforcing Patterns with Oxlint](..//lint). Rules that catch violations TypeScript can't.*

