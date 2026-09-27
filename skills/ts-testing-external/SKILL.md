---
name: ts-testing-external
description: "Use when testing code that integrates with external APIs, payment providers, or third-party services using sandboxes, MSW, nock, stubs, and Faker."
---

## Two Kinds of Infrastructure

1. **You control** (database, cache, queue): use real instances with test data stubs.
2. **You don't control** (Stripe, SendGrid, Worldpay): use sandboxes, MSW, or nock.

## Stubs with Faker for Infrastructure You Control

Create helper functions that insert real records using `@faker-js/faker` for variety. They write real database rows; nothing is mocked.

```typescript
import { faker } from '@faker-js/faker';

export async function createAuthorisedUser(overrides: { email?: string; role?: 'user' | 'admin' } = {}) {
  const user = await prisma.user.create({
    data: {
      email: overrides.email ?? faker.internet.email(),
      name: faker.person.fullName(),
      role: overrides.role ?? 'user',
      passwordHash: await hashPassword('test-password-123'),
    },
  });
  const apiKey = await prisma.apiKey.create({
    data: { userId: user.id, key: `test_${faker.string.alphanumeric(32)}`, name: 'Test API Key', enabled: true },
  });
  return { user, apiKey: apiKey.key };
}
```

Each test creates its own data; no cleanup needed if the test DB resets between runs. Tests can run in parallel.

## Sandboxes (Preferred for External Services)

Use provider sandbox environments with magic values for deterministic responses.

| Provider   | Mechanism         | Example                                  |
|------------|-------------------|------------------------------------------|
| Stripe     | Payment method ID | `pm_card_chargeDeclined`                 |
| Worldpay   | Cardholder name   | `REFUSED33` -> CARD_EXPIRED              |
| PayPal     | Amount/field      | Specific amount triggers error           |
| Adyen      | Test card number  | `4111111111111111` (declined)            |

In CI, keep sandbox tests small (smoke-level) and push error-path coverage to MSW/nock to avoid rate limits.

## MSW (Mock Service Worker)

Intercepts HTTP at the network boundary. Works in Node.js and browser. Preferred when no sandbox exists.

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.post('https://api.stripe.com/v1/charges', async ({ request }) => {
    const body = await request.formData();
    if (body.get('payment_method') === 'pm_card_declined') {
      return HttpResponse.json({ error: { type: 'card_error', code: 'card_declined' } }, { status: 402 });
    }
    return HttpResponse.json({ id: 'ch_test_123', status: 'succeeded', amount: Number(body.get('amount')) });
  }),
);

// In tests:
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Override handlers per-test with `server.use(...)` for specific scenarios.

## Nock (Node.js Alternative)

Simpler API, Node.js only, intercepts at the `http`/`https` module level.

```typescript
import nock from 'nock';

nock('https://api.stripe.com').post('/v1/charges').reply(402, {
  error: { type: 'card_error', code: 'card_declined' },
});
// afterEach: nock.cleanAll()
```

## Testing Rate Limits, Retries, and Timeouts

Use MSW/nock to simulate scenarios impossible to trigger reliably against real services.

**Rate limit (429):** Return 429 on first attempt, succeed on retry. Assert `attemptCount` and `Retry-After` handling.

**Timeout:** Delay response with `setTimeout` beyond the client timeout. Assert error is `TIMEOUT`.

**Exponential backoff:** Track `Date.now()` per attempt, assert increasing delays.

**Cascading failures:** Return 503 from payment service, assert order was NOT created in the database.

## Decision Matrix

| Scenario                          | Use            |
|-----------------------------------|----------------|
| Service has a sandbox             | Sandbox        |
| No sandbox available              | MSW or Nock    |
| Need browser + Node.js testing    | MSW            |
| Node.js only                      | Nock or MSW    |
| Your own database/cache           | Real instance + stubs with Faker |

## Rules

1. Use stubs (Faker + real DB) for infrastructure you control.
2. Prefer sandboxes when available: real HTTP, predetermined responses, no mock code.
3. Use MSW when no sandbox exists (more versatile, works in browser + Node).
4. Use Nock only if already in the codebase or Node-only is fine.
5. Always test error paths: sandboxes and mocks let you reproduce failures on demand.
6. These are integration tests, not E2E. They cover most scenarios without flakiness or cost.
