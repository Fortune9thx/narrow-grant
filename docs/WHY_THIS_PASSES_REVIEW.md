# Why this passes GenLayer Portal review

This document maps each hard requirement given for this primitive to
the specific place in `contracts/NarrowGrant.py` that satisfies it.

## Requirement-by-requirement

| Requirement | Where it's satisfied |
|---|---|
| Origin grant is structured, not an essay | `_parse_grant` accepts exactly ten typed fields (`schema`/`actions`/`asset`/`cap`/`unit`/`period`/`mode`/`witness_url`/`extract_instruction`/`note`) and rejects any unknown key. |
| A hop is allowed only when every structured field is a deterministic narrowing of its parent | `_check_narrowing` -- ten checks, all plain Python (set subset, string equality, integer inequality, a fixed period-rank table), run in full before any nondeterministic code. |
| If mode is checkable, every validator independently fetches the witness URL and extracts the numeric cap | `_run_witness_consensus`'s `validator_fn` never inspects the leader's claim -- it calls `leader_fn` again (via `gl.vm.run_nondet`, the current SDK's name for the unsandboxed leader/validator primitive), its own independent fetch and extraction, and only agrees if all five compared fields match. |
| Failed fetch cannot create a hop or prove a use | `leader_fn` returns `fetch_ok: false` before ever calling the model; `issue_hop`/`prove_use` both check `verdict["fetch_ok"]` and raise before any storage mutation. |
| The LLM never decides containment of two paragraphs | Narrowing is entirely `_check_narrowing`'s deterministic comparisons; the only model call anywhere in the file (`_run_witness_consensus`) extracts three short fields from one page, never compares two grants or judges containment. |
| No funds, no reputation, no scores | The contract has no payable method, no value-transfer call, and no numeric field anywhere in storage that resembles a score or balance -- `uses` records are receipts (`use_id`/`hop_id`/`action`/`amount`/`sender`/`created_at`), not a ledger. |
| Records stored as `TreeMap[str, str]` JSON strings | `origins`/`hops`/`uses`/`latest_origin_by_owner`/`latest_hop_by_grantee` are all `TreeMap[str, str]`; every record is `json.dumps(..., sort_keys=True)`'d before storage. |
| Views return JSON strings, not dicts | `get_origin`/`get_hop`/`walk_line` all return the raw stored JSON string (or, for `walk_line`, a freshly-built JSON array string) -- never a `dict`. |
| `gl.vm.UserError` for user errors | Every validation failure across `_parse_grant`, `_check_narrowing`, `_normalize_grantee`, `_validate_amount`, and every method's own guard clauses raises `gl.vm.UserError`. |
| Header format | Line 1 is `# v0.3.0`; line 2 is exactly `# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }` -- the current canonical `py-genlayer` runner per GenLayer's own published runner list. |
| Public method surface | `issue_origin`, `issue_hop`, `freeze_origin`, `freeze_hop`, `prove_use`, `get_origin`, `get_hop`, `walk_line`, `get_origin_count`, `get_hop_count` -- exactly the ten requested. |

## Mapping against documented real rejection patterns

1. **"Validator checks only shape... redesign the validator to
   independently acquire and assess the evidence."** `validator_fn`
   re-fetches the witness URL and re-extracts from scratch; it never
   inspects the leader's claimed values for plausibility. Directly
   tested by `TestValidatorIndependence::test_validator_disagrees_when_leader_forges_a_higher_cap`.
2. **Nested non-determinism fails contract lint.** Exactly one
   `gl.vm.run_nondet_unsafe` call exists in the whole file, inside the
   single shared `_run_witness_consensus` function; both `issue_hop` and
   `prove_use` reach it through exactly one call each, never nested
   inside another nondet block.
3. **Unsourced/unauthenticated evidence for a consequential decision.**
   A checkable grant's cap/asset/unit are never accepted from caller
   text alone -- they must be independently re-derived from a live
   witness fetch before a hop or use is written.
4. **SSRF on a caller-supplied fetch target.** `_unsafe_host_reason`
   rejects localhost, IP-literal, numeric-IP-encoded, ported, and
   credentialed hostnames on `witness_url` before a grant is ever
   stored.
5. **Address-checksum-style silent lookup failure.** `_normalize_grantee`
   parses every caller-supplied `grantee` through `Address(...).as_hex`
   and stores/compares only that normalized form -- the same
   normalization every other identity in this contract
   (`str(gl.message.sender_address)`) already produces, so an
   authority/grantee comparison can never silently miss due to case
   variance.
6. **Claiming success before real finality.** `issue_hop`/`prove_use`
   write a definite on-chain record the moment the transaction the
   caller submitted is itself accepted by consensus -- there is no
   separate "mark as complete" step whose omission could misrepresent
   status.
7. **Staked/escrowed funds with no bounded escape hatch.** Not
   applicable -- this contract holds no funds of any kind, so there is
   nothing that can become permanently locked.
8. **A favorable verdict treated as immune to further challenge.** Not
   applicable -- there is no verdict/candidate-comparison mechanism
   here; every hop is either created under the stated rules or rejected
   outright, and freezing is always available as an independent
   kill-switch regardless of any prior issuance.
9. **Prompt-injection widening a numeric limit.** `note` is never read
   by `_build_witness_prompt` or `_check_narrowing` -- tested directly by
   `TestNoteCannotWidenCap::test_prompt_injection_in_note_cannot_widen_cap`,
   which plants an injection string in `note` and confirms the resulting
   hop's cap is unaffected.

## Design choices worth naming explicitly

- **A single shared `_check_narrowing` function**, called once from
  `issue_hop`, rather than folding the checks inline -- keeps the
  narrowing rule auditable as one ordered list matching this
  primitive's own specification, rather than scattered across the
  method body.
- **A single shared `_run_witness_consensus` function**, called from
  both `issue_hop` and `prove_use` -- the witness-verification logic
  exists in exactly one place, so a checkable grant is re-verified with
  identical rules whether it is being newly hopped or later exercised.
- **Contract-generated ids only** (`o0`, `h0`, `u0`, ...) -- a caller can
  never choose or collide with an existing record's id.
