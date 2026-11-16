import { z } from 'zod';

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),

    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('1h'),

    PRESENCE_HEARTBEAT_SECONDS: z.coerce.number().int().positive().default(25),
    PRESENCE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    REPLAY_LIMIT: z.coerce.number().int().positive().max(5000).default(500),
  })
  .refine((env) => env.PRESENCE_TTL_SECONDS > env.PRESENCE_HEARTBEAT_SECONDS, {
    path: ['PRESENCE_TTL_SECONDS'],
    message: 'must be longer than PRESENCE_HEARTBEAT_SECONDS, or users flicker offline',
  });

export type Config = z.infer<typeof configSchema>;

/** Parses and validates env vars. Throws one error listing every problem, so startup fails fast. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  return result.data;
}

// Singleton: config is read once and shared, so every module sees the same validated values.
let cached: Config | undefined;
export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}
