---
name: ts-testing
description: "Use when writing unit or integration tests for TypeScript functions following the fn(args, deps) pattern."
---

## Core Pattern: `fn(args, deps)`

Design every function to receive its dependencies as an explicit second argument. You no longer need `vi.mock`, and you avoid hoisting surprises, global state, and path coupling.

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

## Mocking with vitest-mock-extended

Always prefer `mock<T>()` (or `mockDeep<T>()` for nested APIs like Prisma) over hand-rolled mocks. They stay type-safe: if the interface changes, tests fail at compile time.

```typescript
import { mock } from 'vitest-mock-extended';

const deps = mock<CreateUserDeps>();
deps.db.save.mockResolvedValue(mockUser);
```

For Prisma, use `mockDeep` to handle the nested fluent API:

```typescript
import { mockDeep } from 'vitest-mock-extended';

function createMockPrisma() {
  const mockPrisma = mockDeep<PrismaClient>();
  mockPrisma.$transaction.mockImplementation(async (cb) => cb(mockPrisma));
  return mockPrisma;
}
```

## Arrange-Act-Assert

Structure every test with explicit AAA comments:

```typescript
it('creates a user and sends welcome email', async () => {
  // Arrange
  const mockUser = { id: '1', name: 'Alice', email: 'alice@test.com' };
  const deps = mock<CreateUserDeps>();
  deps.db.save.mockResolvedValue(mockUser);

  // Act
  const result = await createUser({ name: 'Alice', email: 'alice@test.com' }, deps);

  // Assert
  expect(result).toEqual(mockUser);
  expect(deps.mailer.sendWelcome).toHaveBeenCalledWith(mockUser);
});
```

If Arrange grows large, the test is too complex. If Assert has unrelated checks, split the test.

## Avoiding vi.mock

Never use `vi.mock` for application code (services, repositories, business functions). It introduces path coupling, hoisting magic, global state, and type erosion via casts.

Use `vi.mock` only when you cannot inject: third-party libraries that call `Date`/`crypto` internally, platform APIs in code you do not control, or legacy code you cannot modify.

For dates, randomness, and IDs, pass them as optional args with production defaults:

```typescript
function createOrder(args: { customerId: string; timestamp?: Date }, deps: Deps) {
  const createdAt = args.timestamp ?? new Date();
  // ...
}
```

## Database Testing Guardrails

### File conventions

- Unit tests: `*.test.ts`: mock deps, run in milliseconds.
- Integration tests: `*.test.int.ts`: real localhost DB, run in seconds.

### Never hit production

Add a setup file that throws before any test if `DATABASE_URL` does not point to localhost:

```typescript
// vitest.setup.ts (referenced in vitest.config.ts setupFiles)
if (!process.env.DATABASE_URL?.startsWith('postgresql://test:test@localhost')) {
  throw new Error(`Tests must use localhost database. Got: ${process.env.DATABASE_URL}`);
}
```

Load `.env.test` in vitest.config.ts via `dotenv.config({ path: '.env.test', override: true })`.

### Integration test data

Use Faker stubs to generate unique data per test so tests run in parallel without cleanup:

```typescript
export async function createTestCustomer(overrides: Partial<Customer> = {}) {
  return prisma.customer.create({
    data: {
      email: overrides.email ?? faker.internet.email(),
      name: overrides.name ?? faker.person.fullName(),
    },
  });
}
```

## Rules

1. Every function under test must accept `(args, deps)`, with no hidden imports.
2. Use `mock<T>()` / `mockDeep<T>()` from vitest-mock-extended for all mocks.
3. Never use `vi.mock` for application code.
4. Always comment `// Arrange`, `// Act`, `// Assert` in tests.
5. Integration tests must have the `.test.int.ts` suffix.
6. Database guardrail in `vitest.setup.ts` is mandatory, with no exceptions.
7. Use Faker for integration test data; avoid hand-crafted UUIDs.
