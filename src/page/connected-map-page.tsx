import Room from 'ipfs-pubsub-room'
import L from 'leaflet'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { Helmet } from 'react-helmet'
import { useTranslation } from 'react-i18next'
import { Planet } from 'react-planet'
import { useHelia } from '../hooks/use-helia.js'
import type { PubsubRoom } from 'ipfs-pubsub-room'
import type { LeafletMouseEvent, Map as LeafletMap, LatLngExpression } from 'leaflet'
import './connected-map-page.css'
import 'leaflet/dist/leaflet.css'

const ROOM_NAME = 'ipfs-share-files-live-map'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
interface BroadcastPoint {
  lat: number
  lng: number
  accuracy?: number
}

type WaypointStatus = 'pending' | 'accepted' | 'denied'

interface Waypoint {
  id: string
  lat: number
  lng: number
  label: string
  assignedBy: string
  status: WaypointStatus
  updatedAt: number
}

interface PeerPresence {
  peerId: string
  displayName: string
  broadcastEnabled: boolean
  audioEnabled: boolean
  location: BroadcastPoint | null
  updatedAt: number
}

type PeerState = PeerPresence & {
  waypoint?: Waypoint | null
  incomingWaypoint?: Waypoint | null
}

interface PresenceMessage {
  type: 'presence'
  payload: PeerPresence
}

interface WaypointRequestMessage {
  type: 'waypoint-request'
  payload: {
    targetPeerId: string
    waypoint: Waypoint
    fromPeerId: string
  }
}

interface WaypointResponseMessage {
  type: 'waypoint-response'
  payload: {
    targetPeerId: string
    waypointId: string
    fromPeerId: string
    status: WaypointStatus
  }
}

interface AudioSignalMessage {
  type: 'audio-signal'
  payload: {
    fromPeerId: string
    toPeerId: string
    kind: 'offer' | 'answer' | 'candidate'
    sdp?: RTCSessionDescriptionInit
    candidate?: RTCIceCandidateInit
  }
}

type RoomMessage = PresenceMessage | WaypointRequestMessage | WaypointResponseMessage | AudioSignalMessage

interface AudioPeer {
  peerId: string
  stream: MediaStream
}

const parseMessage = (message: Uint8Array): RoomMessage | null => {
  try {
    return JSON.parse(textDecoder.decode(message)) as RoomMessage
  } catch {
    return null
  }
}

const normalizeName = (peerId: string, displayName: string | null | undefined): string => {
  const trimmed = displayName?.trim()
  if (trimmed == null || trimmed.length === 0) return peerId.slice(0, 8)
  return trimmed
}

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

const waypointLabel = (waypoint: Waypoint): string => {
  return `${waypoint.label} • ${waypoint.status}`
}

const makeWaypoint = (peerId: string, lat: number, lng: number, label: string): Waypoint => ({
  id: crypto.randomUUID(),
  lat,
  lng,
  label,
  assignedBy: peerId,
  status: 'pending',
  updatedAt: Date.now()
})

const useLocalStorageString = (key: string, defaultValue: string): [string, (value: string) => void] => {
  const [value, setValue] = useState(() => {
    const stored = globalThis.localStorage?.getItem(key)
    return stored ?? defaultValue
  })

  useEffect(() => {
    globalThis.localStorage?.setItem(key, value)
  }, [key, value])

  return [value, setValue]
}

const MapPeerOverlay = ({
  overlayEl,
  map,
  peers,
  selectedPeerId,
  selfPeerId,
  onSelectPeer,
  onRequestWaypoint,
  onToggleBroadcast,
  onToggleAudio
}: {
  overlayEl: HTMLDivElement | null
  map: LeafletMap | null
  peers: PeerState[]
  selectedPeerId: string | null
  selfPeerId: string
  onSelectPeer(peerId: string): void
  onRequestWaypoint(peerId: string): void
  onToggleBroadcast(): void
  onToggleAudio(): void
}): React.ReactNode => {
  if (overlayEl == null || map == null) return null

  const renderedPeers = peers
    .filter(peer => peer.broadcastEnabled && peer.location != null)
    .map((peer, index) => {
      const location = peer.location
      if (location == null) return null
      const point = map.latLngToContainerPoint([location.lat, location.lng])
      const peerIsSelected = peer.peerId === selectedPeerId
      const isSelf = peer.peerId === selfPeerId

      return (
        <div
          key={peer.peerId}
          className='connected-map-peer'
          style={{
            left: point.x,
            top: point.y,
            zIndex: peerIsSelected ? 700 : 500 + index
          }}
        >
          <Planet
            open={peerIsSelected}
            autoClose
            orbitRadius={isSelf ? 112 : 96}
            bounce
            centerContent={(
              <button
                type='button'
                className={`connected-map-marker connected-map-marker--${peerIsSelected ? 'selected' : 'idle'}`}
                onClick={() => { onSelectPeer(peer.peerId) }}
                aria-label={peer.displayName}
              >
                {initials(peer.displayName)}
              </button>
            )}
          >
            <button
              type='button'
              className='connected-map-action'
              onClick={() => { onSelectPeer(peer.peerId) }}
            >
              Focus
            </button>
            {isSelf
              ? (
                <button
                  type='button'
                  className='connected-map-action'
                  onClick={onToggleBroadcast}
                >
                  Broadcast
                </button>
                )
              : (
                <>
                  <button
                    type='button'
                    className='connected-map-action'
                    onClick={() => { onRequestWaypoint(peer.peerId) }}
                  >
                    Waypoint
                  </button>
                <button
                  type='button'
                  className='connected-map-action'
                  onClick={() => { onToggleAudio() }}
                >
                  Call
                </button>
                </>
                )}
          </Planet>
        </div>
      )
    })

  return createPortal(renderedPeers, overlayEl)
}

const LeafletMapScene = ({
  peers,
  selfPeerId,
  selectedPeerId,
  onSelectPeer,
  onRequestWaypoint,
  onToggleBroadcast,
  onToggleAudio,
  onMapClick
}: {
  peers: PeerState[]
  selfPeerId: string
  selectedPeerId: string | null
  onSelectPeer(peerId: string): void
  onRequestWaypoint(peerId: string): void
  onToggleBroadcast(): void
  onToggleAudio(): void
  onMapClick(lat: number, lng: number): void
}): React.JSX.Element => {
  const mapElRef = useRef<HTMLDivElement | null>(null)
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [, setViewportTick] = useState(0)
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null)
  const lineLayerRef = useRef<L.LayerGroup | null>(null)
  const visiblePoints = useMemo(() => peers.flatMap((peer) => {
    if (!peer.broadcastEnabled || peer.location == null) return []
    return [peer.location]
  }), [peers])
  const selectedPeer = peers.find(peer => peer.peerId === selectedPeerId) ?? null
  const visiblePointsKey = visiblePoints.map(point => `${point.lat},${point.lng}`).join('|')
  const waypointKey = useMemo(() => peers.map(peer => {
    const waypoint = peer.peerId === selfPeerId ? (peer.incomingWaypoint ?? peer.waypoint) : peer.waypoint
    if (waypoint == null) return ''
    return `${peer.peerId}:${waypoint.id}:${waypoint.status}:${waypoint.lat},${waypoint.lng}`
  }).join('|'), [peers, selfPeerId])

  useEffect(() => {
    if (mapElRef.current == null || map !== null) return

    const nextMap = L.map(mapElRef.current, {
      center: [20, 0],
      zoom: 2,
      scrollWheelZoom: true
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(nextMap)

    nextMap.on('click', (event: LeafletMouseEvent) => {
      onMapClick(event.latlng.lat, event.latlng.lng)
    })
    nextMap.on('move zoom resize', () => {
      setViewportTick((value) => value + 1)
    })

    lineLayerRef.current = L.layerGroup().addTo(nextMap)
    setMap(nextMap)

    return () => {
      nextMap.remove()
      lineLayerRef.current = null
      setMap(null)
    }
  }, [map, onMapClick])

  useEffect(() => {
    if (map == null || visiblePoints.length === 0) return

    if (visiblePoints.length === 1) {
      map.setView([visiblePoints[0].lat, visiblePoints[0].lng], Math.max(map.getZoom(), 5), { animate: true })
      return
    }

    const bounds = L.latLngBounds(visiblePoints.map((point): LatLngExpression => [point.lat, point.lng]))
    map.fitBounds(bounds.pad(0.2), { animate: true })
  }, [map, visiblePointsKey])

  useEffect(() => {
    if (map == null) return
    if (lineLayerRef.current == null) {
      lineLayerRef.current = L.layerGroup().addTo(map)
    }

    const layer = lineLayerRef.current
    layer.clearLayers()

    peers.forEach(peer => {
      if (peer.location == null) return

      if (peer.waypoint != null && peer.waypoint.status === 'accepted') {
        layer.addLayer(L.polyline([[peer.location.lat, peer.location.lng], [peer.waypoint.lat, peer.waypoint.lng]], {
          color: '#6ee7b7',
          weight: 3,
          opacity: 0.85
        }))
      }

      if (peer.peerId === selfPeerId && peer.incomingWaypoint != null) {
        layer.addLayer(L.polyline([[peer.location.lat, peer.location.lng], [peer.incomingWaypoint.lat, peer.incomingWaypoint.lng]], {
          color: '#fcd34d',
          weight: 2,
          dashArray: '8 8',
          opacity: 0.7
        }))
      }
    })
  }, [map, peers, selfPeerId, waypointKey])

  return (
    <div className='connected-map-shell'>
      <div ref={mapElRef} className='connected-map-canvas' />
      <div ref={setOverlayEl} className='connected-map-overlay' />
      <MapPeerOverlay
        overlayEl={overlayEl}
        map={map}
        peers={peers}
        selectedPeerId={selectedPeerId}
        selfPeerId={selfPeerId}
        onSelectPeer={onSelectPeer}
        onRequestWaypoint={onRequestWaypoint}
        onToggleBroadcast={onToggleBroadcast}
        onToggleAudio={onToggleAudio}
      />

      <div className='connected-map-selection'>
        <div className='connected-map-selection__title'>
          {selectedPeer == null ? 'Select a user from the map or list' : `${selectedPeer.displayName} selected`}
        </div>
        <div className='connected-map-selection__body'>
          {selectedPeer?.waypoint != null
            ? waypointLabel(selectedPeer.waypoint)
            : 'Assign a waypoint to create the operator line.'}
        </div>
      </div>
    </div>
  )
}

/* eslint-disable jsx-a11y/media-has-caption */
const AudioPeerElement = ({ peerId, stream }: AudioPeer): React.JSX.Element => {
  const audioRef = useCallback((node: HTMLAudioElement | null) => {
    if (node == null) return
    node.srcObject = stream
    void node.play()
  }, [stream])

  return <audio ref={audioRef} autoPlay data-peer-id={peerId} />
}
/* eslint-enable jsx-a11y/media-has-caption */

const ConnectedMapPage = (): React.JSX.Element => {
  const [t] = useTranslation()
  const { helia, error } = useHelia()
  const [displayName, setDisplayName] = useLocalStorageString('ipfs-share-files-display-name', '')
  const [broadcastEnabled, setBroadcastEnabled] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null)
  const [selfLocation, setSelfLocation] = useState<BroadcastPoint | null>(null)
  const [roomStatus, setRoomStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [roomError, setRoomError] = useState<string | null>(null)
  const [peers, setPeers] = useState<Record<string, PeerState>>({})
  const [connectedPeerIds, setConnectedPeerIds] = useState<string[]>([])
  const [remoteAudioPeers, setRemoteAudioPeers] = useState<Record<string, MediaStream>>({})
  const roomRef = useRef<PubsubRoom | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const displayNameRef = useRef(displayName)
  const broadcastEnabledRef = useRef(broadcastEnabled)
  const audioEnabledRef = useRef(audioEnabled)
  const selfLocationRef = useRef<BroadcastPoint | null>(selfLocation)
  const selfPeerId = useMemo(() => {
    if (helia == null) return ''
    return (helia).libp2p.peerId.toString()
  }, [helia])

  useEffect(() => {
    displayNameRef.current = displayName
  }, [displayName])

  useEffect(() => {
    broadcastEnabledRef.current = broadcastEnabled
  }, [broadcastEnabled])

  useEffect(() => {
    audioEnabledRef.current = audioEnabled
  }, [audioEnabled])

  useEffect(() => {
    selfLocationRef.current = selfLocation
  }, [selfLocation])

  const publishPresence = useCallback((override?: Partial<PeerPresence>) => {
    const room = roomRef.current
    if (room == null || selfPeerId === '') return

    const payload: PeerPresence = {
      peerId: selfPeerId,
      displayName: normalizeName(selfPeerId, displayNameRef.current),
      broadcastEnabled: broadcastEnabledRef.current,
      audioEnabled: audioEnabledRef.current,
      location: broadcastEnabledRef.current ? selfLocationRef.current : null,
      updatedAt: Date.now(),
      ...override
    }

    room.broadcast(textEncoder.encode(JSON.stringify({ type: 'presence', payload } satisfies PresenceMessage)))
  }, [selfPeerId])

  const updatePeer = useCallback((peerId: string, updater: (current: PeerState | undefined) => PeerState) => {
    setPeers((current) => ({
      ...current,
      [peerId]: updater(current[peerId])
    }))
  }, [])

  const closePeerConnection = useCallback((peerId: string) => {
    const connection = peerConnectionsRef.current.get(peerId)
    if (connection != null) {
      connection.onicecandidate = null
      connection.ontrack = null
      connection.close()
      peerConnectionsRef.current.delete(peerId)
    }
    setRemoteAudioPeers((current) => {
      const { [peerId]: _removed, ...next } = current
      return next
    })
  }, [])

  const sendSignal = useCallback((peerId: string, payload: AudioSignalMessage['payload']) => {
    const room = roomRef.current
    if (room == null) return
    room.sendTo(peerId, textEncoder.encode(JSON.stringify({ type: 'audio-signal', payload } satisfies AudioSignalMessage)))
  }, [])

  const ensurePeerConnection = useCallback((peerId: string) => {
    if (peerId === selfPeerId) return null

    const existing = peerConnectionsRef.current.get(peerId)
    if (existing != null) return existing

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })

    connection.onicecandidate = (event) => {
      if (event.candidate == null) return
      sendSignal(peerId, {
        fromPeerId: selfPeerId,
        toPeerId: peerId,
        kind: 'candidate',
        candidate: event.candidate.toJSON()
      })
    }

    connection.ontrack = (event) => {
      const [stream] = event.streams
      if (stream == null) return
      setRemoteAudioPeers((current) => ({
        ...current,
        [peerId]: stream
      }))
    }

    peerConnectionsRef.current.set(peerId, connection)

    const mic = localStreamRef.current
    if (mic != null) {
      mic.getTracks().forEach(track => connection.addTrack(track, mic))
    }

    return connection
  }, [selfPeerId, sendSignal])

  const startAudio = useCallback(async () => {
    if (audioEnabled) return
    setAudioError(null)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    localStreamRef.current = stream
    setAudioEnabled(true)
  }, [audioEnabled])

  const stopAudio = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(track => { track.stop() })
    localStreamRef.current = null
    setAudioEnabled(false)
    peerConnectionsRef.current.forEach(connection => {
      connection.close()
    })
    peerConnectionsRef.current.clear()
    setRemoteAudioPeers({})
  }, [])

  const toggleAudio = useCallback(() => {
    if (audioEnabled) {
      stopAudio()
      return
    }
    startAudio().catch((err: Error) => {
      setAudioError(err.message)
      setAudioEnabled(false)
    })
  }, [audioEnabled, startAudio, stopAudio])

  const requestWaypoint = useCallback((peerId: string) => {
    const target = peers[peerId]
    if (target?.location == null) return
    const label = `Waypoint for ${target.displayName}`
    const waypoint = makeWaypoint(selfPeerId, target.location.lat, target.location.lng, label)
    const room = roomRef.current
    if (room == null) return

    room.sendTo(peerId, textEncoder.encode(JSON.stringify({
      type: 'waypoint-request',
      payload: {
        targetPeerId: peerId,
        waypoint,
        fromPeerId: selfPeerId
      }
    } satisfies WaypointRequestMessage)))

    updatePeer(peerId, (current) => ({
      peerId,
      displayName: normalizeName(peerId, current?.displayName),
      broadcastEnabled: current?.broadcastEnabled ?? false,
      audioEnabled: current?.audioEnabled ?? false,
      location: current?.location ?? null,
      updatedAt: Date.now(),
      waypoint
    }))
    setSelectedPeerId(peerId)
  }, [peers, selfPeerId, updatePeer])

  const acceptWaypoint = useCallback((status: WaypointStatus) => {
    const room = roomRef.current
    const incoming = peers[selfPeerId]?.incomingWaypoint
    if (room == null || incoming == null) return

    const nextWaypoint = {
      ...incoming,
      status,
      updatedAt: Date.now()
    }

    updatePeer(selfPeerId, (current) => ({
      peerId: selfPeerId,
      displayName: normalizeName(selfPeerId, current?.displayName ?? displayNameRef.current),
      broadcastEnabled: broadcastEnabledRef.current,
      audioEnabled: audioEnabledRef.current,
      location: selfLocationRef.current,
      updatedAt: Date.now(),
      waypoint: nextWaypoint,
      incomingWaypoint: undefined
    }))

    room.broadcast(textEncoder.encode(JSON.stringify({
      type: 'waypoint-response',
      payload: {
        targetPeerId: selfPeerId,
        waypointId: incoming.id,
        fromPeerId: selfPeerId,
        status
      }
    } satisfies WaypointResponseMessage)))
  }, [peers, selfPeerId, updatePeer])

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (selectedPeerId == null || selectedPeerId === selfPeerId) return
    const target = peers[selectedPeerId]
    if (target == null) return

    const waypoint = makeWaypoint(selfPeerId, lat, lng, `Waypoint for ${target.displayName}`)
    const room = roomRef.current
    if (room == null) return

    room.sendTo(selectedPeerId, textEncoder.encode(JSON.stringify({
      type: 'waypoint-request',
      payload: {
        targetPeerId: selectedPeerId,
        waypoint,
        fromPeerId: selfPeerId
      }
    } satisfies WaypointRequestMessage)))

    updatePeer(selectedPeerId, (current) => ({
      peerId: selectedPeerId,
      displayName: normalizeName(selectedPeerId, current?.displayName),
      broadcastEnabled: current?.broadcastEnabled ?? false,
      audioEnabled: current?.audioEnabled ?? false,
      location: current?.location ?? null,
      updatedAt: Date.now(),
      waypoint
    }))
  }, [peers, selfPeerId, selectedPeerId, updatePeer])

  useEffect(() => {
    publishPresence()
  }, [displayName, publishPresence])

  useEffect(() => {
    publishPresence()
  }, [audioEnabled, broadcastEnabled, selfLocation, publishPresence])

  useEffect(() => {
    if (selfPeerId === '') return

    const onPosition = (position: GeolocationPosition): void => {
      setSelfLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
      })
    }

    if (navigator.geolocation == null) return

    const watchId = navigator.geolocation.watchPosition(onPosition, (err) => {
      setRoomError(err.message)
    }, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000
    })

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [selfPeerId])

  useEffect(() => {
    if (helia == null) return
    const libp2p = helia.libp2p
    const room = Room(libp2p, ROOM_NAME, { pollInterval: 1500 })
    roomRef.current = room
    setRoomStatus('connecting')

    const syncPeers = (): void => {
      const connected = room.getPeers()
      setConnectedPeerIds(connected)
      connected.forEach(peerId => {
        updatePeer(peerId, (current) => ({
          peerId,
          displayName: normalizeName(peerId, current?.displayName),
          broadcastEnabled: current?.broadcastEnabled ?? false,
          audioEnabled: current?.audioEnabled ?? false,
          location: current?.location ?? null,
          updatedAt: current?.updatedAt ?? Date.now(),
          waypoint: current?.waypoint,
          incomingWaypoint: current?.incomingWaypoint
        }))
      })
    }

    const handleRoomMessage = (message: { from: string, data: Uint8Array }): void => {
      const parsed = parseMessage(message.data)
      if (parsed == null) return

      if (parsed.type === 'presence') {
        const presence = parsed.payload
        if (presence.peerId === selfPeerId) return
        updatePeer(presence.peerId, (current) => ({
          peerId: presence.peerId,
          displayName: normalizeName(presence.peerId, presence.displayName),
          broadcastEnabled: presence.broadcastEnabled,
          audioEnabled: presence.audioEnabled,
          location: presence.location,
          updatedAt: presence.updatedAt,
          waypoint: current?.waypoint,
          incomingWaypoint: current?.incomingWaypoint
        }))
        return
      }

      if (parsed.type === 'waypoint-request') {
        const { targetPeerId, waypoint } = parsed.payload
        if (targetPeerId !== selfPeerId) return
        updatePeer(selfPeerId, (current) => ({
          peerId: selfPeerId,
          displayName: normalizeName(selfPeerId, current?.displayName ?? displayNameRef.current),
          broadcastEnabled: broadcastEnabledRef.current,
          audioEnabled: audioEnabledRef.current,
          location: selfLocationRef.current,
          updatedAt: Date.now(),
          waypoint: current?.waypoint,
          incomingWaypoint: waypoint
        }))
        return
      }

      if (parsed.type === 'waypoint-response') {
        const { targetPeerId, waypointId, status, fromPeerId } = parsed.payload
        if (targetPeerId === selfPeerId) {
          updatePeer(selfPeerId, (current) => ({
            peerId: selfPeerId,
            displayName: normalizeName(selfPeerId, current?.displayName ?? displayNameRef.current),
            broadcastEnabled: broadcastEnabledRef.current,
            audioEnabled: audioEnabledRef.current,
            location: selfLocationRef.current,
            updatedAt: Date.now(),
            waypoint: {
              ...(current?.incomingWaypoint ?? current?.waypoint ?? { id: waypointId, lat: 0, lng: 0, label: 'Waypoint', assignedBy: fromPeerId, status, updatedAt: Date.now() }),
              status,
              updatedAt: Date.now()
            },
            incomingWaypoint: undefined
          }))
          return
        }

        updatePeer(targetPeerId, (current) => {
          const waypoint = current?.waypoint
          if (current == null || waypoint == null || waypoint.id !== waypointId) {
            return current ?? {
              peerId: targetPeerId,
              displayName: normalizeName(targetPeerId, null),
              broadcastEnabled: false,
              audioEnabled: false,
              location: null,
              updatedAt: Date.now(),
              waypoint: {
                id: waypointId,
                lat: 0,
                lng: 0,
                label: 'Waypoint',
                assignedBy: fromPeerId,
                status,
                updatedAt: Date.now()
              }
            }
          }

          const updated: PeerState = {
            peerId: current.peerId,
            displayName: current.displayName,
            broadcastEnabled: current.broadcastEnabled,
            audioEnabled: current.audioEnabled,
            location: current.location,
            updatedAt: current.updatedAt,
            waypoint: {
              ...waypoint,
              status,
              updatedAt: Date.now()
            },
            incomingWaypoint: current.incomingWaypoint
          }
          return updated
        })
        return
      }

      if (parsed.type === 'audio-signal') {
        const payload = parsed.payload
        if (payload.toPeerId !== selfPeerId) return
        const connection = ensurePeerConnection(payload.fromPeerId)
        if (connection == null) return

        const handleSignal = async (): Promise<void> => {
          if (payload.kind === 'offer' && payload.sdp != null) {
            await connection.setRemoteDescription(payload.sdp)
            const answer = await connection.createAnswer()
            await connection.setLocalDescription(answer)
            sendSignal(payload.fromPeerId, {
              fromPeerId: selfPeerId,
              toPeerId: payload.fromPeerId,
              kind: 'answer',
              sdp: connection.localDescription ?? answer
            })
            return
          }

          if (payload.kind === 'answer' && payload.sdp != null) {
            await connection.setRemoteDescription(payload.sdp)
            return
          }

          if (payload.kind === 'candidate' && payload.candidate != null) {
            await connection.addIceCandidate(payload.candidate)
          }
        }

        handleSignal().catch((err: Error) => {
          setAudioError(err.message)
        })
      }
    }

    const handlePeerJoined = (peerId: string): void => {
      syncPeers()
      updatePeer(peerId, (current) => ({
        peerId,
        displayName: normalizeName(peerId, current?.displayName),
        broadcastEnabled: current?.broadcastEnabled ?? false,
        audioEnabled: current?.audioEnabled ?? false,
        location: current?.location ?? null,
        updatedAt: Date.now(),
        waypoint: current?.waypoint,
        incomingWaypoint: current?.incomingWaypoint
      }))
    }

    const handlePeerLeft = (peerId: string): void => {
      closePeerConnection(peerId)
      setPeers((current) => {
        const { [peerId]: _removed, ...next } = current
        return next
      })
      setConnectedPeerIds((current) => current.filter(id => id !== peerId))
    }

    const handleSubscribed = (): void => {
      setRoomStatus('connected')
      syncPeers()
      publishPresence()
    }

    room.on('subscribed', handleSubscribed)
    room.on('message', handleRoomMessage)
    room.on('peer joined', handlePeerJoined)
    room.on('peer left', handlePeerLeft)

    publishPresence()

    return () => {
      room.removeListener('subscribed', handleSubscribed)
      room.removeListener('message', handleRoomMessage)
      room.removeListener('peer joined', handlePeerJoined)
      room.removeListener('peer left', handlePeerLeft)
      void room.leave()
      roomRef.current = null
      for (const connection of peerConnectionsRef.current.values()) {
        connection.close()
      }
      peerConnectionsRef.current.clear()
    }
  }, [closePeerConnection, ensurePeerConnection, helia, publishPresence, selfPeerId, updatePeer])

  useEffect(() => {
    if (!audioEnabled) return

    const peerIds = connectedPeerIds.filter(peerId => peerId !== selfPeerId)
    peerIds.forEach(peerId => {
      const connection = ensurePeerConnection(peerId)
      if (connection == null || connection.signalingState !== 'stable') return

      if (selfPeerId.localeCompare(peerId) < 0) {
        (async () => {
          const offer = await connection.createOffer()
          await connection.setLocalDescription(offer)
          sendSignal(peerId, {
            fromPeerId: selfPeerId,
            toPeerId: peerId,
            kind: 'offer',
            sdp: connection.localDescription ?? offer
          })
        })().catch((err: Error) => {
          setAudioError(err.message)
        })
      }
    })
  }, [audioEnabled, connectedPeerIds, ensurePeerConnection, selfPeerId, sendSignal])

  useEffect(() => {
    if (!audioEnabled) return

    const timer = window.setInterval(() => {
      publishPresence()
    }, 4000)

    return () => {
      window.clearInterval(timer)
    }
  }, [audioEnabled, publishPresence])

  useEffect(() => {
    if (!audioEnabled) return

    const mic = localStreamRef.current
    if (mic == null) return

    const peerIds = connectedPeerIds.filter(peerId => peerId !== selfPeerId)
    peerIds.forEach(peerId => {
      const connection = ensurePeerConnection(peerId)
      if (connection == null) return

      const existingSenders = connection.getSenders().some(sender => sender.track === mic.getAudioTracks()[0])
      if (!existingSenders) {
        mic.getTracks().forEach(track => connection.addTrack(track, mic))
      }
    })
  }, [audioEnabled, connectedPeerIds, ensurePeerConnection, selfPeerId])

  const allPeers = useMemo(() => {
    const merged = {
      ...peers
    }

    if (selfPeerId !== '') {
      merged[selfPeerId] = {
        peerId: selfPeerId,
        displayName: normalizeName(selfPeerId, displayName),
        broadcastEnabled,
        audioEnabled,
        location: selfLocation,
        updatedAt: peers[selfPeerId]?.updatedAt ?? 0,
        waypoint: peers[selfPeerId]?.waypoint,
        incomingWaypoint: peers[selfPeerId]?.incomingWaypoint
      }
    }

    return Object.values(merged).sort((left, right) => left.displayName.localeCompare(right.displayName))
  }, [audioEnabled, broadcastEnabled, displayName, peers, selfLocation, selfPeerId])

  const selectedPeer = allPeers.find(peer => peer.peerId === selectedPeerId) ?? null
  const incomingWaypoint = peers[selfPeerId]?.incomingWaypoint ?? null

  if (error != null) {
    return (
      <div className='connected-map-page'>
        <Helmet>
          <title>{t('pageTitle.ipfs')} | {t('pageTitle.control')}</title>
        </Helmet>
        <div className='connected-map-panel'>
          <h2 className='connected-map-title'>Helia is not ready</h2>
          <p className='connected-map-copy'>{error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className='connected-map-page'>
      <Helmet>
        <title>{t('pageTitle.ipfs')} | {t('pageTitle.control')}</title>
      </Helmet>

      <div className='connected-map-header'>
        <div>
          <div className='connected-map-kicker'>Live ops</div>
          <h1 className='connected-map-title'>Connected users</h1>
          <p className='connected-map-copy'>
            Share location, route waypoints, and keep a group audio call running over the room.
          </p>
        </div>
        <div className='connected-map-status'>
          <span className={`connected-map-pill connected-map-pill--${roomStatus}`}>{roomStatus}</span>
          <span className='connected-map-pill'>Peers: {allPeers.length}</span>
          <span className='connected-map-pill'>Selected: {selectedPeer?.displayName ?? 'none'}</span>
        </div>
      </div>

      <div className='connected-map-grid'>
        <section className='connected-map-sidebar'>
          <label className='connected-map-field'>
            <span>Display name</span>
            <input
              value={displayName}
              onChange={(event) => { setDisplayName(event.target.value) }}
              placeholder='Your name'
            />
          </label>

          <div className='connected-map-switches'>
            <label className='connected-map-switch'>
              <input
                type='checkbox'
                checked={broadcastEnabled}
                onChange={(event) => { setBroadcastEnabled(event.target.checked) }}
              />
              <span>Broadcast my location</span>
            </label>
            <label className='connected-map-switch'>
              <input
                type='checkbox'
                checked={audioEnabled}
                onChange={() => { toggleAudio() }}
              />
              <span>Group audio call</span>
            </label>
          </div>

          {audioError != null ? <div className='connected-map-error'>{audioError}</div> : null}
          {roomError != null ? <div className='connected-map-error'>{roomError}</div> : null}

          {incomingWaypoint != null
            ? (
            <div className='connected-map-waypoint'>
              <div className='connected-map-waypoint__title'>Waypoint request</div>
              <div className='connected-map-waypoint__body'>{waypointLabel(incomingWaypoint)}</div>
              <div className='connected-map-waypoint__actions'>
                <button type='button' onClick={() => { acceptWaypoint('accepted') }}>Accept</button>
                <button type='button' onClick={() => { acceptWaypoint('denied') }}>Deny</button>
              </div>
            </div>
              )
            : null}

          <div className='connected-map-list'>
            {allPeers.map(peer => (
              <button
                key={peer.peerId}
                type='button'
                className={`connected-map-list-item ${peer.peerId === selectedPeerId ? 'connected-map-list-item--selected' : ''}`}
                onClick={() => { setSelectedPeerId(peer.peerId) }}
              >
                <span>
                  <strong>{peer.displayName}</strong>
                  <small>{peer.broadcastEnabled ? 'broadcasting' : 'hidden'}</small>
                </span>
                <span>{peer.audioEnabled ? 'audio on' : 'audio off'}</span>
              </button>
            ))}
          </div>
        </section>

        <section className='connected-map-main'>
          <LeafletMapScene
            peers={allPeers}
            selfPeerId={selfPeerId}
            selectedPeerId={selectedPeerId}
            onSelectPeer={setSelectedPeerId}
            onRequestWaypoint={requestWaypoint}
            onToggleBroadcast={() => { setBroadcastEnabled((value) => !value) }}
            onToggleAudio={toggleAudio}
            onMapClick={handleMapClick}
          />
        </section>
      </div>

      <div className='connected-map-audio'>
        {Object.entries(remoteAudioPeers).map(([peerId, stream]) => (
          <AudioPeerElement key={peerId} peerId={peerId} stream={stream} />
        ))}
      </div>
    </div>
  )
}

export default ConnectedMapPage
