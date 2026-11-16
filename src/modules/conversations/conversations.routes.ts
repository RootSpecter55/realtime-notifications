import { Router, type RequestHandler } from 'express';
import { validate } from '../../common/validate';
import type { ConversationsController } from './conversations.controller';
import {
  addParticipantBody,
  conversationParams,
  createConversationBody,
  listConversationsQuery,
  markReadBody,
  updateConversationBody,
} from './conversations.schemas';

/** Mounted at /conversations. Only participants can see a conversation; others get 404. */
export function conversationsRoutes(
  controller: ConversationsController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate);
  const params = conversationParams;

  router.post('/', validate({ body: createConversationBody }), controller.create);
  router.get('/', validate({ query: listConversationsQuery }), controller.list);
  router.get('/:id', validate({ params }), controller.get);
  router.patch('/:id', validate({ params, body: updateConversationBody }), controller.update);
  router.post(
    '/:id/participants',
    validate({ params, body: addParticipantBody }),
    controller.addParticipant,
  );
  router.delete('/:id/participants/me', validate({ params }), controller.leave);
  router.post('/:id/read', validate({ params, body: markReadBody }), controller.markRead);
  router.get('/:id/presence', validate({ params }), controller.presence);
  return router;
}
