import { z } from "zod"

// Stellar address: starts with G, 56 chars total
const stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address")

const uuid = z.string().uuid()

// Auth
export const challengeSchema = z.object({
  stellar_address: stellarAddress,
})

export const verifySchema = z.object({
  stellar_address: stellarAddress,
  challenge: z.string().regex(/^[0-9a-f]{64}$/, "Invalid challenge format"),
  signature: z.string().min(1, "Signature required"),
})

// Cooperatives
export const createCooperativeSchema = z.object({
  name: z.string().min(1).max(200),
  technology: z.enum(["solar", "wind", "hydro", "mixed"]),
  admin_stellar_address: stellarAddress,
  country: z.string().max(100).nullish(),
  province: z.string().max(100).nullish(),
  city: z.string().max(100).nullish(),
})

// Members
export const createMemberSchema = z.object({
  stellar_address: stellarAddress,
  cooperative_id: uuid,
  name: z.string().max(200).nullish(),
  panel_capacity_kw: z.number().positive().nullish(),
  role: z.enum(["prosumer", "copropietario", "mixed"]).default("prosumer"),
})

// Legacy prosumer (members/route.ts)
export const createProsumerSchema = z.object({
  stellar_address: stellarAddress,
  name: z.string().max(200).nullish(),
  panel_capacity_kw: z.number().positive().nullish(),
  cooperative_id: uuid.nullish(),
  role: z.enum(["prosumer", "copropietario", "mixed"]).default("prosumer"),
})

// Meters
export const createMeterSchema = z.object({
  cooperative_id: uuid,
  member_stellar_address: stellarAddress,
  device_type: z.enum(["inverter", "bidirectional_meter", "smart_meter"]),
  technology: z.enum(["solar", "wind", "hydro", "biomass"]),
  capacity_kw: z.number().positive(),
  manufacturer: z.string().max(200).nullish(),
  model: z.string().max(200).nullish(),
  serial_number: z.string().max(200).nullish(),
  location_lat: z.number().min(-90).max(90).nullish(),
  location_lng: z.number().min(-180).max(180).nullish(),
  installed_at: z.string().nullish(),
})

// Readings
export const createReadingSchema = z.object({
  stellar_address: stellarAddress.optional(),
  meter_id: uuid.optional(),
  kwh_injected: z.number().positive().lt(1000).optional(),
  kwh_generated: z.number().positive().lt(1000).optional(),
  kwh_consumed: z.number().min(0).optional(),
  kwh_self_consumed: z.number().min(0).optional(),
  reading_date: z.string().optional(),
  reading_timestamp: z.string().optional(),
  power_watts: z.number().min(0).optional(),
  interval_minutes: z.number().int().positive().default(15),
  cooperative_id: uuid.optional(),
}).refine(
  (d) => d.stellar_address || d.meter_id,
  { message: "stellar_address or meter_id required" }
).refine(
  (d) => d.kwh_generated != null || d.kwh_injected != null,
  { message: "kwh_injected or kwh_generated required" }
).refine(
  (d) => d.reading_date || d.reading_timestamp,
  { message: "reading_date or reading_timestamp required" }
).superRefine((d, ctx) => {
  if (d.kwh_injected == null && d.kwh_generated != null && (d.kwh_self_consumed ?? d.kwh_consumed) == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "kwh_self_consumed required when kwh_injected is missing",
    })
  }
})

// ---- Versioned meter ingestion contract (issue #11) ----------------------

/**
 * Supported ingestion schema versions.
 * - v1: original schema (meter_id + readings array)
 * - v2: adds source_event_id per reading and source_metadata envelope
 */
export const SUPPORTED_METER_INGESTION_VERSIONS = ["v1", "v2"] as const
export type MeterIngestionVersion = (typeof SUPPORTED_METER_INGESTION_VERSIONS)[number]

const meterIngestionVersion = z.enum(SUPPORTED_METER_INGESTION_VERSIONS, {
  errorMap: () => ({
    message: `Unsupported schema version. Supported versions: ${SUPPORTED_METER_INGESTION_VERSIONS.join(", ")}`,
  }),
})

/** V1 reading — original fields, backward-compatible */
const meterReadingV1 = z.object({
  kwh_injected: z.number().positive().lt(1000).optional(),
  kwh_generated: z.number().positive().lt(1000).optional(),
  reading_timestamp: z.string().optional(),
  reading_date: z.string().optional(),
  power_watts: z.number().min(0).optional(),
  interval_minutes: z.number().int().positive().optional(),
  kwh_self_consumed: z.number().min(0).optional(),
}).superRefine((d, ctx) => {
  if (d.kwh_injected == null && d.kwh_generated == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "kwh_injected or kwh_generated required" })
  }
  if (d.kwh_injected == null && d.kwh_generated != null && d.kwh_self_consumed == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "kwh_self_consumed required when kwh_injected is missing" })
  }
})

/** V2 reading — adds stable source identity for idempotency */
const meterReadingV2 = meterReadingV1.extend({
  /**
   * Stable event ID emitted by the device or HES/MDM.
   * Used as the idempotency key alongside meter_id + interval.
   * Required for v2.
   */
  source_event_id: z.string().min(1).max(200),
  /**
   * Freeform source metadata (device firmware, protocol version, etc.).
   * Stored verbatim for audit; not used in business logic.
   */
  source_metadata: z.record(z.unknown()).optional(),
})

/** V1 bulk ingestion envelope */
export const bulkMeterReadingsSchemaV1 = z.object({
  schema_version: z.literal("v1"),
  meter_id: uuid,
  readings: z.array(meterReadingV1).min(1).max(1000),
})

/** V2 bulk ingestion envelope */
export const bulkMeterReadingsSchemaV2 = z.object({
  schema_version: z.literal("v2"),
  /**
   * Stable meter identity — preferred over meter_id for new integrations.
   * Either meter_id or (serial_number + cooperative_id) must be supplied.
   */
  meter_id: uuid.optional(),
  serial_number: z.string().max(200).optional(),
  cooperative_id: uuid.optional(),
  readings: z.array(meterReadingV2).min(1).max(1000),
}).refine(
  (d) => d.meter_id || (d.serial_number && d.cooperative_id),
  { message: "meter_id or (serial_number + cooperative_id) required" }
)

/**
 * Top-level versioned ingestion schema.
 * Rejects unknown versions with a machine-readable error before parsing.
 */
export const versionedBulkMeterReadingsSchema = z
  .object({ schema_version: meterIngestionVersion })
  .passthrough()
  .superRefine((d, ctx) => {
    if (d.schema_version === "v1") {
      const r = bulkMeterReadingsSchemaV1.safeParse(d)
      if (!r.success) {
        r.error.issues.forEach((i) => ctx.addIssue(i))
      }
    } else if (d.schema_version === "v2") {
      const r = bulkMeterReadingsSchemaV2.safeParse(d)
      if (!r.success) {
        r.error.issues.forEach((i) => ctx.addIssue(i))
      }
    }
  })

// Keep legacy export for backward-compatibility with existing callers
export const bulkMeterReadingsSchema = bulkMeterReadingsSchemaV1.omit({ schema_version: true }).extend({
  schema_version: z.literal("v1").default("v1"),
  meter_id: uuid,
})

// Certificates
export const createCertificateSchema = z.object({
  cooperative_id: uuid,
  generation_period_start: z.string(),
  generation_period_end: z.string(),
  total_kwh: z.number().positive(),
  technology: z.string().min(1),
  location: z.string().max(200).nullish(),
}).refine(
  (d) => d.generation_period_start <= d.generation_period_end,
  { message: "generation_period_start must be before or equal to generation_period_end" }
)

// Mint
export const mintSchema = z.object({
  reading_id: uuid.optional(),
  certificate_id: uuid.optional(),
}).refine(
  (d) => d.reading_id || d.certificate_id,
  { message: "reading_id or certificate_id required" }
)

// Update reading
export const updateReadingSchema = z.object({
  reading_id: uuid,
  status: z.enum(["pending", "verified", "rejected"]),
})

// Retire
export const retireSchema = z.object({
  certificate_id: uuid,
  buyer_address: stellarAddress,
  buyer_name: z.string().max(200).nullish(),
  buyer_purpose: z.enum([
    "esg_reporting",
    "carbon_offset",
    "voluntary_commitment",
    "regulatory_compliance",
    "other",
  ]),
})

// ---- Settlement (issue #9) ------------------------------------------------

export const settlementStatusEnum = z.enum([
  "draft",
  "pending",
  "approved",
  "corrected",
  "closed",
])

/** Create or open a new settlement period */
export const createSettlementPeriodSchema = z.object({
  cooperative_id: uuid,
  period_start: z.string().datetime({ offset: true }).or(z.string().date()),
  period_end: z.string().datetime({ offset: true }).or(z.string().date()),
}).refine(
  (d) => d.period_start <= d.period_end,
  { message: "period_start must be before or equal to period_end" }
)

/** Transition a settlement to a new status and record the approver */
export const updateSettlementStatusSchema = z.object({
  settlement_id: uuid,
  status: settlementStatusEnum,
  /** Required when status is 'approved' or 'corrected' */
  approved_by: z.string().nullish(),
})

/** Record a correction to a member's allocation inside a settlement */
export const createSettlementAdjustmentSchema = z.object({
  settlement_id: uuid,
  member_stellar_address: stellarAddress,
  corrected_kwh: z.number().nonnegative(),
  reason: z.string().min(1).max(500),
})
