import { createServer as createHttpServer } from 'node:http';
import { createApp } from './app';
import { getPrisma } from './common/db';
import { logger } from './common/logger';
import { getRedis, getSubscriber } from './common/redis';
import { buildContainer, type Container } from './container';
import { RealtimeGateway } from './realtime/gateway';

/** One API instance: the REST app and the WebSocket gateway on a single HTTP server. */
export function createServer(container: Container = buildContainer()) {
  const server = createHttpServer(createApp(container));
  const { services, realtime, config } = container;
  const gateway = new RealtimeGateway(server, services.users.resolveUser, {
    rooms: realtime.rooms,
    presence: realtime.presence,
    requireParticipant: (userId, id) => services.conversations.requireParticipant(userId, id),
    replay: (id, afterSeq, limit) => services.messages.replay(id, afterSeq, limit),
    heartbeatSeconds: config.PRESENCE_HEARTBEAT_SECONDS,
    replayLimit: config.REPLAY_LIMIT,
    logger,
  });
  return { server, gateway };
}

export function startServer() {
  const container = buildContainer();
  const { server, gateway } = createServer(container);
  server.listen(container.config.PORT, () => {
    logger.info(`API and WebSocket gateway listening on port ${container.config.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    void gateway.close().then(() =>
      server.close(() => {
        void Promise.allSettled([
          getPrisma().$disconnect(),
          getRedis().quit(),
          getSubscriber().quit(),
        ]).finally(() => process.exit(0));
      }),
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  startServer();
}
