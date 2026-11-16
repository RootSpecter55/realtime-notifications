import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { ResolveUser } from '../common/auth-middleware';
import { ClientConnection, type ConnectionDeps } from './client-connection';

export const WS_PATH = '/ws';

/**
 * WebSocket endpoint at /ws?token=<JWT>, sharing the HTTP server with the REST API.
 * The token is checked during the HTTP upgrade, so an unauthenticated client gets a plain
 * 401 and never has an open socket. (Browsers cannot set headers on a WebSocket, which is
 * why the token travels in the query string.)
 */
export class RealtimeGateway {
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(
    server: Server,
    private readonly resolveUser: ResolveUser,
    private readonly deps: ConnectionDeps,
  ) {
    server.on('upgrade', (req, socket, head) => void this.handleUpgrade(req, socket, head));
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    let user;
    try {
      user = await this.resolveUser(url.searchParams.get('token') ?? '');
    } catch {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      new ClientConnection(ws, user, this.deps).start().catch((err: unknown) => {
        this.deps.logger.error({ err }, 'Failed to start WebSocket connection');
        ws.close(1011, 'Server error');
      });
    });
  }

  /** Closes every socket, for graceful shutdown. */
  close(): Promise<void> {
    for (const ws of this.wss.clients) ws.close(1001, 'Server shutting down');
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }
}
