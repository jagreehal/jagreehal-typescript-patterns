---
name: ts-performance
description: "Use when setting up load tests with k6 and chaos testing with Toxiproxy to verify system performance and resilience under realistic traffic and failure conditions."
---

## Overview

Load testing proves your system handles real traffic. Chaos testing proves your resilience patterns (retries, timeouts, circuit breakers) work. Combine both with OpenTelemetry traces to find bottlenecks that single-request tests miss.

## Progressive Load Profiles (k6)

Always test progressively: Smoke -> Load -> Stress -> Soak -> Spike.

```javascript
// Smoke: 1 VU, 1m -- catches functional bugs
export const options = { vus: 1, duration: '1m' };

// Load: ramp to expected traffic
export const options = {
  stages: [
    { duration: '2m', target: 50 },
    { duration: '5m', target: 50 },
    { duration: '2m', target: 0 },
  ],
};

// Stress: push until something breaks
export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '5m', target: 200 },
    { duration: '2m', target: 300 },
    { duration: '5m', target: 300 },
    { duration: '2m', target: 0 },
  ],
};

// Soak: steady load for hours, detect memory leaks
export const options = {
  stages: [
    { duration: '5m', target: 50 },
    { duration: '4h', target: 50 },
    { duration: '5m', target: 0 },
  ],
};

// Spike: sudden burst (flash sale, viral tweet)
export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '10s', target: 500 },
    { duration: '3m', target: 500 },
    { duration: '10s', target: 10 },
    { duration: '3m', target: 10 },
    { duration: '5s', target: 0 },
  ],
};
```

## SLO Thresholds

```javascript
export const options = {
  thresholds: {
    http_req_duration: ['p(50)<200', 'p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.001'],  // 99.9% success
    'http_req_duration{endpoint:create_order}': ['p(95)<800'],
    'http_req_duration{endpoint:get_order}': ['p(95)<200'],
  },
};
```

## Connecting k6 to OpenTelemetry Traces

Pass W3C Trace Context from k6 to correlate load test requests with backend traces:

```javascript
import http from 'k6/http';
import { randomUUID } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export default function () {
  const traceId = randomUUID().replace(/-/g, '');
  const spanId = randomUUID().replace(/-/g, '').slice(0, 16);
  http.post(`${BASE_URL}/api/orders`, payload, {
    headers: {
      'traceparent': `00-${traceId}-${spanId}-01`,
      'x-load-test-id': __ENV.TEST_RUN_ID || 'local',
    },
  });
}
```

Query traces afterward: `service.name = "orders-api" AND duration > 1s AND attributes.x-load-test-id = "stress-test-run"`.

## Chaos Engineering with Toxiproxy

```yaml
# docker-compose.chaos.yml
services:
  toxiproxy:
    image: ghcr.io/shopify/toxiproxy
    ports: ["8474:8474", "5433:5433"]
  postgres:
    image: postgres:16
```

```typescript
import Toxiproxy from 'toxiproxy-node-client';
const toxiproxy = new Toxiproxy('http://localhost:8474');
await toxiproxy.createToxic('postgres', {
  name: 'latency', type: 'latency',
  attributes: { latency: 500, jitter: 100 },
});
```

### In-Process Chaos Helpers

```typescript
export function withLatency<T>(
  fn: () => Promise<T>,
  opts: { minMs: number; maxMs: number }
): () => Promise<T> {
  return async () => {
    const delay = Math.random() * (opts.maxMs - opts.minMs) + opts.minMs;
    await new Promise((r) => setTimeout(r, delay));
    return fn();
  };
}

export function withFailureRate<T>(
  fn: () => Promise<T>,
  rate: number,
  error = new Error('Injected failure')
): () => Promise<T> {
  return async () => {
    if (Math.random() < rate) throw error;
    return fn();
  };
}
```

## CI Pipeline Integration

```yaml
# .github/workflows/performance.yml
on:
  push: { branches: [main] }
  schedule: [{ cron: '0 2 * * *' }]
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker-compose up -d
      - uses: grafana/k6-action@v0.3.1
        with:
          filename: load-tests/load.js
          flags: --out json=results.json
```

## Rules

1. Test progressively: Smoke -> Load -> Stress -> Soak.
2. Set thresholds so tests fail if SLOs are not met.
3. Connect load tests to OpenTelemetry traces to find real bottlenecks.
4. Run load tests in CI; catch regressions before production.
5. Inject chaos (latency, failures, partitions) to prove resilience patterns work.
6. Always use `sleep()` in k6 scripts to simulate realistic user think time.
