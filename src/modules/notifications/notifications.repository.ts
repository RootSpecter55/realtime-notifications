import { BaseRepository } from '../../common/base-repository';
import type { Db } from '../../common/db';
import type { Notification, Prisma } from '../../generated/prisma/client';

export class NotificationRepository extends BaseRepository<
  Notification,
  Prisma.NotificationUncheckedCreateInput,
  Prisma.NotificationUncheckedUpdateInput,
  Prisma.NotificationWhereInput
> {
  protected delegate(db: Db) {
    return db.notification;
  }

  /** One INSERT for all recipients, returning the rows so they can be pushed live. */
  async createMany(db: Db, data: Prisma.NotificationCreateManyInput[]) {
    return db.notification.createManyAndReturn({ data });
  }

  /** A user's notifications, newest first; `unread` true/false filters, undefined returns all. */
  async listForUser(
    db: Db,
    userId: string,
    unread: boolean | undefined,
    { skip, take }: { skip: number; take: number },
  ) {
    const where: Prisma.NotificationWhereInput = { userId };
    if (unread !== undefined) where.readAt = unread ? null : { not: null };
    const items = await db.notification.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    });
    const total = await db.notification.count({ where });
    return { items, total };
  }

  async findOwned(db: Db, id: string, userId: string) {
    return db.notification.findFirst({ where: { id, userId } });
  }

  async markAllRead(db: Db, userId: string, now: Date) {
    const { count } = await db.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });
    return count;
  }
}
