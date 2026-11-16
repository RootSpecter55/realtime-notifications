import { Redis } from 'ioredis';
import { getConfig } from './config';

/** A new connection. Exported so tests can build a second, independent API instance. */
export function createRedisConnection(): Redis {
  return new Redis(getConfig().REDIS_URL, {
    // Fail a command after one reconnect attempt instead of queueing it indefinitely.
    maxRetriesPerRequest: 1,
  });
}

// Singletons. Two connections are needed because a connection in subscribe mode
// can only run (un)subscribe commands; publishing and presence use the other one.
let commands: Redis | undefined;
let subscriber: Redis | undefined;

/** For publishing and presence. */
export function getRedis(): Redis {
  commands ??= createRedisConnection();
  return commands;
}

/** Dedicated subscribe-mode connection for receiving pub/sub events. */
export function getSubscriber(): Redis {
  subscriber ??= createRedisConnection();
  return subscriber;
}
