import { Router, type RequestHandler } from 'express';
import { validate } from '../../common/validate';
import type { UsersController } from './users.controller';
import { listUsersQuery, loginBody, registerBody, updateMeBody, userParams } from './users.schemas';

/** Mounted at /auth. */
export function authRoutes(controller: UsersController): Router {
  const router = Router();
  router.post('/register', validate({ body: registerBody }), controller.register);
  router.post('/login', validate({ body: loginBody }), controller.login);
  return router;
}

/** Mounted at /users. */
export function usersRoutes(controller: UsersController, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);
  // "/me" routes are declared before "/:id" so "me" is never read as an id.
  router.get('/me', controller.me);
  router.patch('/me', validate({ body: updateMeBody }), controller.updateMe);
  router.delete('/me', controller.deleteMe);
  router.get('/', validate({ query: listUsersQuery }), controller.list);
  router.get('/:id', validate({ params: userParams }), controller.get);
  router.get('/:id/presence', validate({ params: userParams }), controller.presence);
  return router;
}
