---
title: "Error Boundaries"
description: "Error boundaries are mandatory: where they go, what they catch, what they cannot, and how they pair with typed errors."
sidebar:
  order: 4
---

*Use this page when you are handling a failure in the render tree.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

---

## Error Handling + Error Boundaries (Mandatory)

### Error Handling Layers

| Layer | Catches | Where | Example |
| ----- | ------- | ----- | ------- |
| **Route-level boundary** | SSR errors, render crashes, unhandled throws | `app/error.tsx` or layout wrapper | Page-level "Something went wrong" |
| **Feature-level boundary** | Component subtree failures | Around widgets, forms, complex features | "This widget failed to load" |
| **Query/mutation errors** | Async data failures | React Query `onError`, component state | Inline error messages, retry buttons |
| **Client islands** | Browser-only failures | Wrap interactive islands | Graceful degradation |

### Error Logging

```ts
// Where to log errors
const errorLogger = {
  // Route/feature boundaries -log to Sentry/etc
  boundary: (error: Error, info: React.ErrorInfo) => {
    captureException(error, { extra: { componentStack: info.componentStack } });
  },

  // Query errors -log only server/unexpected errors
  query: (error: Error) => {
    if (isNetworkError(error) || is5xxError(error)) {
      captureException(error);
    }
    // Don't log 4xx -those are expected (not found, validation, etc.)
  },

  // Mutation errors -show user-facing error; log unexpected errors (5xx, network)
  mutation: (error: Error, context: { action: string }) => {
    if (isNetworkError(error) || is5xxError(error)) {
      captureException(error, { extra: context });
    }
    // Don't log 4xx -those are expected (validation, not found, etc.)
  },
};
```

### Example: Error Boundary Component

```tsx
// components/ErrorBoundary.tsx
import { Component, type ReactNode, type ErrorInfo } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode | ((props: { error: Error; reset: () => void }) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return this.props.fallback;
    }
    return this.props.children;
  }
}
```

### Example: Reusable Error States

```tsx
// components/ErrorState.tsx
// Icons from lucide-react, heroicons, or similar -swap as needed
import { AlertCircle as AlertCircleIcon } from 'lucide-react';

type ErrorStateProps = {
  title?: string;
  message?: string;
  error?: Error;
  onRetry?: () => void;
};

export function ErrorState({
  title = 'Something went wrong',
  message,
  error,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center" role="alert">
      <AlertCircleIcon className="h-12 w-12 text-red-500" />
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-gray-600">
        {message ?? error?.message ?? 'An unexpected error occurred.'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

// components/EmptyState.tsx
import { type ReactNode } from 'react';
import { Inbox as InboxIcon } from 'lucide-react';

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
};

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      {icon ?? <InboxIcon className="h-12 w-12 text-gray-400" />}
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      {message && <p className="mt-2 text-gray-600">{message}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

### Example: Error Boundary Usage

```tsx
// Layout with route-level error boundary
function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div className="flex min-h-screen items-center justify-center">
          <ErrorState
            title="Page Error"
            error={error}
            onRetry={reset}
          />
        </div>
      )}
      onError={(error, info) => {
        // Log to error tracking service
        errorTracker.capture(error, { componentStack: info.componentStack });
      }}
    >
      <Header />
      <main>{children}</main>
      <Footer />
    </ErrorBoundary>
  );
}

// Feature-level boundary
function DashboardPage() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <ErrorBoundary fallback={<WidgetErrorState widget="analytics" />}>
        <AnalyticsWidget />
      </ErrorBoundary>

      <ErrorBoundary fallback={<WidgetErrorState widget="notifications" />}>
        <NotificationsWidget />
      </ErrorBoundary>
    </div>
  );
}
```

### React Query + Suspense + ErrorBoundary

If you use both Suspense and error boundaries, watch for two gotchas:

1. **Suspense only handles "pending", not "error".** You still need an ErrorBoundary around Suspense subtrees
2. **React Query suspense mode throws during render.** ErrorBoundary catches them (good), but you need to reset queries when retrying

Wire them together like this:

```tsx
import { QueryErrorResetBoundary } from '@tanstack/react-query';

function DataWidget() {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          fallback={({ error, reset: resetBoundary }) => (
            <ErrorState
              error={error}
              onRetry={() => {
                reset();           // Reset React Query state
                resetBoundary();   // Reset ErrorBoundary state
              }}
            />
          )}
        >
          <Suspense fallback={<WidgetSkeleton />}>
            <WidgetContent />
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
```

The `QueryErrorResetBoundary` ensures that when the user clicks "retry", the failed queries refetch instead of re-throwing.

---

## Related Pages

- [Typed Errors](../../errors) for the `Result` types that arrive at the boundary.
- [Data Fetching](../data) for query errors and retries.
