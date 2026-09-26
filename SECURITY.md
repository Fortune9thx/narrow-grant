# Security

## Trust model

`NarrowGrant` treats every input that is not itself verified through
independent, on-chain re-derivation as untrusted:

- **`witness_url`** (caller-supplied, part of a `checkable` grant) is
  the only fetched, externally-controlled input. It is validated for
  shape and SSRF-shaped risk before storage (see `_unsafe_host_reason`
  in the contract source), but reachability and genuine third-party
  status can only be confirmed at fetch time, by the leader and every
  validator independently.
- **`extract_instruction`** is caller-supplied and untrusted, but never
  fetched or executed -- it only tells the model where to look on an
  already-fetched page; the extraction prompt explicitly warns the
  model not to treat it as evidence of the values themselves.
- **`note`** is caller-supplied, bounded to 200 characters, and stored,
  but never read by `_check_narrowing` or by any prompt built anywhere
  in this contract -- see `docs/DESIGN.md` for why this closes
  prompt-injection-style attempts to widen a cap by construction, not
  by instruction.
- **Fetched witness-page content** is treated as attacker-influenceable
  data, never as instructions -- the extraction prompt includes an
  explicit security notice to this effect.

## SSRF mitigation

`_unsafe_host_reason` rejects `localhost`/`*.localhost`, IP-literal
hostnames (IPv4/IPv6), purely numeric non-dotted-quad IP encodings,
explicit ports, and embedded credentials on `witness_url` before it is
ever stored. This is a textual, pre-fetch check -- it cannot inspect
redirects or pin against DNS rebinding between validation and the
actual `gl.nondet.web.get` fetch. See the function's own docstring in
the contract source for the full, explicit list of what it does and
does not cover.

## Identity normalization

Every address this contract stores or compares (`owner`, `grantee`,
`issued_by`, `sender`) is normalized to the same checksummed hex form
(`Address(...).as_hex` for caller-supplied strings, `str(gl.message.sender_address)`
for the calling wallet) before being written or compared -- an
authority or grantee check can never silently miss due to case
variance between two representations of the same address.

## No funds held

This contract holds no value, has no payable methods, and performs no
value transfers. `prove_use` records a receipt only. There is no
escrow, staking, or payout surface to secure.

## Reporting

If you find a genuine security issue, open a GitHub issue on this
repository.
