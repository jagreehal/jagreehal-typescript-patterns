---
title: Why This Pattern Exists
description: Learn why testability drives design and how explicit dependency injection makes testing simpler than vi.mock.
---

Before we talk about functions, dependency injection, or architecture, let's talk about tests.

Because that's where the pain starts.

---

## The Class Testing Problem

It's 2am. Your test suite just failed in CI. You stare at the error:

```text
TypeError: Cannot read property 'mockResolvedValue' of undefined
    at Object.<anonymous> (/tests/UserService.test.ts:42:18)
```

You didn't change the test. You didn't change `UserService`. You *renamed a folder*.

Now you're debugging test infrastructure instead of shipping features.

---

You've written a service class:

```typescript
class UserService {
  constructor(
    private db: Database,
    private mailer: Mailer
  ) {}

  async createUser(name: string, email: string): Promise<User> {
    const user = await this.db.save({ name, email });
    await this.mailer.sendWelcome(user);
    return user;
  }
}
```

Now you want to test it. The instinct is to reach for `vi.mock`:

```typescript
import { vi, describe, it, expect } from 'vitest';
import { UserService } from './UserService';
import { Database } from './Database';
import { Mailer } from './Mailer';

vi.mock('./Database');
vi.mock('./Mailer');

describe('UserService', () => {
  it('creates a user and sends welcome email', async () => {
    const mockUser = { id: '1', name: 'Alice', email: 'alice@test.com' };

    const mockDb = new Database() as jest.Mocked<Database>;
    mockDb.save.mockResolvedValue(mockUser);

    const mockMailer = new Mailer() as jest.Mocked<Mailer>;
    mockMailer.sendWelcome.mockResolvedValue(undefined);

    const service = new UserService(mockDb, mockMailer);
    const result = await service.createUser('Alice', 'alice@test.com');

    expect(result).toEqual(mockUser);
    expect(mockMailer.sendWelcome).toHaveBeenCalledWith(mockUser);
  });
});
```

This looks reasonable. But there are hidden problems.

---

## Why vi.mock Is Fragile

### 1. Module Path Coupling

```typescript
vi.mock('./Database');
```

That string `'./Database'` must exactly match the import path in your source file. Refactor the folder structure? Tests break. Move a file? Tests break. The mock is coupled to the module's path, not its behavior.

### 2. Hoisting Magic

`vi.mock` calls are hoisted to the top of the file. This code:

```typescript
const mockFn = vi.fn();
vi.mock('./Database', () => ({
  Database: vi.fn(() => ({ save: mockFn }))
}));
```

...doesn't work how it looks. The `vi.mock` runs *before* `const mockFn = vi.fn()`. You end up fighting JavaScript execution order with Vitest-specific hoisting rules.

You read the docs. You try `vi.hoisted()`. You add workarounds. Then a coworker asks "why is our test setup so complicated?" and you don't have a good answer.

### 3. Global State

Mocks are global by default. One test's mock can leak into another. You need `vi.clearAllMocks()` or `vi.resetAllMocks()` in `beforeEach`, and you have to remember which one clears what.

Your test passes locally. It fails in CI. You add `--runInBand` to run tests sequentially. The test takes 3x longer but at least it's consistent. You've traded correctness for performance because of invisible shared state.

### 4. Type Erosion

```typescript
import type { Mock } from 'vitest';

const mockDb = {
  save: vi.fn() as Mock<(user: User) => Promise<User>>,
};
```

That cast (`as Mock<...>`) is a type escape hatch. You're telling TypeScript "trust me." If `Database` changes its interface, the cast still passes. You won't get type errors in tests until runtime.

### Prefer Args for Time and Randomness

Before reaching for `vi.mock`, ask: can I pass this as an argument instead?

For dates, the `fn(args, deps)` pattern often works better than mocking:

```typescript
// Instead of mocking Date or date-fns, pass time as an argument
function createOrder(
  args: {
    customerId: string;
    items: OrderItem[];
    timestamp?: Date;  // defaults to now
  },
  deps: CreateOrderDeps
) {
  const createdAt = args.timestamp ?? new Date();
  return deps.db.orders.create({
    data: { ...args, createdAt },
  });
}
```

Now tests have total control without any mocking:

```typescript
it('sets createdAt to provided timestamp', async () => {
  const fixedDate = new Date('2024-01-15T10:00:00Z');

  const result = await createOrder(
    { customerId: '123', items: [], timestamp: fixedDate },
    deps
  );

  expect(result.createdAt).toEqual(fixedDate);
});
```

The same pattern works for UUIDs and other "environmental" values:

```typescript
function createUser(
  args: {
    email: string;
    id?: string;  // defaults to generated UUID
  },
  deps: CreateUserDeps
) {
  const id = args.id ?? crypto.randomUUID();
  // ...
}

// Test can now assert on exact ID
const result = await createUser(
  { email: 'test@example.com', id: 'test-uuid-1234' },
  deps
);
expect(result.id).toBe('test-uuid-1234');
```

**Why this is better than mocking:**
- No hoisting magic or module path coupling
- The dependency is visible in the function signature
- Tests are simpler: just pass the value you want
- Production code works unchanged (defaults kick in)

### When vi.mock Is Still Appropriate

`vi.mock` still has legitimate uses for things you truly can't inject:

```typescript
// Third-party library that calls Date internally
vi.mock('date-fns', () => ({
  formatDistance: () => '2 days ago',
}));

// Platform APIs in code you don't control
vi.mock('fs/promises');
```

Use `vi.mock` when:
- A third-party library calls `Date` or `crypto` internally
- You can't modify the function signature (legacy code)
- The value is truly environmental (logging timestamps, metrics)

The problem is using `vi.mock` for *application logic*: your services, repositories, and business functions. That's where explicit args and deps win.

All of these issues stem from the same root cause: dependencies are implicit and global instead of explicit and local.

---

## A Different Approach

What if dependencies were just arguments?

```mermaid
graph LR
    subgraph Mock["vi.mock approach"]
        T1[Test File<br/>vi.mock] -->|registers| G[Global Registry<br/>Mocks live here<br/>shared state]
        S1[Source File<br/>import Db] -->|imports| G
    end
    
    subgraph Explicit["fn args, deps approach"]
        T2[Test File<br/>const deps] -->|inject| F[Function<br/>fn args deps]
    end
    
    style Mock fill:#475569,stroke:#0f172a,stroke-width:2px,color:#fff
    style Explicit fill:#334155,stroke:#0f172a,stroke-width:2px,color:#fff
    style G fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
    style F fill:#1e293b,stroke:#0f172a,stroke-width:2px,color:#fff
    style T1 fill:#f8fafc,stroke:#0f172a,stroke-width:2px,color:#0f172a
    style S1 fill:#f8fafc,stroke:#0f172a,stroke-width:2px,color:#0f172a
    style T2 fill:#f8fafc,stroke:#0f172a,stroke-width:2px,color:#0f172a
    
    linkStyle 0 stroke:#0f172a,stroke-width:3px
    linkStyle 1 stroke:#0f172a,stroke-width:3px
    linkStyle 2 stroke:#0f172a,stroke-width:3px
```

**Key difference:** `vi.mock` uses global shared state. `fn(args, deps)` uses direct injection with no global state. Each test owns its deps.

### Comparison at a Glance

| Aspect | `vi.mock` (Module Mocking) | `fn(args, deps)` (Explicit Injection) |
| ------ | -------------------------- | ------------------------------------- |
| **State** | Global & shared | Local & isolated |
| **Refactoring** | High risk (path coupling) | Low risk (type-safe) |
| **Execution** | Hoisting "magic" | Standard JS flow |
| **Type Safety** | Requires manual casting | Naturally enforced |
| **Test Isolation** | Needs `clearAllMocks()` | Each test owns its deps |

```typescript
type CreateUserDeps = {
  db: { save: (user: Omit<User, 'id'>) => Promise<User> };
  mailer: { sendWelcome: (user: User) => Promise<void> };
};

async function createUser(
  args: { name: string; email: string },
  deps: CreateUserDeps
): Promise<User> {
  const user = await deps.db.save(args);
  await deps.mailer.sendWelcome(user);
  return user;
}
```

Now test it:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createUser } from './createUser';

describe('createUser', () => {
  it('creates a user and sends welcome email', async () => {
    const mockUser = { id: '1', name: 'Alice', email: 'alice@test.com' };

    const deps = {
      db: { save: vi.fn().mockResolvedValue(mockUser) },
      mailer: { sendWelcome: vi.fn().mockResolvedValue(undefined) },
    };

    const result = await createUser({ name: 'Alice', email: 'alice@test.com' }, deps);

    expect(result).toEqual(mockUser);
    expect(deps.mailer.sendWelcome).toHaveBeenCalledWith(mockUser);
  });
});
```

No `vi.mock`. No hoisting. No path coupling. No global state.

The mock is just an object you pass in. If the function needs different deps, you pass different deps. Each test is independent.

---

## Structure Tests with Arrange-Act-Assert

Every test follows three phases:

1. **Arrange** – Set up test data and dependencies
2. **Act** – Execute the function under test
3. **Assert** – Verify the outcome

Adding explicit comments makes this structure visible:

```typescript
it('creates a user and sends welcome email', async () => {
  // Arrange
  const mockUser = { id: '1', name: 'Alice', email: 'alice@test.com' };
  const deps = {
    db: { save: vi.fn().mockResolvedValue(mockUser) },
    mailer: { sendWelcome: vi.fn().mockResolvedValue(undefined) },
  };

  // Act
  const result = await createUser({ name: 'Alice', email: 'alice@test.com' }, deps);

  // Assert
  expect(result).toEqual(mockUser);
  expect(deps.mailer.sendWelcome).toHaveBeenCalledWith(mockUser);
});
```

**Why this matters:** If any section grows too large, it signals a problem. A bloated Arrange section suggests the test is too complex or testing too many things. Multiple unrelated assertions indicate you're verifying more than one behavior.

The `fn(args, deps)` pattern naturally keeps Arrange simple. You're just creating an object with mock functions, not orchestrating module mocking magic.

---

## Even Better: vitest-mock-extended

Manually creating mock objects works, but you lose type safety. What if you forget a method? What if the interface changes?

[vitest-mock-extended](https://github.com/eratio08/vitest-mock-extended) gives you typed mocks:

```typescript
import { describe, it, expect } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { createUser, CreateUserDeps } from './createUser';

describe('createUser', () => {
  it('creates a user and sends welcome email', async () => {
    const mockUser = { id: '1', name: 'Alice', email: 'alice@test.com' };

    const deps = mock<CreateUserDeps>();
    deps.db.save.mockResolvedValue(mockUser);

    const result = await createUser({ name: 'Alice', email: 'alice@test.com' }, deps);

    expect(result).toEqual(mockUser);
    expect(deps.mailer.sendWelcome).toHaveBeenCalledWith(mockUser);
  });
});
```

`mock<CreateUserDeps>()` creates an object that:

- Has all the methods from `CreateUserDeps`
- Each method is a `vi.fn()` mock
- TypeScript enforces the shape

If you rename `sendWelcome` to `sendWelcomeEmail` in your deps type, the test fails to compile. No runtime surprises.

---

## The Pattern Emerges

Notice what happened:

1. **Dependencies became explicit.** They're in the function signature, not hidden in a constructor.
2. **Mocks became simple.** Just objects, no framework magic.
3. **Tests became isolated.** No global state, no module mocking.
4. **Types stayed accurate.** vitest-mock-extended maintains type safety.

This is the core insight that drives everything in this series. When you structure code as `fn(args, deps)`:

- **Testing is trivial.** Pass mock deps, call function, check result.
- **Dependencies are visible.** You can see what a function needs.
- **Composition is natural.** Functions are just functions.

If you like this pattern, you can even enforce it automatically. [eslint-plugin-prefer-object-params](https://github.com/jagreehal/eslint-plugin-prefer-object-params) flags functions with multiple positional parameters. More on that in the next post.

### Classes Aren't Evil, Hidden State Is

This isn't "classes bad, functions good." Classes can still work if they're:

- **Thin.** Just wiring, not business logic.
- **IO-free.** They don't reach out to databases or APIs directly.
- **Delegating.** They call pure functions that do the real work.

The problem isn't the `class` keyword. It's when classes accumulate hidden state, implicit dependencies, and methods that secretly share everything through `this`. The `fn(args, deps)` pattern makes it *harder* to do that by accident. More on this in [Functions Over Classes](./functions).

---

## Unit Tests vs Integration Tests

So far we've talked about mocking deps for unit tests. But what about tests that need a real database? Real HTTP calls? Real file systems?

You need both:

- **Unit tests** (`*.test.ts`): Fast, isolated, mock everything
- **Integration tests** (`*.test.int.ts`): Slower, real infrastructure, verify the whole stack

The file naming convention matters. It lets you run them separately:

```bash
# Run only unit tests (fast, no setup required)
vitest --exclude '**/*.test.int.ts'

# Run only integration tests (requires database)
vitest '**/*.test.int.ts'
```

### Vitest Configuration

Configure Vitest to load test-specific environment variables:

```typescript
// vitest.config.ts
import dotenv from 'dotenv';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Load test-specific env before anything else
dotenv.config({ path: '.env.test', override: true });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
  },
});
```

Your `.env.test` file contains test database credentials:

```bash
# .env.test
DATABASE_URL="postgresql://test:test@localhost:5432/orders_test"
```

### Database Guardrails: Never Hit Production

Here's a nightmare scenario: you run tests, they pass, but they just deleted your production data. The test environment loaded the wrong `.env` file.

**Add a guardrail that throws if tests try to connect to anything other than localhost.** Put this in a Vitest setup file so it runs before any test, even if the test doesn't directly import the database:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test-utils/vitest.setup.ts'],  // Runs before all tests
  },
});
```

```typescript
// src/test-utils/vitest.setup.ts

// 🛡️ GUARDRAIL: Prevent tests from hitting non-localhost databases
// This runs before ANY test file loads, catching misconfiguration early
if (
  !process.env.DATABASE_URL?.startsWith('postgresql://test:test@localhost')
) {
  throw new Error(
    `Tests must use localhost database. Got: ${process.env.DATABASE_URL}`
  );
}
```

You can also add a redundant check in your database module for defense-in-depth:

```typescript
// src/db/index.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Redundant guardrail (vitest.setup.ts is the primary check)
if (
  process.env.NODE_ENV === 'test' &&
  !process.env.DATABASE_URL?.startsWith('postgresql://test:test@localhost')
) {
  throw new Error(
    `Tests must use localhost database. Got: ${process.env.DATABASE_URL}`
  );
}

export default prisma;
```

Now if someone accidentally runs tests with production credentials, they get:

```text
Error: Tests must use localhost database. Got: postgresql://prod-user:***@rds.amazonaws.com/orders
```

The setup file catches it before any test runs -even tests that don't import the database directly. Crisis averted.

### Mocking Prisma for Unit Tests

For unit tests, you don't want a real database. Use `vitest-mock-extended` to create a typed mock:

```typescript
// src/test-utils/prisma-mock.ts
import { PrismaClient } from '@prisma/client';
import { mockDeep } from 'vitest-mock-extended';

export function createMockPrisma() {
  // mockDeep is essential for Prisma's nested fluent API
  // (e.g., db.order.findUnique) - it mocks all nested properties automatically
  const mockPrisma = mockDeep<PrismaClient>();

  // Handle $transaction by executing the callback with the mock
  mockPrisma.$transaction.mockImplementation(async (callback) => {
    return callback(mockPrisma);
  });

  return mockPrisma;
}
```

Now in your unit tests:

```typescript
// src/orders/get-order.test.ts
import { describe, it, expect } from 'vitest';
import { createMockPrisma } from '../test-utils/prisma-mock';
import { getOrder } from './get-order';

describe('getOrder', () => {
  it('returns order when found', async () => {
    const mockPrisma = createMockPrisma();

    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-123',
      customerId: 'cust-456',
      status: 'pending',
      total: 9999,
      createdAt: new Date(),
    });

    const result = await getOrder(
      { orderId: 'order-123' },
      { db: mockPrisma }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('order-123');
    }
  });

  it('returns NOT_FOUND when order missing', async () => {
    const mockPrisma = createMockPrisma();
    mockPrisma.order.findUnique.mockResolvedValue(null);

    const result = await getOrder(
      { orderId: 'missing' },
      { db: mockPrisma }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('NOT_FOUND');
    }
  });
});
```

No database connection. Tests run in milliseconds. And TypeScript ensures you're mocking the right methods with the right types.

### Test Stubs with Faker

Integration tests need realistic data. Don't hand-craft UUIDs and names. Use [Faker](https://fakerjs.dev/) to generate them:

```typescript
// src/test-utils/stubs.ts
import { faker } from '@faker-js/faker';
import prisma from '../db';

/**
 * Creates a customer with realistic fake data.
 * Use in integration tests that need a real database record.
 */
export async function createTestCustomer(overrides: {
  email?: string;
  name?: string;
} = {}) {
  return prisma.customer.create({
    data: {
      email: overrides.email ?? faker.internet.email(),
      name: overrides.name ?? faker.person.fullName(),
      phone: faker.phone.number(),
      createdAt: faker.date.past(),
    },
  });
}

/**
 * Creates a customer with associated orders for integration testing.
 */
export async function createTestCustomerWithOrders(overrides: {
  orderCount?: number;
  orderStatus?: 'pending' | 'shipped' | 'delivered';
} = {}) {
  const customer = await createTestCustomer();

  const orders = await Promise.all(
    Array.from({ length: overrides.orderCount ?? 1 }).map(() =>
      prisma.order.create({
        data: {
          customerId: customer.id,
          status: overrides.orderStatus ?? 'pending',
          total: faker.number.int({ min: 1000, max: 100000 }),
          shippingAddress: faker.location.streetAddress(),
          items: {
            create: [
              {
                productId: faker.string.uuid(),
                productName: faker.commerce.productName(),
                quantity: faker.number.int({ min: 1, max: 5 }),
                unitPrice: faker.number.int({ min: 500, max: 10000 }),
              },
            ],
          },
        },
      })
    )
  );

  return { customer, orders };
}

/**
 * Creates an API key for integration testing.
 * Returns the key value to use in x-api-key headers.
 */
export async function createTestApiKey(overrides: {
  customerId?: string;
  permissions?: string[];
} = {}) {
  const customer = overrides.customerId
    ? await prisma.customer.findUnique({ where: { id: overrides.customerId } })
    : await createTestCustomer();

  if (!customer) throw new Error('Customer not found');

  const keyValue = `test_${faker.string.alphanumeric(32)}`;

  const apiKey = await prisma.apiKey.create({
    data: {
      key: keyValue,
      customerId: customer.id,
      name: `Test Key ${faker.string.uuid().slice(0, 8)}`,
      enabled: true,
      permissions: overrides.permissions ?? [],
    },
  });

  return {
    customer,
    apiKey,
    keyValue, // Use this in x-api-key header
  };
}
```

Now your integration tests read clearly:

```typescript
// src/orders/create-order.test.int.ts
import { describe, it, expect } from 'vitest';
import { createTestCustomerWithOrders } from '../test-utils/stubs';
import { createOrder } from './create-order';
import prisma from '../db';

describe('createOrder (integration)', () => {
  // No beforeEach cleanup needed!
  // Each test creates unique data via faker, so tests don't interfere.
  // This enables parallel test execution without race conditions.

  it('creates order with items in database', async () => {
    // faker generates unique IDs/emails, so this test is isolated
    const { customer } = await createTestCustomerWithOrders({ orderCount: 0 });

    const result = await createOrder(
      {
        customerId: customer.id,
        items: [
          { productId: 'prod-1', quantity: 2, unitPrice: 1500 },
          { productId: 'prod-2', quantity: 1, unitPrice: 3000 },
        ],
      },
      { db: prisma }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Verify it's actually in the database
      const dbOrder = await prisma.order.findUnique({
        where: { id: result.value.id },
        include: { items: true },
      });

      expect(dbOrder).not.toBeNull();
      expect(dbOrder?.items).toHaveLength(2);
      expect(dbOrder?.total).toBe(6000); // 2*1500 + 1*3000
    }
  });
});
```

**Why no cleanup?** Each test uses `faker.string.uuid()` for IDs and `faker.internet.email()` for emails. Tests create their own unique data and query only that data. No shared state means no cleanup needed, and tests can run in parallel.

### Stub Patterns for Different Scenarios

Create stubs for common test scenarios:

```typescript
// src/test-utils/stubs.ts (continued)

/**
 * Creates realistic stub data for unit tests (no database).
 * Use when you need typed test data but don't want database overhead.
 */
export const stubs = {
  customer: (overrides: Partial<Customer> = {}): Customer => ({
    id: faker.string.uuid(),
    email: faker.internet.email(),
    name: faker.person.fullName(),
    phone: faker.phone.number(),
    createdAt: faker.date.past(),
    ...overrides,
  }),

  order: (overrides: Partial<Order> = {}): Order => ({
    id: faker.string.uuid(),
    customerId: faker.string.uuid(),
    status: 'pending',
    total: faker.number.int({ min: 1000, max: 100000 }),
    shippingAddress: faker.location.streetAddress(),
    createdAt: faker.date.past(),
    ...overrides,
  }),

  orderItem: (overrides: Partial<OrderItem> = {}): OrderItem => ({
    id: faker.string.uuid(),
    orderId: faker.string.uuid(),
    productId: faker.string.uuid(),
    productName: faker.commerce.productName(),
    quantity: faker.number.int({ min: 1, max: 5 }),
    unitPrice: faker.number.int({ min: 500, max: 10000 }),
    ...overrides,
  }),
};

// Usage in unit tests:
const order = stubs.order({ status: 'shipped' });
const items = [stubs.orderItem({ orderId: order.id })];
```

### When to Use Each

| Test Type | File Pattern | Database | Speed | Use For |
| --------- | ------------ | -------- | ----- | ------- |
| Unit | `*.test.ts` | Mock | Fast (ms) | Business logic, error paths, edge cases |
| Integration | `*.test.int.ts` | Real (localhost) | Slower (s) | Database queries, API endpoints, full workflows |

**Unit tests** verify your functions work correctly in isolation. They're fast because they mock everything.

**Integration tests** verify the whole stack works together. They're slower but catch issues mocks would miss: database constraints, transaction behavior, query performance.

A healthy test suite has many fast unit tests and fewer slower integration tests. The database guardrail ensures the integration tests never escape to production.

---

## What's Next

It all starts with testing. If your code is hard to test, something's wrong with the structure. Testability isn't a nice-to-have. It's a design signal.

Let's begin: [Functions Over Classes](./functions)

