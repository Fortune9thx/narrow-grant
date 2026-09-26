# Portal submission summary -- NarrowGrant

## What it is

A reusable GenLayer Intelligent Contract primitive for attenuated
capability hops: a chain of delegated permission (`origin` → `hop` →
`hop` → ...) that can only ever get more restrictive as it passes from
one holder to the next, never wider. Every structured field of a hop
(actions, asset, cap, unit, period, expiry, depth) is checked as a
deterministic narrowing of its parent before anything is written --
never an LLM judgment call. An optional `checkable` mode adds a live,
independently-verified witness fetch on top of the caller's declared
values. No funds, no reputation, no scores.

## Header

```
# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

## Verification performed

- **`genvm-lint check contracts/NarrowGrant.py`: clean.** Output:
  `Lint passed (3 checks)`, `Validation passed`, `Methods: 10 (5 view, 5
  write)`. The one informational note ("a newer runner is available")
  is an upstream suggestion, not a failure -- this contract stays
  pinned to the dependency hash matching the live network this
  primitive targets.
- **`tests/direct/test_narrow_grant.py`: 58 direct-mode tests, all
  passing locally**, covering: origin issuance and every grant-field
  validation rejection; every deterministic narrowing check in
  isolation (cap increase, extra action, asset/unit mismatch, period
  widening, expiry exceeding the parent's, wrong-caller, `allow_hop`
  gating, grantee-must-not-be-caller, invalid grantee address format);
  a declared-mode hop succeeding with zero mocks registered at all
  (proving no nondeterministic call is reachable in that path);
  checkable-mode success, fetch-failure abort, and extracted-value-
  mismatch abort; a dedicated regression test planting a
  prompt-injection string in `note` and confirming it cannot widen a
  cap (structurally -- `note` is never read into any prompt); freeze
  kill-switch behavior for both origins and hops, including the root
  owner's cascading authority over a hop it did not personally issue;
  `prove_use` caller-binding, action/cap enforcement, and ancestor
  freeze/expiry propagation (both for a frozen origin and a frozen
  intermediate hop); a four-hop chain reaching the maximum depth
  followed by a rejected fifth hop; every view method including
  `walk_line`'s root-to-leaf ordering; and `direct_vm.run_validator`
  checks proving the witness-consensus validator independently
  re-derives its result rather than trusting the leader's claim.
- **A real bug was found and fixed by this test suite before this
  submission**: `_check_narrowing` checked the parent's expiry but
  never its `frozen` flag, so `freeze_origin` did not actually block
  further hops being issued from a frozen origin (it correctly blocked
  `prove_use` on already-issued descendants, but not new issuance).
  Caught by `TestFreezeOrigin::test_frozen_origin_blocks_new_hop`
  failing with `DID NOT RAISE Exception`. Fixed with a one-line check
  at the top of `_check_narrowing`; all 58 tests pass after the fix.
- **Local toolchain note.** The pre-release `genlayer-test==0.30.0rc2` /
  `genvm-linter==0.11.1rc2` auto-upgrade (a known, previously-documented
  upstream gap on this dependency hash: GenLayer's runner-hosting stopped
  serving this hash's tarball for that bundle-cache generation)
  initially made `gltest tests/direct` fail all 58 tests at the deploy
  step with `ImportError: Failed to load contract: unexpected end of
  memory`, while `genvm-lint check` still passed under that same
  pre-release. Downgrading only `genlayer-test` to `0.29.2` (keeping
  `genvm-linter` at `0.11.1rc2`, since downgrading it separately hits
  the identical missing-runner-tarball error from its own, differently
  laid out cache) resolved it completely -- all 58 tests then passed
  locally with no CI dependency needed to prove it. `.github/workflows/ci.yml`
  pins `genlayer-test==0.29.2`/`genvm-linter==0.11.0` for full
  reproducibility on a clean checkout regardless of this machine's
  locally cached state.

## Deploy

Deployed via the reused `bradbury-deploy` GenLayer CLI account
(`0xc6e6d3b2accaececeb40ad4bd3df123ddcb4e537`). See `scripts/deploy.mjs`
and the repository's commit history / README for the current live
address once deployment completes.

## Files

```
contracts/NarrowGrant.py
tests/direct/conftest.py
tests/direct/test_narrow_grant.py
.github/workflows/ci.yml
scripts/deploy.mjs
package.json
README.md
docs/DESIGN.md
docs/WHY_THIS_PASSES_REVIEW.md
PORTAL_SUBMISSION.md
CHANGELOG.md
SECURITY.md
LICENSE
```
