# Domain Glossary and Field Mapping

This document defines the canonical terminology for BeEnergy's cooperative-management product. It is the single source of truth for how generation, injection, credits, and certificates are named across the UI, API, database, contracts, and older documentation.

BeEnergy is a cooperative energy-management product. Generation credits are assigned to cooperative members. BeEnergy does **not** operate an external certificate marketplace and does **not** claim I-REC, ESG, or other independent certification.

## 1. Canonical glossary

| Term | Canonical key | Definition |
| --- | --- | --- |
| **Gross generation** | `gross_generation` | Total energy produced by a generation asset over a period, before any deduction. Measured at the asset meter. |
| **Self-consumption** | `self_consumption` | Portion of gross generation consumed on-site by the producing member/site and therefore not injected into the shared grid. |
| **Injected surplus** | `injected_surplus` | Portion of gross generation delivered into the cooperative grid: `gross_generation - self_consumption`. This is physical energy, not a credit. |
| **Allocated generation credit** | `allocated_generation_credit` | A cooperative-internal accounting unit assigned to a member, representing a share of injected surplus. It is an internal allocation, not a tradable certificate and not an independently certified attribute. |
| **Formal environmental certificate** | `environmental_certificate` | An externally issued, independently certified instrument (e.g. I-REC, Guarantee of Origin). BeEnergy does **not** issue these; the term exists only to distinguish external instruments from internal credits. |

### Relationship between terms

```
gross_generation
  ├── self_consumption          (consumed on-site, not shared)
  └── injected_surplus          (delivered to cooperative grid)
        └── allocated_generation_credit  (member's internal share)

external: environmental_certificate  (NOT issued by BeEnergy)
```

## 2. Field mapping

Each persisted field, API field, and contract amount maps to exactly one glossary term.

### API fields

| API field | Glossary term | Notes |
| --- | --- | --- |
| `grossGenerationKwh` | gross generation | kWh, per period |
| `selfConsumptionKwh` | self-consumption | kWh, per period |
| `injectedSurplusKwh` | injected surplus | kWh, per period |
| `allocatedCreditKwh` | allocated generation credit | kWh-equivalent internal allocation |
| `memberCreditBalance` | allocated generation credit | running balance of allocations |

### Database columns

| Column | Glossary term | Notes |
| --- | --- | --- |
| `generation.gross_kwh` | gross generation | |
| `generation.self_consumption_kwh` | self-consumption | |
| `generation.injected_kwh` | injected surplus | |
| `credit_ledger.amount_kwh` | allocated generation credit | ledger entry amount |
| `credit_ledger.balance_kwh` | allocated generation credit | running balance |

### Contract amounts

| Contract field | Glossary term | Notes |
| --- | --- | --- |
| `contractedGenerationKwh` | gross generation | contracted gross volume |
| `contractedInjectionKwh` | injected surplus | contracted injection volume |
| `contractedCreditKwh` | allocated generation credit | contracted internal allocation |

## 3. Legacy aliases and migration policy

Older documentation and some API responses use overlapping terms. The following aliases are **legacy** and must not be used in new code, UI copy, or docs.

| Legacy alias | Canonical term | Status |
| --- | --- | --- |
| `production`, `totalProduction` | gross generation | deprecated |
| `consumption`, `ownUse` | self-consumption | deprecated |
| `surplus`, `exported` | injected surplus | deprecated |
| `credit`, `token`, `certificate` (when referring to member allocations) | allocated generation credit | deprecated — misleading |
| `irec`, `rec`, `scope2` (when referring to BeEnergy credits) | (none — must be removed) | forbidden |

### Migration policy

1. **Additive first.** Introduce canonical fields/columns alongside legacy ones; never rename in place without a compatibility window.
2. **Read both, write canonical.** During the window, readers accept legacy aliases; writers emit only canonical names.
3. **No data loss.** Legacy columns are retained until backfill is verified; renames use a copy-then-verify-then-drop sequence.
4. **Deprecation notice.** Legacy aliases are documented here and flagged in API responses (e.g. `deprecated: true`) before removal.
5. **Removal.** Legacy aliases are removed only after all consumers migrate and a release notes entry is published.

## 4. User-facing language rules

- BeEnergy credits are **allocated generation credits** assigned to cooperative members.
- Never present BeEnergy credits as I-REC, RECs, Guarantees of Origin, Scope 2 claims, or independently certified environmental attributes.
- Never use the word "certificate" for a member credit in UI copy; reserve it for externally issued instruments, which BeEnergy does not provide.
- Prefer plain labels: "Your generation credit", "Injected surplus", "Self-consumed".

## 5. Validation

- UI strings for these terms are centralized in the product string catalog; terminology tests assert that forbidden terms (`I-REC`, `Scope 2`, `certified`) do not appear in credit-related labels.
- This mapping is reviewed whenever an API field, database column, or contract amount is added or renamed.
