import type { Redis } from 'ioredis';

/**
 * Presence in Redis: `presence:{userId}` is a sorted set with one member per open
 * connection, scored by the time that entry expires. Each socket refreshes its entry on a
 * heartbeat; a user is online while any entry is still in the future.
 *
 * If an API instance crashes, its sockets never say goodbye, but their entries simply
 * expire, so nobody stays "online" forever (which a plain connection counter would do).
 */
export class PresenceStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  private key(userId: string) {
    return `presence:${userId}`;
  }

  /** Adds or refreshes one connection's entry and drops any expired ones. */
  async heartbeat(userId: string, connectionId: string, now = Date.now()): Promise<void> {
    const key = this.key(userId);
    const ttlMs = this.ttlSeconds * 1000;
    await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', now)
      .zadd(key, now + ttlMs, connectionId)
      .pexpire(key, ttlMs) // the whole key goes once the newest entry would have expired
      .exec();
  }

  async remove(userId: string, connectionId: string): Promise<void> {
    await this.redis.zrem(this.key(userId), connectionId);
  }

  async isOnline(userId: string, now = Date.now()): Promise<boolean> {
    return (await this.redis.zcount(this.key(userId), `(${now}`, '+inf')) > 0;
  }

  /** Which of these users are online, in one round trip. */
  async onlineAmong(userIds: string[], now = Date.now()): Promise<Set<string>> {
    const pipeline = this.redis.pipeline();
    for (const id of userIds) pipeline.zcount(this.key(id), `(${now}`, '+inf');
    const results = (await pipeline.exec()) ?? [];
    return new Set(userIds.filter((_, i) => Number(results[i]?.[1]) > 0));
  }
}
