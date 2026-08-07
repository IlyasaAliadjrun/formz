import { z } from 'zod';

export const dependencyStatusSchema = z.enum(['up', 'down']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const dependencyHealthSchema = z.object({
  status: dependencyStatusSchema,
  /** Lama pengecekan dalam milidetik. */
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export const healthResponseSchema = z.object({
  /** `ok` kalau semua dependency up, `degraded` kalau ada yang down. */
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string(),
  dependencies: z.object({
    postgres: dependencyHealthSchema,
    redis: dependencyHealthSchema,
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
