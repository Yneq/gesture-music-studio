<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useDashboardStore, DRUM_LABELS } from '../stores/dashboardStore'

const DRUM_RING = { C4: 'Kick', D4: 'Snare', E4: 'HH', F4: 'Op.HH', G4: 'Tom↑', A4: 'Tom↓', B4: 'Crash', C5: 'Clap' }
import apiClient from '../services/api'

const emit = defineEmits(['status', 'gesture'])

const dashboard = useDashboardStore()

const videoRef = ref(null)
const canvasRef = ref(null)
const status = ref('idle')   // idle | starting | running | error
const errorMsg = ref('')
const needsHttps = ref(false)
const detectedNote = ref(null)
const swipeHint = ref(null)   // e.g. '→ 🎸 Acoustic'
const siteOrigin = location.origin

watch(status, v => emit('status', v))

// NOTES comes from the store so the ring updates when user edits the layout
const INNER = 0.12
const OUTER = 0.38
const REPEAT_MS = 800   // same zone re-trigger cooldown

const INST_LABELS = { piano: '🎹 Piano', guitar: '🎸 Acoustic', synth: '🎛️ Synth', drum: '🥁 Drum' }

let recognizer = null
let mediaStream = null
let rafId = null
let lastNoteAt = 0
let lastNote = null
const gestureEmitAt = {}   // { gestureName: timestamp } — debounce per gesture type

// Swipe detection state
let wristBuffer = []      // normalized canvas-X (mirrored), last N frames
let lastSwipeAt = 0
const WRIST_BUF = 8
const SWIPE_DELTA = 0.13  // 13% of frame width needed
const SWIPE_COOLDOWN = 1200

// Volume knob state
let smoothedVol = 1.0
let prevPalmAngle = null          // null = not tracking (hand absent or wrong gesture)
const VOL_SENSITIVITY = 0.75 / Math.PI  // 180° rotation ≈ 75% volume change

// ─── Note zone helpers ────────────────────────────────────────────────────────

function noteAtPosition(rawX, rawY) {
  const x = 1 - rawX   // mirror to match display
  const dx = x - 0.5, dy = rawY - 0.5
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < INNER || dist > OUTER) return null
  let angle = Math.atan2(dy, dx) + Math.PI / 2
  if (angle < 0) angle += 2 * Math.PI
  return dashboard.activeNotes[Math.floor((angle / (2 * Math.PI)) * 8) % 8]
}

function noteAtCanvasPos(e) {
  const canvas = canvasRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const normX = (e.clientX - rect.left) / rect.width
  const normY = (e.clientY - rect.top) / rect.height
  const dx = normX - 0.5, dy = normY - 0.5
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < INNER || dist > OUTER) return null
  let angle = Math.atan2(dy, dx) + Math.PI / 2
  if (angle < 0) angle += 2 * Math.PI
  return dashboard.activeNotes[Math.floor((angle / (2 * Math.PI)) * 8) % 8]
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────

function drawRing(ctx, W, H, highlightNote = null) {
  const cx = W * 0.5, cy = H * 0.5
  const minDim = Math.min(W, H)
  const ri = INNER * minDim, ro = OUTER * minDim

  for (let i = 0; i < 8; i++) {
    const a1 = (i / 8) * 2 * Math.PI - Math.PI / 2
    const a2 = ((i + 1) / 8) * 2 * Math.PI - Math.PI / 2
    const isHit = dashboard.activeNotes[i] === highlightNote
    ctx.beginPath()
    ctx.arc(cx, cy, ro, a1, a2)
    ctx.arc(cx, cy, ri, a2, a1, true)
    ctx.closePath()
    if (isHit) {
      ctx.fillStyle = 'rgba(52,211,153,0.65)'
      ctx.shadowColor = 'rgba(52,211,153,0.9)'
      ctx.shadowBlur = 18
    } else {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(212,175,55,0.18)' : 'rgba(10,4,0,0.6)'
      ctx.shadowBlur = 0
    }
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = isHit ? 'rgba(52,211,153,0.9)' : 'rgba(212,175,55,0.45)'
    ctx.lineWidth = isHit ? 2 : 1
    ctx.stroke()
  }
  for (const r of [ri, ro]) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(212,175,55,0.7)'
    ctx.lineWidth = 2
    ctx.shadowColor = 'rgba(212,175,55,0.4)'
    ctx.shadowBlur = 6
    ctx.stroke()
    ctx.shadowBlur = 0
  }
  const labelR = (INNER + OUTER) / 2 * minDim
  const isDrum = dashboard.selectedInstrument === 'drum'
  ctx.font = `bold ${Math.round(minDim * (isDrum ? 0.044 : 0.055))}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  dashboard.activeNotes.forEach((note, i) => {
    const a = ((i + 0.5) / 8) * 2 * Math.PI - Math.PI / 2
    const isHit = note === highlightNote
    ctx.fillStyle = isHit ? '#34d399' : 'rgba(212,175,55,0.95)'
    ctx.shadowColor = isHit ? 'rgba(52,211,153,0.8)' : 'rgba(212,175,55,0.5)'
    ctx.shadowBlur = isHit ? 10 : 4
    const label = isDrum ? (DRUM_RING[note] ?? note) : note
    ctx.fillText(label, cx + Math.cos(a) * labelR, cy + Math.sin(a) * labelR)
  })
  ctx.shadowBlur = 0
}

function drawOverlay(landmarks) {
  const canvas = canvasRef.value
  const video = videoRef.value
  if (!canvas || !video) return
  if (!video.videoWidth || !video.videoHeight) return
  // Use display dimensions so the ring is never distorted regardless of video resolution
  const rect = canvas.getBoundingClientRect()
  const W = Math.round(rect.width) || canvas.offsetWidth
  const H = Math.round(rect.height) || canvas.offsetHeight
  if (!W || !H) return
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  drawRing(ctx, W, H, null)

  if (landmarks) {
    // Landmarks are normalized [0,1] so multiply by display size directly
    const lx = i => (1 - landmarks[i].x) * W
    const ly = i => landmarks[i].y * H
    const CONNECTIONS = [
      [0,1],[1,2],[2,3],[3,4],
      [5,6],[6,7],[7,8],
      [9,10],[10,11],[11,12],
      [13,14],[14,15],[15,16],
      [17,18],[18,19],[19,20],
      [0,5],[5,9],[9,13],[13,17],[0,17],
    ]
    ctx.lineWidth = 2
    CONNECTIONS.forEach(([a, b]) => {
      ctx.beginPath()
      ctx.moveTo(lx(a), ly(a))
      ctx.lineTo(lx(b), ly(b))
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.stroke()
    })
    for (let i = 0; i < 21; i++) {
      ctx.beginPath()
      ctx.arc(lx(i), ly(i), 4, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fill()
    }
    const TIPS = [4, 8, 12, 16, 20]
    const TIP_COLORS = ['#facc15','#34d399','#60a5fa','#c084fc','#fb923c']
    TIPS.forEach((t, i) => {
      ctx.beginPath()
      ctx.arc(lx(t), ly(t), 7, 0, Math.PI * 2)
      ctx.fillStyle = TIP_COLORS[i]
      ctx.fill()
    })
  }
}

// Volume bar + rotation dial indicator
function drawVolumeFeedback(ctx, lm, W, H, vol, angleDeg) {
  const hue = vol * 110   // 0 = red, 110 ≈ green

  // Volume bar on right edge
  const bW = 7, bH = H * 0.55, bX = W - bW - 8, bY = (H - bH) / 2
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fillRect(bX, bY, bW, bH)
  ctx.fillStyle = `hsl(${hue},100%,55%)`
  const fillH = bH * vol
  ctx.fillRect(bX, bY + bH - fillH, bW, fillH)

  // Percentage label
  const fs = Math.round(Math.min(W, H) * 0.042)
  ctx.font = `bold ${fs}px monospace`
  ctx.fillStyle = 'white'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.8)'
  ctx.shadowBlur = 3
  ctx.fillText(`${Math.round(vol * 100)}%`, bX - 4, bY + bH / 2)
  ctx.shadowBlur = 0

  // Rotation dial: small semicircle arc + pointer in top-left
  const cx = 36, cy = 36, r = 24
  ctx.beginPath()
  ctx.arc(cx, cy, r, -Math.PI * 0.75, Math.PI * 0.75)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.stroke()
  // Filled arc proportional to volume
  ctx.beginPath()
  ctx.arc(cx, cy, r, -Math.PI * 0.75, -Math.PI * 0.75 + vol * Math.PI * 1.5)
  ctx.strokeStyle = `hsl(${hue},100%,60%)`
  ctx.lineWidth = 5
  ctx.stroke()
  // Pointer needle
  const needleAngle = -Math.PI * 0.75 + vol * Math.PI * 1.5
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(needleAngle) * r * 0.75, cy + Math.sin(needleAngle) * r * 0.75)
  ctx.strokeStyle = 'white'
  ctx.lineWidth = 2
  ctx.stroke()
  // Dial label
  ctx.font = `bold ${Math.round(Math.min(W,H)*0.032)}px monospace`
  ctx.fillStyle = 'white'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowBlur = 3
  ctx.fillText(`${Math.round(vol * 100)}%`, cx, cy + r + 12)
  ctx.shadowBlur = 0
}

function drawIdleRing(highlightNote = null) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const W = Math.round(rect.width) || canvas.offsetWidth
  const H = Math.round(rect.height) || canvas.offsetHeight
  if (!W || !H) return
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  drawRing(ctx, W, H, highlightNote)

  const minDim = Math.min(W, H)
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.font = `${Math.round(minDim * 0.038)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('點擊音區觸發音符', W * 0.5, H * 0.5)
}

// ─── Mouse interaction (idle / error state) ───────────────────────────────────

let isMouseDown = false
let hoverNote = null

function fireNote(note) {
  const now = Date.now()
  if (!note || (note === lastNote && now - lastNoteAt < REPEAT_MS)) return
  lastNote = note
  lastNoteAt = now
  detectedNote.value = note
  setTimeout(() => { detectedNote.value = null }, 600)
  apiClient.post('/music-events', {
    note, instrument: dashboard.selectedInstrument, volume: Math.round(smoothedVol * 100),
  }).catch(e => console.warn('music-event POST failed', e))
}

function onCanvasMouseDown(e) {
  if (status.value === 'starting') return
  isMouseDown = true
  const note = noteAtCanvasPos(e)
  fireNote(note)
  // Only redraw idle ring when camera isn't rendering its own overlay
  if (status.value !== 'running' && note !== hoverNote) { hoverNote = note; drawIdleRing(note) }
}

function onCanvasMouseMove(e) {
  if (status.value === 'starting') return
  const note = noteAtCanvasPos(e)
  // Dynamic cursor: pointer only over a note zone
  if (canvasRef.value) canvasRef.value.style.cursor = note ? 'pointer' : 'default'
  if (isMouseDown) fireNote(note)
  // Hover highlight only in idle/error (camera overlay handles its own drawing)
  if (status.value !== 'running' && note !== hoverNote) { hoverNote = note; drawIdleRing(note) }
}

function onCanvasMouseUp() { isMouseDown = false }
function onCanvasMouseLeave() {
  isMouseDown = false
  if (canvasRef.value) canvasRef.value.style.cursor = 'default'
  if (status.value !== 'running' && hoverNote) { hoverNote = null; drawIdleRing(null) }
}

function onCanvasTouchStart(e) {
  e.preventDefault()
  const touch = e.touches[0]
  const note = noteAtCanvasPos(touch)
  fireNote(note)
  if (status.value !== 'running' && note !== hoverNote) { hoverNote = note; drawIdleRing(note) }
}

function onCanvasTouchMove(e) {
  e.preventDefault()
  const touch = e.touches[0]
  const note = noteAtCanvasPos(touch)
  fireNote(note)
  if (status.value !== 'running' && note !== hoverNote) { hoverNote = note; drawIdleRing(note) }
}

function onCanvasTouchEnd() {
  hoverNote = null
  if (status.value !== 'running') drawIdleRing(null)
}

// ─── Gesture detection loop ───────────────────────────────────────────────────

function detectLoop() {
  const video = videoRef.value
  function frame() {
    if (status.value !== 'running') return
    if (video.readyState >= 2) {
      const now = Date.now()
      let result
      try { result = recognizer.recognizeForVideo(video, now) }
      catch (frameErr) { console.warn('MediaPipe error:', frameErr); rafId = requestAnimationFrame(frame); return }

      if (result.gestures.length > 0 && result.landmarks.length > 0) {
        const top = result.gestures[0][0]
        const lm  = result.landmarks[0]
        const gesture = top.categoryName

        // Emit gesture event (debounced per gesture type, 1.5s cooldown)
        if (gesture !== 'None' && top.score >= 0.75) {
          const last = gestureEmitAt[gesture] ?? 0
          if (now - last > 1500) {
            gestureEmitAt[gesture] = now
            emit('gesture', { gesture, confidence: top.score })
          }
        }

        drawOverlay(lm)
        const ctx = canvasRef.value?.getContext('2d')
        const W = canvasRef.value?.width, H = canvasRef.value?.height

        // ── 1. Rotation volume: Open_Palm + wrist rotation (delta-based knob) ──
        // Wrist (0) → middle finger base (9), mirrored to match display.
        // Each frame computes angle delta and accumulates it into smoothedVol,
        // so multiple rotations in the same direction keep raising/lowering volume.
        if (gesture === 'Open_Palm') {
          const canvasDx = (1 - lm[9].x) - (1 - lm[0].x)
          const dy = lm[9].y - lm[0].y
          const angle = Math.atan2(canvasDx, -dy)   // 0 = up, +CW, -CCW

          if (prevPalmAngle !== null) {
            let delta = angle - prevPalmAngle
            // Wrap-around normalisation: keep delta in [-π, π]
            if (delta > Math.PI)  delta -= 2 * Math.PI
            if (delta < -Math.PI) delta += 2 * Math.PI
            // Dead zone: ignore micro-tremors
            if (Math.abs(delta) > 0.008) {
              smoothedVol = Math.min(1, Math.max(0, smoothedVol + delta * VOL_SENSITIVITY))
              dashboard.setGestureVolume(smoothedVol)
            }
          }
          prevPalmAngle = angle
          if (ctx && W && H) drawVolumeFeedback(ctx, lm, W, H, smoothedVol, 0)
        } else {
          prevPalmAngle = null   // reset when gesture changes, so re-entry is clean
        }

        // ── 2. Swipe (Closed_Fist) → cycle instrument ─────────────────────────
        if (gesture === 'Closed_Fist') {
          // Track canvas-X (mirrored): right on screen = higher value
          const canvasX = 1 - lm[0].x
          wristBuffer.push(canvasX)
          if (wristBuffer.length > WRIST_BUF) wristBuffer.shift()

          if (wristBuffer.length === WRIST_BUF && now - lastSwipeAt > SWIPE_COOLDOWN) {
            const delta = wristBuffer[WRIST_BUF - 1] - wristBuffer[0]
            if (Math.abs(delta) > SWIPE_DELTA) {
              lastSwipeAt = now
              wristBuffer = []
              // delta > 0 = moved right on screen → next (+1)
              // delta < 0 = moved left on screen  → prev (-1)
              const dir = delta > 0 ? 1 : -1
              const next = dashboard.cycleInstrument(dir)
              swipeHint.value = `${dir > 0 ? '→' : '←'} ${INST_LABELS[next] ?? next}`
              setTimeout(() => { swipeHint.value = null }, 900)
            }
          }
        } else {
          wristBuffer = []
        }

        // ── 3. Note detection (Pointing_Up) ───────────────────────────────────
        if (gesture === 'Pointing_Up' && top.score >= 0.7) {
          const note = noteAtPosition(lm[8].x, lm[8].y)
          if (note && (note !== lastNote || now - lastNoteAt > REPEAT_MS)) {
            lastNote = note
            lastNoteAt = now
            detectedNote.value = note
            setTimeout(() => { detectedNote.value = null }, 600)
            apiClient.post('/music-events', {
              note, instrument: dashboard.selectedInstrument, volume: Math.round(smoothedVol * 100),
            }).catch(e => console.warn('music-event POST failed', e))
          }
        }
      } else {
        drawOverlay(null)
        wristBuffer = []
        prevPalmAngle = null
      }
    }
    rafId = requestAnimationFrame(frame)
  }
  frame()
}

// ─── Camera lifecycle ─────────────────────────────────────────────────────────

async function start() {
  if (status.value === 'running') return
  status.value = 'starting'
  errorMsg.value = ''
  needsHttps.value = false
  await nextTick()

  try {
    const { GestureRecognizer, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    )
    recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
    })

    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
    const video = videoRef.value
    video.srcObject = mediaStream
    await new Promise(resolve => { video.onloadedmetadata = resolve })
    await video.play()

    status.value = 'running'
    detectLoop()
  } catch (e) {
    status.value = 'error'
    if (e.name === 'NotAllowedError') {
      errorMsg.value = '攝影機權限被拒，請允許後重試'
    } else if (e.name === 'NotFoundError') {
      errorMsg.value = '找不到攝影機裝置'
    } else if (e.name === 'NotReadableError') {
      errorMsg.value = '攝影機被其他程式佔用，請關閉後重試'
    } else if (!navigator.mediaDevices && location.protocol !== 'https:') {
      // mediaDevices undefined = actual HTTPS restriction (Chrome flag not set)
      errorMsg.value = '需要 HTTPS 才能存取攝影機'
      needsHttps.value = true
    } else {
      errorMsg.value = `啟動失敗：${e.name}${e.message ? ' — ' + e.message : ''}`
    }
    cleanup()
  }
}

function cleanup() {
  cancelAnimationFrame(rafId)
  mediaStream?.getTracks().forEach(t => t.stop())
  mediaStream = null
  if (recognizer) { try { recognizer.close() } catch {} ; recognizer = null }
}

function stop() {
  status.value = 'idle'
  cleanup()
  nextTick(() => drawIdleRing())
}

let resizeObserver = null
onMounted(() => nextTick(() => {
  drawIdleRing()
  if (canvasRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (status.value !== 'running') nextTick(() => drawIdleRing())
    })
    resizeObserver.observe(canvasRef.value)
  }
}))
watch(status, v => { if (v !== 'running') nextTick(() => drawIdleRing()) })
watch(() => dashboard.selectedInstrument, () => { if (status.value !== 'running') nextTick(() => drawIdleRing()) })
watch(() => dashboard.activeNotes, () => { if (status.value !== 'running') nextTick(() => drawIdleRing()) }, { deep: true })
onUnmounted(() => { stop(); resizeObserver?.disconnect() })
defineExpose({ start, stop, status })
</script>

<template>
  <div class="relative bg-slate-900 rounded-xl overflow-hidden w-full h-full">

    <!-- Video feed (CSS-mirrored) -->
    <video ref="videoRef"
      v-show="status === 'running'"
      class="absolute inset-0 w-full h-full object-cover"
      style="transform: scaleX(-1);"
      playsinline muted></video>

    <!-- Canvas: always visible — gesture overlay when running, mouse ring when idle -->
    <canvas ref="canvasRef"
      class="absolute inset-0 w-full h-full cursor-default"
      @mousedown="onCanvasMouseDown"
      @mousemove="onCanvasMouseMove"
      @mouseup="onCanvasMouseUp"
      @mouseleave="onCanvasMouseLeave"
      @touchstart="onCanvasTouchStart"
      @touchmove="onCanvasTouchMove"
      @touchend="onCanvasTouchEnd"></canvas>

    <!-- Detected note badge -->
    <div v-if="detectedNote"
      class="absolute top-2 left-2 z-10 bg-black/70 text-emerald-300 font-black text-2xl px-3 py-1 rounded-lg pointer-events-none">
      {{ detectedNote }}
    </div>

    <!-- Swipe / instrument change hint -->
    <div v-if="swipeHint"
      class="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-black/75 text-amber-300 font-bold text-base px-4 py-1.5 rounded-lg pointer-events-none">
      {{ swipeHint }}
    </div>

    <!-- Status overlays (pointer-events-none so canvas stays clickable) -->
    <div v-if="status !== 'running'"
      class="absolute inset-0 flex flex-col items-center justify-end gap-3 pb-4 pointer-events-none">

      <template v-if="status === 'starting'">
        <div class="w-8 h-8 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin"></div>
        <p class="text-slate-400 text-xs text-center">載入 AI 模型中<br>（首次約 10 秒）</p>
      </template>

      <template v-else-if="status === 'error'">
        <!-- pointer-events-auto so text can be selected / button can be clicked -->
        <div class="pointer-events-auto flex flex-col items-center gap-2 w-full px-3">
          <p class="text-red-400 text-xs text-center">⚠️ {{ errorMsg }}</p>
          <div v-if="needsHttps"
            class="bg-slate-900/95 border border-slate-600 rounded-xl p-3 text-[11px] text-slate-300 space-y-2 w-full">
            <p class="text-amber-400 font-semibold">Chrome 設定（一次即可）：</p>
            <p class="text-slate-400">① 複製下列網址，貼到 Chrome 網址列：</p>
            <div class="bg-slate-800 rounded-lg px-2 py-1.5 cursor-text select-all user-select-all">
              <span class="text-amber-300 break-all">chrome://flags/#unsafely-treat-insecure-origin-as-secure</span>
            </div>
            <p class="text-slate-400">② 在 Enabled Origins 貼入你的網址：</p>
            <div class="bg-slate-800 rounded-lg px-2 py-1.5 cursor-text select-all">
              <span class="text-emerald-300 break-all">{{ siteOrigin }}</span>
            </div>
            <p class="text-slate-400">③ 點 Relaunch 重啟 Chrome</p>
          </div>
          <button @click="start"
            class="text-xs bg-slate-700 hover:bg-slate-600 text-white px-4 py-1.5 rounded-lg transition-colors">
            重試
          </button>
        </div>
      </template>

    </div>
  </div>
</template>
