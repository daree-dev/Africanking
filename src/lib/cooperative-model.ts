/**
 * Cooperative operating-model configuration.
 *
 * Generation credits are assigned to cooperative members. This module does
 * NOT model an external certificate marketplace and does NOT assert I-REC/ESG
 * certification. Unsupported regulatory behavior is labelled explicitly.
 */

export const OPERATING_MODEL_SCHEMA_VERSION = 1 as const;

export type OperatingModelId =
  | "individual"
  | "community"
  | "virtual-community";

export type MeteringInput =
  | "member_generation_meter"
  | "shared_generation_meter"
  | "aggregated_member_meters";

export type AllocationInput =
  | "per_member_allocation"
  | "pooled_allocation"
  | "virtual_pool_allocation";

export interface OperatingModelDefinition {
  readonly id: OperatingModelId;
  readonly label: string;
  readonly description: string;
  readonly requiredMetering: readonly MeteringInput[];
  readonly requiredAllocation: readonly AllocationInput[];
  /** Regulatory behaviors this model does NOT support. */
  readonly unsupportedRegulatory: readonly string[];
}

export const OPERATING_MODELS: Readonly<
  Record<OperatingModelId, OperatingModelDefinition>
> = {
  individual: {
    id: "individual",
    label: "Individual",
    description:
      "Generation is measured per member and credits are assigned to that member.",
    requiredMetering: ["member_generation_meter"],
    requiredAllocation: ["per_member_allocation"],
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
      "Generation is measured on a shared meter and pooled across cooperative members.",
    requiredMetering: ["shared_generation_meter"],
    requiredAllocation: ["pooled_allocation"],
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
      "Generation is aggregated from member meters into a virtual pool and allocated to members.",
    requiredMetering: ["aggregated_member_meters"],
    requiredAllocation: ["virtual_pool_allocation"],
    unsupportedRegulatory: [
      "I-REC issuance",
      "ESG certification",
      "external certificate trading",
      "jurisdiction-specific virtual net metering rules",
    ],
  },
};

export const SUPPORTED_OPERATING_MODELS: readonly OperatingModelId[] =
  Object.keys(OPERATING_MODELS) as OperatingModelId[];

export interface OperatingModelConfig {
  readonly schemaVersion: typeof OPERATING_MODEL_SCHEMA_VERSION;
  readonly model: OperatingModelId;
  readonly metering: readonly MeteringInput[];
  readonly allocation: readonly AllocationInput[];
}

export interface OperatingModelValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly unsupportedRegulatory: readonly string[];
}

export function isOperatingModelId(value: unknown): value is OperatingModelId {
  return (
    typeof value === "string" &&
    (SUPPORTED_OPERATING_MODELS as readonly string[]).includes(value)
  );
}

/**
 * Validate a cooperative operating-model configuration against the versioned
 * definition. Rejects configurations whose required metering or allocation
 * inputs are absent, and surfaces unsupported regulatory behavior explicitly.
 */
export function validateOperatingModelConfig(
  config: Partial<OperatingModelConfig> | null | undefined,
): OperatingModelValidationResult {
  const errors: string[] = [];

  if (!config) {
    return {
      valid: false,
      errors: ["Operating-model configuration is required."],
      unsupportedRegulatory: [],
    };
  }

  if (config.schemaVersion !== OPERATING_MODEL_SCHEMA_VERSION) {
    errors.push(
      `Unsupported operating-model schema version: ${String(
        config.schemaVersion,
      )}. Expected ${OPERATING_MODEL_SCHEMA_VERSION}.`,
    );
  }

  if (!isOperatingModelId(config.model)) {
    return {
      valid: false,
      errors: [
        ...errors,
        `Unsupported operating model: ${String(config.model)}.`,
      ],
      unsupportedRegulatory: [],
    };
  }

  const definition = OPERATING_MODELS[config.model];
  const metering = config.metering ?? [];
  const allocation = config.allocation ?? [];

  for (const required of definition.requiredMetering) {
    if (!metering.includes(required)) {
      errors.push(
        `Operating model "${definition.id}" requires metering input "${required}".`,
      );
    }
  }

  for (const required of definition.requiredAllocation) {
    if (!allocation.includes(required)) {
      errors.push(
        `Operating model "${definition.id}" requires allocation input "${required}".`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    unsupportedRegulatory: definition.unsupportedRegulatory,
  };
}

/**
 * Build a persisted operating-model configuration for a cooperative.
 * Throws when the configuration is invalid so callers cannot persist an
 * incomplete model selection.
 */
export function createOperatingModelConfig(
  input: Partial<OperatingModelConfig>,
): OperatingModelConfig {
  const result = validateOperatingModelConfig(input);
  if (!result.valid) {
    throw new Error(
      `Invalid operating-model configuration: ${result.errors.join(" ")}`,
    );
  }
  return {
    schemaVersion: OPERATING_MODEL_SCHEMA_VERSION,
    model: input.model as OperatingModelId,
    metering: [...(input.metering ?? [])],
    allocation: [...(input.allocation ?? [])],
  };
}
