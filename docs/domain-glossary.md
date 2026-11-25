# Domain Glossary: Generation and Credit Terminology

This document is the canonical reference for generation, injection, certificate, and
credit terminology used across the BeEnergy UI, API, database, contracts, and
documentation. When a term here conflicts with older docs or code comments, this
glossary wins.

## Product direction

BeEnergy is a **cooperative-management** product. Generation credits are assigned to
cooperative members to account for shared generation. BeEnergy credits are **not** an
external certificate marketplace, and they are **not** a claim of I-REC, ESG, or any
other independent certification.

## Canonical terms

| Term | Definition |
| --- | --- |
| **Gross generation** | Total electrical energy produced by a generation asset over a period, measured at the asset's production meter, before any consumption or losses. |
| **Self-consumption** | The portion of gross generation consumed on-site by the producing member/site within the same period. Not available for allocation. |
| **Injected surplus** | Gross generation minus self-consumption (and metered losses) that is delivered to the shared grid/cooperative pool. This is the quantity eligible for allocation. |
| **Allocated generation credit** | A cooperative-internal accounting unit representing a share of injected surplus assigned to a member. It is a bookkeeping allocation, not a tradable certificate and not an independently verified attribute. |
| **Formal environmental certificate** | An externally issued, independently verified instrument (e.g. I-REC, GOs, or other registry certificates). BeEnergy does **not** issue or represent these; any reference is out of scope for this product. |

## Field and column mapping

Each persisted field, API field, and contract amount maps to exactly one glossary term.

| Surface | Field / column | Glossary term | Notes |
| --- | --- | --- | --- |
| DB | `generation.gross_kwh` | Gross generation | Canonical. |
| DB | `generation.self_consumed_kwh` | Self-consumption | Canonical. |
| DB | `generation.injected_kwh` | Injected surplus | Canonical. |
| DB | `credits.allocated_kwh` | Allocated generation credit | Canonical. |
| API | `grossGenerationKwh` | Gross generation | Canonical. |
| API | `selfConsumptionKwh` | Self-consumption | Canonical. |
| API | `injectedSurplusKwh` | Injected surplus | Canonical. |
| API | `allocatedCreditKwh` | Allocated generation credit | Canonical. |
| Contract | `amountKwh` (allocation) | Allocated generation credit | Contract amounts are always allocated generation credits, never certificates. |

## Legacy aliases and migration policy

Older surfaces used overlapping terms. The following aliases are **legacy** and must
not be used in new code or user-facing copy:

| Legacy alias | Canonical term | Status |
| --- | --- | --- |
| `production`, `produced` | Gross generation | Legacy label; map on read. |
| `surplus`, `exported` | Injected surplus | Legacy label; map on read. |
| `certificate`, `cert` | Allocated generation credit | **Misleading**; must be renamed. |
| `credit` (bare) | Allocated generation credit | Ambiguous; qualify as "generation credit". |
| `offset`, `Scope 2` | (none) | **Prohibited**; do not use. |

**Migration policy**

1. Canonical names are additive: introduce canonical fields/labels alongside legacy
   aliases; do not drop or rename persisted columns in place.
2. Legacy aliases are read-mapped to canonical terms at the API boundary and marked
   deprecated in code.
3. No data migration is required to adopt canonical terminology; existing values are
   preserved. Any future column rename must ship with a backfill and a deprecation
   window.
4. User-facing copy is updated to canonical terms; legacy labels are removed from UI
   strings once the mapping is verified.

## User-facing language rules

- Present BeEnergy credits as **allocated generation credits** within the cooperative.
- Never describe credits as I-REC, GOs, Scope 2 reductions, offsets, or independently
  certified environmental attributes.
- Never imply third-party verification or market tradability of credits.

## Validation

- Terminology strings should be centralized so labels can be reviewed in one place.
- Product and domain docs must agree with this glossary; discrepancies are resolved in
  favor of this document.
