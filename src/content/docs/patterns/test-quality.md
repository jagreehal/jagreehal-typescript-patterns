---
title: "Test Quality"
description: "Turn a bug report into a test that stays red for the right reason, review new tests for what they prove, and use mutation testing to find the tests that cannot fail."
---

*Use this page when you are reviewing a test, writing one for a bug, or deciding whether a coverage number means anything.*

A test is a claim about behaviour. This page is about whether the claim holds: whether the test would go red if the behaviour were wrong, and whether a reviewer can tell where its expected values came from.

---

## From Bug Report to Test

A bug report with no reproduction is a hypothesis. Write the test that turns it into a fact before you write the fix. How you write that test decides whether the bug stays fixed.

**Name the guarantee.** `test('refund is rejected after 30 days')` rather than `test('bug #4812')`. In a year the ticket number means nothing and the guarantee still reads as a promise.

**Assert the invariant the bug violated.** The report says "the page crashed". The invariant is "a refund older than 30 days returns `RefundWindowClosed`". Assert the invariant and the test also catches the next way of breaking it.

**Watch it fail first.** A test you have never seen red proves only that it compiles. Run it against the unfixed code, see the failure, then fix.

**Fix the root cause across the callers.** The report names one path. Before editing, find the other callers of the function you are about to touch. One guard in the shared function is a smaller diff than a guard per caller, and it fixes the paths no one has reported yet.

You end up with a test that reads as a published promise, and a fix that something other than its author has verified.

## Coverage Is an Attendance Register

Coverage answers one question: did my tests run this line? It never looks at an assertion. A test with no `expect` at all still produces coverage, and a suite at 100% on statements, branches, functions and lines can still ship a fault one character wide.

Mutation testing asks the question you meant to ask: would my tests notice if this line were wrong? A tool such as [Stryker](https://stryker-mutator.io/) plants one small fault at a time in your production code (a **mutant**), runs the suite, and records whether any test failed. A test failed: the mutant is **killed**. Every test passed: it **survived**, and your suite has accepted a behaviour change as correct.

```json
// stryker.config.json
{
  "testRunner": "vitest",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "coverageAnalysis": "perTest",
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"]
}
```

Take a shipping rule with a 100%-covered suite:

```typescript
if (order.subtotal >= FREE_SHIPPING_THRESHOLD) return 0; // £50.00 or more ships free
```

Stryker turns `>=` into `>`. The tests use an £80 basket and a £20 basket, so both sides of the branch ran and coverage was satisfied. Neither basket can tell the two versions apart, because the mutant only changes behaviour at exactly £50. The mutant survives, and a customer with a £50.00 basket pays £5.99 shipping the site promised was free. The test that kills it is the boundary itself:

```typescript
it('is free at exactly the threshold', () => {
  expect(shippingCost(anOrder({ subtotal: 5_000 }))).toBe(0);
});
```

Survivors fall into a few shapes, and each names a habit to change:

| Survivor | Habit |
| --- | --- |
| `>=` → `>` at a threshold | You tested comfortably above and below the line and never the line itself. Round test data is the smell. |
| `isMember && subtotal >= 10_000` → `isMember && true` | You tested each flag but never the combination. Branch coverage cannot see combinations. |
| `subtotal - discount` → `subtotal + discount`, and `toBeGreaterThan(0)` still passes | The assertion stops at the sign. Assert the number. |
| `+ shipping` → `- shipping` with a basket that ships free | The input zeroed the term before any assertion saw it. No assertion can fix this; change the input. |

Remember the last row. A test can be structurally unable to fail, and the coverage report, the test name and the assertion all stay silent about it; only the surviving mutant tells you. The same run also shows which tests are load-bearing: skip one and re-run, and if the score holds, that test documents rather than guards.

One caution, because the score is a number and numbers get gamed. The repo linked below has a third suite that kills all 24 mutants with nine tests by deriving every expected value from the production code: thresholds retyped from `pricing.ts`, and totals computed by calling `discountRate` and `shippingCost` inside the expectation. Raise the flat shipping fee from £5.99 to £6.99 and that suite stays green, because the expected value was computed by the code that changed. A test that copies the constant instead does fail on the price rise, but the person making the change updates the copy in the same commit, and the test has only ever confirmed that the code agrees with itself; a wrong requirement lands in both places at once and nothing objects. Mutation testing surfaces a slice of this (a mutant inside a helper called on both sides of an assertion survives, when no other test pins that helper) and none of the rest. Expected values come from the spec, the price list, or the ticket, never from the file you are testing, and only a reviewer asking "where did that number come from?" enforces it.

[100% test coverage is false hope](https://github.com/jagreehal/100-percent-test-coverage-is-false-hope) is the worked example above, checked in and runnable: the same pricing module, three suites, identical coverage, different survivors.

---

## Review New Tests

Ask these questions during review:

- Does one lower level prove the same behaviour?
- Does the test cross the seam its level owns?
- Does a shared fixture already cover this payload?
- Would a refactor that preserves user behaviour break the test?
- Does the `then` assert anything? A green run with no assertion proves nothing.
- Is the title a guarantee ("refund is rejected after 30 days") or a function name ("processRefund works")?
- Does it test the boundary value itself, or only comfortably above and below it? A [mutation run](#coverage-is-an-attendance-register) answers this for the whole file.

Move the test down when a lower level can answer the same question with less setup; [Testing Levels](../testing-levels) has the levels.

---

## Related Patterns

- [Testing & Testability](../testing) is where injected deps make these tests cheap to write.
- [CI Gates and Triage](../ci-gates) runs the mutation check on changed files and decides what blocks a merge.
- [AI Coding Agents](../ai-agents#the-verdict-comes-from-the-run) applies the same standard to tests an agent wrote.
