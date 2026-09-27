---
title: "Browser Journeys"
description: "Playwright rules for the tests that own user journeys, so they locate like a user, cannot pass before the app has acted, fail on swallowed errors, and run in parallel."
---

*Use this page when you are writing or reviewing a Playwright test.*

[Testing Levels](../testing-levels#level-4-executable-stories-own-journeys) gives Playwright one job: prove that the browser, the API, and the rendered result work together for a user journey. The rules below keep those tests honest. The [Playwright Cookbook](https://github.com/jagreehal/playwright-cookbook) has each of them as a runnable skill.

---

## Locate by Role, Then Ask Before Adding a Test Id

Playwright's locator priority is `getByRole` → `getByLabel` → `getByPlaceholder` → `getByText` → `getByTestId` → CSS. Role and name is the one a user would recognise, and three things have to change at once for it to break. If you reach for `data-testid` on a button, ask one question: would you ship this attribute if no test existed? An `aria-label` you add only so a test can find the element is worse than a test id, because it changes what screen-reader users hear. Test ids are the honest handle for a wrapper with no role, a third-party canvas widget, and a closed shadow root. Everywhere else, a missing accessible name is the bug.

## Auto-Wait Fixes Fail-Too-Early, Not Pass-Too-Early

Web-first assertions retry until they hold, so a test cannot fail because the app is slow. They can still pass before the app has done anything. An absence check settles on the first tick where the element is missing, including the tick before the app rendered it. A substring check settles on stale text that already contains the substring. A spinner that never started is already hidden.

```typescript
// ❌ Passes before the delete request has been sent
await page.getByRole('button', { name: 'Delete' }).click();
await expect(page.getByRole('row', { name: /invoice 42/ })).toHaveCount(0);

// ✅ Wait for a landmark that renders in the same pass, then assert absence
await page.getByRole('button', { name: 'Delete' }).click();
await expect(page.getByRole('status')).toHaveText('Invoice 42 deleted');
await expect(page.getByRole('row', { name: /invoice 42/ })).toHaveCount(0);
```

Swapping `toHaveCount(0)` for `not.toBeVisible()` changes nothing; both share the race. For a spinner, assert it appears and then that it clears. When the rendered output does not change (same names after a sort, same count after a filter), wait on the response itself with `page.waitForResponse`. `waitForTimeout` is not a synchronisation primitive, and `networkidle` rarely fires on a page with a WebSocket.

## Fail on Errors the UI Swallowed

A React error boundary, an unhandled rejection, or a 500 on your own API can all leave the page looking fine. Add a fixture that collects `console.error`, `pageerror` and 5xx responses on first-party routes, and fails the test at teardown if any arrived. Keep the allowlist explicit and short. For the cost of one fixture, a false green becomes a red with a stack trace.

## Parallel-Safe by Construction

If a test fails when it runs beside other tests, treat it as a bug and don't file it as a flake. Namespace test data by `parallelIndex` (it survives a worker restart; `workerIndex` does not), create entities per test and delete them in the fixture's teardown rather than `afterAll`, which is skipped when the test crashes. For the database, prefer a transaction you roll back, then a schema per worker, then per-test entities with cleanup. Log the seed or the ids you generated so a failure reproduces. Once the suite is isolated, drop `workers: 1` on CI.

## Agents Verify Goals; CI Needs Journeys

An agent driving a browser through Playwright MCP is a good way to explore a feature, hunt a flake, or reproduce a production report. Keep it out of the PR gate. The agent's exploration ends in a committed, deterministic spec that you review like any other: no `waitForTimeout`, locators by role, assertions that cannot pass early. Re-run the spec twice on its own; don't commit a journey that only passes under the agent loop. Give the agent a refusal list too: it must not re-prove in a browser any claim that a cheaper test level already owns. [AI Coding Agents](../ai-agents#the-verdict-comes-from-the-run) has the rest of that contract.

---

## Related Patterns

- [Testing Levels](../testing-levels) decides which behaviours reach the browser at all.
- [Testing External Infrastructure](../testing-external-services) covers controlling third-party services behind the journey.
- [CI Gates and Triage](../ci-gates) covers flakiness as a measurement and what a PR gate may fail on.
