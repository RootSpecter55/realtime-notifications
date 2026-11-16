import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { RealtimeEvent } from './protocol';

export type Listener = (event: RealtimeEvent) => void;

type Room = { listeners: Set<Listener>; subscribed: Promise<unknown> };

/**
 * Which listeners (sockets) on THIS instance want which Redis channel.
 * The instance subscribes to a channel when its first local listener joins and unsubscribes
 * when the last one leaves, so it only receives traffic its own sockets need.
 */
export class Rooms {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly subscriber: Redis,
    private readonly logger: Logger,
  ) {
    subscriber.on('message', (channel: string, payload: string) => this.deliver(channel, payload));
  }

  /**
   * Resolves once Redis has confirmed the subscription, so no event published after this
   * returns can be missed. A second listener joining while the first SUBSCRIBE is still in
   * flight waits for that same confirmation.
   */
  async join(channel: string, listener: Listener): Promise<void> {
    let room = this.rooms.get(channel);
    if (!room) {
      room = { listeners: new Set(), subscribed: this.subscriber.subscribe(channel) };
      this.rooms.set(channel, room);
    }
    room.listeners.add(listener);
    await room.subscribed;
  }

  async leave(channel: string, listener: Listener): Promise<void> {
    const room = this.rooms.get(channel);
    if (!room) return;
    room.listeners.delete(listener);
    if (room.listeners.size === 0) {
      this.rooms.delete(channel);
      await this.subscriber.unsubscribe(channel);
    }
  }

  /** Number of channels this instance is subscribed to (for tests and diagnostics). */
  get channelCount(): number {
    return this.rooms.size;
  }

  private deliver(channel: string, payload: string) {
    const room = this.rooms.get(channel);
    if (!room) return;
    let event: RealtimeEvent;
    try {
      event = JSON.parse(payload) as RealtimeEvent;
    } catch (err) {
      this.logger.warn({ err, channel }, 'Ignoring malformed realtime event');
      return;
    }
    for (const listener of room.listeners) listener(event);
  }
}
