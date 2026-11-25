# Product claims review checklist

This checklist applies to any change that adds or modifies user-visible copy on the landing page, dashboard, export outputs, or integration documentation. Its purpose is to prevent generation credits from being misrepresented as commercial meter evidence, formal environmental certificates, or monetary credits.

**Trigger:** apply this checklist before merging any PR that touches:
- `apps/web/app/page.tsx` (landing page)
- `apps/web/lib/i18n-context.tsx` (all UI strings)
- `apps/web/app/certificates/` (certificate views)
- `apps/web/app/dashboard/` (dashboard copy)
- Any export template or PDF/CSV generation
- Any integration documentation that describes what the platform produces

Legal or commercial claims (statements about regulatory recognition, ESG compliance, or financial value) require review by the domain owner before merging. See `docs/domain-model.md` for the authoritative domain reference.

---

## 1. Measurement authority

- [ ] Does the copy imply that readings submitted through the platform have the same legal weight as a utility bidirectional meter reading?
  - **If yes:** revise. The platform records operational data from inverters and SCADA systems. Under Argentine law (Ley 27.424, Art. 12), only the bidirectional meter installed by the distribution company is the instrument of commercial measurement. Platform readings are operational evidence, not commercial measurement.
- [ ] Does the copy use the phrase "medición oficial" or "official meter reading"?
  - **If yes:** remove or qualify. Use "lectura registrada en la plataforma" / "reading registered on the platform" instead.

---

## 2. Verification state

- [ ] Does the copy describe generation credits as "verified" without specifying what was verified and by whom?
  - **If yes:** be precise. Cooperative admins approve readings before credits are issued. That is internal cooperative approval, not independent third-party verification. Use "aprobado por la cooperativa" / "approved by the cooperative" rather than "verificado" / "verified" alone.
- [ ] Does the copy imply that the blockchain record constitutes independent verification of the energy generation?
  - **If yes:** revise. The blockchain records what the platform submitted. It provides tamper-evidence for the platform's own records, not independent meter verification.

---

## 3. Allocation basis

- [ ] Does the copy describe what generation credits represent?
  - Credits represent an internal cooperative record of a member's share of registered generation for a period. They are not a claim against the electricity grid, a utility account credit, or a transferable environmental attribute.
- [ ] Does the copy imply credits can be traded, sold, or redeemed externally?
  - **If yes:** remove. The current product direction is cooperative-internal management. Credits are assigned to members; there is no external marketplace.
  - Note: some strings in `i18n-context.tsx` still reference "selling to ESG companies" (e.g. `landing.step4.desc`, `dashboard.soldTooltipGlobal`). These are marked for update in the pivot cleanup — do not add new copy in this direction.

---

## 4. Chain evidence

- [ ] Does the copy describe what on-chain records prove?
  - On-chain records prove: a transaction occurred, at a specific time, with specific parameters, submitted by the platform's minter account. They do not independently prove that the underlying meter reading is accurate.
- [ ] Does the copy use "certificado en blockchain" / "certified on blockchain" in a way that could be read as formal certification?
  - **Acceptable:** "registrado en blockchain" / "recorded on blockchain" or "proto-certificado" (platform-defined term).
  - **Requires clarification if used as a standalone claim:** "certificado" without qualification. Add a footnote or tooltip clarifying that this is the platform's internal record, not an I-REC or ESG certificate.

---

## 5. Claim limitations

- [ ] Does the copy, directly or by implication, claim that generation credits are I-REC certificates, I-TRACK(E) certificates, or any other nationally or internationally recognised environmental certificate?
  - **If yes:** remove immediately. I-REC / I-TRACK(E) certificates are issued exclusively by IRAM in Argentina. Each represents 1 MWh. Africanking generation credits are not I-RECs. See `docs/domain-model.md` §0.
- [ ] Does the copy claim Scope 2 or carbon offset eligibility for generation credits?
  - **If yes:** remove. Scope 2 market claims require recognised certificates (I-REC, TIGR, or equivalent). Generation credits in this platform are not recognised certificates.
- [ ] Does the copy present CO₂ avoided figures as independently audited?
  - CO₂ avoided estimates in the platform are calculated at 0.4 kg CO₂ per kWh renewable (a reasonable average estimate, not an audited figure). Copy should say "estimated" / "estimado" and not imply audit or verification.
- [ ] Does the copy present the platform's data as a substitute for utility invoices, regulatory filings, or tax documents?
  - **If yes:** remove. Platform data supports cooperative management and internal tracking; it is not a substitute for official documents.

---

## 6. Terminology consistency

Use these terms consistently. Do not introduce synonyms that blur the distinctions.

| Use this | Instead of |
|----------|-----------|
| Crédito de generación / generation credit | Certificate, certificado ESG, carbon credit |
| Proto-certificado (when referring specifically to the on-chain token) | I-REC, certificado oficial |
| Lectura registrada / registered reading | Medición oficial, official measurement |
| Aprobado por la cooperativa / approved by the cooperative | Verificado de forma independiente, independently verified |
| Registrado en blockchain / recorded on blockchain | Certificado en blockchain (without qualification) |
| Estimación de CO₂ evitado / estimated CO₂ avoided | CO₂ verificado, audited CO₂ |

---

## Applying this checklist to current copy

The following known gaps were identified when this checklist was first applied. Each item is a tracked task, not a blocker for unrelated PRs.

| Location | Gap | Status |
|----------|-----|--------|
| `landing.step4.desc` (es + en) | References "selling to ESG companies" — inconsistent with cooperative-internal direction | Pending update |
| `dashboard.soldTooltipGlobal` (es + en) | References "ESG companies or funds" as buyers — inconsistent with pivot | Pending update |
| `dashboard.forSaleTooltip` (es + en) | References "companies or funds looking to offset their carbon footprint" | Pending update |
| `landing.hero.subtitle` (es) | "certificar" implies formal certification | Pending clarification |
| README.md | Pivot warning present but old flow description still below it | In progress |
| Credit detail view | CO₂ avoided figure lacks "estimated" qualifier in the tooltip | Pending |

New PRs must not introduce copy in the same direction as the gaps above. Fix the existing gaps opportunistically when touching those files.

---

## Who approves

| Copy type | Reviewer |
|-----------|---------|
| UI labels and tooltips | Any contributor; core team reviews terminology |
| Dashboard and certificate copy | Core team |
| Landing page copy | Core team |
| Any claim about regulatory status, ESG eligibility, or formal certification | Domain owner (required, not optional) |
