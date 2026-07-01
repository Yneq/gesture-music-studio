import { Client } from '@stomp/stompjs'

// Use the current page's host so the WS goes through Vite's proxy on LAN too
const _proto = location.protocol === 'https:' ? 'wss' : 'ws'
const WS_URL = import.meta.env.VITE_WS_BASE_URL || `${_proto}://${location.host}/ws`

let stompClient = null

export function connectWebSocket({ onNote, onConnect, onDisconnect }) {
  stompClient = new Client({
    brokerURL: WS_URL,
    reconnectDelay: 3000,
    onConnect: () => {
      stompClient.subscribe('/topic/notes', (message) => {
        try {
          onNote(JSON.parse(message.body))
        } catch {
          // ignore malformed messages
        }
      })
      onConnect?.()
    },
    onDisconnect: () => onDisconnect?.(),
    onStompError: () => onDisconnect?.(),
  })

  stompClient.activate()
}

export function disconnectWebSocket() {
  stompClient?.deactivate()
  stompClient = null
}
