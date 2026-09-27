---
title: "Storybook-First Development"
description: "Get feature flows working in Storybook before wiring real backends; every component gets stories."
sidebar:
  order: 9
---

*Use this page when you are building a component and want it visible before the API exists.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

---

## Show Don't Tell: Storybook-First Development

> **Philosophy:** Get feature flows working in Storybook before wiring to real backends. You get shorter inspect-and-adapt loops and faster feedback. Stakeholders can see working UI before the API exists.

### Why Storybook-First?

| Traditional Approach | Storybook-First |
| -------------------- | --------------- |
| Build backend → Build frontend → Demo | Build stories with MSW → Demo → Build backend in parallel |
| Feedback after full integration | Feedback on UI/UX immediately |
| Bugs found late | Bugs found early |
| Stakeholder review at end | Stakeholder review throughout |

### Feature Flow Storyboards

For multi-step features (checkout, onboarding, wizards), create **storyboard stories** that demonstrate the entire flow:

```tsx
// features/checkout/Checkout.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { http, HttpResponse, delay } from 'msw';

const meta: Meta<typeof CheckoutFlow> = {
  title: 'Flows/Checkout',
  component: CheckoutFlow,
  parameters: {
    layout: 'fullscreen',
    // MSW handlers for the entire flow
    msw: { handlers: checkoutHandlers },
  },
};

export default meta;

// Individual step stories for isolated testing
export const Step1_Cart: Story = {};
export const Step2_Shipping: Story = { args: { initialStep: 'shipping' } };
export const Step3_Payment: Story = { args: { initialStep: 'payment' } };
export const Step4_Confirmation: Story = { args: { initialStep: 'confirmation' } };

// Full flow story with play function -the "storyboard"
export const FullCheckoutFlow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Step 1: Review cart
    await expect(canvas.getByText(/your cart/i)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /proceed to checkout/i }));

    // Step 2: Enter shipping
    await userEvent.type(canvas.getByLabelText(/street/i), '123 Main St');
    await userEvent.type(canvas.getByLabelText(/city/i), 'Portland');
    await userEvent.click(canvas.getByRole('button', { name: /continue to payment/i }));

    // Step 3: Enter payment
    await userEvent.type(canvas.getByLabelText(/card number/i), '4242424242424242');
    await userEvent.click(canvas.getByRole('button', { name: /place order/i }));

    // Step 4: Confirmation
    await expect(canvas.getByText(/order confirmed/i)).toBeInTheDocument();
  },
};

// Edge case flows
export const PaymentDeclined: Story = {
  parameters: {
    msw: {
      handlers: [
        ...checkoutHandlers,
        http.post('/api/orders', () => HttpResponse.json({ error: 'Card declined' }, { status: 402 })),
      ],
    },
  },
};
```

### Development Workflow

1. **Sketch the flow.** Create empty stories for each step
2. **Build views.** Implement `StepView` components with mock props
3. **Add MSW handlers.** Simulate API responses
4. **Demo to stakeholders.** Get feedback before backend is ready
5. **Wire to real backend.** Replace MSW with real API
6. **Keep stories.** They become regression tests

Storybook-first lets you run **parallel frontend/backend development** and catch UX issues before they're expensive to fix.

---

## Storybook: Required for Every Component

Rules:

- Every component must have a paired story.
- Stories must cover key variants: default, loading, empty, error, edge cases
- Stories should use DI handlers (fake actions).
- For data-driven components, use MSW (required) to mock API responses.

Storybook is your:

- component catalog
- regression surface
- living documentation
- **stakeholder demo environment**

### Example: Basic Story Structure

```tsx
// UserCard.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { UserCard } from './UserCard';

const meta: Meta<typeof UserCard> = {
  title: 'Components/UserCard',
  component: UserCard,
  args: {
    handlers: {
      onEdit: fn(),
      onDelete: fn(),
      onView: fn(),
    },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
};

export default meta;
type Story = StoryObj<typeof UserCard>;

export const Default: Story = {
  args: {
    user: {
      id: '1',
      name: 'Alice Johnson',
      email: 'alice@example.com',
      avatar: 'https://i.pravatar.cc/150?u=alice',
    },
  },
};

export const LongName: Story = {
  args: {
    user: {
      id: '2',
      name: 'Alexandria Bartholomew Constantine III',
      email: 'alexandria.bartholomew.constantine.iii@verylongemaildomain.com',
    },
  },
};

export const NoAvatar: Story = {
  args: {
    user: {
      id: '3',
      name: 'Bob Smith',
      email: 'bob@example.com',
    },
  },
};
```

### Example: Story with MSW for Data Fetching

For framework-agnostic Storybook stories, create a portable container that accepts props instead of reading from router params:

```tsx
// UserProfileByIdContainer.tsx -portable container (no useParams)
'use client';

import { createNavigationAdapter } from '@/adapters/navigation';
import { useUserQuery } from '@/queries/useUserQuery';
import { useDeleteUserMutation } from '@/queries/useDeleteUserMutation';
import { UserProfileView } from './UserProfileView';

// Portable container: accepts userId and handlers as props (works in Storybook, tests, any framework)
export function UserProfileByIdContainer({
  userId,
  handlers,
}: {
  userId: string;
  handlers: { onEdit: () => void; onDelete: () => void };
}) {
  const { data: user, isLoading, error } = useUserQuery(userId);

  if (isLoading) return <UserProfileSkeleton />;
  if (error) return <ErrorState error={error} />;
  if (!user) return <EmptyState title="User not found" />;

  return <UserProfileView user={user} handlers={handlers} />;
}

// Framework boundary container (app/users/[id]/UserProfileContainer.tsx)
// This lives in app/ and uses framework-specific hooks
'use client';

import { useParams, useRouter } from 'next/navigation';
import { createNavigationAdapter } from '@/adapters/navigation';
import { useDeleteUserMutation } from '@/queries/useDeleteUserMutation';
import { UserProfileByIdContainer } from './UserProfileByIdContainer';

export function UserProfileContainer() {
  const { id } = useParams<{ id: string }>();
  const nav = createNavigationAdapter(useRouter());
  const deleteUserMutation = useDeleteUserMutation();

  const handlers = {
    onEdit: () => nav.push(`/users/${id}/edit`),
    onDelete: () => deleteUserMutation.mutate(id),
  };

  return <UserProfileByIdContainer userId={id} handlers={handlers} />;
}
```

```tsx
// UserProfile.stories.tsx -framework-agnostic (no router addons needed)
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { http, HttpResponse, delay } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserProfileByIdContainer } from './UserProfileByIdContainer';

const mockUser = {
  id: '123',
  name: 'Alice Johnson',
  email: 'alice@example.com',
  role: 'admin',
};

const meta: Meta<typeof UserProfileByIdContainer> = {
  title: 'Features/UserProfile',
  component: UserProfileByIdContainer,
  decorators: [
    (Story) => {
      // Memoize QueryClient to prevent cache reset on rerender
      const [queryClient] = React.useState(
        () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
      );
      return (
        <QueryClientProvider client={queryClient}>
          {Story()}
        </QueryClientProvider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof UserProfileByIdContainer>;

export const Default: Story = {
  args: {
    userId: '123',
    handlers: { onEdit: fn(), onDelete: fn() },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/users/:id', () => {
          return HttpResponse.json(mockUser);
        }),
      ],
    },
  },
};

export const Loading: Story = {
  args: {
    userId: '123',
    handlers: { onEdit: fn(), onDelete: fn() },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/users/:id', async () => {
          await delay('infinite');
          return HttpResponse.json(mockUser);
        }),
      ],
    },
  },
};

export const Error: Story = {
  args: {
    userId: '123',
    handlers: { onEdit: fn(), onDelete: fn() },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/users/:id', () => {
          return HttpResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }),
      ],
    },
  },
};

export const SlowResponse: Story = {
  args: {
    userId: '123',
    handlers: { onEdit: fn(), onDelete: fn() },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/users/:id', async () => {
          await delay(2000);
          return HttpResponse.json(mockUser);
        }),
      ],
    },
  },
};
```

### Example: Interactive Story with Play Function

```tsx
// LoginForm.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from '@storybook/test';
import { LoginForm } from './LoginForm';

const meta: Meta<typeof LoginForm> = {
  title: 'Forms/LoginForm',
  component: LoginForm,
  args: {
    onSubmit: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof LoginForm>;

export const Default: Story = {};

export const FilledForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByLabelText(/email/i), 'user@example.com');
    await userEvent.type(canvas.getByLabelText(/password/i), 'password123');
  },
};

export const SubmissionFlow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Fill the form
    await userEvent.type(canvas.getByLabelText(/email/i), 'user@example.com');
    await userEvent.type(canvas.getByLabelText(/password/i), 'password123');

    // Submit
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }));

    // Verify handler was called with correct data
    await expect(args.onSubmit).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'password123',
    });
  },
};

export const ValidationErrors: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Submit without filling form
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }));

    // Check for validation errors
    await expect(canvas.getByText(/email is required/i)).toBeInTheDocument();
    await expect(canvas.getByText(/password is required/i)).toBeInTheDocument();
  },
};
```

---

## Related Pages

- [Testing and MSW](../testing) for the deterministic responses stories rely on.
- [Components and Responsibilities](../components) for the injected handlers that make stories cheap.
