/**
 * Audit-safe redaction test utility.
 *
 * Scans captured logs and responses for secret fixture values so tests can
 * assert that JWTs, wallet signatures, email tokens, service keys, and raw
 * meter payloads never leak through logging or error boundaries.
 */

/** Canonical set of sensitive field names that must be redacted. */
export const SENSITIVE_FIELDS = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "jwt",
  "signature",
  "walletsignature",
  "signedmessage",
  "emailtoken",
  "verificationtoken",
  "resettoken",
  "apikey",
  "api_key",
  "servicekey",
  "service_key",
  "secret",
  "clientsecret",
  "privatekey",
  "meterpayload",
  "meterreading",
  "meterid",
  "serialnumber",
] as const;

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

const SENSITIVE_SET = new Set<string>(SENSITIVE_FIELDS);

/** Returns true when a field name is considered sensitive. */
export function isSensitiveField(field: string): boolean {
  return SENSITIVE_SET.has(field.toLowerCase().replace(/[-\s]/g, ""));
}

export interface SecretFixture {
  /** Human-readable label used in failure messages. */
  label: string;
  /** The raw secret value that must never appear in logs or responses. */
  value: string;
}

export interface ScanFinding {
  label: string;
  /** Where the leak was observed (e.g. "logs[0]", "response.body"). */
  location: string;
}

export interface ScanInput {
  /** Captured log lines or structured log objects. */
  logs?: unknown[];
  /** Captured HTTP responses (body may be string or object). */
  responses?: unknown[];
  /** Secret fixture values that must not appear anywhere. */
  secrets: SecretFixture[];
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/**
 * Scans captured logs and responses for any secret fixture value.
 * Returns every finding; an empty array means no leaks were detected.
 */
export function scanForSecrets(input: ScanInput): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const { logs = [], responses = [], secrets } = input;

  const targets: Array<{ location: string; text: string }> = [
    ...logs.map((entry, i) => ({ location: `logs[${i}]`, text: stringify(entry) })),
    ...responses.map((entry, i) => ({
      location: `responses[${i}]`,
      text: stringify(entry),
    })),
  ];

  for (const secret of secrets) {
    if (!secret.value) continue;
    for (const target of targets) {
      if (target.text.includes(secret.value)) {
        findings.push({ label: secret.label, location: target.location });
      }
    }
  }

  return findings;
}

/**
 * Asserts that no secret fixture value appears in captured logs or responses.
 * Throws an Error listing every leak when any are found.
 */
export function assertNoSecretLeaks(input: ScanInput): void {
  const findings = scanForSecrets(input);
  if (findings.length === 0) return;

  const detail = findings
    .map((f) => `  - ${f.label} leaked at ${f.location}`)
    .join("\n");
  throw new Error(`Secret leak detected in captured output:\n${detail}`);
}
