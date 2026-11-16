import { Router, type RequestHandler } from 'express';
import { validate } from '../../common/validate';
import type { MessagesController } from './messages.controller';
import {
  conversationMessagesParams,
  editMessageBody,
  listMessagesQuery,
  messageParams,
  sendMessageBody,
} from './messages.schemas';

/** Mounted at /conversations/:id/messages. */
export function conversationMessagesRoutes(
  controller: MessagesController,
  authenticate: RequestHandler,
): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  const params = conversationMessagesParams;
  router.post('/', validate({ params, body: sendMessageBody }), controller.send);
  router.get('/', validate({ params, query: listMessagesQuery }), controller.list);
  return router;
}

/** Mounted at /messages: edit and delete by message id. */
export function messagesRoutes(
  controller: MessagesController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate);
  router.patch('/:id', validate({ params: messageParams, body: editMessageBody }), controller.edit);
  router.delete('/:id', validate({ params: messageParams }), controller.delete);
  return router;
}
