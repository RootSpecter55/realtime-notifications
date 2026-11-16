import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { errorHandler, notFoundHandler } from './common/error-handler';
import { logger } from './common/logger';
import { sendData } from './common/response';
import type { Container } from './container';
import { conversationsRoutes } from './modules/conversations/conversations.routes';
import { conversationMessagesRoutes, messagesRoutes } from './modules/messages/messages.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { authRoutes, usersRoutes } from './modules/users/users.routes';

/** The REST API. WebSockets are attached to the same HTTP server in server.ts. */
export function createApp(container: Container): Express {
  const { controllers: c, authenticate } = container;
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => sendData(res, { status: 'ok' }));

  app.use('/auth', authRoutes(c.users));
  app.use('/users', usersRoutes(c.users, authenticate));
  // Nested router first so /conversations/:id/messages never reaches the parent router.
  app.use('/conversations/:id/messages', conversationMessagesRoutes(c.messages, authenticate));
  app.use('/conversations', conversationsRoutes(c.conversations, authenticate));
  app.use('/messages', messagesRoutes(c.messages, authenticate));
  app.use('/notifications', notificationsRoutes(c.notifications, authenticate));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
