import { loadConfig } from '../../src/common/config';
import { clientMessage } from '../../src/realtime/protocol';

describe('client message schema', () => {
  const id = '7f1c1e2a-9a39-4c55-8a3b-0d2d7d0d8e11';

  it('accepts subscribe, defaulting lastSeq to 0', () => {
    expect(clientMessage.parse({ type: 'subscribe', conversationId: id })).toEqual({
      type: 'subscribe',
      conversationId: id,
      lastSeq: 0,
    });
  });

  it('rejects unknown types, bad ids and negative sequence numbers', () => {
    expect(clientMessage.safeParse({ type: 'send', body: 'x' }).success).toBe(false);
    expect(clientMessage.safeParse({ type: 'subscribe', conversationId: 'x' }).success).toBe(false);
    expect(
      clientMessage.safeParse({ type: 'subscribe', conversationId: id, lastSeq: -1 }).success,
    ).toBe(false);
  });
});

describe('loadConfig', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379/0',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('applies defaults', () => {
    expect(loadConfig(base)).toMatchObject({
      PRESENCE_HEARTBEAT_SECONDS: 25,
      PRESENCE_TTL_SECONDS: 60,
      REPLAY_LIMIT: 500,
    });
  });

  it('requires the presence TTL to outlast the heartbeat', () => {
    expect(() =>
      loadConfig({ ...base, PRESENCE_HEARTBEAT_SECONDS: '30', PRESENCE_TTL_SECONDS: '20' }),
    ).toThrow(/PRESENCE_TTL_SECONDS: must be longer than PRESENCE_HEARTBEAT_SECONDS/);
  });
});
