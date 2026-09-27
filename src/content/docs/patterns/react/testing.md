---
title: "Testing and MSW"
description: "Test only where it pays: pure domain logic heavily, components where the logic is real, and MSW for deterministic network in Vite."
sidebar:
  order: 10
---

*Use this page when you are writing a React test or setting up MSW.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

---

## Testing Philosophy: Only When It Pays

- **Unit test** pure domain logic heavily.
- **Component tests** only where valuable:
  - complex UI logic
  - high-risk flows
  - historically flaky/buggy components
- **E2E tests** for critical user journeys.
- Prefer story-driven interaction tests for UI behaviors.

Avoid low-value tests:

- snapshot spam
- shallow render tests that assert implementation details
- tests that duplicate type checking

### Example: Testing Pure Domain Logic

```ts
// domain/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { calculateDiscount, calculateTotal } from './pricing';

describe('calculateDiscount', () => {
  it('applies percentage discount correctly', () => {
    expect(calculateDiscount(100, { type: 'percentage', value: 20 })).toBe(80);
  });

  it('applies fixed discount correctly', () => {
    expect(calculateDiscount(100, { type: 'fixed', value: 15 })).toBe(85);
  });

  it('does not allow negative totals', () => {
    expect(calculateDiscount(10, { type: 'fixed', value: 50 })).toBe(0);
  });

  it('handles edge case: 100% discount', () => {
    expect(calculateDiscount(100, { type: 'percentage', value: 100 })).toBe(0);
  });
});

describe('calculateTotal', () => {
  it('sums items correctly', () => {
    const items = [
      { price: 10, quantity: 2 },
      { price: 15, quantity: 1 },
    ];
    expect(calculateTotal(items)).toBe(35);
  });

  it('returns 0 for empty cart', () => {
    expect(calculateTotal([])).toBe(0);
  });
});
```

### Example: Component Test for Complex Logic

```tsx
// Only test components with non-trivial logic
// MultiStepForm.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultiStepForm } from './MultiStepForm';

describe('MultiStepForm', () => {
  it('progresses through steps correctly', async () => {
    const onComplete = vi.fn();
    render(<MultiStepForm onComplete={onComplete} />);

    // Step 1: Personal Info
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/name/i), 'Alice');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    // Step 2: Address
    expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/street/i), '123 Main St');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    // Step 3: Review
    expect(screen.getByText(/step 3 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/123 main st/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onComplete).toHaveBeenCalledWith({
      name: 'Alice',
      street: '123 Main St',
    });
  });

  it('allows going back to previous steps', async () => {
    render(<MultiStepForm onComplete={vi.fn()} />);

    // Go to step 2
    await userEvent.type(screen.getByLabelText(/name/i), 'Alice');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    // Go back
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveValue('Alice'); // Data preserved
  });
});
```

---

## MSW + Vite

### MSW: Required for Storybook and Integration Tests

MSW is required: it gives you deterministic stories and tests.

| Use Case | MSW Role |
| -------- | -------- |
| Storybook (data-fetching stories) | Required. No real network in stories. |
| Storybook (pure presentational) | Not needed if no fetch occurs. |
| Integration tests | Required. Simulate edge cases deterministically. |
| Local dev "mock mode" | Optional but useful for offline/backend-less dev. |
| Production | Never. |

### Example: MSW Handler Setup

```ts
// mocks/handlers.ts
import { http, HttpResponse, delay } from 'msw';
import type { User, Product } from '@/types';

// Mock data -use incrementing IDs for deterministic tests
let nextId = 3;
let users: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
];

// Reset between tests/stories to prevent state leakage
export function resetMockDb() {
  nextId = 3;
  users = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ];
}

export const handlers = [
  // List users
  http.get('/api/users', () => {
    return HttpResponse.json(users);
  }),

  // Get single user
  http.get('/api/users/:id', ({ params }) => {
    const user = users.find((u) => u.id === params.id);
    if (!user) {
      return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return HttpResponse.json(user);
  }),

  // Create user -deterministic ID for tests
  http.post('/api/users', async ({ request }) => {
    const body = await request.json() as Omit<User, 'id'>;
    const newUser = { ...body, id: String(nextId++) };
    users.push(newUser);
    return HttpResponse.json(newUser, { status: 201 });
  }),

  // Delete user
  http.delete('/api/users/:id', ({ params }) => {
    const index = users.findIndex((u) => u.id === params.id);
    if (index === -1) {
      return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    }
    users.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];

// Edge case handlers for testing
export const errorHandlers = {
  serverError: http.get('/api/users', () => {
    return HttpResponse.json({ error: 'Internal error' }, { status: 500 });
  }),

  slowResponse: http.get('/api/users', async () => {
    await delay(3000);
    return HttpResponse.json(users);
  }),

  networkError: http.get('/api/users', () => {
    return HttpResponse.error();
  }),
};
```

```ts
// Usage: call resetMockDb() to prevent state leakage
// In tests (vitest/jest):
afterEach(() => { resetMockDb(); });

// In Storybook decorator:
decorators: [(Story) => { resetMockDb(); return Story(); }]
```

```ts
// mocks/browser.ts -for Storybook
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
```

```ts
// mocks/server.ts -for tests
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

```ts
// vitest.setup.ts
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './mocks/server';
import { resetMockDb } from './mocks/handlers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();  // Reset to default handlers
  resetMockDb();           // Reset mock data to prevent test leakage
});
afterAll(() => server.close());
```

### Storybook One-Time Setup (preview.ts)

This wiring file gives every story MSW + deterministic resets:

```ts
// .storybook/preview.ts
import type { Preview } from '@storybook/react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { handlers, resetMockDb } from '../src/mocks/handlers';

// Initialize MSW
initialize({ onUnhandledRequest: 'error' });

const preview: Preview = {
  loaders: [mswLoader],
  parameters: {
    msw: { handlers },
  },
  decorators: [
    (Story) => {
      resetMockDb();  // Reset before each story
      return Story();
    },
  ],
};

export default preview;
```

Every story now has MSW + deterministic mock state. Individual stories can override handlers via `parameters.msw.handlers` for edge cases.

### Vite: Recommended for Dev Tooling, Not an Architectural Dependency

Use Vite for fast dev experience (Storybook builder, TanStack Start, component playgrounds). Don't architect as if Vite is always present. Your code should work with any bundler.

---

## Related Pages

- [Test Quality](../../test-quality) for what makes a test worth having.
- [Browser Journeys](../../browser-journeys) for the tests that leave the component.
- [Simulating Third-Party Services](../../third-party-doubles) for MSW outside React.
