import { BaseRepository } from '../../common/base-repository';
import type { Db } from '../../common/db';
import type { Conversation, Participant, Prisma } from '../../generated/prisma/client';

const userFields = { select: { id: true, email: true, name: true } } as const;

export class ConversationRepository extends BaseRepository<
  Conversation,
  Prisma.ConversationUncheckedCreateInput,
  Prisma.ConversationUncheckedUpdateInput,
  Prisma.ConversationWhereInput
> {
  protected delegate(db: Db) {
    return db.conversation;
  }

  /** Creates the conversation and all participant rows in one statement. */
  async createWithParticipants(
    db: Db,
    data: { title: string | null; createdById: string; participantIds: string[] },
  ) {
    return db.conversation.create({
      data: {
        title: data.title,
        createdById: data.createdById,
        participants: { create: data.participantIds.map((userId) => ({ userId })) },
      },
    });
  }

  /** The conversation with participants (public user fields), only if `userId` is one of them. */
  async findForParticipant(db: Db, id: string, userId: string) {
    return db.conversation.findFirst({
      where: { id, participants: { some: { userId } } },
      include: { participants: { include: { user: userFields }, orderBy: { joinedAt: 'asc' } } },
    });
  }

  /** The user's conversations, most recent activity first, each with the user's own read position. */
  async listForUser(db: Db, userId: string, { skip, take }: { skip: number; take: number }) {
    const where = { participants: { some: { userId } } };
    const items = await db.conversation.findMany({
      where,
      skip,
      take,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: { participants: { where: { userId }, select: { lastReadSeq: true } } },
    });
    const total = await db.conversation.count({ where });
    return { items, total };
  }
}

export class ParticipantRepository {
  async find(db: Db, conversationId: string, userId: string): Promise<Participant | null> {
    return db.participant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
  }

  async listUserIds(db: Db, conversationId: string): Promise<string[]> {
    const rows = await db.participant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async add(db: Db, conversationId: string, userId: string) {
    return db.participant.create({ data: { conversationId, userId } });
  }

  async remove(db: Db, conversationId: string, userId: string) {
    await db.participant.delete({ where: { conversationId_userId: { conversationId, userId } } });
  }

  async count(db: Db, conversationId: string) {
    return db.participant.count({ where: { conversationId } });
  }

  /** Moves the read position forward only; an older `seq` arriving late cannot move it back. */
  async advanceLastRead(db: Db, conversationId: string, userId: string, seq: number) {
    await db.participant.updateMany({
      where: { conversationId, userId, lastReadSeq: { lt: seq } },
      data: { lastReadSeq: seq },
    });
  }
}
