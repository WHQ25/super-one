import WebSocket from 'ws'

/**
 * The part of a `ws` socket the node channel uses on either end. A plain
 * WebSocket is one; a relay slot (`relay-node-link.ts`) is another, so the
 * channel handshake, attach and RPC code run unchanged over both.
 */
export type NodeSocket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'on' | 'once' | 'off' | 'removeAllListeners'>

/** Opens a socket to a node's `/ws` URL (or, for the relay, to the node's room). */
export type NodeSocketDialer = (wsUrl: string) => NodeSocket

export const dialWebSocket: NodeSocketDialer = (wsUrl) => new WebSocket(wsUrl)

/** Must cover workspace.readFile/writeFile max (10 MiB) plus RPC framing overhead. */
export const MAX_NODE_FRAME_BYTES = 12 * 1024 * 1024
