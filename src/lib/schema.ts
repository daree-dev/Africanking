import { z } from "zod";

export const OPERATING_MODEL_VERSION = "2024-01";

export const operatingModelIdSchema = z.enum([
  "individual",
  "community",
  "virtual_community",
]);

export type OperatingModelId = z.infer<typeof operatingModelIdSchema>;

export const meteringInputSchema = z.object({
  meterId: z.string().min(1),
  unit: z.enum(["kWh", "MWh"]),
  intervalMinutes: z.number().int().positive(),
});

export const allocationInputSchema = z.object({
  method: z.enum(["equal", "proportional", "custom"]),
  memberIds: z.array(z.string().min(1)).min(1),
});

export const operatingModelConfigSchema = z.discriminatedUnion("model", [
  z.object({
    model: z.literal("individual"),
    version: z.literal(OPERATING_MODEL_VERSION),
    metering: meteringInputSchema,
    allocation: allocationInputSchema,
  }),
  z.object({
    model: z.literal("community"),
    version: z.literal(OPERATING_MODEL_VERSION),
    metering: meteringInputSchema,
    allocation: allocationInputSchema,
  }),
  z.object({
    model: z.literal("virtual_community"),
    version: z.literal(OPERATING_MODEL_VERSION),
    metering: meteringInputSchema,
    allocation: allocationInputSchema,
  }),
]);

export type OperatingModelConfig = z.infer<typeof operatingModelConfigSchema>;

export const cooperativeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  operatingModel: operatingModelConfigSchema,
});

export type Cooperative = z.infer<typeof cooperativeSchema>;

export function parseOperatingModelConfig(input: unknown): OperatingModelConfig {
  return operatingModelConfigSchema.parse(input);
}
