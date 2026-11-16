import { z } from 'zod';
import { paginationQuerySchema } from '../../common/pagination';

const body = z.string().trim().min(1).max(4000);

export const conversationMessagesParams = z.object({ id: z.uuid() });
export const messageParams = z.object({ id: z.uuid() });

export const sendMessageBody = z.object({ body });
export const editMessageBody = z.object({ body });

export const listMessagesQuery = paginationQuerySchema.extend({
  /** Only messages after this sequence number: how a client catches up through REST. */
  afterSeq: z.coerce.number().int().min(0).default(0),
});

export type ConversationMessagesParams = z.infer<typeof conversationMessagesParams>;
export type MessageParams = z.infer<typeof messageParams>;
export type SendMessageInput = z.infer<typeof sendMessageBody>;
export type EditMessageInput = z.infer<typeof editMessageBody>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;
