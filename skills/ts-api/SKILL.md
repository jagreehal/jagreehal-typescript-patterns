---
name: ts-api
description: "Use when building HTTP API handlers with orpc, Zod schemas, and production-ready patterns including error envelopes, health checks, graceful shutdown, CORS, idempotency, pagination, and ETags."
---

## Overview

Build production-ready HTTP APIs using orpc with thin handlers that translate between HTTP and domain logic. Handlers validate input via Zod, call business functions using `fn(args, deps) -> Result`, and map results to HTTP responses with consistent error envelopes.

## Route File Organization

One file per route with co-located tests:

```
routes/
├── posts/
│   ├── get-post.ts          # Single route
│   ├── get-post.test.ts     # Co-located test
│   ├── create-post.ts
│   ├── create-post.test.ts
│   ├── index.ts             # Composes into postsRouter
│   └── schemas.ts           # Shared Zod schemas
├── users/
│   └── ...
└── index.ts                 # Composes into apiRouter
```

Naming: files use `action-resource.ts` (kebab-case), factory functions use `createActionResource` (camelCase), router keys use `actionResource` (camelCase), URL paths use plural nouns (`/api/v1/posts`).

## Handler Template

```typescript
import { os, ORPCError } from "@orpc/server";
import { z } from "zod";

const GetPostInput = z.object({ postId: z.string().uuid() });

type GetPostDeps = { postRepo: PostRepository };

export function createGetPost({ deps }: { deps: GetPostDeps }) {
  return os
    .input(GetPostInput)
    .output(PostResponse)    // Strips extra fields, prevents data leaks
    .handler(async ({ input }) => {
      const post = await deps.postRepo.findById({ id: input.postId });
      if (!post) {
        throw new ORPCError("NOT_FOUND", {
          status: 404,
          message: `Post ${input.postId} not found`,
        });
      }
      return post;
    });
}
```

## Consistent Error Envelope

All errors return the same JSON shape:

```typescript
const ErrorResponse = z.object({
  code: z.string(),          // Machine-readable: "NOT_FOUND"
  message: z.string(),       // Human-readable
  requestId: z.string(),     // For log correlation
  details: z.unknown().optional(),
});

function createErrorResponse(code: string, message: string, requestId: string, details?: unknown) {
  return { code, message, requestId, details };
}

// ORPCError code MUST match ErrorResponse code
throw new ORPCError("NOT_FOUND", {
  status: 404,
  data: createErrorResponse("NOT_FOUND", "Resource not found", requestId),
});
```

Standard error map: `NOT_FOUND:404`, `UNAUTHORIZED:401`, `FORBIDDEN:403`, `CONFLICT:409`, `VALIDATION_FAILED:400`, `DB_ERROR:500`. Use 400 for schema/syntax errors, 422 for business rule violations.

## Health Checks

Two endpoints required:

- **`/health` (liveness)**: Always returns 200 if process is running. No dependency checks. If it fails, orchestrator restarts the container.
- **`/ready` (readiness)**: Checks database, cache, `!isShuttingDown`. Returns 200 when ready, 503 when not. Load balancers use this to route traffic.

```typescript
export const ready = os.input(z.void()).output(ReadyResponse).handler(async () => {
  const checks = { database: await checkDatabase(), cache: await checkCache(), acceptingRequests: !isShuttingDown };
  if (!Object.values(checks).every(Boolean)) {
    throw new ORPCError("SERVICE_UNAVAILABLE", { status: 503, data: { status: "not_ready", checks } });
  }
  return { status: "ready" as const, checks };
});
```

## Graceful Shutdown

```typescript
let isShuttingDown = false;
const activeRequests = new Set<Promise<unknown>>();

async function gracefulShutdown(signal: string) {
  isShuttingDown = true;  // readiness probe returns 503
  await Promise.race([Promise.allSettled(activeRequests), new Promise(r => setTimeout(r, 10_000))]);
  await db.close();
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
```

Handlers must reject with 503 when `isShuttingDown` is true.

## CORS

```typescript
new CORSPlugin({
  origin: (origin) => {
    if (!origin) return null;  // Non-browser request, no CORS headers needed
    return ALLOWED_ORIGINS.has(origin) ? origin : null;
  },
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  credentials: true,  // Cannot use origin: '*' with credentials
  maxAge: 86400,
});
```

Always echo the specific allowed origin (never `*` with credentials). Include `Vary: Origin`.

## Idempotency Keys

For POST/PUT mutations, require `Idempotency-Key` header:

```typescript
const idempotencyKey = req.headers.get('idempotency-key');
if (!idempotencyKey) throw new ORPCError("MISSING_IDEMPOTENCY_KEY", { status: 400, ... });
const existing = await deps.idempotencyStore.get(idempotencyKey);
if (existing) return existing.response;  // Return cached response
// ... process, then cache: deps.idempotencyStore.set(idempotencyKey, { response, createdAt }, { ttl: 86400 });
```

## Cursor Pagination

```typescript
const ListInput = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
const ListOutput = z.object({
  items: z.array(ItemResponse),
  nextCursor: z.string().nullable(),  // null = no more results
  hasMore: z.boolean(),
});
```

Prefer cursor over offset: stable results, no skipped items, better DB performance.

## ETags

```typescript
const etag = `"${crypto.createHash('md5').update(stableStringify(data)).digest('hex')}"`;
if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304 });
// Set headers: ETag, Cache-Control: private|public|no-store
```

Use stable JSON stringification or hash a canonical field like `updatedAt`.

## Rules

1. Handlers are thin translation layers with no business logic.
2. Validate input and output with Zod schemas at the boundary.
3. All errors use the same JSON envelope with `code`, `message`, `requestId`.
4. `ORPCError` code must match `ErrorResponse.code`.
5. Two health endpoints: `/health` (liveness, always 200) and `/ready` (readiness, 200 or 503).
6. Graceful shutdown: stop accepting, drain in-flight, close resources.
7. Require `Idempotency-Key` header for all mutation endpoints.
8. Use cursor-based pagination for list endpoints.
9. One file per route, co-located tests, factory functions with explicit deps.
10. Never expose internal details in error messages. Log internally, return safe messages.
