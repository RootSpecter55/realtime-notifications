import type { Db } from '../../common/db';
import { AppError, ConflictError, NotFoundError } from '../../common/errors';
import { toPage, toSkipTake } from '../../common/pagination';
import type { PresenceStore } from '../../realtime/presence';
import type { NotificationsService } from '../notifications/notifications.service';
import type { UserRepository } from '../users/users.repository';
import type { ConversationRepository, ParticipantRepository } from './conversations.repository';
import type {
  CreateConversationInput,
  ListConversationsQuery,
  UpdateConversationInput,
} from './conversations.schemas';

export class ConversationsService {
  constructor(
    private readonly db: Db,
    private readonly conversations: ConversationRepository,
    private readonly participants: ParticipantRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationsService,
    private readonly presenceStore: PresenceStore,
  ) {}

  async create(creatorId: string, input: CreateConversationInput) {
    const otherIds = [...new Set(input.participantIds)].filter((id) => id !== creatorId);
    if (otherIds.length === 0)
      throw new AppError(400, 'NO_PARTICIPANTS', 'Add at least one other participant');
    for (const id of otherIds) {
      if (!(await this.users.findById(this.db, id))) throw new NotFoundError(`User ${id}`);
    }

    const conversation = await this.conversations.createWithParticipants(this.db, {
      title: input.title ?? null,
      createdById: creatorId,
      participantIds: [creatorId, ...otherIds],
    });
    await this.notifications.notifyAddedToConversation(otherIds, conversation);
    return this.get(creatorId, conversation.id);
  }

  /** Each conversation carries the caller's unread count: no counting query needed. */
  async list(userId: string, query: ListConversationsQuery) {
    const { items, total } = await this.conversations.listForUser(
      this.db,
      userId,
      toSkipTake(query),
    );
    const views = items.map(({ participants, ...conversation }) => ({
      ...conversation,
      unreadCount: conversation.lastSeq - (participants[0]?.lastReadSeq ?? 0),
    }));
    return toPage(views, total, query);
  }

  async get(userId: string, id: string) {
    return this.requireParticipant(userId, id);
  }

  /** Throws 404 unless the user is a participant, so non-members cannot learn ids exist. */
  async requireParticipant(userId: string, id: string) {
    const conversation = await this.conversations.findForParticipant(this.db, id, userId);
    if (!conversation) throw new NotFoundError('Conversation');
    return conversation;
  }

  async isParticipant(userId: string, id: string): Promise<boolean> {
    return (await this.participants.find(this.db, id, userId)) !== null;
  }

  async update(userId: string, id: string, input: UpdateConversationInput) {
    await this.requireParticipant(userId, id);
    await this.conversations.update(this.db, id, { title: input.title });
    return this.get(userId, id);
  }

  async addParticipant(userId: string, id: string, newUserId: string) {
    const conversation = await this.requireParticipant(userId, id);
    if (!(await this.users.findById(this.db, newUserId))) throw new NotFoundError('User');
    if (await this.participants.find(this.db, id, newUserId)) {
      throw new ConflictError('User is already a participant');
    }
    await this.participants.add(this.db, id, newUserId);
    await this.notifications.notifyAddedToConversation([newUserId], conversation);
    return this.get(userId, id);
  }

  /** The last person to leave deletes the conversation and its messages. */
  async leave(userId: string, id: string) {
    await this.requireParticipant(userId, id);
    await this.participants.remove(this.db, id, userId);
    if ((await this.participants.count(this.db, id)) === 0) {
      await this.conversations.delete(this.db, id);
    }
  }

  /** Records that the user has read up to `seq` (capped at the newest message). */
  async markRead(userId: string, id: string, seq: number) {
    const conversation = await this.requireParticipant(userId, id);
    const upTo = Math.min(seq, conversation.lastSeq);
    await this.participants.advanceLastRead(this.db, id, userId, upTo);
    const me = await this.participants.find(this.db, id, userId);
    const lastReadSeq = me?.lastReadSeq ?? 0;
    return { lastReadSeq, unreadCount: conversation.lastSeq - lastReadSeq };
  }

  async presence(userId: string, id: string) {
    const conversation = await this.requireParticipant(userId, id);
    const ids = conversation.participants.map((p) => p.userId);
    const online = await this.presenceStore.onlineAmong(ids);
    return ids.map((participantId) => ({
      userId: participantId,
      online: online.has(participantId),
    }));
  }
}
