---
title: Enforcing Patterns with ESLint
description: Use ESLint rules to enforce architectural boundaries, function signatures, and import patterns at lint time.
---

*Previously: [Enforcing Patterns with TypeScript](./typescript-config). TypeScript catches type errors. But patterns need more enforcement.*

---

TypeScript enforces types. It doesn't enforce:
- Architectural boundaries (domain can't import infra)
- Function signatures (object params vs positional)
- Import patterns (which modules can import which)

For that, you need **rules**. Not documentation. Not code reviews. Rules that fail the build.

---

## The Problem: Patterns Without Rules

You've documented the pattern: "Domain code must not import from infrastructure. Inject dependencies instead."

But look at this:

```typescript
// ❌ Violates the pattern
import { db } from '../infra/database';

async function getUser(args: { userId: string }) {
  return db.findUser(args.userId);
}
```

TypeScript compiles it. The linter might warn. But it doesn't fail. The violation ships.

A new developer joins the team. They read the architecture docs. They understand the pattern. Then they're rushing to meet a deadline. They write `import { db }` because it's faster. The PR reviewer is tired -it's Friday. The code ships. Six months later, half your domain layer has direct infrastructure imports. The pattern exists in docs nobody reads. The codebase doesn't follow it.

**Documentation is a ritual. Rules are enforcement.**

As [Jag Reehals puts it](https://arrangeactassert.com/posts/ai-code-needs-rules-not-rituals-the-proof/):

> Prompting is a ritual. Linting is a rule.
>
> Rituals hope. Rules enforce.

---

## ESLint as Enforcement

ESLint can enforce patterns at lint time. Not in review. Not in production. **At lint time.**

### Enforcing Architectural Boundaries

The pattern: domain code must not import from infrastructure.

```typescript
// ❌ Bad: domain importing infra
import { db } from '../infra/database';

// ✅ Good: inject dependency
async function getUser(args: { userId: string }, deps: { db: Database }) {
  return deps.db.findUser(args.userId);
}
```

**Simple approach:** Use `no-restricted-imports` to block paths:

```javascript
// eslint.config.mjs
export default {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/infra/**"],
            message: "Domain code must not import from infra. Inject dependencies instead.",
          },
        ],
      },
    ],
  },
};
```

This works but it's a blunt instrument -it blocks *all* imports from infra, everywhere.

**Better approach:** Use [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) to define directional rules between layers:

```bash
npm install -D eslint-plugin-boundaries
```

```javascript
// eslint.config.mjs
import boundaries from 'eslint-plugin-boundaries';

export default [
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain/**' },
        { type: 'infra', pattern: 'src/infra/**' },
        { type: 'api', pattern: 'src/api/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // Domain is pure - no external imports
            { from: 'domain', allow: ['domain'] },
            // Infra can import domain (to implement interfaces)
            { from: 'infra', allow: ['domain', 'infra'] },
            // API can import domain and infra (wires everything together)
            { from: 'api', allow: ['domain', 'infra', 'api'] },
          ],
        },
      ],
    },
  },
];
```

Now you get *directional* enforcement:

- Domain → Domain ✓
- Domain → Infra ✗ (violates dependency inversion)
- Infra → Domain ✓ (infra implements domain interfaces)
- API → anything ✓ (composition root)

This matches the architecture: dependencies point inward toward the domain.

**Advanced: Module Privacy with `no-private`**

For larger projects, you may want to enforce that certain files within a layer are "private" -internal helpers that shouldn't be imported from outside the module:

```javascript
// eslint.config.mjs
{
  settings: {
    'boundaries/elements': [
      { type: 'domain', pattern: 'src/domain/**' },
      { type: 'domain-internal', pattern: 'src/domain/**/internal/**', private: true },
      // ...
    ],
  },
  rules: {
    'boundaries/no-private': ['error'],
  },
}
```

```typescript
// src/domain/user/internal/helpers.ts
export function hashPassword(password: string) { /* ... */ }

// src/domain/user/createUser.ts
import { hashPassword } from './internal/helpers';  // ✅ Same module, allowed

// src/api/routes/user.ts
import { hashPassword } from '../domain/user/internal/helpers';  // ❌ Error: private module
```

This ensures modules expose only their public API through an `index.ts`, preventing tight coupling to internal implementation details.

### Enforcing Function Signatures

The pattern: functions should take object parameters, not positional arguments.

```typescript
// ❌ Bad: positional parameters
function createUser(name: string, email: string, age: number) { }

// ✅ Good: object parameter
function createUser(args: { name: string; email: string; age: number }) { }
```

Use [eslint-plugin-prefer-object-params](https://github.com/jagreehal/eslint-plugin-prefer-object-params):

```bash
npm install -D eslint-plugin-prefer-object-params
```

```javascript
// eslint.config.mjs
import preferObjectParams from 'eslint-plugin-prefer-object-params';

export default [
  {
    plugins: { 'prefer-object-params': preferObjectParams },
    rules: {
      'prefer-object-params/prefer-object-params': 'error',
    },
  },
];
```

Now this fails:

```typescript
// ❌ ESLint error: prefer object params
function createUser(name: string, email: string, age: number) { }
```

The rule is pragmatic. It ignores:
- Single-parameter functions
- Constructors
- Test files (by default)

It catches the cases where positional params hurt readability: when there are multiple arguments and order matters.

**Migrating Existing Codebases**

The `prefer-object-params` rule currently reports violations but doesn't auto-fix them (the transformation is too complex for safe automation -call sites need updating too).

For large-scale migrations, consider:

1. **Incremental adoption:** Start with `'warn'` and fix violations file-by-file
2. **Codemod scripts:** Use [jscodeshift](https://github.com/facebook/jscodeshift) to automate the transformation:

```javascript
// transform-to-object-params.js (jscodeshift)
export default function transformer(file, api) {
  const j = api.jscodeshift;
  // Transform function declarations with 2+ params to object pattern
  // ... (custom logic for your codebase)
}
```

```bash
npx jscodeshift -t transform-to-object-params.js src/**/*.ts
```

3. **AI-assisted refactoring:** Modern coding agents can batch-refactor functions when given clear rules

The key is that the ESLint rule *catches* violations. The migration strategy is separate from enforcement.

### Enforcing Server-Only Boundaries

With React Server Components, TanStack Start, and Next.js Server Actions, the server/client boundary is the most frequent source of runtime errors in 2025. Code compiles fine but crashes in the browser.

You're building a dashboard. Everything works locally. You deploy. Users report a blank page. You check the console: `ReferenceError: process is not defined`. You imported a utility that uses `process.env`. TypeScript didn't care. The bundler didn't warn. You shipped server code to the browser.

**Problem 1: Importing server files into client code**

```typescript
// ❌ Bad: server code imported in client
import { db } from './server/database';

// ✅ Good: server-only code stays separate
// (in server-only file)
```

Use [eslint-plugin-no-server-imports](https://github.com/jagreehal/eslint-plugin-no-server-imports):

```javascript
// eslint.config.mjs
import noServerImports from 'eslint-plugin-no-server-imports';

export default [
  {
    plugins: { 'no-server-imports': noServerImports },
    rules: {
      'no-server-imports/no-server-imports': [
        'error',
        {
          serverFilePatterns: [
            '**/*.server.ts',
            '**/*.server.tsx',
            '**/server/**',
            '**/api/**',
          ],
        },
      ],
    },
  },
];
```

**Problem 2: Importing Node.js modules in client code**

Even without importing server *files*, developers accidentally import Node.js built-ins:

```typescript
// ❌ In a React component:
import { readFileSync } from 'fs';      // Crashes in browser
import { createHash } from 'crypto';    // Crashes in browser
```

Use `eslint-plugin-import`'s `no-nodejs-modules` rule for client files:

```javascript
// eslint.config.mjs
export default [
  {
    files: ['src/components/**/*.tsx', 'src/hooks/**/*.ts'],
    rules: {
      'import/no-nodejs-modules': ['error', {
        allow: [],  // No Node.js modules allowed in client code
      }],
    },
  },
];
```

Now importing `fs`, `crypto`, `path`, or any Node.js built-in in client code fails the build immediately.

**Why this matters:** The build fails with a clear ESLint error instead of a cryptic runtime crash in production.

---

## Real Example: Complete ESLint Config

Here's a complete `eslint.config.mjs` that enforces the patterns:

```javascript
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import preferObjectParams from 'eslint-plugin-prefer-object-params';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'prefer-object-params': preferObjectParams,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      
      // Enforce architectural boundaries
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infra/**'],
              message: 'Domain code must not import from infra. Inject dependencies instead.',
            },
          ],
        },
      ],
      
      // Enforce function signatures
      'prefer-object-params/prefer-object-params': 'error',
      
      // TypeScript best practices
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      
      // Code quality
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      // Relax rules in tests
      'prefer-object-params/prefer-object-params': 'off',
    },
  },
];
```

This config enforces:

- ✅ No infrastructure imports in domain code
- ✅ Object parameters for functions
- ✅ TypeScript best practices
- ✅ Code quality rules

Violations fail the build. The patterns are enforced.

---

## Essential Plugins

Beyond the pattern-specific plugins above, these plugins form a solid foundation for any TypeScript project:

### The Foundation

**[@typescript-eslint/eslint-plugin](https://typescript-eslint.io/)**: Non-optional for TypeScript. Provides TS-aware rules and typed linting. The example config above already uses this.

**[eslint-plugin-import](https://www.npmjs.com/package/eslint-plugin-import)**: Catches broken imports, enforces import order, and prevents circular dependencies. Pairs with the TypeScript resolver for full type awareness.

```bash
npm install -D eslint-plugin-import eslint-import-resolver-typescript
```

**[eslint-plugin-unused-imports](https://www.npmjs.com/package/eslint-plugin-unused-imports)**: High ROI -automatically removes dead imports. Eliminates "why is this here?" review churn.

```bash
npm install -D eslint-plugin-unused-imports
```

**[eslint-plugin-unicorn](https://www.npmjs.com/package/eslint-plugin-unicorn)**: A comprehensive set of rules that catch real mistakes and push modern, safer patterns. Opinionated but helpful.

```bash
npm install -D eslint-plugin-unicorn
```

### Plugins for Your Stack

ESLint has plugins for most frameworks and testing libraries. Install the ones that match your stack:

| Stack | Plugin | What it catches |
| ----- | ------ | --------------- |
| Vitest | `eslint-plugin-vitest` | Test anti-patterns, expect assertions |
| Jest | `eslint-plugin-jest` | Same, for Jest |
| Testing Library | `eslint-plugin-testing-library` | Async query issues, accessibility |
| React | `eslint-plugin-react-hooks` | Hook dependency arrays, rules of hooks |
| React | `eslint-plugin-jsx-a11y` | Accessibility violations |
| Next.js | `@next/eslint-plugin-next` | Next.js-specific patterns |

The principle: **if a library has common pitfalls, there's probably an ESLint plugin that catches them.** Search for `eslint-plugin-{library-name}` before writing custom rules.

---

## Why Rules Matter for AI-Generated Code

AI coding agents generate code fast. But they're inconsistent. They might follow patterns. They might not.

**Prompting is probabilistic.** You're hoping the model remembers your preferences and applies them consistently. Sometimes it does. Sometimes it doesn't. Often it lands in the worst possible place: almost correct.

Almost correct is how bugs slip through review.

You ask the AI to add a user lookup function. It generates code that imports the database directly -perfectly valid TypeScript, completely wrong architecture. You catch it in review. Next week, your teammate asks for the same thing. The AI generates the same wrong pattern. Without rules, you're reviewing the same architectural violations forever.

**Rules are deterministic.** The linter fires. The code fails. The agent fixes it. That's enforcement.

From [Jag Reehals' article](https://arrangeactassert.com/posts/ai-code-needs-rules-not-rituals-the-proof/):

> If AI is writing code in your repo, constrain it with the same systems you already trust: linters, types, tests, and CI checks. That's how you get the speed AI promises without sacrificing reliability.

---

## The Rules

1. **Enforce architectural boundaries.** Use `no-restricted-imports` to prevent domain code from importing infrastructure.
2. **Enforce function signatures.** Use `prefer-object-params` to enforce object parameters.
3. **Enforce framework boundaries.** Use framework-specific plugins (like `no-server-imports`) for server/client separation.
4. **Fail the build on violations.** Rules should be `'error'`, not `'warn'`.

ESLint enforces patterns. TypeScript enforces types. Together, they catch violations before code ships.

---

## What's Next

We've established the enforcement layer. TypeScript catches type errors. ESLint catches architectural violations. Together, they ensure patterns are followed within a package.

But what about multiple packages? How do you structure a monorepo for debuggability, shared configuration, and granular exports?

---

*Next: [Monorepo Patterns](./monorepos). Structure packages for debugging, sharing, and tree-shaking.*

