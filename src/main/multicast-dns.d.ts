declare module 'multicast-dns' {
  import { EventEmitter } from 'events'

  export interface MdnsQuestion {
    name: string
    type: string
    class?: number
  }

  export interface MdnsAnswer {
    name: string
    type: string
    ttl?: number
    flush?: boolean
    data: unknown
  }

  export interface MdnsPacket {
    type: 'query' | 'response'
    questions?: MdnsQuestion[]
    answers?: MdnsAnswer[]
    additionals?: MdnsAnswer[]
    authorities?: MdnsAnswer[]
  }

  export interface MdnsOptions {
    multicast?: boolean
    interface?: string
    port?: number
    ip?: string
    ttl?: number
    loopback?: boolean
    reuseAddr?: boolean
    type?: 'udp4' | 'udp6'
  }

  export interface MdnsInstance extends EventEmitter {
    query(packet: { questions: MdnsQuestion[] } | MdnsQuestion[], cb?: (err: Error | null) => void): void
    respond(packet: { answers: MdnsAnswer[] } | MdnsAnswer[], cb?: (err: Error | null) => void): void
    destroy(cb?: () => void): void
    on(event: 'ready', listener: () => void): this
    on(event: 'error' | 'warning', listener: (err: Error) => void): this
    on(event: 'query' | 'response', listener: (packet: MdnsPacket, rinfo: unknown) => void): this
    once(event: 'ready', listener: () => void): this
    once(event: 'error' | 'warning', listener: (err: Error) => void): this
    once(event: 'query' | 'response', listener: (packet: MdnsPacket, rinfo: unknown) => void): this
  }

  export default function makeMdns(options?: MdnsOptions): MdnsInstance
}
