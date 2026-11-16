import { z } from 'zod';
import { paginationQuerySchema } from '../../common/pagination';

const title = z.string().trim().min(1).max(100);

export const conversationParams = z.object({ id: z.uuid() });

export const createConversationBody = z.object({
  title: title.optional(),
  /** Other people to include; the creator is always added. */
  participantIds: z.array(z.uuid()).min(1).max(50),
});

export const updateConversationBody = z.object({ title: title.nullable() });

export const addParticipantBody = z.object({ userId: z.uuid() });

/** Marks everything up to and including `seq` as read. */
export const markReadBody = z.object({ seq: z.number().int().min(0) });

export const listConversationsQuery = paginationQuerySchema;

export type ConversationParams = z.infer<typeof conversationParams>;
export type CreateConversationInput = z.infer<typeof createConversationBody>;
export type UpdateConversationInput = z.infer<typeof updateConversationBody>;
export type AddParticipantInput = z.infer<typeof addParticipantBody>;
export type MarkReadInput = z.infer<typeof markReadBody>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuery>;
