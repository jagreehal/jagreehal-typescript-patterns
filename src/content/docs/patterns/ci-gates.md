---
title: "CI Gates and Triage"
description: "Sort a red run into regression, stale expectation, cascade, environment, or flake before fixing anything, and gate merges only on checks the author can act on."
---

*Use this page when CI is red, or when you are deciding which checks should block a merge.*

---

## Triage a Red Run Before Fixing It

Fourteen failures is almost never fourteen problems. Before anyone opens an editor, sort the red into buckets:

| Bucket | Signal | Action |
| --- | --- | --- |
| Regression | The promise was not meant to change and the code broke it | Fix the code |
| Stale expectation | The promise was meant to change and the test wasn't updated | Fix the test, in the same PR as the behaviour change |
| Cascade | One shared fixture or seed broke and took a dozen tests with it | Fix the one cause, re-run, re-triage |
| Environment | Missing service, expired credential, wrong Node version | Fix the runner, not the code |
| Flaky | Passes and fails on the same commit | Quarantine with an owner and a date; prove the fix with `--repeat-each` |

Regression versus stale expectation is the bucket you will get wrong. The question that separates them is "was this promise supposed to change?" Flakiness is a measurement: you need several runs on the same commit, which is why a PR gate cannot decide it. And if you add a retry to turn a red test green, you have moved the race from CI to a customer.

Hold two rules. Do not fix during triage; sort first, or you will fix the easy failure and rationalise the real one. And do not go green by subtraction. Deleting a test or stripping its assertions changes behaviour, so review it as a behaviour change.

## Gate on What Someone Can Act On

If a CI gate fires on things the author cannot act on, someone disables it within a fortnight and the one useful check goes with it. Add one gate, watch it for a week, then add the next. A gate that cannot be satisfied is a bug in the gate.

Put checks the author can fix before merge on the PR gate: the suite is red, or a scenario disappeared without a matching change. Put trend checks (flakiness rate, suite duration) on a nightly run with a person on the other end, because someone has to discuss a trend before anyone acts on it.

Get two mechanical details right. Publish the run artifacts when the gate fails, or the person triaging reads a log instead of a report. And give each gate its own exit code, so a pipeline can tell "the PR gate failed" from "the release gate failed" without parsing output.

A PR gate should fire about as often as something is wrong. If one has not fired in a month, it is not protecting anything.

## Run Mutation Testing on What Changed

Scope a CI run to the production files a PR touched. Stryker mutates whatever `--mutate` names, so exclude the tests yourself (`.test.ts`, `.spec.ts`, `__tests__/`, or whichever conventions your repo uses) and skip the run when nothing qualifies. Under `set -euo pipefail`, a `grep` with no matches exits 1, so the script wraps the two filters to keep an empty selection from failing the job. It leaves `git diff` unwrapped: an empty diff already exits 0, and a missing base ref should fail the job rather than skip the run:

```bash
set -euo pipefail
changed=$(
  git diff --name-only --diff-filter=AM origin/main -- src |
  { grep -E '\.ts$' || true; } |
  { grep -vE '(\.test|\.spec)\.ts$|/__tests__/' || true; } |
  paste -sd, -
)
if [ -n "$changed" ]; then
  npx stryker run --mutate "$changed"
else
  echo "no production files changed, skipping mutation run"
fi
```

Treat a survivor on a changed line the way you treat a failing test. `--incremental` speeds up repeat runs by reusing `reports/stryker-incremental.json`; it only helps if you cache that file between runs, and it does not choose which files to mutate.

---

## Related Patterns

- [Test Quality](../test-quality) explains what a survivor means and how to kill one.
- [Browser Journeys](../browser-journeys) covers the parallel-safety rules that stop flakes at the source.
- [executable-stories](https://github.com/jagreehal/executable-stories) implements the triage buckets and gate exit codes above as a CLI (`check`, `goal --baseline`, `triage`, `gate-release`).
