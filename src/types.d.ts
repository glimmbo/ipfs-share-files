/* eslint-disable @typescript-eslint/method-signature-style */

declare module '*.svg' {
  const content: React.FC<React.SVGProps<SVGElement> & { alt?: string }>
  export default content
}

declare module 'ipfs-pubsub-room' {
  import type { EventEmitter } from 'node:events'

  export interface PubsubRoomMessage {
    from: string
    data: Uint8Array
  }

  export interface PubsubRoomOptions {
    pollInterval?: number
  }

  export interface PubsubRoom extends EventEmitter {
    broadcast(message: string | Uint8Array): void
    sendTo(peerId: string, message: string | Uint8Array): void
    leave(): Promise<void>
    getPeers(): string[]
    hasPeer(peerId: string): boolean
  }

  const room: (libp2p: any, roomName: string, options?: PubsubRoomOptions) => PubsubRoom
  export default room
}
