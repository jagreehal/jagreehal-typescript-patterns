---
title: "Test Data and Fakes"
description: "Split unit and integration test files, keep integration tests off production databases, and build fakes and stubs that read like the real thing."
---

*Use this page when you are setting up vitest for a repo, writing a fake for a database or client, or generating test data.*

This page continues from [Testing & Testability](../testing), where every function takes its collaborators as `deps`. This page covers the tooling around that: which tests get a real database, how to stop them reaching production, and how to build the fakes the unit tests use.

---

## Unit Tests vs Integration Tests

The unit tests so far mock their deps. Some tests need a real database, real HTTP calls, or a real file system.

You need both:

- **Unit tests** (`*.test.ts`): Fast, isolated, mock everything
- **Integration tests** (`*.test.int.ts`): Slower, real infrastructure, verify the whole stack

The file naming convention lets you run them separately:

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
import { defineConfig } from 'vitest/config';

// Load test-specific env before anything else
dotenv.config({ path: '.env.test', override: true });

export default defineConfig({
  resolve: {
    tsconfigPaths: true, // opt-in; default is false
  },
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

Picture it: you run tests, they pass, and they delete your production data because the test environment loaded the wrong `.env` file.

**Add a guardrail that throws if tests try to connect to anything other than localhost.** Put this in a Vitest setup file so it runs before any test, even if the test doesn't import the database:

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

Now if someone runs tests with production credentials, they get:

```text
Error: Tests must use localhost database. Got: postgresql://prod-user:***@rds.amazonaws.com/orders
```

The setup file catches it before any test runs, even in tests that don't import the database.

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

No database connection, and tests run in milliseconds. TypeScript ensures you mock the right methods with the right types.

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

**Unit tests** verify your functions work in isolation. They're fast because they mock everything.

**Integration tests** verify the whole stack works together. They're slower but catch issues mocks would miss: database constraints, transaction behavior, query performance.

A healthy test suite has many fast unit tests and fewer slower integration tests. The database guardrail keeps the integration tests off production.

---

## Related Patterns

- [Testing Levels](../testing-levels) decides which level owns a behaviour before you pick a fake for it.
- [Testing External Infrastructure](../testing-external-services) covers sandboxes, MSW and nock for services you do not own.
- [Test Quality](../test-quality) covers what makes the resulting test worth having.
