import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
let socketToken: string | null = null;
let pendingDisconnect: ReturnType<typeof setTimeout> | null = null;

/**
 * Connects to the backend's Socket.IO `/ws` namespace (see realtime.gateway.ts).
 * Reuses an existing connection for the same token instead of tearing it down
 * and reconnecting -- this specifically absorbs React 18 StrictMode's
 * deliberate dev-only mount->cleanup->mount double-invoke (RealtimeProvider's
 * effect runs, its cleanup calls disconnectRealtime(), then the effect runs
 * again immediately). Without this, that cycle creates a socket, destroys it
 * mid-handshake, and creates another -- functionally harmless (the second
 * socket connects fine) but shows a confusing "WebSocket is closed before
 * the connection is established" console warning every time in dev.
 * `removeAllListeners()` clears the previous mount's handlers so the caller
 * re-attaching its own `.on(...)` calls right after this returns doesn't end
 * up with duplicate listeners on the reused socket.
 */
export function connectRealtime(accessToken: string): Socket {
  if (pendingDisconnect) {
    clearTimeout(pendingDisconnect);
    pendingDisconnect = null;
  }
  if (socket && socketToken === accessToken) {
    socket.removeAllListeners();
    return socket;
  }
  socket?.disconnect();
  socket = io('/ws', {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
  });
  socketToken = accessToken;
  return socket;
}

/**
 * Deferred, not immediate -- see connectRealtime()'s comment. A real unmount
 * (navigating away, logging out) lets this timer fire and actually
 * disconnect; an immediate StrictMode remount cancels it via connectRealtime()
 * instead, so the socket survives the dev-only double-invoke intact.
 */
export function disconnectRealtime(): void {
  if (pendingDisconnect) clearTimeout(pendingDisconnect);
  pendingDisconnect = setTimeout(() => {
    socket?.disconnect();
    socket = null;
    socketToken = null;
    pendingDisconnect = null;
  }, 0);
}

export function getSocket(): Socket | null {
  return socket;
}
