# BeEnergy Domain Terminology

This glossary is the canonical reference for generation, injection, and credit
terminology across the UI, API, database, contracts, and documentation. When a
term here conflicts with older docs or code, this document wins.

BeEnergy is a **cooperative-management product**. Generation credits are
assigned to cooperative members. BeEnergy is **not** an external certificate
marketplace and does **not** issue or claim I-REC, ESG, or Scope 2 certification.

## 1. Canonical glossary

| Term | Definition |
| --- | --- |
| **Gross generation** | Total electrical energy produced by a generation asset over a period, measured at the asset's meter, before any consumption or losses. |
| **Self-consumption** | Portion of gross generation consumed on-site by the producing member/site and therefore never injected into the cooperative grid. |
| **Injected surplus** | Gross generation minus self-consumption: the energy actually delivered into the cooperative distribution/grid for allocation. |
| **Allocated generation credit** | A cooperative-internal accounting unit representing a member's share of injected surplus, assigned by the cooperative's allocation rules. It is a bookkeeping entitlement, not a tradable environmental attribute. |
| **Formal environmental certificate** | An independently issued, audited instrument (e.g. I-REC, Guarantee of Origin) attesting to the environmental attributes of 1 MWh. BeEnergy does **not** issue, broker, or represent these. |

Relationship: `gross generation = self-consumption + injected surplus`, and
`sum(allocated generation credits) <= injected surplus` per settlement period.

## 2. Field and column mapping

Every persisted field, API field, and contract amount maps to exactly one
glossary term. Legacy aliases are retained for backward compatibility only.

| Surface | Field / column / amount | Glossary term | Status |
| --- | --- | --- | --- |
| DB | `generation.gross_kwh` | Gross generation | canonical |
| DB | `generation.self_consumed_kwh` | Self-consumption | canonical |
| DB | `generation.injected_kwh` | Injected surplus | canonical |
| DB | `generation.surplus_kwh` | Injected surplus | **legacy alias** |
| DB | `credits.amount_kwh` | Allocated generation credit | canonical |
| DB | `credits.certificate_kwh` | Allocated generation credit | **legacy alias (misleading)** |
| API | `GET /generation` → `grossKwh` | Gross generation | canonical |
| API | `GET /generation` → `selfConsumptionKwh` | Self-consumption | canonical |
| API | `GET /generation` → `injectedSurplusKwh` | Injected surplus | canonical |
| API | `GET /generation` → `surplusKwh` | Injected surplus | **legacy alias** |
| API | `GET /credits` → `allocatedKwh` | Allocated generation credit | canonical |
| API | `GET /credits` → `certificateKwh` | Allocated generation credit | **legacy alias (misleading)** |
| Contract | `GenerationRecord.grossAmount` | Gross generation | canonical |
| Contract | `GenerationRecord.selfConsumptionAmount` | Self-consumption | canonical |
| Contract | `GenerationRecord.injectedAmount` | Injected surplus | canonical |
| Contract | `CreditAllocation.amount` | Allocated generation credit | canonical |
| Contract | `CreditAllocation.certificateAmount` | Allocated generation credit | **legacy alias (misleading)** |

## 3. Legacy aliases and migration policy

- **Legacy aliases** are the `surplus*` and `certificate*` names above. They
  remain readable but must not be used in new code, contracts, or UI copy.
- **Additive rollout:** introduce canonical names alongside legacy aliases; do
  not drop or rename existing columns/fields in the same release.
- **Data preservation:** no destructive migration. Legacy columns keep their
  values; canonical columns are backfilled from them and kept in sync until the
  alias is retired.
- **Deprecation:** mark legacy aliases deprecated in API docs and contracts;
  remove only after all consumers migrate and a deprecation window has passed.
- **No semantic drift:** a legacy alias must never be re-interpreted as a
  formal environmental certificate.

## 4. User-facing language rules

- Present BeEnergy credits as **allocated generation credits** assigned to
  cooperative members — never as certificates.
- Never label credits as **I-REC**, **Guarantee of Origin**, **Scope 2** claims,
  or **independently certified** environmental attributes.
- Avoid the words "certificate", "certified", and "offset" in credit UI copy;
  use "generation credit" and "allocated energy".
- Where certification is discussed, state explicitly that BeEnergy does not
  provide certified environmental attributes.

## 5. Validation

- Terminology strings shown to users are centralized so labels can be reviewed
  against this glossary in one place.
- Product and domain docs must use the canonical terms in section 1; any
  remaining legacy alias must be marked as such per section 3.
