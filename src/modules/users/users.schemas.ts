import { z } from 'zod';
import { paginationQuerySchema } from '../../common/pagination';

const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const name = z.string().trim().min(1).max(100);

export const registerBody = z.object({ email, name, password: z.string().min(8).max(128) });
export const loginBody = z.object({ email, password: z.string().min(1).max(128) });
export const updateMeBody = z.object({ name });
export const userParams = z.object({ id: z.uuid() });
export const listUsersQuery = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
});

export type RegisterInput = z.infer<typeof registerBody>;
export type LoginInput = z.infer<typeof loginBody>;
export type UpdateMeInput = z.infer<typeof updateMeBody>;
export type UserParams = z.infer<typeof userParams>;
export type ListUsersQuery = z.infer<typeof listUsersQuery>;
