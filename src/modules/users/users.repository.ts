import { BaseRepository } from '../../common/base-repository';
import type { Db } from '../../common/db';
import type { Prisma, User } from '../../generated/prisma/client';

export class UserRepository extends BaseRepository<
  User,
  Prisma.UserUncheckedCreateInput,
  Prisma.UserUncheckedUpdateInput,
  Prisma.UserWhereInput
> {
  protected delegate(db: Db) {
    return db.user;
  }

  async findByEmail(db: Db, email: string) {
    return db.user.findUnique({ where: { email } });
  }

  /** Users whose name or email contains `search` (case-insensitive), by name. */
  async search(db: Db, search: string | undefined, { skip, take }: { skip: number; take: number }) {
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const items = await db.user.findMany({ where, skip, take, orderBy: { name: 'asc' } });
    const total = await db.user.count({ where });
    return { items, total };
  }
}
