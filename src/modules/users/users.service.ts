import type { AuthUser } from '../../common/auth-middleware';
import type { Db } from '../../common/db';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../common/errors';
import { toPage, toSkipTake } from '../../common/pagination';
import type { User } from '../../generated/prisma/client';
import type { PresenceStore } from '../../realtime/presence';
import { hashPassword, verifyPassword, type TokenService } from './tokens';
import type { UserRepository } from './users.repository';
import type { ListUsersQuery, LoginInput, RegisterInput, UpdateMeInput } from './users.schemas';

export type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'createdAt'>;

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly presenceStore: PresenceStore,
  ) {}

  async register(input: RegisterInput) {
    if (await this.users.findByEmail(this.db, input.email)) {
      throw new ConflictError('An account with this email already exists');
    }
    const user = await this.users.create(this.db, {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
    });
    return { user: toPublicUser(user), token: this.tokens.issue(user) };
  }

  async login(input: LoginInput) {
    const user = await this.users.findByEmail(this.db, input.email);
    // Same error for unknown email and wrong password, so the response does not reveal which.
    const valid = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !valid) throw new UnauthorizedError('Invalid email or password');
    return { user: toPublicUser(user), token: this.tokens.issue(user) };
  }

  async get(id: string): Promise<PublicUser> {
    const user = await this.users.findById(this.db, id);
    if (!user) throw new NotFoundError('User');
    return toPublicUser(user);
  }

  async list(query: ListUsersQuery) {
    const { items, total } = await this.users.search(this.db, query.search, toSkipTake(query));
    return toPage(items.map(toPublicUser), total, query);
  }

  async updateMe(userId: string, input: UpdateMeInput) {
    return toPublicUser(await this.users.update(this.db, userId, input));
  }

  /** Deleting a user cascades to their participations, messages and notifications. */
  async deleteMe(userId: string) {
    await this.users.delete(this.db, userId);
  }

  async presence(userId: string) {
    await this.get(userId);
    return { userId, online: await this.presenceStore.isOnline(userId) };
  }

  /** Shared by the HTTP auth middleware and the WebSocket gateway. */
  resolveUser = async (token: string): Promise<AuthUser> => {
    const { userId } = this.tokens.verify(token);
    const user = await this.users.findById(this.db, userId);
    if (!user) throw new UnauthorizedError();
    return { id: user.id, email: user.email };
  };
}
