---
title: "Enforcing Patterns with Oxlint"
description: "Use Oxlint rules to enforce architectural boundaries, function signatures, and import patterns at lint time, fast enough to run on every save."
---

*Previously: [Enforcing Patterns with TypeScript](..//typescript-config). TypeScript catches type errors; patterns need more enforcement.*

---

TypeScript enforces types. It doesn't enforce:
- Architectural boundaries (domain can't import infra)
- Function signatures (object params vs positional)
- Import patterns (which modules can import which)

For that, you need rules that fail the build, not documentation or code reviews.

---

## The Problem: Patterns Without Rules

You've documented the pattern: "Domain code must not import from infrastructure. Inject dependencies instead."

Someone writes this anyway:

```typescript
// ❌ Violates the pattern
import { db } from '../infra/database';

async function getUser(args: { userId: string }) {
  return db.findUser(args.userId);
}
```

TypeScript compiles it. The linter might warn, but nothing fails, and the violation ships.

A new developer joins the team. They read the architecture docs. They understand the pattern. Then they're rushing to meet a deadline and write `import { db }` because it's faster. The PR reviewer is tired, it's Friday, and the code ships. Six months later, half your domain layer has direct infrastructure imports. The pattern lives in docs no one reads, and the code stops matching it.

As [Jag Reehals puts it](https://arrangeactassert.com/posts/ai-code-needs-rules-not-rituals-the-proof/):

> Prompting is a ritual. Linting is a rule.
>
> Rituals hope. Rules enforce.

---

## Oxlint as Enforcement

[Oxlint](https://oxc.rs/docs/guide/usage/linter.html) is the linter this book uses. It ships as a single native binary, runs the rules from ESLint, typescript-eslint, `import`, `unicorn`, `react`, `jsx-a11y`, `vitest`, `jest`, `node` and `nextjs` without installing any of them, and lints a large repo in the time ESLint takes to load its plugins. That speed is the point: a rule that runs on every save gets obeyed, a rule that runs in a five-minute CI job gets `eslint-disable`d.

Two features make the switch cheap. Type-aware rules (`no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition`) run through [tsgolint](https://github.com/oxc-project/tsgolint) when you set `options.typeAware` and install `oxlint-tsgolint`. And `jsPlugins` loads an ESLint v9 plugin as long as it does not need type information or ESLint's own internals; one of the two plugins this book used carries over, and the other becomes a rule you own.

```bash
pnpm add -D -E oxlint @oxlint/plugins oxlint-tsgolint
```

Pin `oxlint` and `@oxlint/plugins` to the same exact version; they move together.

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

`no-restricted-imports` blocks a path. On its own it is a blunt instrument, because it blocks that path for every file. `overrides` makes it directional: each layer gets its own list of what it may not import.

```ts
// oxlint.config.ts
import { defineConfig } from 'oxlint';

export default defineConfig({
  overrides: [
    {
      // Domain is pure: no infra, no api
      files: ['src/domain/**'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['**/infra/**'], message: 'Domain must not import infra. Inject the dependency.' },
            { group: ['**/api/**'], message: 'Domain must not import the api layer.' },
          ],
        }],
      },
    },
    {
      // Infra implements domain interfaces; it never reaches up into api,
      // and nothing outside a module touches that module's internals
      files: ['src/infra/**'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['**/api/**'], message: 'Infra must not import the api layer.' },
            { group: ['**/internal/**'], message: 'Import the module\'s index, not its internals.' },
          ],
        }],
      },
    },
    {
      files: ['src/api/**'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{ group: ['**/internal/**'], message: 'Import the module\'s index, not its internals.' }],
        }],
      },
    },
  ],
});
```

A later override that sets `no-restricted-imports` replaces the earlier one's options for the files both match; it does not merge them. So each layer's full deny list lives in one override, and the `internal/` pattern is repeated rather than layered on top.

Now you get *directional* enforcement:

- Domain → Domain ✓
- Domain → Infra ✗ (violates dependency inversion)
- Infra → Domain ✓ (infra implements domain interfaces)
- API → anything ✓ (composition root)

Dependencies point inward toward the domain, and the `api` layer is the only place allowed to see all of it. The `internal/` pattern keeps a module's helpers private to that module, so callers couple to its `index.ts` and nothing else.

### Enforcing Function Signatures

The pattern: functions should take object parameters, not positional arguments.

```typescript
// ❌ Bad: positional parameters
function createUser(name: string, email: string, age: number) { }

// ✅ Good: object parameter
function createUser(args: { name: string; email: string; age: number }) { }
```

[eslint-plugin-prefer-object-params](https://github.com/jagreehal/eslint-plugin-prefer-object-params) does this for ESLint, but its build bundles `@typescript-eslint/utils`, which reaches into ESLint's internals, so Oxlint cannot load it (`Dynamic require of "eslint/use-at-your-own-risk" is not supported`). The rule is small enough to own. This is the whole thing, and it is the template for every custom rule in this book:

```ts
// tools/oxlint/prefer-object-params.ts
import { definePlugin } from '@oxlint/plugins';

// Two positional parameters is the ceiling: fn(args, deps) and (item, index) pass.
const MAX_POSITIONAL = 2;

// Destructured, rest and `this` parameters are already self-describing.
const isPositional = (param) =>
  param.type === 'Identifier' ? param.name !== 'this' : param.type === 'AssignmentPattern' && param.left.type === 'Identifier';

export default definePlugin({
  meta: { name: 'local' },
  rules: {
    'prefer-object-params': {
      create(context) {
        const check = (node) => {
          const positional = node.params.filter(isPositional).length;
          if (positional <= MAX_POSITIONAL) return;
          context.report({
            node,
            message: `Prefer a single object parameter over ${positional} positional parameters: fn(args, deps).`,
          });
        };
        return { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check };
      },
    },
  },
});
```

```ts
// oxlint.config.ts
export default defineConfig({
  jsPlugins: [{ name: 'local', specifier: './tools/oxlint/prefer-object-params.ts' }],
  rules: {
    'local/prefer-object-params': 'error',
  },
  overrides: [
    { files: ['**/*.test.ts'], rules: { 'local/prefer-object-params': 'off' } },
  ],
});
```

Now this fails:

```typescript
// ❌ local(prefer-object-params): Prefer a single object parameter over 3 positional parameters
function createUser(name: string, email: string, age: number) { }
```

Two positional parameters are allowed, so `getUser(args, deps)` and `(item, index) => …` pass, and destructured, rest and `this` parameters never count. The override ignores tests. What remains is the case where positional params hurt: three or more arguments whose order matters. Your `package.json` needs `"type": "module"` for Oxlint to load a `.ts` config and plugin.

**Migrating an existing codebase.** The rule reports and does not auto-fix, because every call site changes too. Start it at `'warn'`, fix file by file, then flip it to `'error'`. For a large codebase, a [jscodeshift](https://github.com/facebook/jscodeshift) codemod or a coding agent given the rule as its spec does the mechanical part. The rule catches violations; the migration is a separate job.

### Enforcing Server-Only Boundaries

With React Server Components, TanStack Start, and Next.js Server Actions, the server/client boundary is the most frequent source of runtime errors. Code compiles and then crashes in the browser.

You're building a dashboard. Everything works locally. You deploy. Users report a blank page. You check the console: `ReferenceError: process is not defined`. You imported a utility that uses `process.env`. TypeScript didn't care. The bundler didn't warn. You shipped server code to the browser.

**Problem 1: importing server files into client code.** [eslint-plugin-no-server-imports](https://github.com/jagreehal/eslint-plugin-no-server-imports) is an ESLint plugin that Oxlint loads as-is. Its file patterns match against absolute paths, so start each one with `**/`:

```bash
pnpm add -D eslint-plugin-no-server-imports
```

```ts
// oxlint.config.ts
export default defineConfig({
  jsPlugins: ['eslint-plugin-no-server-imports'],
  rules: {
    'no-server-imports/no-server-imports': ['error', {
      clientFilePatterns: ['**/src/components/**', '**/src/hooks/**', '**/*.client.{ts,tsx}'],
      serverFilePatterns: ['**/*.server.{ts,tsx}', '**/server/**', '**/api/**'],
    }],
  },
});
```

**Problem 2: importing Node.js built-ins in client code.** Even without importing server *files*, someone imports `fs` into a component:

```typescript
// ❌ In a React component:
import { readFileSync } from 'fs';      // Crashes in browser
import { createHash } from 'crypto';    // Crashes in browser
```

Oxlint ships the `import` plugin, so `no-nodejs-modules` needs no install:

```ts
// oxlint.config.ts
export default defineConfig({
  plugins: ['import'],
  overrides: [
    {
      files: ['src/components/**/*.tsx', 'src/hooks/**/*.ts'],
      rules: { 'import/no-nodejs-modules': 'error' },
    },
  ],
});
```

Importing `fs`, `crypto`, `path`, or any Node.js built-in in client code now fails the build with a lint error instead of a runtime crash in production.

---

## Real Example: Complete Config

This complete `oxlint.config.ts` enforces the patterns:

```ts
import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript', 'import', 'unicorn'],
  options: { typeAware: true },
  ignorePatterns: ['**/dist/**', '**/coverage/**', '.claude/**', '.cursor/**'],
  jsPlugins: [
    { name: 'local', specifier: './tools/oxlint/prefer-object-params.ts' },
    'eslint-plugin-no-server-imports',
  ],
  categories: { correctness: 'error', suspicious: 'error' },
  rules: {
    // Enforce function signatures
    'local/prefer-object-params': 'error',

    // Server code stays on the server
    'no-server-imports/no-server-imports': ['error', {
      clientFilePatterns: ['**/src/components/**', '**/src/hooks/**', '**/*.client.{ts,tsx}'],
      serverFilePatterns: ['**/*.server.{ts,tsx}', '**/server/**', '**/api/**'],
    }],

    // TypeScript best practices (the last three are type-aware)
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'typescript/no-explicit-any': 'error',
    'typescript/consistent-type-imports': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-misused-promises': 'error',
    'typescript/no-unnecessary-condition': 'error',

    // Imports
    'import/no-cycle': ['error', { maxDepth: 3 }],

    // Code quality
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-template': 'error',
  },
  overrides: [
    {
      files: ['src/domain/**'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['**/infra/**'], message: 'Domain must not import infra. Inject the dependency.' },
            { group: ['**/api/**'], message: 'Domain must not import the api layer.' },
          ],
        }],
      },
    },
    {
      files: ['src/components/**/*.tsx', 'src/hooks/**/*.ts'],
      rules: { 'import/no-nodejs-modules': 'error' },
    },
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: { 'local/prefer-object-params': 'off' },
    },
  ],
});
```

`categories` turns on a whole tier at once; `correctness` and `suspicious` are the two you want at `error` everywhere. The config, the local rule, and the `no-server-imports` load were run against Oxlint 1.78.0 on Node 24. This config enforces:

- ✅ No infrastructure imports in domain code
- ✅ Object parameters for functions
- ✅ Server code and Node built-ins stay out of the client
- ✅ Type-aware promise and condition checks

Violations fail the build, so the patterns hold.

---

## Plugins for Your Stack

Oxlint bundles the plugins most stacks need. Turn them on by name in `plugins`; nothing to install.

| Stack | Plugin | What it catches |
| ----- | ------ | --------------- |
| TypeScript | `typescript` | `any`, unused vars, type-only imports, and (type-aware) promise misuse |
| Any | `import` | Broken imports, cycles, Node built-ins in the browser |
| Any | `unicorn` | Real mistakes and safer modern idioms |
| Vitest / Jest | `vitest`, `jest` | Focused tests, missing assertions, disabled tests |
| React | `react` | Hook dependency arrays, rules of hooks, refresh boundaries |
| React | `jsx-a11y` | Accessibility violations |
| Next.js | `nextjs` | Next.js-specific patterns |
| Node | `node` | Node-specific mistakes in CommonJS and module handling |

If a rule you need lives only in an ESLint plugin, `jsPlugins` loads it. Three kinds do not load: plugins that need TypeScript's type checker, plugins that parse another file format (Vue, Svelte), and plugins whose build pulls in ESLint's own internals (the `prefer-object-params` case above). For the third kind, port the rule; a `create(context)` function is usually shorter than the plugin's README.

The principle: **if a library has common pitfalls, there's probably a plugin that catches them.** Search for one before writing custom rules.

If you do write one, aim it at preconditions the type system cannot express: call order and lexical scope. A reporter API that needs `story.init(task)` called inside the test body and before any `given()` step will type-check when you get that wrong; the scenario fails to attach to the report and nothing tells you. A rule that says "`init` before steps, steps only inside a test" turns a runtime-invisible constraint into a red line in the editor. [executable-stories](https://github.com/jagreehal/executable-stories) ships this rule for Vitest, Jest and Playwright, and the shape fits any API with a "call this first" contract. The `prefer-object-params` rule above is the template; the [Monorepos](../monorepos#oxlint-extend-and-override) chapter writes another to ban `export *`.

---

## Why Rules Matter for AI-Generated Code

AI coding agents generate code fast and inconsistently: they might follow your patterns, or they might not.

**Prompting is probabilistic.** You're hoping the model remembers your preferences and applies them consistently. Sometimes it does, sometimes it doesn't. Often it lands in the worst place, almost correct, which is how bugs slip through review.

You ask the AI to add a user lookup function. It generates code that imports the database directly: valid TypeScript, wrong architecture. You catch it in review. Next week, your teammate asks for the same thing. The AI generates the same wrong pattern. Without rules, you're reviewing the same architectural violations forever.

**Rules are deterministic.** The linter fires, the code fails, and the agent fixes it.

From [Jag Reehals' article](https://arrangeactassert.com/posts/ai-code-needs-rules-not-rituals-the-proof/):

> If AI is writing code in your repo, constrain it with the same systems you already trust: linters, types, tests, and CI checks. That's how you get the speed AI promises without sacrificing reliability.

---

## Lint for Discarded Evidence

The rules above enforce structure: which module may import which. A second family catches code that throws away evidence the compiler already had, and AI-generated code trips it several times a file.

Every one of these compiles:

```typescript
const handlers: Record<string, Handler> = { create, update }; // keys gone; use `satisfies`
const user = payload as object as User;                        // a cast laundered through `object`
function load(id: unknown): Promise<unknown> { /* ... */ }    // unknown in, unknown out
if (typeof input === 'string') { /* ... */ }                   // narrowing a representation, not a contract
vi.mock('./database');                                         // faking a dependency instead of injecting it
```

In each line the type system knew something precise and the code widened it or re-derived it at runtime. The fix is the one this book keeps returning to: keep the precise type from initialisation through use, and parse untrusted input once, at the [boundary](../validation).

[anti-slop](https://github.com/dmmulroy/anti-slop) is an Oxlint ruleset that encodes this. You vendor it rather than depend on it: copy the rules into `tools/oxlint/anti-slop/`, read them, edit them to match your team, and treat an upstream update as a reviewed merge.

```ts
// oxlint.config.ts
export default defineConfig({
  ignorePatterns: ['tools/oxlint/anti-slop/**'],
  jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
  rules: {
    'anti-slop/no-unknown-parameters': 'error',
    'anti-slop/no-unknown-returns': 'error',
    'anti-slop/no-runtime-typeof': 'error',
    'anti-slop/no-known-value-widening': 'error',
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/require-safety-comment-for-type-assertion': 'error',
    'anti-slop/no-module-mocking': 'error',
  },
});
```

The rules that map onto this book:

| Rule | Rejects | Chapter it enforces |
| --- | --- | --- |
| `no-unknown-parameters`, `no-unknown-returns`, `no-unsafe-dictionary-type` | `unknown` anywhere but the parse boundary (and `cause`) | [Validation at the Boundary](../validation) |
| `no-runtime-typeof` | `typeof x === 'string'` as a substitute for parsing | [Validation at the Boundary](../validation) |
| `no-known-value-widening`, `no-chained-type-assertions`, `no-widen-then-assert` | annotating away literal types, laundering casts | [TypeScript Config](../typescript-config) |
| `require-safety-comment-for-type-assertion` | any `as` without a `// SAFETY: <invariant>` comment | [TypeScript Config](../typescript-config) |
| `no-module-mocking` | `vi.mock`, `jest.mock` and friends | [Testing](../testing) |
| `no-array-filter-map`, `no-reduce-accumulator-copy` | double passes and quadratic reducers | [Performance](../performance) |

Copy two habits from it even if you never install it. The authors write each diagnostic as an instruction an agent can act on ("Parse input at its I/O boundary, then branch on the domain value"), which turns a red squiggle into a self-correcting loop. And the install skill tells the agent not to suppress a rule or add a cast to make lint pass. A rule the agent can `oxlint-disable` its way past enforces nothing.

---

## The Rules

1. **Enforce architectural boundaries.** Use `no-restricted-imports` inside `overrides` so each layer has its own deny list.
2. **Enforce function signatures.** Own a `prefer-object-params` rule; it is twenty-five lines and it allows `fn(args, deps)`.
3. **Enforce framework boundaries.** `no-server-imports` for server files, `import/no-nodejs-modules` for client files.
4. **Fail the build on violations.** Rules should be `'error'`, not `'warn'`.
5. **Lint for discarded evidence.** Ban `unknown` past the boundary and unexplained casts. Vendor the rules so you own them.

TypeScript enforces types and Oxlint enforces patterns. Together they catch violations before code ships.

---

## What's Next

We've established the enforcement layer: TypeScript catches type errors, and Oxlint catches architectural violations within a package.

But what about multiple packages? How do you structure a monorepo for debuggability, shared configuration, and granular exports?

---

*Next: [Monorepo Patterns](..//monorepos). Structure packages for debugging, sharing, and tree-shaking.*
