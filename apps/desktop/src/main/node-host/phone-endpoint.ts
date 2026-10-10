import { createConnectionRpc, createFramedWire, type AuthenticatedClient, type RpcContext } from '@superone/runtime/server'
import { ADMIN_PAIRING_SCOPES } from '@superone/shared/environment'
import log from '../logger'
import type { DesktopDomain } from './desktop-domain'
import { bindControlActor } from '@superone/runtime/lease'

/** One open link of a paired phone (a LAN socket or its relay slot), as the endpoint writes to it. */
export interface PhoneLink {
  deviceId: string
  /** The pairing's key id; the actor's fingerprint. */
  keyId: string
  transport: 'lan' | 'relay'
  /** Seal one protocol frame for this link's channel and send it. */
  write(frame: Uint8Array): void
  /** Bytes the link's socket still holds. */
  buffered(): number
  close(code: number, reason: string): void
}

/** A phone's protocol connection on one link: frames in, closed with the link. */
export interface PhoneConnection {
  receive(frame: Uint8Array): void
  close(): void
}

/**
 * The actor of a phone's requests: its pairing, not a node client session.
 * Phones are this desktop's user's devices and hold every scope; leases and
 * receipts key off `phone:<deviceId>`.
 */
export function phoneClient(link: Pick<PhoneLink, 'deviceId' | 'keyId'>): AuthenticatedClient {
  return {
    clientSessionId: `phone:${link.deviceId}`,
    scopes: [...ADMIN_PAIRING_SCOPES],
    devicePublicKeyFingerprint: link.keyId,
    devicePublicKeyPem: '',
  }
}

/**
 * Serve the protocol to a phone on one link from the desktop domain, through
 * the same connection handler node sockets use. The link layer authenticates
 * the pairing and checks it before each frame, so the handler does not.
 */
export function openPhoneConnection(domain: DesktopDomain, link: PhoneLink): PhoneConnection {
  const wire = createFramedWire({ write: link.write, buffered: link.buffered })
  const client = phoneClient(link)
  const routed = domain.openPhoneRoute(client)
  const rpc = createConnectionRpc<RpcContext>({
    identity: domain.identity,
    client,
    wire,
    route: link.transport,
    surface: 'phone',
    context: {
      ...domain.phoneContext(),
      leases: bindControlActor(domain.leases, {
        clientSessionId: client.clientSessionId,
        holderClientId: `desktop:${domain.identity.environmentId}`,
        delegate: client.clientSessionId,
        yields: false,
      }),
    },
    dispatch: domain.dispatchRpc,
    control: domain.leases,
    holdsControl: lease => lease.delegate === client.clientSessionId,
    routeRpc: routed?.dispatch,
    isRevoked: () => false,
    close: link.close,
  })
  return {
    receive(frame) {
      let message: unknown
      try {
        message = wire.read(frame, true)
      } catch (err) {
        log.warn('[phone-endpoint] unreadable frame from %s: %s', link.deviceId, err instanceof Error ? err.message : String(err))
        link.close(1008, 'protocol_error')
        return
      }
      if (message !== undefined) void rpc(() => message)
    },
    close() {
      rpc.dispose()
      routed?.close()
      wire.close()
    },
  }
}
