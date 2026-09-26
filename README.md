# NarrowGrant

A GenLayer Intelligent Contract that is a reusable primitive for
**attenuated capability hops**: a chain of delegated permission that can
only ever get more restrictive as it passes from one holder to the
next, never wider.

## What it does

1. **`issue_origin(grant_json, allow_hop, expires_at)`** -- a wallet
   issues itself a root grant: a bounded set of `actions`, a single
   `asset`, a numeric `cap`, a `unit`, and an accounting `period`
   (`tx` / `day` / `week` / `month`). Returns the new `origin_id`.
2. **`issue_hop(parent_id, grantee, grant_json, allow_hop, expires_at)`**
   -- whoever currently holds a grant's authority (the origin's owner,
   or one step further down, a hop's own grantee) can delegate a
   further-narrowed grant to a new `grantee`. Every structured field of
   the new grant is checked as a deterministic narrowing of its parent
   before anything is written -- actions must be a subset, asset/unit
   must match exactly, the cap cannot increase, the period cannot
   widen, the expiry cannot exceed the parent's, and the chain is
   capped at depth 4.
3. **`prove_use(hop_id, action, amount)`** -- a hop's grantee records
   that they exercised it. Every ancestor back to the origin is walked
   and must be neither frozen nor expired. No value is transferred --
   this is a receipt, not a payment.
4. **`freeze_origin(origin_id)` / `freeze_hop(hop_id)`** -- a kill
   switch. An origin's owner can freeze it; a hop's issuer, or the root
   origin owner (cascading), can freeze it. A frozen link blocks
   `prove_use` for itself and everything beneath it in the chain.

A grant can optionally be `"checkable"`: instead of trusting the
caller's self-declared cap/asset/unit outright, every validator
independently fetches a witness URL the grant names and independently
extracts those same three fields from it, and a hop (or a recorded use)
is only written once every independent extraction agrees with both the
declared fields and the parent's own ceiling. A witness fetch that does
not return successfully can never produce a hop or a recorded use.

There are no funds, no reputation, and no scores anywhere in this
contract.

## Why containment is never an LLM decision

A grant is a structured record -- an action list, an asset string, an
integer cap, a unit string, a ranked period -- not a paragraph. Every
one of those fields has an exact, reproducible comparison in plain
Python: set subset, string equality, integer inequality, a fixed period
ranking. Every validator computes each of these identically and for
free. The only place this contract ever calls a model at all is
narrower and different in kind: extracting three short fields from one
already-fetched witness page. It is never asked to compare, judge, or
decide containment between two grants.

## Public methods

```
issue_origin(grant_json: str, allow_hop: bool, expires_at: u256) -> str
issue_hop(parent_id: str, grantee: str, grant_json: str, allow_hop: bool, expires_at: u256) -> str
freeze_origin(origin_id: str) -> None
freeze_hop(hop_id: str) -> None
prove_use(hop_id: str, action: str, amount: str) -> str
get_origin(origin_id: str) -> str
get_hop(hop_id: str) -> str
walk_line(hop_id: str) -> str        # full ancestor chain, root to leaf, as a JSON array
get_origin_count() -> u256
get_hop_count() -> u256
```

## Grant JSON shape

```json
{
  "schema": "narrowgrant.v1",
  "actions": ["pay"],
  "asset": "USDC",
  "cap": "25000",
  "unit": "usd",
  "period": "month",
  "mode": "declared",
  "witness_url": "",
  "extract_instruction": "",
  "note": ""
}
```

`actions` is 1-6 tokens matching `[a-z0-9_]{1,24}`. `cap` is an integer
string of 1-18 digits. `period` is one of `tx` / `day` / `week` /
`month`, ranked in that order (narrower to wider). `mode` is `declared`
or `checkable`; `checkable` requires a bounded HTTPS `witness_url` and a
non-empty `extract_instruction`. `note` is free text, at most 200
characters, and is **never** read by any consensus path -- see
[docs/DESIGN.md](docs/DESIGN.md).

## Repository layout

```
contracts/NarrowGrant.py                 # the contract
tests/direct/                            # gltest direct-mode tests
docs/DESIGN.md                           # design rationale and trust boundaries
docs/WHY_THIS_PASSES_REVIEW.md           # point-by-point rejection-pattern mapping
PORTAL_SUBMISSION.md                     # submission summary
```

## Running tests / lint

```bash
genvm-lint check contracts/NarrowGrant.py
gltest tests/direct
```

CI (`.github/workflows/ci.yml`) runs both on every push against a clean
checkout.

## License

MIT. See [LICENSE](LICENSE).
