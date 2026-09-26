# Design

`NarrowGrant` is a reusable primitive for attenuated capability hops: a
chain of delegated permission that can only ever narrow as it passes
from one holder to the next.

## Data model

Three `TreeMap[str, str]` collections, each keyed by a contract-generated
id (`o0`, `o1`, ... / `h0`, `h1`, ... / `u0`, `u1`, ...) so no caller can
choose or collide with an existing record's id:

- `origins` -- root grants: `kind`, `origin_id`, `owner`, `grant`,
  `allow_hop`, `expires_at`, `depth` (always `0`), `frozen`,
  `created_at`.
- `hops` -- attenuated grants: `kind`, `hop_id`, `parent_id`,
  `parent_kind` (`"origin"` or `"hop"`), `issued_by`, `grantee`,
  `grant`, `allow_hop`, `expires_at`, `depth`, `frozen`, `created_at`.
- `uses` -- receipts written by `prove_use`: `use_id`, `hop_id`,
  `action`, `amount`, `sender`, `created_at`.

`latest_origin_by_owner` and `latest_hop_by_grantee` are auxiliary
`TreeMap[str, str]` indexes, updated on every `issue_origin`/`issue_hop`
call, pointing an address at the most recent origin/hop it owns or was
granted.

Every value is `str` (a JSON-encoded record, `json.dumps(..., sort_keys=True)`),
and every counter (`origin_counter`/`hop_counter`/`use_counter`) is a
genuinely scalar `u256`. This is a deliberate, previously-verified
choice on this exact pinned dependency hash: `str` is the one `TreeMap`
value type with reliable post-deploy readability; other shapes have
been observed elsewhere to deploy successfully and then become
permanently unreadable. Every public view returns the already-serialized
`str`, never a `dict` -- nothing in this contract ever returns or stores
a bare Python `float`, which GenVM calldata encoding has no case for at
all.

## The grant record

A grant is exactly ten fields, never free text:

| Field | Type | Constraint |
|---|---|---|
| `schema` | str | must equal `"narrowgrant.v1"` |
| `actions` | list[str] | 1-6 items, each matching `[a-z0-9_]{1,24}` |
| `asset` | str | 1-32 chars, no control characters |
| `cap` | str | integer string, 1-18 digits |
| `unit` | str | 1-32 chars, no control characters |
| `period` | str | one of `tx` / `day` / `week` / `month` |
| `mode` | str | `declared` or `checkable` |
| `witness_url` | str | required, bounded HTTPS, SSRF-checked, iff `mode == "checkable"` |
| `extract_instruction` | str | required, ≤300 chars, iff `mode == "checkable"` |
| `note` | str | optional, ≤200 chars, never read by any consensus path |

## Deterministic narrowing -- always, before any nondeterministic code

`_check_narrowing` runs entirely in plain Python, before either
`issue_hop`'s witness consensus or any other nondeterministic call, and
enforces every one of the following, in order:

1. The parent's `allow_hop` must be `true`.
2. The caller must hold the parent's authority -- the origin's `owner`
   if the parent is an origin, or the hop's `grantee` if the parent is
   a hop.
3. `grantee` must not equal the caller.
4. `child.actions` must be a subset of `parent.grant.actions`.
5. `child.asset` must equal `parent.grant.asset` exactly.
6. `child.unit` must equal `parent.grant.unit` exactly.
7. `int(child.cap) <= int(parent.grant.cap)`.
8. `child.period`'s rank (`tx=0 < day=1 < week=2 < month=3`) must not
   exceed `parent.grant.period`'s rank.
9. The parent must not have already expired, `child.expires_at` must be
   in the future, and `child.expires_at <= parent.expires_at`.
10. `child.depth` must equal `parent.depth + 1` and be at most `4`.

Every one of these is an exact, reproducible comparison -- a set
operation, a string equality, an integer inequality, a fixed lookup
table. No model is ever consulted to decide whether one grant "fits
inside" another; that decision is fully representable in structured
data and is decided identically by every validator for free.

## The witness consensus -- the one place a model is invoked at all

When a grant's `mode` is `"checkable"`, `_run_witness_consensus` runs a
hand-written `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` pair:

- `leader_fn` fetches `witness_url` (`gl.nondet.web.get`). A fetch that
  does not return a 2xx status, or returns empty content, immediately
  produces `{"fetch_ok": false, ...}` -- **before** any model is ever
  invoked. Only on a successful fetch does it build a prompt (from the
  grant's own `extract_instruction` plus the fetched text -- never
  `note`) and ask a model to extract exactly `cap`/`asset`/`unit` as
  plain strings. The extracted values are then compared, in plain
  Python, against the declared grant fields and the parent's cap
  ceiling -- never accepted on the model's own say-so about whether they
  "match."
- `validator_fn` never inspects the leader's claim. It calls `leader_fn`
  again -- its own independent fetch, its own independent extraction --
  and only agrees if every one of the five compared fields
  (`fetch_ok`/`cap`/`asset`/`unit`/`matches_declared`) is byte-identical
  to the leader's.

This is the single non-deterministic call reachable from either
`issue_hop` or `prove_use` (each reaches it through exactly one call to
`_run_witness_consensus`, never nested inside another nondet block), and
it never reads or writes `self.*` -- both closures see only their own
plain-value parameters.

## Why a failed witness fetch can never produce a hop or a use

`leader_fn` checks the fetch outcome with plain Python control flow and
returns `fetch_ok: false` immediately, before `gl.nondet.exec_prompt` is
ever called. `issue_hop`/`prove_use` then check `verdict["fetch_ok"]`
and `verdict["matches_declared"]` and raise `gl.vm.UserError` on either
being false, **before** any storage mutation happens. There is no
fallback path where caller-supplied text substitutes for a live,
independently-verified witness once `checkable` mode is chosen, and no
partial hop/use record is ever left behind by an aborted attempt.

## Why `prove_use` binds the caller to the grantee

`prove_use` requires `sender == hop.grantee` -- not the hop's issuer,
not an ancestor's owner, not anyone who merely learns the `hop_id`. This
matches the attenuated-delegation model directly: holding a hop is what
lets you exercise it, not having created it. An issuer or root owner who
wants to stop a grantee from using a hop already has the tool for that
-- `freeze_hop`/`freeze_origin` -- rather than being given a second way
to exercise someone else's capability.

## Why `note` is ignored by every consensus path

`note` is parsed, length-bounded, and stored -- and nothing else.
`_check_narrowing` never reads it. `_build_witness_prompt` never
includes it (only `extract_instruction` and the fetched witness text
are ever embedded in a prompt). A field that no comparison and no
prompt ever looks at cannot be used to smuggle a wider cap, a different
asset, or an instruction to a model that has no reason to ever see it --
this is closed by construction, not by an instruction asking a model to
ignore it.

## Kill-switch cascade

`freeze_hop` is callable by whoever issued that exact hop, or by the
root origin owner at the top of its lineage -- a cascading kill switch
that lets the root owner cut off any downstream hop even if they did not
personally issue it. `prove_use` walks every ancestor from the named hop
up to its origin and rejects if any link anywhere in that chain is
frozen or expired: attenuation only narrows forward, and a parent that
has lost its own standing cannot leave a descendant capability still
exercisable.

## Trust boundaries

- **`witness_url`** is the only fetched, externally-controlled input.
  It is validated for shape (bounded length, `https://` only, no
  whitespace/quote characters) and SSRF-shaped risk (no `localhost`, no
  IP-literal or numeric-encoded-IP hostnames, no explicit port, no
  embedded credentials) before storage. This cannot guarantee the URL is
  reachable or genuinely third-party at fetch time -- see the caveats
  documented directly in `_unsafe_host_reason`'s own docstring in the
  contract source.
- **`extract_instruction`** is caller-supplied and untrusted, but never
  fetched or executed -- it only tells the model *where* to look; the
  prompt explicitly warns the model not to treat it as evidence of the
  values themselves.
- **Fetched witness-page content** is treated as attacker-influenceable
  data, never as instructions -- the extraction prompt includes an
  explicit security notice to this effect.
- **`note` is caller-supplied, bounded, and stored, but never read by
  any consensus path** -- see above.
- **Issuing a hop has no special evaluation rights beyond authority
  checks.** Any current authority holder (an origin's owner, or a hop's
  grantee) can issue further hops from what they hold; `prove_use` is
  permissionless for anyone who genuinely is a hop's grantee.

## Known limitations

- **Witness-page stability.** `witness_url` is fetched independently by
  the leader and by every validator, possibly seconds apart, and again
  on every later `prove_use` call for a checkable hop. A witness page
  that changes between independent fetches, or between issuance and
  use, can make a genuinely-supported hop fail a later re-verification
  -- not a contract bug. Prefer a witness source that represents an
  already-settled, stable record over a live/real-time view of the same
  data.
- **No history of prior uses per hop.** `uses` records every
  `prove_use` call as an independent receipt; this contract does not sum
  amounts against a hop's cap across multiple uses within a period --
  each `prove_use` call is checked against the hop's cap independently.
  A caller building a rate-limited spending policy on top of this
  primitive should track cumulative usage per period off-chain or in a
  wrapping contract; `period` here documents the *accounting window a
  grant is denominated in*, not an on-chain running total this contract
  itself enforces.

## Deliberately out of scope

No funds, no reputation or trust scoring, no percentage or
partial-credit result. A primitive whose entire job is "does this
structured grant deterministically narrow its parent" does not need a
value-transfer or scoring surface, and adding one would only add attack
surface and review scope without serving that single question.
