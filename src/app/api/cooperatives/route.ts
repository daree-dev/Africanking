import { NextResponse } from "next/server";

/**
 * Versioned set of supported cooperative operating models.
 *
 * Generation credits are assigned to cooperative members. This is NOT an
 * external certificate marketplace and does NOT claim I-REC/ESG certification.
 * Regulatory behavior that is not implemented is labeled explicitly as
 * unsupported rather than assumed.
 */
export const OPERATING_MODEL_VERSION = "2024-01";

export type OperatingModelId =
  | "individual"
  | "community"
  | "virtual-community";

export interface OperatingModelDefinition {
  id: OperatingModelId;
  label: string;
  description: string;
  /** Metering inputs that must be present for a valid configuration. */
  requiredMetering: string[];
  /** Allocation inputs that must be present for a valid configuration. */
  requiredAllocation: string[];
  /** Regulatory behaviors that are explicitly NOT supported. */
  unsupportedRegulatory: string[];
}

export const OPERATING_MODELS: Record<OperatingModelId, OperatingModelDefinition> = {
  individual: {
    id: "individual",
    label: "Individual",
    description:
      "Generation is measured and credited to a single member's own metered production.",
    requiredMetering: ["memberMeterId"],
    requiredAllocation: ["memberId"],
    unsupportedRegulatory: [
      "I-REC issuance",
      "ESG certification",
      "external certificate trading",
    ],
  },
  community: {
    id: "community",
    label: "Community",
    description:
      "Shared generation is measured at community meters and allocated across cooperative members.",
    requiredMetering: ["communityMeterId"],
    requiredAllocation: ["allocationMethod", "memberShares"],
    unsupportedRegulatory: [
      "I-REC issuance",
      "ESG certification",
      "external certificate trading",
    ],
  },
  "virtual-community": {
    id: "virtual-community",
    label: "Virtual community",
    description:
      "Generation from distributed member meters is aggregated and allocated across cooperative members.",
    requiredMetering: ["memberMeterIds"],
    requiredAllocation: ["allocationMethod", "memberShares"],
    unsupportedRegulatory: [
      "I-REC issuance",
      "ESG certification",
      "external certificate trading",
      "cross-jurisdiction settlement",
    ],
  },
};

export interface OperatingModelConfig {
  model: OperatingModelId;
  version: string;
  metering: Record<string, unknown>;
  allocation: Record<string, unknown>;
}

export interface Cooperative {
  id: string;
  name: string;
  operatingModel: OperatingModelConfig;
}

/** In-memory persistence placeholder; replace with the cooperative store. */
const cooperatives: Cooperative[] = [];

export type ValidationResult =
  | { ok: true; config: OperatingModelConfig }
  | { ok: false; errors: string[] };

export function validateOperatingModelConfig(
  input: unknown,
): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["operatingModel must be an object"] };
  }

  const raw = input as Record<string, unknown>;
  const model = raw.model;

  if (typeof model !== "string" || !(model in OPERATING_MODELS)) {
    return {
      ok: false,
      errors: [
        `model must be one of: ${Object.keys(OPERATING_MODELS).join(", ")}`,
      ],
    };
  }

  const definition = OPERATING_MODELS[model as OperatingModelId];
  const metering =
    raw.metering && typeof raw.metering === "object"
      ? (raw.metering as Record<string, unknown>)
      : {};
  const allocation =
    raw.allocation && typeof raw.allocation === "object"
      ? (raw.allocation as Record<string, unknown>)
      : {};

  for (const key of definition.requiredMetering) {
    if (metering[key] === undefined || metering[key] === null) {
      errors.push(`metering.${key} is required for model "${model}"`);
    }
  }

  for (const key of definition.requiredAllocation) {
    if (allocation[key] === undefined || allocation[key] === null) {
      errors.push(`allocation.${key} is required for model "${model}"`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: {
      model: model as OperatingModelId,
      version: OPERATING_MODEL_VERSION,
      metering,
      allocation,
    },
  };
}

export async function GET() {
  return NextResponse.json({
    version: OPERATING_MODEL_VERSION,
    models: Object.values(OPERATING_MODELS),
    cooperatives,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const name = payload.name;

  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 },
    );
  }

  const result = validateOperatingModelConfig(payload.operatingModel);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Invalid operating model configuration", details: result.errors },
      { status: 422 },
    );
  }

  const cooperative: Cooperative = {
    id: crypto.randomUUID(),
    name: name.trim(),
    operatingModel: result.config,
  };

  cooperatives.push(cooperative);

  return NextResponse.json(cooperative, { status: 201 });
}
