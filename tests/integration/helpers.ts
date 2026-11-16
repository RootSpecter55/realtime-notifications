import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { getPrisma } from '../../src/common/db';
import { createRedisConnection, getRedis, getSubscriber } from '../../src/common/redis';
import { buildContainer } from '../../src/container';
import type { ServerEvent } from '../../src/realtime/protocol';
import { createServer } from '../../src/server';

export async function resetState() {
  await getPrisma().$executeRawUnsafe(
    'TRUNCATE users, conversations, participants, messages, notifications CASCADE',
  );
  await getRedis().flushdb();
}

export async function disconnectShared() {
  await getPrisma().$disconnect();
  await getRedis().quit();
  await getSubscriber().quit();
}

export type Instance = {
  http: ReturnType<typeof createServer>['server'];
  wsUrl: string;
  close: () => Promise<void>;
};

/**
 * Starts an API instance on a random port. With `ownRedis`, it gets its own Redis
 * connections, which makes it behave like a separate process for pub/sub purposes.
 */
export async function startInstance(ownRedis = false): Promise<Instance> {
  const redis = ownRedis
    ? { commands: createRedisConnection(), subscriber: createRedisConnection() }
    : undefined;
  const { server, gateway } = createServer(buildContainer(redis));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    http: server,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: async () => {
      await gateway.close();
      await new Promise((resolve) => server.close(resolve));
      if (redis) await Promise.all([redis.commands.quit(), redis.subscriber.quit()]);
    },
  };
}

export type TestUser = { id: string; token: string; auth: { Authorization: string } };

export async function registerUser(instance: Instance, name: string): Promise<TestUser> {
  const res = await request(instance.http)
    .post('/auth/register')
    .send({ email: `${name.toLowerCase()}@example.com`, name, password: 'password-123' })
    .expect(201);
  const { user, token } = res.body.data;
  return { id: user.id, token, auth: { Authorization: `Bearer ${token}` } };
}

export async function createConversation(instance: Instance, owner: TestUser, others: TestUser[]) {
  const res = await request(instance.http)
    .post('/conversations')
    .set(owner.auth)
    .send({ participantIds: others.map((u) => u.id) })
    .expect(201);
  return res.body.data.id as string;
}

export async function sendMessage(
  instance: Instance,
  user: TestUser,
  conversationId: string,
  body: string,
) {
  const res = await request(instance.http)
    .post(`/conversations/${conversationId}/messages`)
    .set(user.auth)
    .send({ body })
    .expect(201);
  return res.body.data as { id: string; seq: number };
}

/** A WebSocket client that records every event it receives. */
export class TestSocket {
  readonly events: ServerEvent[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => this.events.push(JSON.parse(data.toString()) as ServerEvent));
  }

  static open(instance: Instance, token: string): Promise<TestSocket> {
    const ws = new WebSocket(`${instance.wsUrl}?token=${encodeURIComponent(token)}`);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(new TestSocket(ws)));
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once('error', reject);
    });
  }

  send(message: object) {
    this.ws.send(JSON.stringify(message));
  }

  /** Subscribes and waits until the replay for that conversation has finished. */
  async subscribe(conversationId: string, lastSeq = 0) {
    const before = this.events.length;
    this.send({ type: 'subscribe', conversationId, lastSeq });
    await this.waitFor(
      (e) => e.type === 'replay.done' && e.conversationId === conversationId,
      before,
    );
  }

  /** Waits for the first event (at or after index `from`) matching the predicate. */
  async waitFor(predicate: (e: ServerEvent) => boolean, from = 0, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = this.events.slice(from).find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for event; received: ${JSON.stringify(this.events)}`);
  }

  /** Sequence numbers of every message.created event received, in arrival order. */
  receivedSeqs(conversationId: string): number[] {
    return this.events.flatMap((e) =>
      e.type === 'message.created' && e.message.conversationId === conversationId
        ? [e.message.seq]
        : [],
    );
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}
