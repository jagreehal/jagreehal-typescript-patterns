---
name: ts-validation
description: "Use when implementing input validation with Zod schemas, branded types, and domain rules at application boundaries in TypeScript."
---

## Three-Layer Validation

Validation comes in three kinds. Keep them separate.

| Layer | Question | Where | Tool |
|---|---|---|---|
| Boundary Parsing | Is the data shaped correctly? | HTTP handlers, queue consumers, CLI | Zod schemas |
| Invariant Construction | Can this value exist at all? | Factory functions, branded types | `.brand<>()`, value objects |
| Domain Rules | Is this operation allowed now? | Business functions | DB lookups, context |

Flow: **External Input** --> parse --> **Validated Shape** --> construct --> **Invariant Types** --> check rules --> **Business Logic**

## Parse, Don't Validate

Parsing returns a typed value or fails. Validation returns a boolean and leaves you with the original type.

```typescript
// Bad: still a string after check
function isValidEmail(s: string): boolean { ... }

// Good: get Email type or fail
const EmailSchema = z.string().email().brand<'Email'>();
type Email = z.infer<typeof EmailSchema>;
const email = EmailSchema.parse(rawInput); // Email type
```

## Boundary Parsing with Zod

Parse untrusted input at entry points. Business functions never see invalid data.

```typescript
const CreateUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
});
type CreateUserInput = z.infer<typeof CreateUserSchema>;

app.post('/users', async (req, res) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  const user = await createUser(parsed.data, deps);
  return res.status(201).json(user);
});
```

Use `z.coerce` for query params but add `.refine(Number.isFinite)` to catch silent NaN coercion.

## Branded Types (Invariant Construction)

Encode "always valid" constraints in the type system. Validate once at construction, never again.

```typescript
const EmailSchema = z.string().email().brand<'Email'>();
const UserIdSchema = z.string().uuid().brand<'UserId'>();
const PositiveAmountSchema = z.number().positive().brand<'PositiveAmount'>();

// Deep functions accept branded types -- no re-validation needed
function sendEmail(to: Email, subject: string) { ... }
```

For complex invariants with behavior, use value objects with private constructors and a static `create()` that returns `Result`.

## Domain Rules

Business rules require context (DB, state). Return `Result` types, not exceptions.

```typescript
async function validateTransfer(
  args: { from: AccountId; to: AccountId; amount: PositiveAmount },
  deps: { db: Database }
): Promise<Result<ValidatedTransfer, 'INSUFFICIENT_FUNDS' | 'ACCOUNT_FROZEN'>> {
  const account = await deps.db.getAccount(args.from);
  if (account.frozen) return err('ACCOUNT_FROZEN');
  if (account.balance < args.amount) return err('INSUFFICIENT_FUNDS');
  return ok({ ...args, sourceAccount: account });
}
```

## HTTP Status Mapping

| Layer | Status | Meaning |
|---|---|---|
| Boundary parsing failure | **400** | Bad shape/format (missing field, wrong type) |
| Domain rule failure | **422** | Valid request, invalid operation (email taken, insufficient funds) |
| Unexpected error | **500** | Server error |

```typescript
app.post('/transfers', async (req, res) => {
  const parsed = TransferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error)); // shape

  const validated = await validateTransfer(parsed.data, deps);
  if (!validated.ok) return res.status(422).json({ error: validated.error }); // domain

  const result = await executeTransfer(validated.value, deps);
  if (!result.ok) return res.status(500).json({ error: 'INTERNAL_ERROR' });

  return res.status(200).json(result.value);
});
```

## Quick Rules

- Parse shape/format at boundary with Zod. Return 400 on failure.
- Encode "always valid" with branded types or value objects. Never re-check downstream.
- Validate business rules in business functions with context. Return 422 on failure.
- Internal `fn(args, deps)` trusts invariant types. Add assertions only for critical paths (money, auth, safety).
- Reuse schemas within a service but not across service boundaries.
- Correctness wins over performance by default: Zod parsing is ~0.01-0.1ms, negligible vs DB/HTTP.
