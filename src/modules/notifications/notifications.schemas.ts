import { z } from 'zod';
import { paginationQuerySchema } from '../../common/pagination';

export const notificationParams = z.object({ id: z.uuid() });

export const listNotificationsQuery = paginationQuerySchema.extend({
  unread: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type NotificationParams = z.infer<typeof notificationParams>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;
