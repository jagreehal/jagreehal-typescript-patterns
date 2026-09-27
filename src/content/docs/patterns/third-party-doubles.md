---
title: "Simulating Third-Party Services"
description: "Sandboxes, MSW, and nock for services you do not control, in order of preference, plus the complete pattern that combines them with real infrastructure you do."
---

*Use this page when a test needs a payment provider, email service, or external API to answer, and you cannot call the real one.*

[Testing External Infrastructure](../testing-external-services) makes the decision: real instance, sandbox, or simulated response. This page is the how-to for the last two.

---

## Testing Infrastructure You Don't Control

For external services (payment providers, email services, third-party APIs), you have three options, in order of preference:

### Option 1: Sandboxes (Best When Available)

Many services provide test sandboxes. Stripe, SendGrid, and Twilio all have test environments where you can send real HTTP requests and get predetermined responses.

**Worldpay Example (Magic Values):**

Some sandboxes use "magic values" in specific request fields to trigger deterministic responses. Worldpay's sandbox reads special strings in the `cardHolderName` field to force specific outcomes. These "magic values" are specific to Worldpay's sandbox and only apply in test environments.

```typescript
// src/payments/worldpay-payment.test.int.ts
import { describe, it, expect } from 'vitest';
import { processWorldpayPayment } from './worldpay-payment';

describe('processWorldpayPayment (integration)', () => {
  it('handles card expired error', async () => {
    // Magic value in cardHolderName triggers specific error response
    const result = await processWorldpayPayment(
      {
        amount: 1000,
        currency: 'GBP',
        cardNumber: '4444333322221111',
        expiryMonth: '12',
        expiryYear: '2030',
        cardHolderName: 'REFUSED33', // Magic value → "CARD EXPIRED"
      },
      {
        worldpay: new WorldpayClient(process.env.WORLDPAY_TEST_KEY!),
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('CARD_EXPIRED');
    }
  });

  it('handles hold card error', async () => {
    const result = await processWorldpayPayment(
      {
        amount: 1000,
        cardHolderName: 'REFUSED4', // Magic value → "HOLD CARD"
        // ... other fields
      },
      { worldpay: new WorldpayClient(process.env.WORLDPAY_TEST_KEY!) }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('HOLD_CARD');
    }
  });

  it('succeeds with authorised magic value', async () => {
    const result = await processWorldpayPayment(
      {
        amount: 1000,
        cardHolderName: 'AUTHORISED', // Magic value → successful payment
        // ... other fields
      },
      { worldpay: new WorldpayClient(process.env.WORLDPAY_TEST_KEY!) }
    );

    expect(result.ok).toBe(true);
  });
});
```

**Common Sandbox Patterns:**

Different providers use different mechanisms, but the pattern is the same: use documented test inputs to get predictable outcomes.

| Provider | Deterministic test input | Example |
|----------|-------------------------|---------|
| Stripe | Payment method ID | `pm_card_chargeDeclined` |
| Worldpay | Cardholder name value | `REFUSED33` (in `cardHolderName` field) |
| PayPal | Amount or field value | Specific amount triggers error |
| Adyen | Test card number | `4111111111111111` (declined) |
| GoCardless | Test bank account | Fixed test account number |

**Why sandboxes are best:**
- Real HTTP calls catch integration issues (headers, auth, request format)
- Predetermined responses let you test error paths reliably
- No mocking code to maintain
- Tests run against the actual API contract
- In CI, keep sandbox tests small (smoke-level) and push most error path testing to MSW/nock to avoid rate limits and slow builds

**When to use sandboxes:**
- Service provides a test environment
- You need to verify request format and authentication
- Error scenarios are well-documented

**Limitations:**
- Not all services have sandboxes
- Some sandboxes have rate limits
- Network calls are slower than mocks

---

### Option 2: MSW (Mock Service Worker)

When sandboxes aren't available, use [MSW](https://mswjs.io/) to intercept HTTP requests at the boundary of your app. MSW works in both Node.js and browser environments.

**Setup:**

```typescript
// src/test-utils/msw-handlers.ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const handlers = [
  // Single handler for Stripe charges with branching logic
  // MSW matches handlers in order, so put more specific cases first
  // Note: Example uses /charges for brevity; use the endpoints your app actually uses (e.g., PaymentIntents)
  http.post('https://api.stripe.com/v1/charges', async ({ request }) => {
    const body = await request.formData();
    const paymentMethod = body.get('payment_method');
    const amount = body.get('amount');

    // Optional: Assert request details (headers, auth, etc.) to verify integration
    // Adjust this check to match your actual auth format
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer sk_test_')) {
      return HttpResponse.json(
        { error: { message: 'Invalid API key' } },
        { status: 401 }
      );
    }

    // Simulate decline for specific test card
    if (paymentMethod === 'pm_card_declined') {
      return HttpResponse.json(
        {
          error: {
            type: 'card_error',
            code: 'card_declined',
            message: 'Your card was declined.',
          },
        },
        { status: 402 }
      );
    }

    // Default to success
    return HttpResponse.json({
      id: 'ch_test_123',
      object: 'charge',
      amount: Number(amount),
      status: 'succeeded',
      currency: 'usd',
    });
  }),

  // Mock email service
  http.post('https://api.sendgrid.com/v3/mail/send', () => {
    return HttpResponse.json(
      { message: 'success' },
      { status: 202 }
    );
  }),
];

export const server = setupServer(...handlers);
```

**In your test file:**

```typescript
// src/payments/charge-customer.test.int.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { server } from '../test-utils/msw-handlers';
import { createCharge } from './charge-customer';

describe('createCharge (integration)', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it('succeeds when payment method is valid', async () => {
    // Note: Even though we pass a real-looking Stripe client,
    // MSW intercepts the HTTP request before it reaches the network
    const result = await createCharge(
      {
        amount: 1000,
        currency: 'usd',
        paymentMethodId: 'pm_card_visa',
      },
      { stripe: new Stripe('sk_test_...') }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('succeeded');
    }
  });

  it('handles declined card', async () => {
    const result = await createCharge(
      {
        amount: 1000,
        paymentMethodId: 'pm_card_declined', // Triggers decline handler
      },
      { stripe: new Stripe('sk_test_...') }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('PAYMENT_DECLINED');
    }
  });
});
```

**Why MSW:**
- Intercepts at the boundary of your app: your code makes real HTTP requests
- Works in Node.js and browser (same handlers for both)
- Type-safe with TypeScript
- Can override handlers per test
- You can also assert request payloads/headers inside handlers (e.g., check auth header) to lock down the integration

**When to use MSW:**
- Service doesn't have a sandbox
- You need to test error scenarios that are hard to trigger in sandboxes
- You want fast, reliable tests without network calls

**Reference:** See [nodejs-api-testing-examples-vitest](https://github.com/jagreehal/nodejs-api-testing-examples-vitest) for complete MSW examples.

---

### Option 3: Nock

[Nock](https://github.com/nock/nock) is a Node.js-specific HTTP mocking library. It intercepts requests at a lower level than MSW.

**Example:**

```typescript
// src/payments/charge-customer.test.int.ts
import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { createCharge } from './charge-customer';

describe('createCharge (integration)', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('succeeds when payment method is valid', async () => {
    nock('https://api.stripe.com')
      .post('/v1/charges')
      .reply(200, {
        id: 'ch_test_123',
        status: 'succeeded',
        amount: 1000,
      });

    const result = await createCharge(
      {
        amount: 1000,
        paymentMethodId: 'pm_card_visa',
      },
      { stripe: new Stripe('sk_test_...') }
    );

    expect(result.ok).toBe(true);
  });

  it('handles declined card', async () => {
    nock('https://api.stripe.com')
      .post('/v1/charges')
      .reply(402, {
        error: {
          type: 'card_error',
          code: 'card_declined',
        },
      });

    const result = await createCharge(
      {
        amount: 1000,
        paymentMethodId: 'pm_card_declined',
      },
      { stripe: new Stripe('sk_test_...') }
    );

    expect(result.ok).toBe(false);
  });
});
```

**Nock vs MSW:**

| Feature | Nock | MSW |
|---------|------|-----|
| Environment | Node.js only | Node.js + Browser |
| Interception level | Lower (http/https modules) | Higher (fetch/XHR) |
| Setup complexity | Simple | Slightly more setup |
| Type safety | Manual | Better with TypeScript |

**When to use Nock:**
- Node.js-only codebase
- You prefer the simpler API
- You're already using it in your codebase

**When to prefer MSW:**
- You need browser testing too
- You want better TypeScript support
- You're starting fresh

**Reference:** See [nodejs-api-testing-examples-vitest](https://github.com/jagreehal/nodejs-api-testing-examples-vitest) for complete nock examples.

---

## The Complete Pattern

This example combines a real database with MSW-intercepted Stripe calls:

```typescript
// src/payments/process-payment.test.int.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { createAuthorisedUser } from '../test-utils/stubs';
import { server } from '../test-utils/msw-handlers';
import { processPayment } from './process-payment';
import prisma from '../db';

describe('processPayment (integration)', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it('charges customer and creates order', async () => {
    // Arrange: Real database with test data
    const { user } = await createAuthorisedUser();
    const customer = await prisma.customer.create({
      data: {
        userId: user.id,
        email: user.email,
        stripeCustomerId: 'cus_test_123',
      },
    });

    // Act: Business logic with real DB; Stripe client wired, HTTP intercepted by MSW
    const result = await processPayment(
      {
        customerId: customer.id,
        amount: 1000,
        paymentMethodId: 'pm_card_visa',
      },
      {
        db: prisma,
        stripe: new Stripe(process.env.STRIPE_TEST_SECRET_KEY!),
      }
    );

    // Assert: Verify database state
    expect(result.ok).toBe(true);
    if (result.ok) {
      const order = await prisma.order.findUnique({
        where: { id: result.value.orderId },
      });
      expect(order).not.toBeNull();
      expect(order?.status).toBe('paid');
    }
  });
});
```

**What's happening:**
- **Real database** - Uses `createAuthorisedUser()` stub to set up test data
- **Stripe client wired, HTTP intercepted by MSW** - Real Stripe client instance, but MSW intercepts HTTP requests before they reach the network
- **Integration test** - Tests the full flow: database → business logic → external API

You get confidence that your code works end-to-end, without the flakiness and cost of real external services.

---

## Related Patterns

- [Testing Failure Scenarios](../testing-failure-scenarios) uses these same tools to force rate limits, timeouts and cascades.
- [Test Data and Fakes](../test-data) covers fakes for infrastructure you do control.
- [Resilience Patterns](../resilience) is the code these simulations exercise.
