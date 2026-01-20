---
title: Functions Over Classes
description: Learn the fn(args, deps) pattern for explicit dependency injection, making your code testable and composable.
---

*Previously: [Why This Pattern Exists](./testing). We saw how testability drives design. Now let's see the pattern itself.*

I want to talk about dependency injection.

Wait, don't leave. I know "dependency injection" sounds like something from a Java enterprise architecture book from 2005. It sounds complicated.

But here's the thing: you're already doing it. Every time you pass something to a function instead of reaching for a global, that's dependency injection. The question isn't whether to do it. It's *how*.

---

## The Problem With Classes

Let's say you're building a user service. The OOP-trained part of your brain might reach for this:

```typescript
class UserService {
  constructor(
    private db: Database,
    private logger: Logger,
    private cache: Cache,
    private mailer: Mailer,
    private metrics: Metrics
  ) {}

  async getUser(userId: string): Promise<User | null> {
    this.logger.info(`Getting user ${userId}`);
    return this.db.findUser(userId);
  }

  async createUser(name: string, email: string): Promise<User> {
    const user = { id: crypto.randomUUID(), name, email };
    await this.db.saveUser(user);
    await this.mailer.sendWelcome(user);
    return user;
  }
}
```

This looks fine at first. But something subtle is happening here.

Look at `getUser`. It only needs `db` and `logger`. But to test it, you have to satisfy the *entire* constructor, including `cache`, `mailer`, and `metrics` that it doesn't use.

A new developer joins. They ask: "What does `getUser` need?" You point to the constructor: five dependencies. They mock all five. The test passes. Two months later, someone adds `this.metrics.increment('user_fetched')` inside `getUser`. The test still passes -but now it's lying. It doesn't verify that metric increment ever happened, because the mock was set up blindly.

As the class grows, the constructor accumulates more and more dependencies. Every method inherits access to everything, whether it needs it or not. You end up with a "god object" where any method might touch any dependency via `this`.

What does `getUser` actually need? You can't tell from its signature. You have to read the implementation.

```mermaid
graph TD
    A[constructor<br/>db, logger, cache, mailer, metrics] --> B[getUser<br/>uses 2]
    A --> C[createUser<br/>uses 3]
    A --> D[method3<br/>uses 1]
    
    style A fill:#475569,stroke:#0f172a,stroke-width:2px,color:#fff
    style B fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
    style C fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
    style D fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
    
    linkStyle 0 stroke:#0f172a,stroke-width:3px
    linkStyle 1 stroke:#0f172a,stroke-width:3px
    linkStyle 2 stroke:#0f172a,stroke-width:3px
```

---

## A Different Shape

What if we wrote functions instead?

```typescript
type GetUserDeps = {
  db: Database;
  logger: Logger;
};

async function getUser(
  args: { userId: string },
  deps: GetUserDeps
): Promise<User | null> {
  deps.logger.info(`Getting user ${args.userId}`);
  return deps.db.findUser(args.userId);
}
```

Now look at that signature. You can see *exactly* what `getUser` needs:
- `args`: the data for this specific call
- `deps`: the infrastructure it relies on

A new developer joins. They ask: "What does `getUser` need?" You point to the type: `GetUserDeps`. Two things: `db` and `logger`. That's it. If someone adds a new dependency, the type changes. Tests that don't mock it fail to compile. You can't accidentally ignore new dependencies.

No hidden state. No constructor that accumulates junk. The function declares its contract explicitly.

Yes, this is just functions + closures -and that's a feature, not a workaround.

This is the core pattern:

```typescript
fn(args, deps)
```

- **args**: what varies per call (userId, input data)
- **deps**: injected collaborators (database, logger, other functions)

```mermaid
graph LR
    A[getUser args, deps<br/>deps: db, logger] 
    B[createUser args, deps<br/>deps: db, logger, mailer]
    
    style A fill:#475569,stroke:#0f172a,stroke-width:2px,color:#fff
    style B fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
```

---

## "But That's So Verbose!"

I hear you. Having to pass deps everywhere sounds tedious. Won't your call sites become cluttered with infrastructure?

Here's the trick: you wire deps *once* at the boundary.

```typescript
// user-service/index.ts
import { getUser, type GetUserDeps } from './functions/get-user';
import { createUser, type CreateUserDeps } from './functions/create-user';

type UserServiceDeps = GetUserDeps & CreateUserDeps;

export function createUserService({ deps }: { deps: UserServiceDeps }) {
  return {
    getUser: ({ userId }: { userId: string }) =>
      getUser({ userId }, deps),
    createUser: ({ name, email }: { name: string; email: string }) =>
      createUser({ name, email }, deps),
  };
}

export type UserService = ReturnType<typeof createUserService>;
```

Now your handlers stay clean:

```typescript
const userService = createUserService({ deps });

await userService.getUser({ userId: '123' });
await userService.createUser({ name: 'Alice', email: 'alice@example.com' });
```

No deps passing at the call site. The factory bound them once.

You get both worlds:
- Functions stay independent (per-function deps)
- Call sites stay clean (factory binds deps)

---

## Why `fn(args, deps)` (Not `fn({ args, deps })`)

You might wonder why this pattern uses two parameters instead of a single object like `{ args, deps }`.

This is intentional: **`args` and `deps` have different lifetimes**.

- `args` are per-call data.
- `deps` are long-lived collaborators.

Keeping them separate makes dependency bloat harder to hide, keeps call sites focused on intent, and makes composition easier: bind `deps` once and pass `args` freely.

Different lifetimes deserve different parameters.

> Note: We intentionally avoid currying here. While it works, explicit parameters keep stack traces simpler and avoid unnecessary closures in hot paths.

---

## What About Context?

You might ask: 'What about request-scoped context like trace IDs, user info, or cancellation signals?'

For **observability context** (trace/span IDs, correlation IDs, baggage, span attributes), you don't need a third parameter. Keep domain functions pure and layer telemetry on top with a wrapper.

```ts
// domain/create-user.ts -pure business logic
export async function createUser(args: CreateUserArgs, deps: CreateUserDeps) {
  const user = await deps.db.users.insert(args);
  return user;
}

// app/create-user.traced.ts -observability layer
import { trace } from 'autotel';
import { createUser } from '../domain/create-user';

export const createUserTraced = trace('user.create', async (args: CreateUserArgs, deps: CreateUserDeps) => {
  return createUser(args, deps);
});
```

If you need direct access to trace context (attributes, baggage, etc.), use the factory form:

```ts
import { trace } from 'autotel';
import { createUser } from '../domain/create-user';

export const createUserTraced = trace((ctx) => async (args: CreateUserArgs, deps: CreateUserDeps) => {
  ctx.setAttribute('user.plan', args.plan);
  return createUser(args, deps);
});
```

This keeps the core message clean:

- **Dependency injection** (`fn(args, deps)`) is for correctness and testability
- **Observability** is layered on, not baked in

→ See [OpenTelemetry patterns](./opentelemetry) for the complete tracing approach.

If context changes business behavior (e.g. tenant isolation or authorization), model it explicitly in `args` or as request-scoped `deps` -not as "extra data."

---

### Where Does This Live?

The factory gets called in your **Composition Root**, the entry point where you wire everything together. This is typically `main.ts`, `server.ts`, or wherever your app boots:

```typescript
// main.ts (Composition Root)
import { createUserService } from './services/user';
import { createDb } from './infra/db';
import { createLogger } from './infra/logger';

// Create infrastructure once
const db = createDb(process.env.DATABASE_URL);
const logger = createLogger({ level: 'info' });

// Wire deps into services
const deps = { db, logger };
const userService = createUserService({ deps });

// Start your server with wired services
const app = createApp({ userService });
app.listen(3000);
```

The Composition Root is the *only* place that knows about all dependencies. Your handlers, routes, and business functions don't know how deps were created. They just receive them.

```mermaid
graph TD
    A[Composition Root] -->|wire deps| B[Service Factory]
    A -->|provides wired services| C[Services API]
    B -->|creates| C
    C -->|calls| D[Core Functions]
    D -->|uses deps| E[Infrastructure]
    
    style A fill:#475569,stroke:#0f172a,stroke-width:2px,color:#fff
    style B fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
    style C fill:#94a3b8,stroke:#0f172a,stroke-width:2px,color:#0f172a
    style D fill:#cbd5e1,stroke:#0f172a,stroke-width:2px,color:#0f172a
    style E fill:#e2e8f0,stroke:#0f172a,stroke-width:2px,color:#0f172a
    
    linkStyle 0 stroke:#0f172a,stroke-width:3px
    linkStyle 1 stroke:#0f172a,stroke-width:3px
    linkStyle 2 stroke:#0f172a,stroke-width:3px
    linkStyle 3 stroke:#0f172a,stroke-width:3px
    linkStyle 4 stroke:#0f172a,stroke-width:3px
```

---

## Why This Matters

### 1. Each Function Declares Exactly What It Needs

With classes, the constructor accumulates everything:

```typescript
class UserService {
  constructor(
    private db: Database,
    private logger: Logger,
    private mailer: Mailer,     // only createUser needs this
    private cache: Cache,        // only someOtherMethod needs this
  ) {}
}
```

With functions, each one declares its own deps:

```typescript
type GetUserDeps = { db: Database; logger: Logger };
type CreateUserDeps = { db: Database; logger: Logger; mailer: Mailer };
```

Look at that. `getUser` doesn't pretend to need `mailer`. The type system documents the truth.

### 2. Testing Gets Simpler

```typescript
import { describe, it, expect } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { getUser, type GetUserDeps } from './get-user';

// Function: pass only what the function needs
it('returns user when found', async () => {
  const mockUser = { id: '123', name: 'Alice', email: 'alice@test.com' };

  const deps = mock<GetUserDeps>();
  deps.db.findUser.mockResolvedValue(mockUser);

  const result = await getUser({ userId: '123' }, deps);
  expect(result).toEqual(mockUser);
});
```

Compare to the class version where you'd have to mock `mailer`, `cache`, and everything else the constructor demands, even though `getUser` doesn't touch them.

### 3. No Hidden Coupling

In a class, any method can call any other method via `this`:

```typescript
class UserService {
  async createUser(name: string, email: string) {
    const user = await this.db.save({ name, email });
    await this.sendWelcomeEmail(user);       // hidden dependency
    await this.updateMetrics('user_created'); // hidden dependency
    return user;
  }

  private sendWelcomeEmail(user: User) { /* ... */ }
  private updateMetrics(event: string) { /* ... */ }
}
```

You're reviewing a PR that changes `sendWelcomeEmail` to require an API key. The PR looks simple: add `apiKey` to the constructor, use it in `sendWelcomeEmail`. But wait -what calls `sendWelcomeEmail`? You grep for it: called from `createUser`, `reactivateUser`, and `inviteUser`. Do all those callers have the context needed for this new API call? You can't tell from the PR. You have to trace through every method that touches `this`.

With functions, collaborators must be explicit:

```typescript
type CreateUserDeps = {
  db: Database;
  sendWelcomeEmail: SendWelcomeEmail;
  updateMetrics: UpdateMetrics;
};

async function createUser(
  args: { name: string; email: string },
  deps: CreateUserDeps
) {
  const user = await deps.db.save(args);
  await deps.sendWelcomeEmail({ user });
  await deps.updateMetrics({ event: 'user_created' });
  return user;
}
```

Want to know what `createUser` depends on? Look at its deps type. It's right there.

---

## When Classes Are Still Fine

I'm not saying "never use classes." Classes work well when:

- **2-5 cohesive methods** that genuinely share state
- **Framework requires them** (NestJS, Angular)
- **Thin infrastructure wrapper** (Redis client, HTTP client)

Classes become problematic when:

- **10+ methods** accumulate over time
- **Private helpers** create implicit coupling via `this`
- **Constructor grows** to satisfy every method's needs

For business logic? Prefer functions.

---

## Grouping Related Functions: The Trade-off

When you end up with many related functions (5+), you have two valid ways to inject them:

- **Inject individually** (optimizes for precision: minimal deps per consumer)
- **Inject as a grouped object** (optimizes for wiring: one thing to pass around)

This choice is not about type safety -you can export explicit input/output types either way. It's about how your codebase uses these functions.

> Pick one approach per module. If grouping starts to feel like a "god object", split it.

### Approach 1: Inject Individually (default)

Use this when most consumers only need a subset (1–2 functions), or when you want dependency lists to stay honest and minimal.

```ts
// user-functions.ts
export async function getUser(args: { userId: string }, deps: GetUserDeps) {
  // ...
}

export async function createUser(
  args: { name: string; email: string },
  deps: CreateUserDeps
) {
  // ...
}

// Function types (single source of truth: the function itself)
export type GetUserFn = typeof getUser;
export type CreateUserFn = typeof createUser;

// Explicit output/input types (no stringy indexing)
export type GetUserResult = Awaited<ReturnType<GetUserFn>>;
export type CreateUserResult = Awaited<ReturnType<CreateUserFn>>;

export type GetUserArgs = Parameters<GetUserFn>[0];
export type CreateUserArgs = Parameters<CreateUserFn>[0];

// notification-handler.ts -only needs sendWelcomeEmail
export type NotificationHandlerDeps = {
  sendWelcomeEmail: SendWelcomeEmailFn;
  // doesn't need getUser or createUser
};
```

**Use this when:**

✅ Most consumers only need 1–2 functions

✅ You want the smallest possible dependency surface area per consumer

✅ You want "no magic strings" and direct `typeof fn` types

**Trade-off:** More verbose wiring (but very explicit)

### Approach 2: Inject as a Grouped Object (when they travel together)

Use this when the functions form a cohesive module and most consumers inject the same set. This reduces DI boilerplate in routers/service factories.

```ts
// user-functions.ts
export const userFns = {
  getUser,
  createUser,
  updateUser,
  deleteUser,
  sendWelcomeEmail,
  sendPasswordReset,
} as const;

export type UserFns = typeof userFns;

// Quote-free type exports (no bracket string access required)
export type GetUserFn = typeof userFns.getUser;
export type GetUserResult = Awaited<ReturnType<GetUserFn>>;

// user-router.ts -needs most user functions
export type UserRouterDeps = {
  userFns: UserFns; // simplest
  // If you really want to narrow the surface area, you can use Pick<UserFns, ...>
};
```

**Use this when:**

✅ The functions are usually injected together

✅ You want simpler wiring and fewer constructor-like objects

✅ The group is truly cohesive (not a dumping ground)

**Trade-off:** Some consumers may receive more than they use (which is fine for cohesive modules)

### Rule of thumb

**Default to injecting individually.**

Group only when the functions are a cohesive unit and genuinely travel together (often at boundaries: routers, service factories, composition root). If grouping starts to feel like a "god object", split it.

---

## The Rules

1. **Per-function deps.** Avoid god objects. Each function declares exactly what it needs. Group related functions only when they're cohesive and always used together.

2. **Inject what you want to mock.** infrastructure (db, logger) and collaborators. Import pure utilities you'll never mock (think `lodash`, `slugify`, math helpers -only inject things that hit network, disk, or the clock).

   Don't inject pure functions:
   ```typescript
   // ❌ Over-injecting
   function createUser(args, deps: { db, logger, slugify, randomUUID }) { }
   
   // ✅ Only inject what you'll mock
   import { slugify } from 'slugify';
   import { randomUUID } from 'crypto';
   function createUser(args, deps: { db, logger }) { }
   ```

3. **Trust validated input.** Core functions don't re-validate args—that's the boundary's job. See [Validation at the Boundary](./validation).

4. **Factory at the boundary.** Wire deps once, expose clean API.

The pattern: `fn(args, deps)`

```mermaid
graph TD
    A[Handlers / Routes<br/>userService.getUser] --> B[Factory boundary<br/>createUserService]
    B --> C[Core Functions<br/>getUser, createUser]
    
    style A fill:#475569,stroke:#0f172a,stroke-width:2px,color:#fff
    style B fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
    style C fill:#94a3b8,stroke:#0f172a,stroke-width:2px,color:#0f172a
    
    linkStyle 0 stroke:#0f172a,stroke-width:3px
    linkStyle 1 stroke:#0f172a,stroke-width:3px
```

---

## Dependency Injection & Testability Guidelines

### Goals

- Maximize testability
- Follow SOLID principles
- Eliminate hidden dependencies
- Avoid module-level imports as runtime dependencies
- Prefer functions over classes

### ❌ Disallowed Pattern

Do not import concrete dependencies directly into business logic.

```typescript
import { cache as defaultCache, KeyvCache } from '../cache'; // ❌ BAD
```

**Why:**

- Hard to test
- Hard to mock
- Creates hidden coupling
- Violates Dependency Inversion

### ✅ Required Pattern: `fn(args, deps)`

All business logic functions must follow this signature:

```typescript
fn(args, deps)
```

- **args** → varies per call (input data)
- **deps** → injected collaborators (db, cache, logger, other functions)

No classes.  
No `this`.  
No hidden state.

### Three-Phase Migration Strategy

Use this when refactoring existing code.

#### Tests Enable a Strangler Fig Migration

If tests already cover the current behavior, don’t rewrite everything at once. Migrate **behind a seam**:

1. **Lock the contract.** Add a small set of tests at the service boundary (inputs → outputs + side effects). These should stay valid no matter how internals change.
2. **Introduce a seam.** Keep the existing class/module, but route calls through a factory/wrapper so you can switch implementations per method. Your service factory is usually the seam.
3. **Migrate one function at a time.** Implement the new `fn(args, deps)` version alongside the old one, then swap the wrapper to call the new function for that single path.
4. **Prove equivalence.** Re-run the same contract tests. If behavior changes, it’s a bug (unless you intended to change the contract).
5. **Delete dead code.** Once every path routes to the new functions, remove the old class/module and the migration glue.

The three-phase migration below shows how to refactor a single function. Use this strangler fig approach to migrate entire services incrementally.

#### BEFORE

```typescript
import { mailer } from '../infra/mailer'; // ❌ Concrete implementation that will require vi.mock to work.

export async function sendWelcomeEmail(recipient: User, sender: User) {
  return mailer.send({
    to: recipient.email,
    from: sender.email,
    template: 'welcome',
  });
}
```

#### PHASE 1: Introduce Dependency Injection (defaulted deps) 100% backwards compatible

- Rename imports to `_mailer`
- Add a `deps` parameter (last positional argument)
- Provide defaults so existing callers keep working

```typescript
import { mailer as _mailer, type Mailer } from '../infra/mailer';

export type SendWelcomeEmailDeps = { mailer: Mailer };

const defaultDeps: SendWelcomeEmailDeps = { mailer: _mailer };

export async function sendWelcomeEmail(
  recipient: User,
  sender: User,
  deps: SendWelcomeEmailDeps = defaultDeps
) {
  const { mailer } = deps;

  return mailer.send({
    to: recipient.email,
    from: sender.email,
    template: 'welcome',
  });
}
```

✅ Safe, incremental  
✅ Existing callers continue to work  
✅ Now testable

Phase 1 is transitional. Once all call sites are updated, move to Phase 2 to enforce explicit dependency injection.

#### PHASE 2: Remove Defaults

- No default deps
- All dependencies must be injected
- Import types using import type (no runtime coupling)

```typescript
import type { Mailer } from '../infra/mailer'; // ✅ Type-only import

export type SendWelcomeEmailDeps = { mailer: Mailer };

export async function sendWelcomeEmail(
  recipient: User,
  sender: User,
  deps: SendWelcomeEmailDeps
) {
  const { mailer } = deps;

  return mailer.send({
    to: recipient.email,
    from: sender.email,
    template: 'welcome',
  });
}
```

✅ Fully testable  
✅ Explicit dependencies  
✅ No runtime imports from infrastructure

**When to stop here:** If you have many call sites and want to minimize changes, Phase 2 is sufficient. 

#### PHASE 3 (Optional but Recommended): Use Object Parameters

- Switch positional args to an `Args` object for readability
- Keeps the public API consistent with the rest of the post (`fn(args, deps)`)
- Still zero defaults, so dependencies remain explicit

```typescript
import type { Mailer } from '../infra/mailer';

export type SendWelcomeEmailArgs = { recipient: User; sender: User };
export type SendWelcomeEmailDeps = { mailer: Mailer };

export async function sendWelcomeEmail(
  args: SendWelcomeEmailArgs,
  deps: SendWelcomeEmailDeps
) {
  const { recipient, sender } = args;
  const { mailer } = deps;

  return mailer.send({
    to: recipient.email,
    from: sender.email,
    template: 'welcome',
  });
}
```

✅ Named args, easier call sites  
✅ Matches the `fn(args, deps)` pattern everywhere  
✅ Recommended for new code and when refactoring call sites is feasible

#### Enforcement: tsconfig.json

Enable `verbatimModuleSyntax` in `tsconfig.json` to prevent accidental runtime imports from infrastructure.

```json
{
  "compilerOptions": {
    "verbatimModuleSyntax": true
  }
}
```

#### Enforcement: ESLint

Add a rule to ESLint to prevent imports from infrastructure.


**ESM (eslint.config.mjs):**
```javascript
export default {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/infra/**"],
            message:
              "Domain code must not import from infra. Inject dependencies instead.",
          },
        ],
      },
    ],
  },
};
```

---

## Enforcing the Pattern

You can enforce object parameters with ESLint using [eslint-plugin-prefer-object-params](https://github.com/jagreehal/eslint-plugin-prefer-object-params):

```bash
npm install -D eslint-plugin-prefer-object-params
```

```javascript
// eslint.config.js
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

Now this gets flagged:

```typescript
// ESLint error: prefer object params
function createUser(name: string, email: string, age: number) { }
```

And this passes:

```typescript
// Object params
function createUser(args: { name: string; email: string; age: number }) { }
```

The rule is pragmatic. It ignores single-parameter functions, constructors, and test files by default. It catches the cases where positional params hurt readability: when there are multiple arguments and order starts to matter.

---

## Integrating with Frameworks

### The NestJS Case

Many developers use decorator-heavy frameworks like NestJS. You don't have to abandon the `fn(args, deps)` pattern -use NestJS classes as **thin wrappers**:

```typescript
import { type Result } from 'awaitly';

// Pure function - your actual logic
async function createUser(
  args: CreateUserInput,
  deps: { db: Database; logger: Logger }
): Promise<Result<User, 'EMAIL_EXISTS' | 'DB_ERROR'>> {
  // Business logic here
}

// NestJS wrapper - thin delegation layer
@Injectable()
export class UserService {
  constructor(
    private db: Database,
    private logger: Logger,
  ) {}

  async createUser(args: CreateUserInput) {
    // Delegate to pure function
    return createUser(args, {
      db: this.db,
      logger: this.logger,
    });
  }
}
```

The NestJS class:
- Receives dependencies via constructor injection (NestJS handles this)
- Delegates immediately to the pure function
- Contains no business logic itself

Your pure function:
- Remains fully testable without NestJS
- Has explicit dependencies (no decorators needed)
- Can be used outside NestJS if you migrate later

**The principle:** Framework classes are infrastructure. Keep them thin. Business logic lives in pure functions.

### Enterprise-Scale DI

For very large applications with hundreds of services, manually wiring dependencies in a Composition Root can become tedious. The `fn(args, deps)` pattern is compatible with auto-wiring DI containers:

```typescript
// tsyringe example
import { container, injectable, inject } from 'tsyringe';

@injectable()
class UserServiceImpl {
  constructor(
    @inject('Database') private db: Database,
    @inject('Logger') private logger: Logger,
  ) {}

  createUser(args: CreateUserInput) {
    return createUser(args, { db: this.db, logger: this.logger });
  }
}

// Auto-wired, but pure functions underneath
const userService = container.resolve(UserServiceImpl);
```

The pattern works with tsyringe, InversifyJS, or any DI container. The key is that your *core functions* remain pure and decorator-free -only the wiring layer uses framework-specific features.

---

## Performance Considerations

Critics sometimes worry that creating many small objects (`args` objects, `deps` bags, factory functions) increases garbage collection pressure.

**The reality:** Modern V8 engines (Orinoco) use generational garbage collection. Objects that die young -like the temporary objects created during request handling -are reclaimed almost instantly. V8 is *extremely* efficient at this.

For I/O-bound web applications:

| Operation | Typical Latency |
|-----------|-----------------|
| Database query | 1-50ms |
| HTTP request | 10-500ms |
| Object allocation | 0.0001ms |

The database query is 10,000-500,000x slower than object allocation. The architectural clarity and type safety of the `fn(args, deps)` pattern far outweigh any micro-overhead.

**When to worry about allocation:**

- Tight loops processing millions of items
- Real-time systems with hard latency requirements
- Memory-constrained embedded environments

For typical web services, **don't optimize for GC**. Optimize for correctness, testability, and maintainability.

---

## What's Next

Alright, so we have clean functions with explicit deps. But there's something we've glossed over.

When someone calls `getUser({ userId: '123' }, deps)`... how do we know `userId` is actually valid? What if it's an empty string? What if `createUser` receives an email that's not actually an email?

Our functions have clean signatures, but right now they're *trusting* that the data they receive is correct. And in a web application, data comes from the outside world. It comes from HTTP requests, queue messages, CLI arguments. It comes from users who might type anything.

Where does validation fit into `fn(args, deps)`?

That's what we'll figure out next.

---

*Next: [Validation at the Boundary](./validation). Where Zod and schema validation fit into this world.*

