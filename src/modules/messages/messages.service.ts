import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import { toPage, toSkipTake } from '../../common/pagination';
import type { Message, PrismaClient } from '../../generated/prisma/client';
import type { MessageView } from '../../realtime/protocol';
import type { EventPublisher } from '../../realtime/publisher';
import type { ParticipantRepository } from '../conversations/conversations.repository';
import type { ConversationsService } from '../conversations/conversations.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { MessageRepository } from './messages.repository';
import type { ListMessagesQuery } from './messages.schemas';

export function toMessageView(m: Message): MessageView {
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq,
    senderId: m.senderId,
    body: m.deletedAt ? null : m.body,
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export class MessagesService {
  constructor(
    // The root client: sending a message runs its own transaction.
    private readonly db: PrismaClient,
    private readonly messages: MessageRepository,
    private readonly participants: ParticipantRepository,
    private readonly conversations: ConversationsService,
    private readonly notifications: NotificationsService,
    private readonly publisher: EventPublisher,
  ) {}

  /** Saves the message, then (after commit) pushes it live and notifies the other participants. */
  async send(userId: string, conversationId: string, body: string): Promise<MessageView> {
    await this.conversations.requireParticipant(userId, conversationId);
    const message = await this.messages.append(this.db, conversationId, userId, body);
    const view = toMessageView(message);

    await this.publisher.toConversation(conversationId, { type: 'message.created', message: view });
    const others = (await this.participants.listUserIds(this.db, conversationId)).filter(
      (id) => id !== userId,
    );
    await this.notifications.notifyNewMessage(others, message);
    return view;
  }

  async list(userId: string, conversationId: string, query: ListMessagesQuery) {
    await this.conversations.requireParticipant(userId, conversationId);
    const { items, total } = await this.messages.listAfter(
      this.db,
      conversationId,
      query.afterSeq,
      toSkipTake(query),
    );
    return toPage(items.map(toMessageView), total, query);
  }

  /** For the gateway: up to `limit` messages after `afterSeq`. Access is checked by the caller. */
  async replay(conversationId: string, afterSeq: number, limit: number): Promise<MessageView[]> {
    const { items } = await this.messages.listAfter(this.db, conversationId, afterSeq, {
      skip: 0,
      take: limit,
    });
    return items.map(toMessageView);
  }

  async edit(userId: string, messageId: string, body: string): Promise<MessageView> {
    await this.requireOwnLiveMessage(userId, messageId);
    const view = toMessageView(
      await this.messages.update(this.db, messageId, { body, editedAt: new Date() }),
    );
    await this.publisher.toConversation(view.conversationId, {
      type: 'message.updated',
      message: view,
    });
    return view;
  }

  /** Soft delete: the row and its seq stay (so there is no gap), the body is hidden. */
  async delete(userId: string, messageId: string): Promise<void> {
    await this.requireOwnLiveMessage(userId, messageId);
    const view = toMessageView(
      await this.messages.update(this.db, messageId, { deletedAt: new Date() }),
    );
    await this.publisher.toConversation(view.conversationId, {
      type: 'message.deleted',
      message: view,
    });
  }

  private async requireOwnLiveMessage(userId: string, messageId: string) {
    const message = await this.messages.findById(this.db, messageId);
    // Not a participant: same 404 as a missing message, so ids cannot be probed.
    if (!message || !(await this.conversations.isParticipant(userId, message.conversationId))) {
      throw new NotFoundError('Message');
    }
    if (message.senderId !== userId)
      throw new ForbiddenError('You can only change your own messages');
    if (message.deletedAt) throw new ConflictError('Message was deleted');
    return message;
  }
}
