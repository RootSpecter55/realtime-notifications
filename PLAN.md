# PLAN — realtime-notifications

A chat and notifications backend. Users create conversations, send messages over REST, and receive them live over WebSockets. Three mechanisms carry the design:

1. **Redis pub/sub**, so any number of API instances can share the live traffic.
2. **Presence in Redis**, which survives instance crashes.
3. **Per-conversation sequence numbers**, so a reconnecting client gets exactly what it missed from Postgres, with no gaps and no duplicates.

**Stack:** Node 24, TypeScript 5.9 (strict), Express 5, `ws`, Prisma 7, Zod 4, ioredis, Jest 30 with Supertest, ESLint and Prettier, PostgreSQL 16, Redis 7.

## Modules

| Module        | Responsibility                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users         | Register and login (local JWT), `me`, update or delete yourself, list or search users, get a user's presence.                                                                                                         |
| conversations | Create a conversation with participants, list mine (newest activity first, with an unread count), get, rename, add a participant, leave, mark as read up to a sequence number, and see which participants are online. |
| messages      | Send, list (`?afterSeq=` for catch-up), edit your own, delete your own (soft delete). Sending assigns the next sequence number, publishes a live event and creates notifications.                                     |
| notifications | List mine (`?unread=true`), mark one read, mark all read, delete. They're created when a message arrives or when you're added to a conversation.                                                                      |

**Realtime layer (`src/realtime/`):**

| File           | Job                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway.ts`   | The `ws` server at `/ws?token=<JWT>`: authentication, heartbeats, and validating client messages with Zod.                                                              |
| `rooms.ts`     | Which local sockets are in which conversation. Subscribes this instance to a Redis channel when the first local socket joins and unsubscribes when the last one leaves. |
| `publisher.ts` | Services call it to publish events. They never touch sockets.                                                                                                           |
| `presence.ts`  | Presence store.                                                                                                                                                         |
| `protocol.ts`  | Message and event schemas.                                                                                                                                              |

**Shared code (`src/common/`):** the same set as repos 1 and 2 (config, logger, errors and handler, validate, pagination, base repository, auth middleware, response helpers, Prisma singleton), plus Redis singletons: one publisher and one subscriber, because a Redis connection in subscribe mode can't run other commands.

**Patterns:**

- _Singleton:_ Prisma, both Redis connections, config.
- _Repository:_ all Postgres access, plus `PresenceStore` for Redis.
- _Factory_ and _Strategy:_ not used. Nothing here is interchangeable or varies by type.

## Data model

```
User          id, email (unique), name, passwordHash, createdAt
Conversation  id, title?, createdById, lastSeq (int, default 0), lastMessageAt?, createdAt, updatedAt
Participant   id, conversationId, userId, lastReadSeq (int, default 0), joinedAt     unique(conversationId, userId)
Message       id, conversationId, seq, senderId, body, editedAt?, deletedAt?, createdAt
                                                                   unique(conversationId, seq)
Notification  id, userId, type (NEW_MESSAGE | ADDED_TO_CONVERSATION), conversationId?, messageId?,
              preview, readAt?, createdAt                          index(userId, createdAt)
```

## Mechanism 1: sequence numbers

- Sending a message runs one transaction:
  1. `UPDATE conversations SET last_seq = last_seq + 1 … RETURNING last_seq` (a Prisma atomic `increment`).
  2. Insert the message with that `seq`.
- The row lock on the conversation makes concurrent senders in one conversation take turns. Sequence numbers come out 1, 2, 3, … with no gaps or duplicates. Different conversations don't block each other. `unique(conversationId, seq)` is a backstop.
- **Test:** 50 concurrent sends produce sequence numbers exactly 1–50.
- Unread count = `lastSeq − lastReadSeq`, with no counting query.

## Mechanism 2: live delivery across instances (Redis pub/sub)

- After the transaction commits, the service publishes the event to `conv:{conversationId}`, or `user:{userId}` for notifications.
- Each instance subscribes only to the channels its own connected sockets need. On a message from Redis, it forwards the event to those local sockets.
- **Test:** two gateway instances run in one test process, each with its own Redis connections. A user on instance A receives a message sent through instance B's REST API.

## Mechanism 3: reconnect and catch-up

- The client sends `{ "type": "subscribe", "conversationId", "lastSeq" }`.
- The server checks the user is a participant, then:
  1. Joins the room. Live events start arriving and are **held in a buffer**.
  2. Loads messages with `seq > lastSeq` from Postgres and sends them in order (at most 500; beyond that it sends `replay.truncated` and the client pages through REST).
  3. Sends the buffered live events with `seq` above the last replayed one, then switches to live.
- That ordering means nothing is missed between the query and the join, and nothing is sent twice. The client only has to remember the highest `seq` it has seen.
- **Tests:**
  - A client disconnects, 3 messages are sent, and it reconnects with its last seq: it receives exactly those 3, in order.
  - A message sent during the replay arrives exactly once.

## Presence

- Each connection is a member of a Redis sorted set `presence:{userId}`, with an expiry time as its score.
- The socket refreshes its entry every 25 s with a 60 s TTL. A user is online if the set has any unexpired entry.
- If an instance crashes, its entries simply expire, so nobody stays "online" forever. A plain connection counter would have that problem.
- Readable via `GET /users/:id/presence` and `GET /conversations/:id/presence`. Live presence-change events aren't pushed in this version (listed under limitations).

## Server → client events

`message.created`, `message.updated`, `message.deleted`, `notification.created`, `replay.done`, `replay.truncated`, `error`, `pong`.

Client → server messages: `subscribe`, `unsubscribe`, `ping`. Every incoming message is validated, and an invalid one gets an `error` event; the socket stays open.

## Endpoints

```
GET    /health
POST   /auth/register                 POST /auth/login
GET    /users/me                       PATCH /users/me        DELETE /users/me
GET    /users                          (?search=, paginated)  GET /users/:id
GET    /users/:id/presence
POST   /conversations                  GET /conversations     (mine, with unreadCount)
GET    /conversations/:id              PATCH /conversations/:id
POST   /conversations/:id/participants DELETE /conversations/:id/participants/me (leave)
POST   /conversations/:id/read         { seq }
GET    /conversations/:id/presence
POST   /conversations/:id/messages     GET /conversations/:id/messages (?afterSeq=, paginated)
PATCH  /messages/:id                   DELETE /messages/:id
GET    /notifications                  (?unread=true)
POST   /notifications/:id/read         POST /notifications/read-all
DELETE /notifications/:id
WS     /ws?token=<JWT>
```

The same envelope and pagination rules as the earlier repos apply. Only participants can see a conversation; everyone else gets 404.

## Load test (script only, no numbers)

`npm run loadtest` uses `scripts/load-test.ts`:

1. Registers N users and puts them in a conversation.
2. Opens N WebSockets.
3. Sends M messages over REST.
4. Records the time from send to receipt on every socket and prints p50, p95 and p99 and the delivery count.

The README's **Results** section will say only "Not yet measured, run `npm run loadtest`".

## Tests

- **Unit:** services with mocked repositories and a mocked publisher, the protocol schemas, the replay buffer logic and `start-with-secrets`.
- **Integration (real Postgres and Redis):** REST endpoints, sequence-number concurrency, the cross-instance test, reconnect and replay, presence (including expiry) and notifications.

## Deployment files

The same set as before, adapted to this repo (required secret keys: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`).

Ports: Postgres on host port **5442**, Redis on **6381**.

## Build order

1. Scaffold
2. Common layer and Redis connections
3. Schema and migration
4. users and auth
5. conversations
6. messages and sequence numbers
7. notifications
8. Realtime: publisher and rooms
9. Gateway, replay and presence
10. Load-test script
11. Deployment files
12. README
