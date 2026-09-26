# Changelog

## 1.0.0 -- 2026-09-26

Initial release.

- `contracts/NarrowGrant.py`: `issue_origin`, `issue_hop`, `freeze_origin`,
  `freeze_hop`, `prove_use`, `get_origin`, `get_hop`, `walk_line`,
  `get_origin_count`, `get_hop_count`.
- Deterministic narrowing (`_check_narrowing`) enforced on every hop:
  action subset, exact asset/unit match, non-increasing cap, non-widening
  period, non-extending expiry, depth-capped-at-4 chain, `allow_hop`
  gating, and caller/grantee identity checks -- all plain Python, no
  model call anywhere in the narrowing path.
- Optional `checkable` grant mode: a hand-written
  `gl.vm.run_nondet_unsafe` leader/validator pair independently fetches
  a witness URL and independently extracts `cap`/`asset`/`unit`; a
  failed fetch or a mismatch aborts the write.
- `genvm-lint check` clean (10 methods: 5 view, 5 write, no nesting
  warning).
- `tests/direct/test_narrow_grant.py`: direct-mode test suite covering
  origin issuance, valid/rejected hops across every narrowing field,
  declared-mode hops with zero mocks registered, checkable-mode success
  and fetch-failure abort, a depth-4-then-rejected-5th-hop chain, a
  prompt-injection-in-`note` regression test, freeze/kill-switch
  cascades, `prove_use` caller-binding and cap enforcement, and
  validator-independence checks via `direct_vm.run_validator`.
- `.github/workflows/ci.yml` runs lint + tests on every push.
