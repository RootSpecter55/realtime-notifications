import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { WebSocket, type RawData } from 'ws';
import type { AuthUser } from '../common/auth-middleware';
import { ConversationSubscription } from './conversation-subscription';
import type { PresenceStore } from './presence';
import {
  clientMessage,
  conversationChannel,
  userChannel,
  type MessageView,
  type ServerEvent,
} from './protocol';
import type { Listener, Rooms } from './rooms';

export type ConnectionDeps = {
  rooms: Rooms;
  presence: PresenceStore;
  /** Throws if the user is not a participant; returns the conversation (with lastSeq). */
  requireParticipant: (userId: string, conversationId: string) => Promise<{ lastSeq: number }>;
  replay: (conversationId: string, afterSeq: number, limit: number) => Promise<MessageView[]>;
  heartbeatSeconds: number;
  replayLimit: number;
  logger: Logger;
};

/** Everything about one open WebSocket: its subscriptions, presence and heartbeat. */
export class ClientConnection {
  readonly id = randomUUID();
  private readonly subscriptions = new Map<string, ConversationSubscription>();
  private readonly onUserEvent: Listener = (event) => this.send(event);
  private heartbeat?: NodeJS.Timeout;
  private alive = true;

  constructor(
    private readonly ws: WebSocket,
    private readonly user: AuthUser,
    private readonly deps: ConnectionDeps,
  ) {}

  async start(): Promise<void> {
    this.ws.on('message', (data) => void this.onMessage(data));
    this.ws.on('pong', () => (this.alive = true));
    this.ws.on('close', () => void this.stop());

    // The user's own channel carries notifications, wherever they were created.
    await this.deps.rooms.join(userChannel(this.user.id), this.onUserEvent);
    await this.deps.presence.heartbeat(this.user.id, this.id);
    this.heartbeat = setInterval(() => void this.tick(), this.deps.heartbeatSeconds * 1000);
  }

  private async tick() {
    // No pong since the last ping: the connection is dead even if TCP has not noticed yet.
    if (!this.alive) {
      this.ws.terminate();
      return;
    }
    this.alive = false;
    this.ws.ping();
    await this.deps.presence
      .heartbeat(this.user.id, this.id)
      .catch((err: unknown) => this.deps.logger.warn({ err }, 'Presence heartbeat failed'));
  }

  private async onMessage(data: RawData) {
    let json: unknown;
    try {
      json = JSON.parse(data.toString());
    } catch {
      return this.send({ type: 'error', message: 'Message is not valid JSON' });
    }
    const parsed = clientMessage.safeParse(json);
    if (!parsed.success) {
      return this.send({ type: 'error', message: 'Invalid message', details: parsed.error.issues });
    }

    const message = parsed.data;
    try {
      if (message.type === 'ping') this.send({ type: 'pong' });
      if (message.type === 'subscribe')
        await this.subscribe(message.conversationId, message.lastSeq);
      if (message.type === 'unsubscribe') await this.unsubscribe(message.conversationId);
    } catch (err) {
      this.deps.logger.error({ err, type: message.type }, 'WebSocket message failed');
      this.send({ type: 'error', message: 'Something went wrong' });
    }
  }

  /** See ConversationSubscription for why the room is joined before the replay query. */
  private async subscribe(conversationId: string, lastSeq: number) {
    try {
      await this.deps.requireParticipant(this.user.id, conversationId);
    } catch {
      return this.send({ type: 'error', message: 'Conversation not found' });
    }
    await this.unsubscribe(conversationId); // subscribing again starts a fresh replay

    const subscription = new ConversationSubscription(conversationId, lastSeq, (e) => this.send(e));
    this.subscriptions.set(conversationId, subscription);
    await this.deps.rooms.join(conversationChannel(conversationId), subscription.onLive);

    // Ask for one more than the limit to find out whether there are too many to replay.
    const limit = this.deps.replayLimit;
    const missed = await this.deps.replay(conversationId, lastSeq, limit + 1);
    const truncated = missed.length > limit;
    const latestSeq = truncated
      ? (await this.deps.requireParticipant(this.user.id, conversationId)).lastSeq
      : lastSeq;
    subscription.finishReplay(missed, truncated, latestSeq);
  }

  private async unsubscribe(conversationId: string) {
    const subscription = this.subscriptions.get(conversationId);
    if (!subscription) return;
    this.subscriptions.delete(conversationId);
    await this.deps.rooms.leave(conversationChannel(conversationId), subscription.onLive);
  }

  private send(event: ServerEvent) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  private async stop() {
    clearInterval(this.heartbeat);
    try {
      for (const conversationId of [...this.subscriptions.keys()]) {
        await this.unsubscribe(conversationId);
      }
      await this.deps.rooms.leave(userChannel(this.user.id), this.onUserEvent);
      await this.deps.presence.remove(this.user.id, this.id);
    } catch (err) {
      this.deps.logger.warn({ err }, 'Cleanup after disconnect failed');
    }
  }
}
