import { z } from "zod";

export const healthResponseSchema = z.object({
    environment: z.string().min(1),
    requestId: z.string().min(1),
    service: z.literal("smartservice-api"),
    status: z.literal("ok"),
    timestamp: z.iso.datetime(),
    version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
