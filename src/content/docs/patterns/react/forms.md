---
title: "Forms"
description: "Form handling with React 19 actions, Zod validation at the boundary, and predictable pending and error states."
sidebar:
  order: 6
---

*Use this page when you are building or reviewing a form.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

---

## Form Handling Patterns

Forms are validation boundaries. Use React Hook Form for form state + Zod for schema validation. This keeps business functions clean and forms performant.

### Required Stack

```bash
npm install react-hook-form @hookform/resolvers zod
```

### Basic Pattern: Form + Zod Schema

```tsx
// schemas/contact.ts -single source of truth
import { z } from 'zod';

export const contactFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export type ContactFormData = z.infer<typeof contactFormSchema>;
```

```tsx
// components/ContactForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { contactFormSchema, type ContactFormData } from '@/schemas/contact';

type ContactFormProps = {
  onSubmit: (data: ContactFormData) => Promise<void>;
  defaultValues?: Partial<ContactFormData>;
};

export function ContactForm({ onSubmit, defaultValues }: ContactFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      priority: 'medium',
      ...defaultValues,
    },
  });

  const handleFormSubmit = async (data: ContactFormData) => {
    await onSubmit(data);
    reset();  // Clear form on success
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} noValidate>
      <div>
        <label htmlFor="name">Name</label>
        <input id="name" {...register('name')} aria-invalid={!!errors.name} />
        {errors.name && <span role="alert">{errors.name.message}</span>}
      </div>

      <div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" {...register('email')} aria-invalid={!!errors.email} />
        {errors.email && <span role="alert">{errors.email.message}</span>}
      </div>

      <div>
        <label htmlFor="message">Message</label>
        <textarea id="message" {...register('message')} aria-invalid={!!errors.message} />
        {errors.message && <span role="alert">{errors.message.message}</span>}
      </div>

      <div>
        <label htmlFor="priority">Priority</label>
        <select id="priority" {...register('priority')}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  );
}
```

### Field Components for Reuse

Extract field rendering into reusable components:

```tsx
// components/form/FormField.tsx
import { type FieldError } from 'react-hook-form';

type FormFieldProps = {
  label: string;
  name: string;
  error?: FieldError;
  children: React.ReactNode;
};

export function FormField({ label, name, error, children }: FormFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error.message}
        </p>
      )}
    </div>
  );
}
```

```tsx
// Usage in form
<FormField label="Email" name="email" error={errors.email}>
  <input
    id="email"
    type="email"
    {...register('email')}
    className={cn('input', errors.email && 'border-red-500')}
    aria-invalid={!!errors.email}
  />
</FormField>
```

### Controlled Fields (When Needed)

Most fields should be uncontrolled (via `register`). Use `Controller` only when the component requires controlled props:

```tsx
// For third-party components that don't accept ref
import { Controller, useForm } from 'react-hook-form';
import { DatePicker } from '@/components/DatePicker';

function EventForm() {
  const { control, handleSubmit } = useForm<EventFormData>();

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Regular inputs: uncontrolled via register */}
      <input {...register('title')} />

      {/* DatePicker needs controlled: use Controller */}
      <Controller
        name="startDate"
        control={control}
        render={({ field, fieldState }) => (
          <DatePicker
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
    </form>
  );
}
```

### Server Errors + Field Errors

Handle both client validation and server-side errors:

```tsx
function RegistrationForm({ onSubmit }: RegistrationFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationData>({
    resolver: zodResolver(registrationSchema),
  });

  const handleFormSubmit = async (data: RegistrationData) => {
    const result = await onSubmit(data);

    if (!result.success) {
      // Map server errors to specific fields
      if (result.error.code === 'EMAIL_TAKEN') {
        setError('email', { message: 'This email is already registered' });
        return;
      }

      // Generic form-level error
      setError('root', { message: result.error.message });
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)}>
      {errors.root && (
        <div role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-700">
          {errors.root.message}
        </div>
      )}

      {/* Field inputs... */}
    </form>
  );
}
```

### Form with React Query Mutation

Wire forms to mutations for full server integration:

```tsx
// Container wires mutation to form
function CreateUserContainer() {
  const createUserMutation = useCreateUserMutation();

  const handleSubmit = async (data: CreateUserData) => {
    await createUserMutation.mutateAsync(data);
    toast.success('User created!');
    router.push('/users');
  };

  return (
    <CreateUserForm
      onSubmit={handleSubmit}
      isSubmitting={createUserMutation.isPending}
      serverError={createUserMutation.error?.message}
    />
  );
}

// Form stays pure -receives handlers via props
function CreateUserForm({ onSubmit, isSubmitting, serverError }: CreateUserFormProps) {
  const { register, handleSubmit, formState: { errors } } = useForm<CreateUserData>({
    resolver: zodResolver(createUserSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {serverError && <FormError message={serverError} />}
      {/* Fields... */}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create User'}
      </button>
    </form>
  );
}
```

### Form Patterns Summary

| Need | Solution |
| ---- | -------- |
| Form state | React Hook Form (`useForm`) |
| Validation | Zod schema + `zodResolver` |
| Simple inputs | `register('fieldName')` (uncontrolled) |
| Complex components | `Controller` (controlled) |
| Field errors | `formState.errors.fieldName` |
| Server errors | `setError('root', ...)` or `setError('fieldName', ...)` |
| Submission state | `formState.isSubmitting` or mutation `isPending` |
| Default values | `useForm({ defaultValues })` |

---

### Input types, autocomplete, and inputmode

Give the browser and password managers what they need, and you get correct mobile keyboards, autofill and fewer typos at no cost.

- Use the specific `type`: `email`, `tel`, `url`, `number`. Add `inputMode` for the on-screen keyboard.
- Set a meaningful `autoComplete` token on identity fields (`email`, `name`, `tel`, `current-password`, `new-password`, `one-time-code`).
- Turn off `spellCheck` on emails, usernames, and codes.
- Never block paste. Users paste one-time codes and passwords.

```tsx
<FormField label="Email" name="email" error={errors.email}>
  <input
    id="email"
    type="email"
    inputMode="email"
    autoComplete="email"
    spellCheck={false}
    placeholder="you@example.com"
    {...register('email')}
    aria-invalid={!!errors.email}
  />
</FormField>

<FormField label="Verification code" name="otp" error={errors.otp}>
  <input
    id="otp"
    inputMode="numeric"
    autoComplete="one-time-code"
    spellCheck={false}
    {...register('otp')}
  />
</FormField>
```

### Associate errors with their field

`role="alert"` announces an error once, but a screen reader landing on the input later won't know it's invalid or why. Wire `aria-describedby` to the message id.

```tsx
export function FormField({ label, name, error, children }: FormFieldProps) {
  const errorId = `${name}-error`;
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {/* children pass aria-describedby={error ? errorId : undefined} + aria-invalid */}
      {children}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-600">
          {error.message}
        </p>
      )}
    </div>
  );
}

// Input wires the describedby so the field announces its own error
<input
  id="email"
  {...register('email')}
  aria-invalid={!!errors.email}
  aria-describedby={errors.email ? 'email-error' : undefined}
/>
```

### Focus the first error, announce the result

On a failed submit, move keyboard and screen-reader users to the problem and announce the outcome.

- React Hook Form's `shouldFocusError` (on by default) focuses the first invalid registered field. Keep it on, and make sure custom controls forward their `ref` so focus lands.
- Wrap the form-level success or error banner in an `aria-live` region so it's announced without stealing focus.

```tsx
const { handleSubmit, setError, formState: { errors, isSubmitting } } =
  useForm<RegistrationData>({
    resolver: zodResolver(registrationSchema),
    shouldFocusError: true, // default; focuses the first invalid field
  });

return (
  <form onSubmit={handleSubmit(onSubmit)} noValidate>
    <div aria-live="polite" className="sr-only">
      {isSubmitting ? 'Submitting…' : ''}
    </div>

    {errors.root && (
      <div role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-700">
        {errors.root.message}
      </div>
    )}
    {/* fields… */}
  </form>
);
```

For a global toast system, mount one `aria-live="polite"` region at the app root so every toast is announced. A toast that only renders visually is invisible to screen readers.

### Guard against losing unsaved work

A dirty form plus an accidental back button or tab close loses user input. Warn before it happens.

```tsx
const { formState: { isDirty, isSubmitting } } = useForm(/* ... */);

useEffect(() => {
  if (!isDirty || isSubmitting) return;
  const warn = (e: BeforeUnloadEvent) => e.preventDefault();
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}, [isDirty, isSubmitting]);
```

`beforeunload` covers tab close and reload. For in-app route changes, use your router's navigation-blocking API (injected as a dep, per the adapter pattern) so this stays framework-agnostic.

---

## Related Pages

- [Validation at the Boundary](../../validation) for the schemas the form submits through.
- [State](../state) for where form state lives when it outgrows the form.
