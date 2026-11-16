import request from 'supertest';
import { getPrisma } from '../../src/common/db';
import {
  createConversation,
  disconnectShared,
  registerUser,
  resetState,
  sendMessage,
  startInstance,
  type Instance,
  type TestUser,
} from './helpers';

let api: Instance;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

beforeAll(async () => {
  api = await startInstance();
});
beforeEach(async () => {
  await resetState();
  alice = await registerUser(api, 'Alice');
  bob = await registerUser(api, 'Bob');
  carol = await registerUser(api, 'Carol');
});
afterAll(async () => {
  await api.close();
  await disconnectShared();
});

describe('users', () => {
  it('registers, logs in, searches and updates', async () => {
    await request(api.http)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'password-123' })
      .expect(200);
    await request(api.http)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'wrong' })
      .expect(401);

    const search = await request(api.http).get('/users?search=bo').set(alice.auth).expect(200);
    expect(search.body.data.map((u: { name: string }) => u.name)).toEqual(['Bob']);

    const updated = await request(api.http)
      .patch('/users/me')
      .set(alice.auth)
      .send({ name: 'Alice B' })
      .expect(200);
    expect(updated.body.data.name).toBe('Alice B');
  });

  it('reports a user without an open socket as offline', async () => {
    const res = await request(api.http)
      .get(`/users/${bob.id}/presence`)
      .set(alice.auth)
      .expect(200);
    expect(res.body.data).toEqual({ userId: bob.id, online: false });
  });
});

describe('conversations', () => {
  it('creates a conversation that always includes the creator', async () => {
    const id = await createConversation(api, alice, [bob]);
    const res = await request(api.http).get(`/conversations/${id}`).set(bob.auth).expect(200);
    const ids = res.body.data.participants.map((p: { userId: string }) => p.userId).sort();
    expect(ids).toEqual([alice.id, bob.id].sort());
  });

  it('hides a conversation from non-participants', async () => {
    const id = await createConversation(api, alice, [bob]);
    await request(api.http).get(`/conversations/${id}`).set(carol.auth).expect(404);
    await request(api.http).get(`/conversations/${id}/messages`).set(carol.auth).expect(404);
    await request(api.http)
      .post(`/conversations/${id}/messages`)
      .set(carol.auth)
      .send({ body: 'hi' })
      .expect(404);
  });

  it('tracks unread counts from sequence numbers, and read position only moves forward', async () => {
    const id = await createConversation(api, alice, [bob]);
    for (const body of ['one', 'two', 'three']) await sendMessage(api, alice, id, body);

    const list = await request(api.http).get('/conversations').set(bob.auth).expect(200);
    expect(list.body.data[0]).toMatchObject({ id, lastSeq: 3, unreadCount: 3 });

    const read = await request(api.http)
      .post(`/conversations/${id}/read`)
      .set(bob.auth)
      .send({ seq: 2 })
      .expect(200);
    expect(read.body.data).toEqual({ lastReadSeq: 2, unreadCount: 1 });

    const backwards = await request(api.http)
      .post(`/conversations/${id}/read`)
      .set(bob.auth)
      .send({ seq: 1 })
      .expect(200);
    expect(backwards.body.data.lastReadSeq).toBe(2);

    const beyond = await request(api.http)
      .post(`/conversations/${id}/read`)
      .set(bob.auth)
      .send({ seq: 99 })
      .expect(200);
    expect(beyond.body.data).toEqual({ lastReadSeq: 3, unreadCount: 0 });
  });

  it('adds a participant and deletes the conversation when the last one leaves', async () => {
    const id = await createConversation(api, alice, [bob]);
    await request(api.http)
      .post(`/conversations/${id}/participants`)
      .set(alice.auth)
      .send({ userId: carol.id })
      .expect(201);
    await request(api.http)
      .post(`/conversations/${id}/participants`)
      .set(alice.auth)
      .send({ userId: carol.id })
      .expect(409);

    for (const user of [alice, bob, carol]) {
      await request(api.http)
        .delete(`/conversations/${id}/participants/me`)
        .set(user.auth)
        .expect(204);
    }
    expect(await getPrisma().conversation.count()).toBe(0);
  });
});

describe('messages', () => {
  it('assigns gap-free sequence numbers to 50 concurrent sends', async () => {
    const id = await createConversation(api, alice, [bob]);
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => sendMessage(api, i % 2 ? alice : bob, id, `m${i}`)),
    );
    const rows = await getPrisma().message.findMany({
      where: { conversationId: id },
      orderBy: { seq: 'asc' },
    });
    expect(rows.map((m) => m.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const conversation = await getPrisma().conversation.findUniqueOrThrow({ where: { id } });
    expect(conversation.lastSeq).toBe(50);
  });

  it('keeps sequences independent per conversation', async () => {
    const first = await createConversation(api, alice, [bob]);
    const second = await createConversation(api, alice, [carol]);
    expect((await sendMessage(api, alice, first, 'a')).seq).toBe(1);
    expect((await sendMessage(api, alice, second, 'b')).seq).toBe(1);
    expect((await sendMessage(api, alice, first, 'c')).seq).toBe(2);
  });

  it('lists messages after a sequence number, for catching up over REST', async () => {
    const id = await createConversation(api, alice, [bob]);
    for (let i = 1; i <= 5; i++) await sendMessage(api, alice, id, `m${i}`);
    const res = await request(api.http)
      .get(`/conversations/${id}/messages?afterSeq=3`)
      .set(bob.auth)
      .expect(200);
    expect(res.body.data.map((m: { seq: number }) => m.seq)).toEqual([4, 5]);
    expect(res.body.meta.total).toBe(2);
  });

  it('lets only the sender edit or delete, and keeps the seq of a deleted message', async () => {
    const id = await createConversation(api, alice, [bob]);
    const message = await sendMessage(api, alice, id, 'original');

    await request(api.http)
      .patch(`/messages/${message.id}`)
      .set(bob.auth)
      .send({ body: 'x' })
      .expect(403);
    const edited = await request(api.http)
      .patch(`/messages/${message.id}`)
      .set(alice.auth)
      .send({ body: 'edited' })
      .expect(200);
    expect(edited.body.data).toMatchObject({ body: 'edited', seq: 1 });
    expect(edited.body.data.editedAt).not.toBeNull();

    await request(api.http).delete(`/messages/${message.id}`).set(alice.auth).expect(204);
    const list = await request(api.http)
      .get(`/conversations/${id}/messages`)
      .set(bob.auth)
      .expect(200);
    expect(list.body.data[0]).toMatchObject({ seq: 1, body: null });
    await request(api.http)
      .patch(`/messages/${message.id}`)
      .set(alice.auth)
      .send({ body: 'x' })
      .expect(409);
  });
});

describe('notifications', () => {
  it('notifies the other participants, not the sender', async () => {
    const id = await createConversation(api, alice, [bob, carol]);
    await sendMessage(api, alice, id, 'Hello everyone, this is a message');

    const forAlice = await request(api.http).get('/notifications').set(alice.auth).expect(200);
    expect(forAlice.body.meta.total).toBe(0);

    const forBob = await request(api.http).get('/notifications').set(bob.auth).expect(200);
    expect(forBob.body.data.map((n: { type: string }) => n.type)).toEqual([
      'NEW_MESSAGE',
      'ADDED_TO_CONVERSATION',
    ]);
    expect(forBob.body.data[0].preview).toBe('Hello everyone, this is a message');
  });

  it('marks one or all as read, filters unread, and protects other users', async () => {
    const id = await createConversation(api, alice, [bob]);
    await sendMessage(api, alice, id, 'one');
    await sendMessage(api, alice, id, 'two');

    const all = await request(api.http).get('/notifications').set(bob.auth).expect(200);
    const first = all.body.data[0].id;
    await request(api.http).post(`/notifications/${first}/read`).set(alice.auth).expect(404);
    await request(api.http).post(`/notifications/${first}/read`).set(bob.auth).expect(200);

    const unread = await request(api.http)
      .get('/notifications?unread=true')
      .set(bob.auth)
      .expect(200);
    expect(unread.body.meta.total).toBe(2);

    const readAll = await request(api.http)
      .post('/notifications/read-all')
      .set(bob.auth)
      .expect(200);
    expect(readAll.body.data).toEqual({ updated: 2 });

    await request(api.http).delete(`/notifications/${first}`).set(bob.auth).expect(204);
    const after = await request(api.http).get('/notifications').set(bob.auth).expect(200);
    expect(after.body.meta.total).toBe(2);
  });
});
