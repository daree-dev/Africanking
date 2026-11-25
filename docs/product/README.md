# BeEnergy — Product & Domain Documentation

This document is the canonical reference for BeEnergy's cooperative energy product.
BeEnergy is a **cooperative energy management** product: generation credits are
assigned to cooperative members. It is **not** an external certificate marketplace
and makes **no** claim of I-REC, ESG, or other independent certification.

---

## 1. Domain glossary

These are the canonical terms. Use them consistently in UI copy, API contracts,
database columns, and documentation.

| Term | Definition |
| --- | --- |
| **Gross generation** | Total electrical energy produced by a generation asset over a period, measured at the asset's meter, before any deduction. |
| **Self-consumption** | The portion of gross generation consumed on-site by the producing member/site and therefore never injected into the cooperative grid. |
| **Injected surplus** | Gross generation minus self-consumption: the energy actually delivered into the cooperative distribution network and available for allocation. |
| **Allocated generation credit** | A cooperative-internal accounting unit representing a member's share of injected surplus, assigned by the cooperative's allocation rules. It is an internal bookkeeping credit, **not** a tradable certificate and **not** an independently verified environmental attribute. |
| **Formal environmental certificate** | An externally issued, independently verified instrument (e.g. I-REC, Guarantee of Origin). BeEnergy does **not** issue, broker, or represent these. Any reference to certificates is out of scope for the current product. |

### Relationship between terms

```
gross_generation
  − self_consumption
  = injected_surplus
        ↓ (cooperative allocation rules)
  allocated_generation_credit  (per member, internal accounting only)
```

A **formal environmental certificate** is a separate, external concept and is not
derived from the above chain within BeEnergy.

---

## 2. Field mapping

Every persisted field, API field, and contract amount maps to exactly one glossary
term. Where a legacy name exists, it is listed as an alias with its migration policy.

### API fields

| API field | Glossary term | Notes |
| --- | --- | --- |
| `grossGenerationKwh` | Gross generation | Canonical. |
| `selfConsumptionKwh` | Self-consumption | Canonical. |
| `injectedSurplusKwh` | Injected surplus | Canonical. |
| `allocatedCreditKwh` | Allocated generation credit | Canonical. |
| `creditKwh` | Allocated generation credit | **Legacy alias.** Deprecated; see migration policy. |
| `certificateKwh` | — | **Legacy alias, do not use.** Previously conflated credits with certificates. Must not be reintroduced. |

### Database columns

| Column | Glossary term | Notes |
| --- | --- | --- |
| `gross_generation_kwh` | Gross generation | Canonical. |
| `self_consumption_kwh` | Self-consumption | Canonical. |
| `injected_surplus_kwh` | Injected surplus | Canonical. |
| `allocated_credit_kwh` | Allocated generation credit | Canonical. |
| `credit_kwh` | Allocated generation credit | **Legacy alias.** Retained for existing data; see migration policy. |
| `certificate_kwh` | — | **Legacy alias, do not use.** Retained read-only for historical rows only. |

### Contract amounts

| Contract amount | Glossary term | Notes |
| --- | --- | --- |
| `allocatedAmountKwh` | Allocated generation credit | Canonical amount assigned to a member under a contract. |
| `surplusAmountKwh` | Injected surplus | Canonical amount of surplus covered by the contract. |
| `creditAmountKwh` | Allocated generation credit | **Legacy alias.** Deprecated; see migration policy. |

---

## 3. Legacy aliases & migration policy

- **Canonical names win.** New code, new API versions, and new UI copy must use the
  canonical terms above.
- **Legacy aliases are read-only.** `creditKwh` / `credit_kwh` / `creditAmountKwh`
  remain readable for existing data and clients but must not be written by new code.
- **`certificateKwh` / `certificate_kwh` are frozen.** They are never written again and
  must not be surfaced in user-facing language. Historical rows are preserved as-is.
- **No destructive migration.** Existing data is preserved. Renames are additive:
  introduce the canonical field/column, backfill from the legacy alias, then deprecate
  the alias in a later release. Rollout is staged and reversible.
- **Rollout requirements.** (1) Add canonical fields/columns. (2) Backfill from legacy
  aliases. (3) Update API and UI to canonical terms. (4) Mark aliases deprecated in
  contracts. (5) Remove aliases only after a deprecation window and data verification.

---

## 4. User-facing language rules

BeEnergy credits are cooperative-internal accounting units. User-facing copy must:

- Refer to **"generation credits"** or **"allocated generation credits"**, never
  "certificates".
- **Never** present credits as I-REC, Guarantee of Origin, Scope 2 claims, or any
  independently certified environmental attribute.
- **Never** imply external tradability or third-party verification.
- Describe credits as a member's share of the cooperative's injected surplus.

### Approved vs. prohibited phrasing

| Approved | Prohibited |
| --- | --- |
| "Your allocated generation credit this month" | "Your renewable energy certificate" |
| "Share of injected surplus" | "Certified green energy" / "I-REC backed" |
| "Cooperative generation credit" | "Scope 2 offset" / "ESG-certified" |

---

## 5. Validation

- Terminology strings should be centralized (single source for labels) so tests can
  assert that prohibited terms ("I-REC", "certificate", "Scope 2") never appear in
  user-facing credit labels.
- Product and domain docs must agree with this glossary; changes to terminology require
  updating this document and the field mapping together.
