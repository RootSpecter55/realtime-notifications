import { BaseRepository } from '../../common/base-repository';
import type { Db } from '../../common/db';
import type { Message, Prisma, PrismaClient } from '../../generated/prisma/client';

export class MessageRepository extends BaseRepository<
  Message,
  Prisma.MessageUncheckedCreateInput,
  Prisma.MessageUncheckedUpdateInput,
  Prisma.MessageWhereInput
> {
  protected delegate(db: Db) {
    return db.message;
  }

  /**
   * Appends a message with the conversation's next sequence number, in one transaction:
   *   1. UPDATE conversations SET last_seq = last_seq + 1 ... RETURNING last_seq
   *   2. INSERT the message with that seq
   * Step 1 locks the conversation row until commit, so concurrent senders in the same
   * conversation take turns and seqs come out 1, 2, 3 ... with no gaps or duplicates.
   * If the insert fails, the increment rolls back with it.
   */
  async append(db: PrismaClient, conversationId: string, senderId: string, body: string) {
    return db.$transaction(async (tx) => {
      const { lastSeq } = await tx.conversation.update({
        where: { id: conversationId },
        data: { lastSeq: { increment: 1 }, lastMessageAt: new Date() },
        select: { lastSeq: true },
      });
      return tx.message.create({ data: { conversationId, senderId, body, seq: lastSeq } });
    });
  }

  /** Messages after `afterSeq` in sequence order: used for paging and reconnect replay. */
  async listAfter(
    db: Db,
    conversationId: string,
    afterSeq: number,
    { skip, take }: { skip: number; take: number },
  ) {
    const where = { conversationId, seq: { gt: afterSeq } };
    const items = await db.message.findMany({ where, skip, take, orderBy: { seq: 'asc' } });
    const total = await db.message.count({ where });
    return { items, total };
  }
}
