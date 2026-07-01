import { defineStore } from 'pinia'
import apiClient from '../services/api'
import { connectWebSocket, disconnectWebSocket } from '../services/websocketService'

const PALETTE = [
  'text-emerald-400', 'text-blue-400', 'text-purple-400',
  'text-orange-400', 'text-pink-400', 'text-yellow-400',
]
const _colorCache = {}
function userColor(username) {
  if (!_colorCache[username]) {
    const hash = [...(username || '?')].reduce((a, c) => a + c.charCodeAt(0), 0)
    _colorCache[username] = PALETTE[hash % PALETTE.length]
  }
  return _colorCache[username]
}

export const DRUM_LABELS = {
  C4: 'Kick', D4: 'Snare', E4: 'Hi-hat', F4: 'Open Hi-hat',
  G4: 'Tom H', A4: 'Tom L', B4: 'Crash', C5: 'Clap',
}

const GUITAR_CHORDS = {
  C4: ['C3', 'E3', 'G3', 'C4', 'E4'],
  D4: ['D3', 'F3', 'A3', 'D4', 'F4'],
  E4: ['E2', 'B2', 'E3', 'G3', 'B3'],
  F4: ['F3', 'A3', 'C4', 'F4'],
  G4: ['G2', 'B2', 'D3', 'G3', 'B3'],
  A4: ['A2', 'E3', 'A3', 'C4', 'E4'],
  B4: ['B3', 'D4', 'F4', 'B4'],
  C5: ['C4', 'E4', 'G4', 'C5'],
}

// ─── Salamander Grand Piano sample URLs ──────────────────────────────────────
const SALAMANDER_URLS = {
  A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
  A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
  A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
  A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
  A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
  A5: 'A5.mp3', C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
  A6: 'A6.mp3', C7: 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
  A7: 'A7.mp3', C8: 'C8.mp3',
}
const SALAMANDER_BASE = 'https://tonejs.github.io/audio/salamander/'

// ─── Multi-instrument audio state ────────────────────────────────────────────
// Each instrument is built lazily on first use and kept alive for the session.
// Incoming events are routed by event.instrument — not the local selection.
// This means remote users are heard through their own chosen instrument.
let masterGain = null
const instruments = {}   // { piano: {...}, guitar: {...}, synth: {...}, drum: {...} }

function disposeAllInstruments() {
  for (const inst of Object.values(instruments)) {
    if (inst?.releaseTimer) clearTimeout(inst.releaseTimer)
    inst?.nodes?.forEach(n => { try { n.dispose() } catch { /* ignore */ } })
  }
  for (const k of Object.keys(instruments)) delete instruments[k]
}

async function ensureInstrument(Tone, instrument) {
  if (!masterGain) masterGain = new Tone.Gain(1).toDestination()
  if (instruments[instrument]) return

  switch (instrument) {
    case 'guitar': {
      const reverb = new Tone.Reverb({ decay: 2.8, wet: 0.32 }).connect(masterGain)
      const strings = Array.from({ length: 6 }, () => {
        const s = new Tone.PluckSynth({ attackNoise: 1.5, dampening: 3200, resonance: 0.988 })
          .connect(reverb)
        s.volume.value = -4
        return s
      })
      instruments.guitar = { strings, nodes: [reverb, ...strings] }
      break
    }
    case 'synth': {
      const reverb = new Tone.Reverb({ decay: 3.5, wet: 0.45 }).connect(masterGain)
      const chorus = new Tone.Chorus({ frequency: 3, delayTime: 3.5, depth: 0.7 }).connect(reverb)
      chorus.wet.value = 0.5
      chorus.start()
      const fm = new Tone.FMSynth({
        harmonicity: 3, modulationIndex: 12,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.08, decay: 0.3, sustain: 0.85, release: 2.5 },
        modulation: { type: 'triangle' },
        modulationEnvelope: { attack: 0.4, decay: 0.01, sustain: 1, release: 0.5 },
      }).connect(chorus)
      fm.volume.value = -6
      instruments.synth = { fm, sustain: null, releaseTimer: null, nodes: [reverb, chorus, fm] }
      break
    }
    case 'drum': {
      const room = new Tone.Reverb({ decay: 0.6, wet: 0.14 }).connect(masterGain)
      const kick = new Tone.MembraneSynth({
        pitchDecay: 0.09, octaves: 7,
        envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.12 },
      }).connect(room)
      kick.volume.value = -3
      const snareHP = new Tone.Filter(2500, 'highpass').connect(masterGain)
      const snare = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.04 },
      }).connect(snareHP)
      snare.volume.value = -5
      const hihatHP = new Tone.Filter(10000, 'highpass').connect(masterGain)
      const hihat = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.01 },
      }).connect(hihatHP)
      hihat.volume.value = -9
      const openHP = new Tone.Filter(8000, 'highpass').connect(masterGain)
      const openHihat = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0.05, release: 0.2 },
      }).connect(openHP)
      openHihat.volume.value = -9
      const tomH = new Tone.MembraneSynth({
        pitchDecay: 0.06, octaves: 3,
        envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.08 },
      }).connect(masterGain)
      tomH.volume.value = -5
      const tomL = new Tone.MembraneSynth({
        pitchDecay: 0.08, octaves: 4,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
      }).connect(masterGain)
      tomL.volume.value = -5
      const crashHP = new Tone.Filter(5000, 'highpass').connect(masterGain)
      const crash = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.005, decay: 0.9, sustain: 0.08, release: 0.6 },
      }).connect(crashHP)
      crash.volume.value = -11
      const clapBP = new Tone.Filter({ frequency: 1800, type: 'bandpass', Q: 0.8 }).connect(masterGain)
      const clap = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 },
      }).connect(clapBP)
      clap.volume.value = -6
      instruments.drum = {
        triggers: {
          C4: () => kick.triggerAttackRelease('C1', '8n'),
          D4: () => snare.triggerAttackRelease('8n'),
          E4: () => hihat.triggerAttackRelease('16n'),
          F4: () => openHihat.triggerAttackRelease('8n'),
          G4: () => tomH.triggerAttackRelease('A2', '8n'),
          A4: () => tomL.triggerAttackRelease('E2', '8n'),
          B4: () => crash.triggerAttackRelease('4n'),
          C5: () => clap.triggerAttackRelease('16n'),
        },
        nodes: [
          room, kick, snareHP, snare, hihatHP, hihat,
          openHP, openHihat, tomH, tomL, crashHP, crash, clapBP, clap,
        ],
      }
      break
    }
    default: { // piano
      const reverb = new Tone.Reverb({ decay: 1.8, wet: 0.18 }).connect(masterGain)
      const sampler = new Tone.Sampler({
        urls: SALAMANDER_URLS, release: 1,
        baseUrl: SALAMANDER_BASE,
      }).connect(reverb)
      sampler.volume.value = -6
      instruments.piano = { sampler, sustain: null, releaseTimer: null, nodes: [reverb, sampler] }
    }
  }
}

function playNoteForInstrument(note, instrument) {
  if (!masterGain) return

  switch (instrument) {
    case 'drum': {
      const trigger = instruments.drum?.triggers[note] ?? instruments.drum?.triggers['C4']
      trigger?.()
      break
    }
    case 'guitar': {
      const { strings } = instruments.guitar ?? {}
      if (!strings) break
      const chordNotes = GUITAR_CHORDS[note] ?? [note]
      chordNotes.forEach((n, i) => {
        try { strings[i % strings.length]?.triggerAttackRelease(n, 3, `+${i * 0.028}`) } catch { /* ignore */ }
      })
      break
    }
    case 'synth': {
      const inst = instruments.synth
      if (!inst) break
      clearTimeout(inst.releaseTimer)
      if (inst.sustain) try { inst.fm.triggerRelease() } catch { /* ignore */ }
      inst.sustain = note
      try { inst.fm.triggerAttack(note) } catch { /* ignore */ }
      inst.releaseTimer = setTimeout(() => {
        if (!inst.sustain) return
        try { inst.fm.triggerRelease() } catch { /* ignore */ }
        inst.sustain = null
      }, 3000)
      break
    }
    default: { // piano
      const inst = instruments.piano
      if (!inst) break
      clearTimeout(inst.releaseTimer)
      if (inst.sustain) try { inst.sampler.triggerRelease(inst.sustain) } catch { /* ignore */ }
      inst.sustain = note
      try { inst.sampler.triggerAttack(note) } catch { /* ignore */ }
      inst.releaseTimer = setTimeout(() => {
        if (!inst.sustain) return
        try { inst.sampler.triggerRelease(inst.sustain) } catch { /* ignore */ }
        inst.sustain = null
      }, 3000)
    }
  }
}

// ─── Canon audio state (independent from instrument routing above) ────────────
// HTML5 Audio + Web Audio GainNode allows volume > 1.0.
let canonAudio = null
let canonAudioCtx = null
let canonGainNode = null

// ─── Vite HMR cleanup ────────────────────────────────────────────────────────
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (masterGain) {
      try { masterGain.gain.value = 0 } catch { /* ignore */ }
      try { masterGain.disconnect() } catch { /* ignore */ }
      try { masterGain.dispose() } catch { /* ignore */ }
      masterGain = null
    }
    disposeAllInstruments()
    if (canonAudio) { canonAudio.pause(); canonAudio = null }
    if (canonAudioCtx) { try { canonAudioCtx.close() } catch { /* ignore */ } ; canonAudioCtx = null }
    canonGainNode = null
  })
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useDashboardStore = defineStore('dashboard', {
  state: () => ({
    wsConnected: false,
    audioEnabled: false,
    selectedInstrument: 'piano',
    currentNote: null,
    currentUsername: null,
    recentNotes: [],
    recentGestures: [],
    canonPlaying: false,
  }),

  getters: {
    noteColor: (state) => userColor(state.currentUsername),
  },

  actions: {
    connect() {
      connectWebSocket({
        onNote: (event) => this._handleNoteEvent(event),
        onConnect: () => { this.wsConnected = true },
        onDisconnect: () => { this.wsConnected = false },
      })
    },

    disconnect() {
      disconnectWebSocket()
      this.wsConnected = false
    },

    async enableAudio() {
      const Tone = await import('tone')
      await Tone.start()
      await ensureInstrument(Tone, this.selectedInstrument)
      this.audioEnabled = true
    },

    async setInstrument(instrument) {
      this.selectedInstrument = instrument
      // Pre-build the instrument so the first note plays without latency.
      // All other instruments stay alive — remote users still heard correctly.
      if (this.audioEnabled) {
        const Tone = await import('tone')
        await ensureInstrument(Tone, instrument)
      }
    },

    async playCanon() {
      this.stopCanon()
      if (!canonAudio) {
        canonAudio = new Audio('/audio/canon.mp3')
        canonAudioCtx = new AudioContext()
        const source = canonAudioCtx.createMediaElementSource(canonAudio)
        canonGainNode = canonAudioCtx.createGain()
        canonGainNode.gain.value = 1.5
        source.connect(canonGainNode)
        canonGainNode.connect(canonAudioCtx.destination)
      }
      canonAudio.currentTime = 150
      canonAudio.onended = () => { this.canonPlaying = false }
      try {
        if (canonAudioCtx.state === 'suspended') await canonAudioCtx.resume()
        await canonAudio.play()
        this.canonPlaying = true
      } catch {
        this.canonPlaying = false
      }
    },

    stopCanon() {
      if (canonAudio) {
        canonAudio.pause()
        canonAudio.currentTime = 150
        canonAudio.onended = null
      }
      this.canonPlaying = false
    },

    async fetchRecentGestures() {
      try {
        const { data } = await apiClient.get('/gestures/recent?limit=10')
        this.recentGestures = data
      } catch { /* ignore */ }
    },

    _handleNoteEvent(event) {
      this.currentNote = event.note
      this.currentUsername = event.username
      const eventInstrument = event.instrument ?? 'piano'
      const isDrum = eventInstrument === 'drum'
      this.recentNotes.unshift({
        id: event.id ?? Date.now(),
        username: event.username,
        note: isDrum ? (DRUM_LABELS[event.note] ?? event.note) : event.note,
        instrument: eventInstrument,
        volume: event.volume,
        time: new Date(event.createdAt ?? Date.now()).toLocaleTimeString(),
        color: userColor(event.username),
      })
      if (this.recentNotes.length > 20) this.recentNotes.pop()
      if (this.audioEnabled) {
        import('tone').then(Tone =>
          ensureInstrument(Tone, eventInstrument).then(() =>
            playNoteForInstrument(event.note, eventInstrument)
          )
        )
      }
    },
  },
})
