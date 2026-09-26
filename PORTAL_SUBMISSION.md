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
# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
```

This is the current canonical `py-genlayer` runner hash (per GenLayer's
own published runner list) and the v0.3.0 standard-library API
(`gl.contract.Contract`, `gl.vm.run_nondet`, `gl.message.raw`, etc.).

## Verification performed

- **`genvm-lint check contracts/NarrowGrant.py`: clean.** `Lint passed
  (3 checks)`, `Validation passed`, `Methods: 10 (5 view, 5 write)`, no
  nesting warning, no informational notices.
- **`tests/direct/test_narrow_grant.py`: 58 direct-mode tests, all
  passing.** Covers: origin issuance and every grant-field validation
  rejection; every deterministic narrowing check in isolation (cap
  increase, extra action, asset/unit mismatch, period widening, expiry
  exceeding the parent's, wrong-caller, `allow_hop` gating,
  grantee-must-not-be-caller, invalid grantee address format); a
  declared-mode hop succeeding with zero mocks registered at all
  (proving no nondeterministic call is reachable in that path);
  checkable-mode success, fetch-failure abort, and
  extracted-value-mismatch abort; a dedicated regression test planting
  a prompt-injection string in `note` and confirming it cannot widen a
  cap; freeze kill-switch behavior for both origins and hops, including
  the root owner's cascading authority over a hop it did not personally
  issue; `prove_use` caller-binding, action/cap enforcement, and
  ancestor freeze/expiry propagation; a four-hop chain reaching the
  maximum depth followed by a rejected fifth hop; every view method
  including `walk_line`'s root-to-leaf ordering; and
  `direct_vm.run_validator` checks proving the witness-consensus
  validator independently re-derives its result rather than trusting
  the leader's claim.
- **Toolchain note.** `genlayer-test==0.30.0rc2` correctly resolves this
  contract's pinned hash locally; `genlayer-test==0.29.2` does not (it
  tries to fetch a `genvm-universal.tar.xz` release asset this hash's
  SDK generation no longer publishes under that filename). Separately,
  gltest's direct-mode LLM mock auto-`json.loads()`s any JSON-shaped
  `mock_llm` response, which breaks the real SDK's
  `exec_prompt(response_format="json")` decoder (it expects raw text it
  parses itself) -- `tests/direct/conftest.py` patches
  `wasi_mock._handle_llm_request` to keep the literal string. Both
  fixes are test-harness-only; no contract code was changed for either.
  `.github/workflows/ci.yml` pins `genlayer-test==0.30.0rc2` /
  `genvm-linter==0.11.1rc2` explicitly.

## Deploy

**Live on GenLayer Studio Devnet.**

- Contract address: `0x71A09Ff4d0cc11132A32c8509aCeE3CBdE111aE5`
- Deploy transaction: `0x6b8b92e6c2843e424c3bfa20006b471174111462122b14b5873fa8726701d408`
- Status: `FINALIZED`
- Deployed from the `bradbury-deploy` GenLayer CLI account
  (`0xC6E6d3b2acCaECeCeB40Ad4bD3dF123DDCB4e537`), reused across
  projects on this account
- The CLI's automatic gas/fee estimation (`eth_estimateGas` /
  `sim_estimateTransactionFees`) is currently unreliable on this
  network -- both the deploy and every live smoke-test write below used
  a complete fee distribution copied from a real, recently `FINALIZED`
  transaction on this exact network (via the explorer API), rather than
  the CLI's own auto-derived estimate, which either reverted with
  `FeeValueMustBeNonZero` or failed a client-side safe-integer check.

## Live smoke test

Run against the live deployment above via a one-off `genlayer-js`
script (`scripts/smoke.mjs`) -- not the `genlayer` CLI's `--args`,
which `JSON.parse`s any JSON-shaped string argument and would have sent
`grant_json`'s *parsed* object instead of the literal string the
contract's `str` parameter expects.

**1. `issue_origin` (declared grant)**
tx `0x9e67575716ad4b281f77b917b8b8388b96a3d4021f2edd1703f0dd9961d9fd66`,
`FINISHED_WITH_RETURN`. Returned `origin_id`: `o0`.
```json
{"allow_hop": true, "created_at": 1790424283, "depth": 0, "expires_at": 1793016278, "frozen": false, "grant": {"actions": ["pay", "refund"], "asset": "USDC", "cap": "1000", "extract_instruction": "", "mode": "declared", "note": "", "period": "month", "schema": "narrowgrant.v1", "unit": "usd", "witness_url": ""}, "kind": "origin", "origin_id": "o0", "owner": "0xC6E6d3b2acCaECeCeB40Ad4bD3dF123DDCB4e537"}
```

**2. `issue_hop` narrowing cap 1000→500, actions [pay,refund]→[pay], period month→tx**
tx `0x2c3ea5f9ff9151fd3989e2c069cffd2d47e75c5219ca164dbacdd51e4f00f333`,
`FINISHED_WITH_RETURN`. Returned `hop_id`: `h0`.
```json
{"allow_hop": true, "created_at": 1790424324, "depth": 1, "expires_at": 1793016278, "frozen": false, "grant": {"actions": ["pay"], "asset": "USDC", "cap": "500", "extract_instruction": "", "mode": "declared", "note": "", "period": "tx", "schema": "narrowgrant.v1", "unit": "usd", "witness_url": ""}, "grantee": "0x7726df49d7488f853135689cAa94c1a7F7301513", "hop_id": "h0", "issued_by": "0xC6E6d3b2acCaECeCeB40Ad4bD3dF123DDCB4e537", "kind": "hop", "parent_id": "o0", "parent_kind": "origin"}
```

**3. `prove_use` from the grantee**
tx `0x1482bc21e865c906df1c19e03ffe98bb1ffbe8dcfb784b0646c84d945091f640`,
sent **from the grantee's own address**
(`0x7726df49d7488f853135689cAa94c1a7F7301513`, confirmed on the
explorer -- never the origin owner or hop issuer), `FINALIZED`,
`FINISHED_WITH_RETURN`. Recorded `use_id` `u0` for `action="pay"`,
`amount="300"` (within the hop's 500 cap).

**4. Rejected hop that tries to raise the cap**
An `issue_hop` call from `o0` (declared cap `1000`) requesting a child
cap of `2000` was submitted and reached real consensus -- and was
rejected by the contract itself, not by the fee layer. tx
`0x183a2f18f678af875248c0f4c27a63c749a9028bb092967cea7f6a05cbc33f28`,
`FINISHED_WITH_ERROR`. Decoded leader result (base64, both the leader's
and the sole other validator's independent receipts agree
byte-for-byte):
```
hop cap cannot exceed the parent's cap
```
-- the exact `gl.vm.UserError` message raised by `_check_narrowing`.
`get_hop_count()` remained `1` after this attempt: no partial or
invalid hop was ever written.

**5. (bonus) checkable hop against a live HTTPS witness**
`witness_url` was
`https://httpbin.org/base64/Y2FwOiA1MDAsIGFzc2V0OiBVU0RDLCB1bml0OiB1c2Q=`
-- a stable, publicly reachable page that decodes to the plain text
`cap: 500, asset: USDC, unit: usd`. tx
`0x80d6efc2822aabd5147c61f24a0f4e3b10117f4bc6adfd7a00c1ebba75fcb5cb`,
`FINISHED_WITH_RETURN`: every validator independently fetched the live
page, independently ran the extraction prompt, and independently
derived `cap="500"`/`asset="USDC"`/`unit="usd"` matching the declared
grant fields exactly -- `get_hop_count()` moved from `1` to `2`,
confirming a genuine new hop was written only after that live agreement.

## Files

```
contracts/NarrowGrant.py
tests/direct/conftest.py
tests/direct/test_narrow_grant.py
.github/workflows/ci.yml
scripts/deploy.mjs
scripts/deployed.json
scripts/smoke.mjs
scripts/smoke-results.json
package.json
README.md
docs/DESIGN.md
docs/WHY_THIS_PASSES_REVIEW.md
PORTAL_SUBMISSION.md
CHANGELOG.md
SECURITY.md
LICENSE
```
