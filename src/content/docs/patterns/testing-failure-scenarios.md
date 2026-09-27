---
title: "Testing Failure Scenarios"
description: "Force rate limits, timeouts, retry storms, and cascading failures in tests so resilience code is proven before a provider proves it for you."
---

*Use this page when you are testing retry, backoff, timeout, or circuit-breaker behaviour against a simulated service.*

Live services rarely fail on cue. MSW and nock (see [Simulating Third-Party Services](../third-party-doubles)) let you script the failure, which is the only way to test the code that handles it.

---

## Testing Error Scenarios: Rate Limits, Retries, and Timeouts

Integration tests with MSW or Nock let you test error scenarios that are difficult to trigger with real services. Use them to test resilience patterns such as retries, backoffs, and timeout handling.

### Testing Rate Limits (429 Errors)

Simulate rate limiting to verify your retry logic and user experience:

```typescript
// src/payments/charge-customer.test.int.ts
import { describe, it, expect, vi } from 'vitest';
import { server } from '../test-utils/msw-handlers';
import { createCharge } from './charge-customer';

describe('createCharge handles rate limits', () => {
  it('retries after 429 with Retry-After header', async () => {
    let attemptCount = 0;

    server.use(
      http.post('https://api.stripe.com/v1/charges', async ({ request }) => {
        attemptCount++;
        if (attemptCount === 1) {
          // First attempt: rate limited
          return HttpResponse.json(
            { error: { message: 'Rate limit exceeded' } },
            {
              status: 429,
              headers: { 'Retry-After': '1' },
            }
          );
        }
        // Second attempt: succeeds
        return HttpResponse.json({
          id: 'ch_test_123',
          status: 'succeeded',
        });
      })
    );

    const result = await createCharge(
      { amount: 1000, paymentMethodId: 'pm_card_visa' },
      { stripe: new Stripe('sk_test_...') }
    );

    expect(result.ok).toBe(true);
    expect(attemptCount).toBe(2); // Verify retry happened
  });
});
```

### Testing Timeouts

Simulate slow or unresponsive services to verify timeout handling:

```typescript
it('handles timeout gracefully', async () => {
  server.use(
    http.post('https://api.stripe.com/v1/charges', async () => {
      // Simulate slow response that exceeds timeout
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return HttpResponse.json({ id: 'ch_test_123' });
    })
  );

  const result = await createCharge(
    { amount: 1000, paymentMethodId: 'pm_card_visa' },
    {
      stripe: new Stripe('sk_test_...'),
      timeout: 1000, // 1 second timeout
    }
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe('TIMEOUT');
  }
});
```

### Testing Retry and Backoff Logic

Verify your retry logic with exponential backoff works:

```typescript
it('implements exponential backoff on retries', async () => {
  const attemptTimes: number[] = [];
  let attemptCount = 0;

  server.use(
    http.post('https://api.stripe.com/v1/charges', async () => {
      attemptCount++;
      attemptTimes.push(Date.now());

      if (attemptCount < 3) {
        return HttpResponse.json(
          { error: { message: 'Temporary failure' } },
          { status: 503 }
        );
      }

      return HttpResponse.json({ id: 'ch_test_123', status: 'succeeded' });
    })
  );

  const result = await createCharge(
    { amount: 1000, paymentMethodId: 'pm_card_visa' },
    { stripe: new Stripe('sk_test_...') }
  );

  expect(result.ok).toBe(true);
  expect(attemptCount).toBe(3);

  // Verify backoff: time between attempts should increase
  const delay1 = attemptTimes[1] - attemptTimes[0];
  const delay2 = attemptTimes[2] - attemptTimes[1];
  expect(delay2).toBeGreaterThan(delay1);
});
```

### Testing UX Impact in Frontend

In a frontend, test how errors affect the user experience:

```typescript
// src/components/PaymentForm.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { server } from '../test-utils/msw-handlers';
import { PaymentForm } from './PaymentForm';

describe('PaymentForm error handling', () => {
  it('shows user-friendly message on rate limit', async () => {
    server.use(
      http.post('https://api.stripe.com/v1/charges', () => {
        return HttpResponse.json(
          { error: { message: 'Rate limit exceeded' } },
          { status: 429 }
        );
      })
    );

    render(<PaymentForm />);
    // ... trigger payment

    await waitFor(() => {
      expect(screen.getByText(/please try again in a moment/i)).toBeInTheDocument();
    });
  });

  it('shows loading state during retry', async () => {
    let attemptCount = 0;

    server.use(
      http.post('https://api.stripe.com/v1/charges', async () => {
        attemptCount++;
        if (attemptCount === 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json({ error: { message: 'Temporary failure' } }, { status: 503 });
        }
        return HttpResponse.json({ id: 'ch_test_123', status: 'succeeded' });
      })
    );

    render(<PaymentForm />);
    // ... trigger payment

    // Verify loading indicator appears during retry
    expect(screen.getByText(/processing/i)).toBeInTheDocument();
  });
});
```

### Testing Cascading Failures

Check how an error in one service affects the services that depend on it:

```typescript
it('handles payment service failure gracefully', async () => {
  server.use(
    http.post('https://api.stripe.com/v1/charges', () => {
      return HttpResponse.json(
        { error: { message: 'Service unavailable' } },
        { status: 503 }
      );
    })
  );

  const result = await processOrder(
    {
      customerId: 'cust_123',
      items: [{ productId: 'prod_1', quantity: 1 }],
    },
    { db: prisma, stripe: new Stripe('sk_test_...') }
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe('PAYMENT_SERVICE_UNAVAILABLE');
  }

  // Verify order was not created in database
  const order = await prisma.order.findUnique({
    where: { customerId: 'cust_123' },
  });
  expect(order).toBeNull();
});
```

**What this gives you:**

- **Reliability**: Verify your retry and backoff logic works before production
- **User experience**: Test error messages and loading states in frontend
- **Resilience**: Confirm one failing service doesn't take down its dependents
- **Performance**: Test timeout handling without waiting for real network delays

You can't trigger most of these scenarios on demand against a real service. With MSW or Nock you script them once and replay them on every run.

---

## Related Patterns

- [Resilience Patterns](../resilience) is the code under test here.
- [Performance Testing](../performance) covers the same failures under load with k6 and Toxiproxy.
- [CI Gates and Triage](../ci-gates) covers what to do when one of these fails for real in CI.
