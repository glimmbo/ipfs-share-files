import React, { createContext, useCallback, useState } from 'react'

const STORAGE_KEY_URL = 'nodePinApiUrl'
const STORAGE_KEY_KEY = 'nodePinApiKey'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface NodePinContextType {
  apiUrl: string
  apiKey: string
  connectionStatus: ConnectionStatus
  connectionError: string | null
  remotePeerId: string | null
  setConfig(url: string, key: string): void
  testConnection(): Promise<void>
  pinCid(cid: string): Promise<void>
}

const defaultContext: NodePinContextType = {
  apiUrl: '',
  apiKey: '',
  connectionStatus: 'idle',
  connectionError: null,
  remotePeerId: null,
  setConfig: () => {},
  testConnection: async () => {},
  pinCid: async () => {}
}

export const NodePinContext = createContext<NodePinContextType>(defaultContext)

function buildHeaders (apiKey: string): HeadersInit {
  const headers: Record<string, string> = {}
  if (apiKey.trim() !== '') {
    headers.Authorization = ['Bearer', apiKey].join(' ')
  }
  return headers
}

export const NodePinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiUrl, setApiUrl] = useState<string>(() => localStorage.getItem(STORAGE_KEY_URL) ?? '')
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem(STORAGE_KEY_KEY) ?? '')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null)

  const setConfig = useCallback((url: string, key: string) => {
    const trimmedUrl = url.trim().replace(/\/$/, '')
    setApiUrl(trimmedUrl)
    setApiKey(key)
    localStorage.setItem(STORAGE_KEY_URL, trimmedUrl)
    localStorage.setItem(STORAGE_KEY_KEY, key)
    setConnectionStatus('idle')
    setConnectionError(null)
    setRemotePeerId(null)
  }, [])

  const testConnection = useCallback(async (): Promise<void> => {
    if (apiUrl === '') return
    setConnectionStatus('connecting')
    setConnectionError(null)
    setRemotePeerId(null)
    try {
      const res = await fetch(`${apiUrl}/api/v0/id`, {
        method: 'POST',
        headers: buildHeaders(apiKey)
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      const data = await res.json() as { ID?: string }
      setRemotePeerId(data.ID ?? null)
      setConnectionStatus('connected')
    } catch (e: any) {
      const msg: string = e instanceof TypeError
        ? 'Network error — check CORS settings on your IPFS node (see Kubo docs) and ensure the node is reachable.'
        : (e.message as string)
      setConnectionError(msg)
      setConnectionStatus('error')
    }
  }, [apiUrl, apiKey])

  const pinCid = useCallback(async (cid: string): Promise<void> => {
    if (apiUrl === '') return
    const res = await fetch(`${apiUrl}/api/v0/pin/add?arg=${encodeURIComponent(cid)}&recursive=true`, {
      method: 'POST',
      headers: buildHeaders(apiKey)
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
  }, [apiUrl, apiKey])

  const value: NodePinContextType = {
    apiUrl,
    apiKey,
    connectionStatus,
    connectionError,
    remotePeerId,
    setConfig,
    testConnection,
    pinCid
  }

  return (
    <NodePinContext.Provider value={value}>
      {children}
    </NodePinContext.Provider>
  )
}
