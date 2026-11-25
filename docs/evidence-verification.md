# Privacy-safe generation evidence boundary

Generation credits remain cooperative-member credits. They are **not** I-REC, I-TRACK,
ESG certificates, or external environmental claims.

## Evidence reference

The API emits a versioned opaque reference with this format:

```text
beenergy://evidence/v1/<cooperative-id>/<YYYY-MM-DD>/<YYYY-MM-DD>/<operation-id>#sha256=<64-hex>
```

Only the following fields are eligible for on-chain evidence events:

- cooperative ID
- generation period start and end
- operation ID (certificate or reading ID)
- evidence format version (currently `1`)
- evidence SHA-256 digest
- evidence reference string
- generated/credited kWh amount

The SHA-256 digest is of a canonical JSON manifest containing the cooperative ID,
period, operation ID, aggregate kWh amount, and evidence version. It is not a digest
of a member profile or raw meter payload. The evidence reference is immutable: a
different period, operation, amount, or version produces a different reference and digest.

## Verification boundary

Raw meter samples, timestamps below period granularity, member names, emails, wallet
identity documents, and personal identifiers remain in the off-chain verification system.
The on-chain contract may record aggregate kWh and the privacy-reviewed reference only.

Reviewers verify the off-chain evidence package for the named cooperative and period,
check the canonical manifest digest against `evidence_hash`, and confirm that the
operation ID matches the mint or generation operation. The blockchain proves that a
mint/generation happened and links it to that digest; it does not expose or independently
verify personal readings.
