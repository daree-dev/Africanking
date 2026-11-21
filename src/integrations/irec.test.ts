import { describe, it, expect } from 'vitest';
import {
  IREC_RESPONSIBILITIES,
  IREC_PROVIDER_STATUS,
  isFormalCertificateClaim,
  assertNoCrossLabeling,
  type BeEnergyGenerationCredit,
  type IrecCertificateRecord,
} from './irec';

describe('I-REC integration boundary', () => {
  it('documents separate registration, issuer, issuance, transfer, and retirement responsibilities', () => {
    expect(IREC_RESPONSIBILITIES.registration).toBeDefined();
    expect(IREC_RESPONSIBILITIES.issuer).toBeDefined();
    expect(IREC_RESPONSIBILITIES.issuance).toBeDefined();
    expect(IREC_RESPONSIBILITIES.transfer).toBeDefined();
    expect(IREC_RESPONSIBILITIES.retirement).toBeDefined();
  });

  it('keeps provider identifiers and formal certificate status separate from generation credits', () => {
    const credit: BeEnergyGenerationCredit = {
      kind: 'beenergy_generation_credit',
      id: 'credit-1',
      memberId: 'member-1',
      generationKwh: 100,
    };

    expect(credit).not.toHaveProperty('providerId');
    expect(credit).not.toHaveProperty('certificateStatus');
    expect(credit).not.toHaveProperty('irecSerial');
    expect(credit.kind).toBe('beenergy_generation_credit');
  });

  it('does not represent formal claims without an approved provider agreement and product decision', () => {
    const record: IrecCertificateRecord = {
      kind: 'irec_certificate',
      providerId: 'provider-x',
      certificateStatus: 'pending',
      providerAgreementApproved: false,
      productDecisionApproved: false,
    };

    expect(isFormalCertificateClaim(record)).toBe(false);
    expect(IREC_PROVIDER_STATUS).toContain(record.certificateStatus);
  });

  it('prevents cross-labeling generation credits as I-REC certificates', () => {
    const credit: BeEnergyGenerationCredit = {
      kind: 'beenergy_generation_credit',
      id: 'credit-2',
      memberId: 'member-2',
      generationKwh: 50,
    };

    expect(() => assertNoCrossLabeling(credit)).not.toThrow();
    expect(() =>
      assertNoCrossLabeling({
        ...credit,
        kind: 'irec_certificate',
      } as unknown as BeEnergyGenerationCredit),
    ).toThrow();
  });
});
