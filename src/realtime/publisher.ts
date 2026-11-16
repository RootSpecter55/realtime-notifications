import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { conversationChannel, userChannel, type RealtimeEvent } from './protocol';

/** What services use to push live events. They never see sockets or instances. */
export interface EventPublisher {
  toConversation(conversationId: string, event: RealtimeEvent): Promise<void>;
  toUser(userId: string, event: RealtimeEvent): Promise<void>;
}

/**
 * Publishes to Redis; every API instance with a subscribed socket receives it.
 * Called after the database commit. If Redis is down the error is logged, not thrown: the
 * data is already saved, and clients get it on their next reconnect replay.
 */
export class RedisEventPublisher implements EventPublisher {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  toConversation(conversationId: string, event: RealtimeEvent) {
    return this.publish(conversationChannel(conversationId), event);
  }

  toUser(userId: string, event: RealtimeEvent) {
    return this.publish(userChannel(userId), event);
  }

  private async publish(channel: string, event: RealtimeEvent) {
    try {
      await this.redis.publish(channel, JSON.stringify(event));
    } catch (err) {
      this.logger.warn({ err, channel, type: event.type }, 'Failed to publish realtime event');
    }
  }
}
