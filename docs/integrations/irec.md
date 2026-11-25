# I-REC Integration Boundary

This document defines the boundary between BeEnergy generation credits and any
future I-REC (International Renewable Energy Certificate) integration. It is an
architecture and product-direction note only. It does **not** claim that
BeEnergy issues, holds, or trades I-REC certificates, and it does **not** claim
any ESG certification.

## Product direction (unchanged)

BeEnergy is a cooperative-management product. Generation credits are assigned to
cooperative members to represent their share of cooperative generation. This is
an internal accounting construct, not an external certificate marketplace and
not a formal environmental-attribute claim.

## Terminology: keep the two concepts separate

| Concept | Owner | Meaning |
| --- | --- | --- |
| BeEnergy generation credit | BeEnergy | Internal cooperative accounting unit for member generation share. |
| I-REC certificate | External I-REC registry / issuer | Formal, externally registered renewable-energy attribute certificate. |

Rules:

- A BeEnergy generation credit is **never** labeled, displayed, or exported as an
  I-REC certificate.
- Provider identifiers (registry account IDs, device IDs, issuer IDs) live only
  in the integration layer and are never stored on or derived from BeEnergy
  generation-credit records.
- Formal certificate status (registered / issued / transferred / retired) is a
  property of the external registry, not of a BeEnergy generation credit.

## Responsibility split for any I-REC workflow

Any future I-REC workflow must keep these responsibilities distinct and outside
the internal credit model:

1. **Registration** — registering devices/participants with the I-REC registry.
   Owned by the integration layer under an approved provider agreement.
2. **Issuer** — the accredited I-REC issuer that mints certificates. BeEnergy is
   not an issuer and must not act as one.
3. **Issuance** — the registry issuing certificates for registered generation.
   Tracked by external certificate identifiers, never by internal credit IDs.
4. **Transfer** — movement of certificates between registry accounts. Handled by
   the registry/provider, not by BeEnergy credit transfers.
5. **Retirement** — the registry permanently retiring certificates for a claim.
   Recorded against external certificate identifiers only.

## Data-model boundary

- Internal credits and external certificates are separate records with separate
  identifiers. There is no shared primary key and no implicit mapping.
- Provider identifiers and formal certificate status are stored only in the
  integration layer, keyed by external identifiers.
- Any linkage between a generation credit and an external certificate must be an
  explicit, optional reference added by a future product decision — never an
  assumption baked into the credit model.

See `docs/domain-model.md` for the canonical internal credit model. This document
must stay consistent with it; if terminology diverges, `docs/domain-model.md`
wins and this document is corrected.

## Claims gate

Do not submit to any registry, and do not represent any formal I-REC or ESG
claim in the product, exports, or marketing, until **both** exist:

- an approved provider agreement, and
- an explicit product decision approving the integration.

Until then, the integration boundary is documentation only.

## Rollout and migration

- No data migration is required: this change adds no fields to existing credit
  records and does not alter stored data.
- Existing generation credits remain valid and unchanged.
- When a real integration is approved, any new external-certificate records must
  be introduced additively, with their own identifiers, so existing data is
  preserved.

## Preventing cross-labeling

Tests and reviews must reject any code or copy that:

- labels a BeEnergy generation credit as an I-REC certificate, or
- stores provider identifiers or formal certificate status on internal credit
  records, or
- emits a formal claim before the claims gate above is satisfied.
