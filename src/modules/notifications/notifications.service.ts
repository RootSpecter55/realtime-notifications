import type { Db } from '../../common/db';
import { NotFoundError } from '../../common/errors';
import { toPage, toSkipTake } from '../../common/pagination';
import type { Notification } from '../../generated/prisma/client';
import type { NotificationView } from '../../realtime/protocol';
import type { EventPublisher } from '../../realtime/publisher';
import type { NotificationRepository } from './notifications.repository';
import type { ListNotificationsQuery } from './notifications.schemas';

const PREVIEW_LENGTH = 80;

export function toNotificationView(n: Notification): NotificationView {
  return {
    id: n.id,
    type: n.type,
    conversationId: n.conversationId,
    messageId: n.messageId,
    preview: n.preview,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export class NotificationsService {
  constructor(
    private readonly db: Db,
    private readonly notifications: NotificationRepository,
    private readonly publisher: EventPublisher,
  ) {}

  /** Stores one notification per recipient, then pushes each to that user's channel. */
  private async createAndPush(rows: Parameters<NotificationRepository['createMany']>[1]) {
    if (rows.length === 0) return;
    const created = await this.notifications.createMany(this.db, rows);
    await Promise.all(
      created.map((n) =>
        this.publisher.toUser(n.userId, {
          type: 'notification.created',
          notification: toNotificationView(n),
        }),
      ),
    );
  }

  notifyNewMessage(
    recipientIds: string[],
    message: { id: string; conversationId: string; body: string },
  ) {
    const preview = message.body.slice(0, PREVIEW_LENGTH);
    return this.createAndPush(
      recipientIds.map((userId) => ({
        userId,
        type: 'NEW_MESSAGE' as const,
        conversationId: message.conversationId,
        messageId: message.id,
        preview,
      })),
    );
  }

  notifyAddedToConversation(
    recipientIds: string[],
    conversation: { id: string; title: string | null },
  ) {
    const preview = `You were added to ${conversation.title ?? 'a conversation'}`;
    return this.createAndPush(
      recipientIds.map((userId) => ({
        userId,
        type: 'ADDED_TO_CONVERSATION' as const,
        conversationId: conversation.id,
        preview,
      })),
    );
  }

  async list(userId: string, query: ListNotificationsQuery) {
    const { items, total } = await this.notifications.listForUser(
      this.db,
      userId,
      query.unread,
      toSkipTake(query),
    );
    return toPage(items.map(toNotificationView), total, query);
  }

  async markRead(userId: string, id: string) {
    const notification = await this.requireOwned(userId, id);
    if (notification.readAt) return toNotificationView(notification);
    return toNotificationView(await this.notifications.update(this.db, id, { readAt: new Date() }));
  }

  async markAllRead(userId: string) {
    return { updated: await this.notifications.markAllRead(this.db, userId, new Date()) };
  }

  async delete(userId: string, id: string) {
    await this.requireOwned(userId, id);
    await this.notifications.delete(this.db, id);
  }

  private async requireOwned(userId: string, id: string) {
    const notification = await this.notifications.findOwned(this.db, id, userId);
    if (!notification) throw new NotFoundError('Notification');
    return notification;
  }
}
