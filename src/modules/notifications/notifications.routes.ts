import { Router, type RequestHandler } from 'express';
import { validate } from '../../common/validate';
import type { NotificationsController } from './notifications.controller';
import { listNotificationsQuery, notificationParams } from './notifications.schemas';

/** Mounted at /notifications. Every route acts on the caller's own notifications. */
export function notificationsRoutes(
  controller: NotificationsController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', validate({ query: listNotificationsQuery }), controller.list);
  router.post('/read-all', controller.markAllRead);
  router.post('/:id/read', validate({ params: notificationParams }), controller.markRead);
  router.delete('/:id', validate({ params: notificationParams }), controller.delete);
  return router;
}
