import request from 'supertest';
import { getRedis } from '../../src/common/redis';
import { PresenceStore } from '../../src/realtime/presence';
import {
  createConversation,
  disconnectShared,
  registerUser,
  resetState,
  sendMessage,
  startInstance,
  TestSocket,
  type Instance,
  type TestUser,
} from './helpers';

let api: Instance;
let alice: TestUser;
let bob: TestUser;
let conversationId: string;
const sockets: TestSocket[] = [];

async function connect(user: TestUser, instance = api) {
  const socket = await TestSocket.open(instance, user.token);
  sockets.push(socket);
  return socket;
}

beforeAll(async () => {
  api = await startInstance();
});
beforeEach(async () => {
  await resetState();
  alice = await registerUser(api, 'Alice');
  bob = await registerUser(api, 'Bob');
  conversationId = await createConversation(api, alice, [bob]);
});
afterEach(async () => {
  await Promise.all(sockets.splice(0).map((s) => s.close()));
});
afterAll(async () => {
  await api.close();
  await disconnectShared();
});

describe('WebSocket gateway', () => {
  it('rejects a connection without a valid token with HTTP 401', async () => {
    await expect(TestSocket.open(api, 'not-a-token')).rejects.toThrow('HTTP 401');
  });

  it('delivers a message sent over REST to a subscribed socket, plus a notification', async () => {
    const socket = await connect(alice);
    await socket.subscribe(conversationId);

    await sendMessage(api, bob, conversationId, 'hi Alice');

    const created = await socket.waitFor((e) => e.type === 'message.created');
    expect(created).toMatchObject({ message: { seq: 1, body: 'hi Alice', senderId: bob.id } });
    const notification = await socket.waitFor((e) => e.type === 'notification.created');
    expect(notification).toMatchObject({ notification: { type: 'NEW_MESSAGE' } });
  });

  it('delivers edits and deletions live', async () => {
    const socket = await connect(bob);
    await socket.subscribe(conversationId);
    const message = await sendMessage(api, alice, conversationId, 'first draft');

    await request(api.http)
      .patch(`/messages/${message.id}`)
      .set(alice.auth)
      .send({ body: 'final' })
      .expect(200);
    await request(api.http).delete(`/messages/${message.id}`).set(alice.auth).expect(204);

    expect(await socket.waitFor((e) => e.type === 'message.updated')).toMatchObject({
      message: { body: 'final' },
    });
    expect(await socket.waitFor((e) => e.type === 'message.deleted')).toMatchObject({
      message: { seq: 1, body: null },
    });
  });

  it('answers an invalid message with an error and keeps the socket open', async () => {
    const socket = await connect(alice);
    socket.send({ type: 'subscribe', conversationId: 'not-a-uuid' });
    expect(await socket.waitFor((e) => e.type === 'error')).toMatchObject({
      message: 'Invalid message',
    });
    socket.send({ type: 'ping' });
    await socket.waitFor((e) => e.type === 'pong');
  });

  it("refuses to subscribe someone to a conversation they're not in", async () => {
    const carol = await registerUser(api, 'Carol');
    const socket = await connect(carol);
    socket.send({ type: 'subscribe', conversationId, lastSeq: 0 });
    expect(await socket.waitFor((e) => e.type === 'error')).toMatchObject({
      message: 'Conversation not found',
    });
  });

  it('stops delivering after unsubscribe', async () => {
    const socket = await connect(alice);
    await socket.subscribe(conversationId);
    socket.send({ type: 'unsubscribe', conversationId });
    socket.send({ type: 'ping' });
    await socket.waitFor((e) => e.type === 'pong'); // unsubscribe has been processed

    await sendMessage(api, bob, conversationId, 'are you there?');
    await socket.waitFor((e) => e.type === 'notification.created'); // still gets notifications
    expect(socket.receivedSeqs(conversationId)).toEqual([]);
  });
});

describe('multiple API instances (Redis pub/sub)', () => {
  it('delivers a message sent through instance B to a socket on instance A', async () => {
    const instanceB = await startInstance(true); // own Redis connections, like another process
    try {
      const socketOnA = await connect(alice, api);
      await socketOnA.subscribe(conversationId);

      await sendMessage(instanceB, bob, conversationId, 'sent via B');

      expect(await socketOnA.waitFor((e) => e.type === 'message.created')).toMatchObject({
        message: { body: 'sent via B' },
      });
    } finally {
      await Promise.all(sockets.splice(0).map((s) => s.close()));
      await instanceB.close();
    }
  });
});

describe('reconnect replay', () => {
  it('sends exactly the missed messages, in order, after a reconnect', async () => {
    const first = await connect(alice);
    await first.subscribe(conversationId);
    await sendMessage(api, bob, conversationId, 'seen');
    await first.waitFor((e) => e.type === 'message.created');
    await first.close();

    for (const body of ['missed 1', 'missed 2', 'missed 3']) {
      await sendMessage(api, bob, conversationId, body);
    }

    const second = await connect(alice);
    await second.subscribe(conversationId, 1);
    expect(second.receivedSeqs(conversationId)).toEqual([2, 3, 4]);
    const done = second.events.find((e) => e.type === 'replay.done');
    expect(done).toMatchObject({ lastSeq: 4 });
  });

  it('has no gaps or duplicates when messages arrive during the replay', async () => {
    for (let i = 1; i <= 20; i++) await sendMessage(api, bob, conversationId, `before ${i}`);

    const socket = await connect(alice);
    // Subscribe while 20 more messages are being sent concurrently.
    const sending = Promise.all(
      Array.from({ length: 20 }, (_, i) => sendMessage(api, bob, conversationId, `during ${i}`)),
    );
    await socket.subscribe(conversationId, 0);
    await sending;

    await socket.waitFor((e) => e.type === 'message.created' && e.message.seq === 40);
    expect(socket.receivedSeqs(conversationId)).toEqual(
      Array.from({ length: 40 }, (_, i) => i + 1),
    );
  });
});

describe('presence', () => {
  it('shows a user online while connected and offline after disconnecting', async () => {
    const presenceOf = async () =>
      (await request(api.http).get(`/users/${bob.id}/presence`).set(alice.auth).expect(200)).body
        .data.online;

    const socket = await connect(bob);
    expect(await presenceOf()).toBe(true);
    const inConversation = await request(api.http)
      .get(`/conversations/${conversationId}/presence`)
      .set(alice.auth)
      .expect(200);
    expect(inConversation.body.data).toEqual(
      expect.arrayContaining([
        { userId: bob.id, online: true },
        { userId: alice.id, online: false },
      ]),
    );

    await socket.close();
    sockets.splice(sockets.indexOf(socket), 1);
    for (let i = 0; i < 50 && (await presenceOf()); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await presenceOf()).toBe(false);
  });

  it('expires the entries of a connection that never said goodbye (crashed instance)', async () => {
    const store = new PresenceStore(getRedis(), 60);
    const start = 1_000_000;
    await store.heartbeat('user-x', 'conn-1', start);

    expect(await store.isOnline('user-x', start + 59_000)).toBe(true);
    expect(await store.isOnline('user-x', start + 61_000)).toBe(false);
  });

  it('stays online while any one of several connections is alive', async () => {
    const store = new PresenceStore(getRedis(), 60);
    await store.heartbeat('user-y', 'laptop', 0);
    await store.heartbeat('user-y', 'phone', 30_000);
    await store.remove('user-y', 'laptop');
    expect(await store.isOnline('user-y', 40_000)).toBe(true);
    await store.remove('user-y', 'phone');
    expect(await store.isOnline('user-y', 40_000)).toBe(false);
  });
});
