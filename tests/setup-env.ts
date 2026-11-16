// Test environment: runs before every test file, before any app module reads config.
// Uses a separate database and Redis db index so tests never touch local development data.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://app:app@localhost:5442/realtime_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6381/1',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
  JWT_EXPIRES_IN: '1h',
  PRESENCE_HEARTBEAT_SECONDS: '25',
  PRESENCE_TTL_SECONDS: '60',
  REPLAY_LIMIT: '500',
});
