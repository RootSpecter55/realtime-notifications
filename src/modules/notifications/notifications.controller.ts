import type { Request, Response } from 'express';
import { currentUser } from '../../common/auth-middleware';
import { sendData, sendPage } from '../../common/response';
import type { ListNotificationsQuery, NotificationParams } from './notifications.schemas';
import type { NotificationsService } from './notifications.service';

export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  list = async (req: Request, res: Response) => {
    const query = req.validated.query as ListNotificationsQuery;
    sendPage(res, await this.service.list(currentUser(req).id, query));
  };

  markRead = async (req: Request, res: Response) => {
    const { id } = req.validated.params as NotificationParams;
    sendData(res, await this.service.markRead(currentUser(req).id, id));
  };

  markAllRead = async (req: Request, res: Response) => {
    sendData(res, await this.service.markAllRead(currentUser(req).id));
  };

  delete = async (req: Request, res: Response) => {
    const { id } = req.validated.params as NotificationParams;
    await this.service.delete(currentUser(req).id, id);
    res.status(204).end();
  };
}
