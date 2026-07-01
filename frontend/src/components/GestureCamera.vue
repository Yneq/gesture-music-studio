<script setup>
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { useDashboardStore } from '../stores/dashboardStore'
import apiClient from '../services/api'

const emit = defineEmits(['status'])

const dashboard = useDashboardStore()

const videoRef = ref(null)
const canvasRef = ref(null)
const status = ref('idle')   // idle | starting | running | error
const errorMsg = ref('')
const needsHttps = ref(false)
const detectedNote = ref(null)
const siteOrigin = location.origin

watch(status, v => emit('status', v))

const NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']
const INNER = 0.12
const OUTER = 0.38
const DEBOUNCE_MS = 500

let recognizer = null
let mediaStream = null
let rafId = null
let lastNoteAt = 0

function noteAtPosition(rawX, rawY) {
  const x = 1 - rawX
  const dx = x - 0.5, dy = rawY - 0.5
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < INNER || dist > OUTER) return null
  let angle = Math.atan2(dy, dx) + Math.PI / 2
  if (angle < 0) angle += 2 * Math.PI
  return NOTES[Math.floor((angle / (2 * Math.PI)) * 8) % 8]
}

function drawOverlay(landmarks) {
  const canvas = canvasRef.value
  const video = videoRef.value
  if (!canvas || !video) return
  const W = video.videoWidth, H = video.videoHeight
  if (!W || !H) return
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)

  const cx = W * 0.5, cy = H * 0.5
  const minDim = Math.min(W, H)
  const ri = INNER * minDim, ro = OUTER * minDim

  // Alternating sectors
  for (let i = 0; i < 8; i++) {
    const a1 = (i / 8) * 2 * Math.PI - Math.PI / 2
    const a2 = ((i + 1) / 8) * 2 * Math.PI - Math.PI / 2
    ctx.beginPath()
    ctx.arc(cx, cy, ro, a1, a2)
    ctx.arc(cx, cy, ri, a2, a1, true)
    ctx.closePath()
    ctx.fillStyle = i % 2 === 0 ? 'rgba(200,230,255,0.28)' : 'rgba(0,10,40,0.45)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // Ring outlines
  for (const r of [ri, ro]) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // Note labels at sector centers
  const labelR = (INNER + OUTER) / 2 * minDim
  ctx.font = `bold ${Math.round(minDim * 0.055)}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  NOTES.forEach((note, i) => {
    const a = ((i + 0.5) / 8) * 2 * Math.PI - Math.PI / 2
    ctx.fillStyle = 'white'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 4
    ctx.fillText(note, cx + Math.cos(a) * labelR, cy + Math.sin(a) * labelR)
  })
  ctx.shadowBlur = 0

  // Hand skeleton
  if (landmarks) {
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

function detectLoop() {
  const video = videoRef.value
  function frame() {
    if (status.value !== 'running') return
    if (video.readyState >= 2) {
      const now = Date.now()
      const result = recognizer.recognizeForVideo(video, now)
      if (result.gestures.length > 0 && result.landmarks.length > 0) {
        const top = result.gestures[0][0]
        const lm  = result.landmarks[0]
        drawOverlay(lm)
        if (top.categoryName === 'Pointing_Up' && top.score >= 0.7 && now - lastNoteAt > DEBOUNCE_MS) {
          const note = noteAtPosition(lm[8].x, lm[8].y)
          if (note) {
            lastNoteAt = now
            detectedNote.value = note
            setTimeout(() => { detectedNote.value = null }, 600)
            apiClient.post('/music-events', {
              note, instrument: dashboard.selectedInstrument, volume: 80,
            }).catch(() => {})
          }
        }
      } else {
        drawOverlay(null)
      }
    }
    rafId = requestAnimationFrame(frame)
  }
  frame()
}

async function start() {
  if (status.value === 'running') return
  status.value = 'starting'
  errorMsg.value = ''
  needsHttps.value = false
  await nextTick()  // ensure video element is visible before assigning srcObject

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
    } else if (location.protocol !== 'https:') {
      errorMsg.value = '需要 HTTPS 才能存取攝影機'
      needsHttps.value = true
    } else {
      errorMsg.value = '啟動失敗：' + (e.message || e.name)
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
}

onUnmounted(stop)
defineExpose({ start, stop, status })
</script>

<template>
  <!-- Inline camera panel — parent controls size via class -->
  <div class="relative bg-slate-900 rounded-xl overflow-hidden w-full h-full">

    <!-- Video feed (CSS-mirrored) -->
    <video ref="videoRef"
      v-show="status === 'running'"
      class="absolute inset-0 w-full h-full object-cover"
      style="transform: scaleX(-1);"
      playsinline muted></video>

    <!-- Canvas overlay (NOT mirrored — x manually flipped in drawOverlay) -->
    <canvas ref="canvasRef"
      v-show="status === 'running'"
      class="absolute inset-0 w-full h-full"></canvas>

    <!-- Detected note badge -->
    <div v-if="detectedNote && status === 'running'"
      class="absolute top-2 left-2 z-10 bg-black/70 text-emerald-300 font-black text-2xl px-3 py-1 rounded-lg">
      {{ detectedNote }}
    </div>

    <!-- Non-running states -->
    <div v-if="status !== 'running'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">

      <template v-if="status === 'idle'">
        <span class="text-4xl opacity-30">📷</span>
        <p class="text-slate-600 text-xs text-center">點「手勢」開啟攝影機</p>
      </template>

      <template v-else-if="status === 'starting'">
        <div class="w-8 h-8 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin"></div>
        <p class="text-slate-400 text-xs text-center">載入 AI 模型中<br>（首次約 10 秒）</p>
      </template>

      <template v-else-if="status === 'error'">
        <p class="text-red-400 text-xs text-center">⚠️ {{ errorMsg }}</p>
        <div v-if="needsHttps"
          class="bg-slate-800 rounded-lg p-3 text-[11px] text-slate-300 space-y-1.5 w-full">
          <p class="text-amber-400 font-semibold text-xs">Chrome 設定（一次）：</p>
          <p class="break-all text-amber-300 select-all">chrome://flags/#unsafely-treat-insecure-origin-as-secure</p>
          <p>加入 <span class="text-emerald-300 select-all">{{ siteOrigin }}</span> → Enable → 重啟</p>
        </div>
        <button @click="start"
          class="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg transition-colors">
          重試
        </button>
      </template>
    </div>
  </div>
</template>
