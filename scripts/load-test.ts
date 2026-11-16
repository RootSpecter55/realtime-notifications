/**
 * Load test: fan-out latency from a REST send to every subscribed WebSocket.
 *
 *   npm run loadtest                                  # 50 clients, 100 messages
 *   CLIENTS=200 MESSAGES=500 API_URL=http://host:3000 npm run loadtest
 *
 * 1. Registers one sender and CLIENTS receivers, all in one conversation.
 * 2. Opens one WebSocket per receiver and subscribes it.
 * 3. Sends MESSAGES messages over REST, one after another.
 * 4. Records, for every (message, receiver) pair, the time from just before the POST until the
 *    socket received it, then prints delivery count and latency percentiles.
 *
 * Everything runs in this one process, so the numbers include client-side overhead and depend
 * on the machine; they describe this setup, not a production deployment.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const CLIENTS = Number(process.env.CLIENTS ?? 50);
const MESSAGES = Number(process.env.MESSAGES ?? 100);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 30_000);
const MAX_PARTICIPANTS_PER_CREATE = 50;

type User = { id: string; token: string };

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
  });
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return ((await res.json()) as { data: T }).data;
}

async function register(label: string): Promise<User> {
  const { user, token } = await api<{ user: { id: string }; token: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `${label}-${randomUUID()}@loadtest.local`,
      name: label,
      password: 'load-test-password',
    }),
  });
  return { id: user.id, token };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function main() {
  console.log(`Target ${API_URL}: ${CLIENTS} clients, ${MESSAGES} messages`);

  const sender = await register('sender');
  const receivers: User[] = [];
  for (let i = 0; i < CLIENTS; i++) receivers.push(await register(`receiver-${i}`));

  const firstBatch = receivers.slice(0, MAX_PARTICIPANTS_PER_CREATE);
  const conversation = await api<{ id: string }>('/conversations', {
    method: 'POST',
    token: sender.token,
    body: JSON.stringify({ title: 'load test', participantIds: firstBatch.map((r) => r.id) }),
  });
  for (const receiver of receivers.slice(MAX_PARTICIPANTS_PER_CREATE)) {
    await api(`/conversations/${conversation.id}/participants`, {
      method: 'POST',
      token: sender.token,
      body: JSON.stringify({ userId: receiver.id }),
    });
  }

  const sentAt = new Map<number, number>(); // message index -> time just before its POST
  const latencies: number[] = [];
  let delivered = 0;
  const expected = CLIENTS * MESSAGES;
  let resolveAll!: () => void;
  const allDelivered = new Promise<void>((resolve) => (resolveAll = resolve));

  const sockets = await Promise.all(
    receivers.map(
      (receiver) =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/ws?token=${receiver.token}`);
          ws.on('error', reject);
          ws.on('open', () =>
            ws.send(JSON.stringify({ type: 'subscribe', conversationId: conversation.id })),
          );
          ws.on('message', (raw) => {
            const event = JSON.parse(raw.toString());
            if (event.type === 'replay.done') resolve(ws);
            if (event.type !== 'message.created') return;
            const index = Number(String(event.message.body).replace('load-', ''));
            const start = sentAt.get(index);
            if (start !== undefined) latencies.push(performance.now() - start);
            if (++delivered === expected) resolveAll();
          });
        }),
    ),
  );
  console.log(`${sockets.length} sockets connected and subscribed`);

  const sendStart = performance.now();
  for (let i = 0; i < MESSAGES; i++) {
    sentAt.set(i, performance.now());
    await api(`/conversations/${conversation.id}/messages`, {
      method: 'POST',
      token: sender.token,
      body: JSON.stringify({ body: `load-${i}` }),
    });
  }
  const sendSeconds = (performance.now() - sendStart) / 1000;

  await Promise.race([allDelivered, new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS))]);
  for (const ws of sockets) ws.close();

  latencies.sort((a, b) => a - b);
  const fmt = (ms: number) => `${ms.toFixed(1)} ms`;
  console.log('');
  console.log(`Delivered        ${delivered} / ${expected}`);
  console.log(
    `Send rate        ${(MESSAGES / sendSeconds).toFixed(1)} messages/s (sequential REST)`,
  );
  console.log(`Latency p50      ${fmt(percentile(latencies, 50))}`);
  console.log(`Latency p95      ${fmt(percentile(latencies, 95))}`);
  console.log(`Latency p99      ${fmt(percentile(latencies, 99))}`);
  console.log(`Latency max      ${fmt(latencies.at(-1) ?? NaN)}`);
  process.exit(delivered === expected ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
