import type { Redis } from 'ioredis';
import { createAuthMiddleware } from './common/auth-middleware';
import { getConfig } from './common/config';
import { getPrisma } from './common/db';
import { logger } from './common/logger';
import { getRedis, getSubscriber } from './common/redis';
import { ConversationsController } from './modules/conversations/conversations.controller';
import {
  ConversationRepository,
  ParticipantRepository,
} from './modules/conversations/conversations.repository';
import { ConversationsService } from './modules/conversations/conversations.service';
import { MessagesController } from './modules/messages/messages.controller';
import { MessageRepository } from './modules/messages/messages.repository';
import { MessagesService } from './modules/messages/messages.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { NotificationRepository } from './modules/notifications/notifications.repository';
import { NotificationsService } from './modules/notifications/notifications.service';
import { TokenService } from './modules/users/tokens';
import { UsersController } from './modules/users/users.controller';
import { UserRepository } from './modules/users/users.repository';
import { UsersService } from './modules/users/users.service';
import { PresenceStore } from './realtime/presence';
import { RedisEventPublisher } from './realtime/publisher';
import { Rooms } from './realtime/rooms';

/**
 * Composition root: builds every repository, service and controller in one place.
 * Redis connections can be passed in, which is how tests run two independent instances.
 */
export function buildContainer(redis: { commands: Redis; subscriber: Redis } = defaultRedis()) {
  const config = getConfig();
  const db = getPrisma();

  const repos = {
    users: new UserRepository(),
    conversations: new ConversationRepository(),
    participants: new ParticipantRepository(),
    messages: new MessageRepository(),
    notifications: new NotificationRepository(),
  };

  const presence = new PresenceStore(redis.commands, config.PRESENCE_TTL_SECONDS);
  const publisher = new RedisEventPublisher(redis.commands, logger);
  const rooms = new Rooms(redis.subscriber, logger);

  const usersService = new UsersService(
    db,
    repos.users,
    new TokenService(config.JWT_SECRET, config.JWT_EXPIRES_IN),
    presence,
  );
  const notificationsService = new NotificationsService(db, repos.notifications, publisher);
  const conversationsService = new ConversationsService(
    db,
    repos.conversations,
    repos.participants,
    repos.users,
    notificationsService,
    presence,
  );
  const messagesService = new MessagesService(
    db,
    repos.messages,
    repos.participants,
    conversationsService,
    notificationsService,
    publisher,
  );

  return {
    config,
    authenticate: createAuthMiddleware(usersService.resolveUser),
    services: {
      users: usersService,
      conversations: conversationsService,
      messages: messagesService,
    },
    realtime: { rooms, presence },
    controllers: {
      users: new UsersController(usersService),
      conversations: new ConversationsController(conversationsService),
      messages: new MessagesController(messagesService),
      notifications: new NotificationsController(notificationsService),
    },
  };
}

function defaultRedis() {
  return { commands: getRedis(), subscriber: getSubscriber() };
}

export type Container = ReturnType<typeof buildContainer>;
