<script setup>
import { onMounted, onUnmounted, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/authStore'
import { useDashboardStore, DRUM_LABELS } from '../stores/dashboardStore'
import { publishPresenceLeave } from '../services/websocketService'
import apiClient from '../services/api'
import GestureCamera from '../components/GestureCamera.vue'
import LayoutEditor from '../components/LayoutEditor.vue'
import StatsModal from '../components/StatsModal.vue'

const auth = useAuthStore()
const dashboard = useDashboardStore()
const router = useRouter()

const cameraRef = ref(null)
const cameraStatus = ref('idle')
const showLayoutEditor = ref(false)
const showStats = ref(false)
const isMobile = ref(window.innerWidth < 768)
const activeTab = ref('notes')
function onWindowResize() { isMobile.value = window.innerWidth < 768 }

// ── Note particles (visualization) ───────────────────────────────────────────
const noteParticles = ref([])
let _particleId = 0
let _particleTimer = null

watch(() => dashboard.recentNotes[0], (note) => {
  if (!note || note.type === 'presence' || note.type === 'presence-leave') return
  const id = _particleId++
  noteParticles.value.push({
    id,
    text: note.note,
    color: note.color,
    x: 8 + Math.random() * 84,   // % across main area
    y: 30 + Math.random() * 45,  // % down main area
  })
  if (noteParticles.value.length > 12) noteParticles.value.shift()
  setTimeout(() => {
    noteParticles.value = noteParticles.value.filter(p => p.id !== id)
  }, 1000)
})

// ── Resizable left panel ──────────────────────────────────────────────────────
const mainRef = ref(null)
const leftPct = ref(48)

let dragStart = null

function onDragStart(e) {
  e.preventDefault()
  dragStart = { x: e.clientX, pct: leftPct.value }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onDragMove(e) {
  if (!dragStart || !mainRef.value) return
  const totalW = mainRef.value.getBoundingClientRect().width
  const deltaPct = ((e.clientX - dragStart.x) / totalW) * 100
  leftPct.value = Math.min(68, Math.max(28, dragStart.pct + deltaPct))
}

function onDragEnd() {
  dragStart = null
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function sendLeave() { publishPresenceLeave(auth.user?.username) }

onMounted(async () => {
  window.addEventListener('beforeunload', sendLeave)
  window.addEventListener('resize', onWindowResize)
  dashboard.connect(auth.user?.username, auth.token)
  dashboard.fetchRecentGestures()
  dashboard.fetchLayouts()
  await nextTick()
  cameraRef.value?.start()
  dashboard.enableAudio().catch(() => {})
  toggleJazzBg().catch(() => {})  // auto-play on enter; silently ignored if browser blocks
})
onUnmounted(() => {
  window.removeEventListener('beforeunload', sendLeave)
  window.removeEventListener('resize', onWindowResize)
  sendLeave()
  dashboard.disconnect()
  stopJazzBg()
  stopCaravan()
  clearTimeout(_toastTimer)
  onDragEnd()
})

function logout() {
  sendLeave()                // send before WebSocket disconnects
  dashboard.disconnect()
  cameraRef.value?.stop()
  auth.logout()
  router.push('/login')
}

function autoEnableAudio() {
  if (!dashboard.audioEnabled) dashboard.enableAudio()
}

const INSTRUMENTS = [
  { id: 'piano',  label: 'Piano',   icon: '🎹' },
  { id: 'guitar', label: 'Acoustic', icon: '🎸' },
  { id: 'synth',  label: 'Synth',   icon: '🎛️' },
  { id: 'drum',   label: 'Drum',    icon: '🥁' },
]

const GESTURE_EMOJI = {
  OPEN_HAND: '🖐', FIST: '✊', THUMB_UP: '👍',
  PEACE: '✌️', POINT: '👆',
  // MediaPipe names (from frontend camera)
  Open_Palm: '🖐', Closed_Fist: '✊', Thumb_Up: '👍',
  Victory: '✌️', Pointing_Up: '👆', ILoveYou: '🤟',
}

// Map MediaPipe gesture names → canonical names for display
const GESTURE_LABEL = {
  Open_Palm: 'OPEN_HAND', Closed_Fist: 'FIST', Thumb_Up: 'THUMB_UP',
  Victory: 'PEACE', Pointing_Up: 'POINT', ILoveYou: 'ILoveYou',
}

// ── Gesture toast HUD ────────────────────────────────────────────────────────
const gestureToast = ref(null)   // { emoji, label, confidence } | null
let _toastTimer = null

function onGestureDetected({ gesture, confidence }) {
  const label = GESTURE_LABEL[gesture] ?? gesture
  dashboard.recentGestures.unshift({ id: Date.now(), gesture: label, confidence })
  if (dashboard.recentGestures.length > 20) dashboard.recentGestures.pop()

  // Persist to DB (fire-and-forget; don't block UI)
  apiClient.post('/gesture', { gesture: label, confidence }).catch(e => console.warn('gesture POST failed', e))

  // Show HUD overlay on camera
  clearTimeout(_toastTimer)
  gestureToast.value = { emoji: GESTURE_EMOJI[gesture] ?? '🤚', label, confidence }
  _toastTimer = setTimeout(() => { gestureToast.value = null }, 2200)
}

// ── Jazz background music ─────────────────────────────────────────────────────
let _jazzAudio = null
const jazzPlaying = ref(false)

function stopJazzBg() {
  if (_jazzAudio) { _jazzAudio.pause(); _jazzAudio.currentTime = 0 }
  jazzPlaying.value = false
}

async function toggleJazzBg() {
  if (jazzPlaying.value) { stopJazzBg(); return }
  if (!_jazzAudio) {
    _jazzAudio = new Audio('/audio/jazz_rock.mp3')
    _jazzAudio.loop = true
    _jazzAudio.volume = 0.04
    _jazzAudio.onended = () => { jazzPlaying.value = false }
  }
  try {
    await _jazzAudio.play()
    jazzPlaying.value = true
  } catch (e) { jazzPlaying.value = false }
}

// ── Caravan player (local, avoids Pinia HMR stale-instance issues) ────────────
let _caravanAudio = null
let _caravanCtx   = null
let _caravanGain  = null
const caravanPlaying = ref(false)

async function playCaravan() {
  stopJazzBg()
  stopCaravan()
  try {
    if (!_caravanAudio) {
      _caravanAudio = new Audio('/audio/caravan.mp3')
      _caravanCtx   = new AudioContext()
      const src     = _caravanCtx.createMediaElementSource(_caravanAudio)
      _caravanGain  = _caravanCtx.createGain()
      _caravanGain.gain.value = 1.0
      src.connect(_caravanGain)
      _caravanGain.connect(_caravanCtx.destination)
    }
    _caravanAudio.currentTime = 30
    _caravanAudio.loop = true
    _caravanAudio.onended = () => { caravanPlaying.value = false }
    if (_caravanCtx.state === 'suspended') await _caravanCtx.resume()
    await _caravanAudio.play()
    caravanPlaying.value = true
  } catch (e) {
    console.error('Caravan play error:', e)
    caravanPlaying.value = false
  }
}

function stopCaravan() {
  if (_caravanAudio) {
    _caravanAudio.pause()
    _caravanAudio.currentTime = 119
    _caravanAudio.onended = null
  }
  caravanPlaying.value = false
}

// shared inline style helpers
const GLASS = 'background:rgba(10,4,0,0.68);backdrop-filter:blur(20px);border:1px solid rgba(212,175,55,0.25);'
const GOLD_TEXT = 'color:#FFF5D6;'
const LABEL_STYLE = 'color:rgba(212,175,55,0.5);font-size:0.65rem;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;'
</script>

<template>
  <div class="flex flex-col min-h-screen md:h-screen md:overflow-hidden relative" @click.capture="autoEnableAudio">

    <!-- ── Background: same baroque orchestra as login ──────────────────────── -->
    <div class="absolute inset-0 bg-cover bg-center bg-no-repeat pointer-events-none"
      style="background-image:url('https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?auto=format&fit=crop&w=1920&q=80')">
    </div>
    <div class="absolute inset-0 pointer-events-none"
      style="background:linear-gradient(to bottom,rgba(14,6,0,0.82) 0%,rgba(22,10,0,0.72) 50%,rgba(14,6,0,0.88) 100%)">
    </div>
    <div class="absolute inset-0 pointer-events-none"
      style="background:radial-gradient(ellipse 90% 80% at 50% 40%,transparent 0%,rgba(5,2,0,0.55) 100%)">
    </div>

    <!-- ── Header ───────────────────────────────────────────────────────────── -->
    <header class="relative z-10 shrink-0 px-6 py-3 flex items-center justify-between"
      style="background:rgba(8,3,0,0.80);border-bottom:1px solid rgba(212,175,55,0.22);backdrop-filter:blur(16px);">

      <div class="flex items-center gap-3">
        <span style="color:rgba(212,175,55,0.6);font-size:13px">❖</span>
        <h1 style="font-family:'Georgia',serif;font-size:1.05rem;font-weight:700;letter-spacing:0.12em;color:#FFF5D6;text-shadow:0 0 20px rgba(212,175,55,0.3)">
          MAESTRO
        </h1>
        <span class="hidden sm:inline" style="color:rgba(212,175,55,0.3);font-size:0.6rem;letter-spacing:0.2em;text-transform:uppercase;padding-top:1px">
          AI Gesture Music Studio
        </span>
      </div>

      <div class="flex items-center gap-4">
        <!-- Connection status -->
        <span class="flex items-center gap-2 text-sm">
          <span class="w-2 h-2 rounded-full transition-colors"
            :class="dashboard.wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-stone-600'"></span>
          <span class="text-xs" :style="dashboard.wsConnected ? 'color:#6ee7b7' : 'color:rgba(212,175,55,0.3)'">
            {{ dashboard.wsConnected ? 'Live' : '未連線' }}
          </span>
        </span>

        <!-- Jazz background music toggle -->
        <button @click="toggleJazzBg" class="music-hdr-btn flex items-center justify-center w-7 h-7 rounded-full"
          :title="jazzPlaying ? '關閉背景音樂' : '播放背景音樂'"
          style="border:1px solid rgba(212,175,55,0.3);background:rgba(12,5,0,0.5);backdrop-filter:blur(6px)">
          <span v-if="jazzPlaying" class="absolute w-7 h-7 rounded-full animate-ping opacity-20"
            style="background:rgba(212,175,55,0.5)"></span>
          <span class="relative text-xs" style="color:rgba(212,175,55,0.85)">{{ jazzPlaying ? '🎶' : '🎵' }}</span>
        </button>

        <!-- Online users (Figma-style stacked avatars) -->
        <div v-if="dashboard.onlineUsers.length" class="hidden sm:flex items-center">
          <div v-for="(user, i) in dashboard.onlineUsers.slice(0, 5)" :key="user"
            class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 relative"
            :style="`border:1.5px solid rgba(8,3,0,0.9);margin-left:${i===0?'0':'-6px'};z-index:${10-i};
              background:rgba(212,175,55,0.18);color:#D4AF37;`"
            :title="user">
            {{ user.charAt(0).toUpperCase() }}
            <!-- green dot for self -->
            <span v-if="user === auth.user?.username"
              class="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-full bg-emerald-400"
              style="border:1px solid rgba(8,3,0,0.9)"></span>
          </div>
          <span v-if="dashboard.onlineUsers.length > 5"
            class="ml-1 text-[10px]" style="color:rgba(212,175,55,0.45)">
            +{{ dashboard.onlineUsers.length - 5 }}
          </span>
          <span class="ml-2 text-[10px]" style="color:rgba(212,175,55,0.35)">
            {{ dashboard.onlineUsers.length }} 人在線
          </span>
        </div>

        <!-- Self avatar + username (click → stats) -->
        <button class="avatar-btn flex items-center gap-2"
          @click="showStats = true" title="我的統計">
          <div class="avatar-ring w-7 h-7 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
            style="border:1px solid rgba(212,175,55,0.45)">
            <img v-if="auth.user?.avatarUrl" :src="auth.user.avatarUrl"
              class="w-full h-full object-cover" referrerpolicy="no-referrer">
            <span v-else class="text-xs font-bold w-full h-full flex items-center justify-center"
              style="background:rgba(212,175,55,0.15);color:#D4AF37;letter-spacing:0">
              {{ auth.user?.username?.charAt(0)?.toUpperCase() }}
            </span>
          </div>
          <span class="hidden sm:inline" style="color:rgba(212,175,55,0.65);font-size:0.8rem">{{ auth.user?.username }}</span>
        </button>
        <button @click="logout"
          class="text-xs transition-colors px-3 py-1 rounded-lg"
          style="color:rgba(212,175,55,0.45);border:1px solid rgba(212,175,55,0.18);"
          @mouseenter="e=>{e.target.style.color='rgba(212,175,55,0.9)';e.target.style.borderColor='rgba(212,175,55,0.5)'}"
          @mouseleave="e=>{e.target.style.color='rgba(212,175,55,0.45)';e.target.style.borderColor='rgba(212,175,55,0.18)'}">
          登出
        </button>
      </div>
    </header>

    <!-- ── Main ─────────────────────────────────────────────────────────────── -->
    <main ref="mainRef" class="relative z-10 flex-1 flex flex-col md:flex-row gap-0 p-3 gap-y-3 md:gap-y-0 md:min-h-0 md:overflow-hidden">

      <!-- Note particles overlay -->
      <TransitionGroup tag="div"
        class="absolute inset-0 pointer-events-none z-30 overflow-hidden"
        name="note-particle">
        <div v-for="p in noteParticles" :key="p.id"
          class="absolute font-black select-none manga-note"
          :class="p.color"
          :style="`left:${p.x}%;top:${p.y}%`">
          {{ p.text }}
        </div>
      </TransitionGroup>

      <!-- Left panel -->
      <div :style="isMobile ? {} : { width: leftPct + '%' }"
        class="w-full md:w-auto md:shrink-0 md:min-h-0 md:overflow-y-auto rounded-2xl p-4 flex flex-col gap-3"
        style="background:rgba(10,4,0,0.68);backdrop-filter:blur(20px);border:1px solid rgba(212,175,55,0.22);">

        <!-- Current note badge -->
        <div class="flex items-center justify-between shrink-0">
          <span :style="LABEL_STYLE">即時音符</span>
          <div class="flex items-center gap-2">
            <span class="font-black text-lg transition-all duration-200"
              :class="dashboard.currentNote ? dashboard.noteColor : ''">
              <span v-if="!dashboard.currentNote" style="color:rgba(212,175,55,0.2)">—</span>
              <template v-else>
                {{ dashboard.selectedInstrument === 'drum'
                    ? (DRUM_LABELS[dashboard.currentNote] ?? dashboard.currentNote)
                    : dashboard.currentNote }}
              </template>
            </span>
            <span v-if="dashboard.currentUsername" class="text-xs" :class="dashboard.noteColor">
              {{ dashboard.currentUsername }}
            </span>
          </div>
        </div>

        <!-- Camera -->
        <div class="w-full aspect-[4/3] relative shrink-0 rounded-xl overflow-hidden mx-auto"
          style="border:1px solid rgba(212,175,55,0.18);max-height:50vh;max-width:calc(50vh * 4 / 3)">
          <GestureCamera ref="cameraRef" class="absolute inset-0"
            @status="v => cameraStatus = v"
            @gesture="onGestureDetected" />

          <!-- Gesture HUD toast -->
          <Transition name="gesture-toast">
            <div v-if="gestureToast"
              class="absolute bottom-0 left-0 right-0 flex items-center gap-3 px-4 py-3 pointer-events-none"
              style="background:linear-gradient(to top,rgba(6,2,0,0.88) 0%,rgba(6,2,0,0.4) 70%,transparent 100%)">
              <span class="text-4xl leading-none select-none">{{ gestureToast.emoji }}</span>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-bold tracking-[0.18em] uppercase"
                  style="color:#FFF5D6;text-shadow:0 0 12px rgba(212,175,55,0.6)">
                  {{ gestureToast.label }}
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Instrument selector -->
        <div class="grid grid-cols-4 gap-2 shrink-0">
          <button v-for="inst in INSTRUMENTS" :key="inst.id"
            @click="dashboard.setInstrument(inst.id)"
            class="gold-btn flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-semibold transition-all"
            :style="dashboard.selectedInstrument === inst.id
              ? 'background:linear-gradient(135deg,#7A5C0E,#D4AF37,#7A5C0E);color:#1A0800;box-shadow:0 2px 12px rgba(212,175,55,0.3)'
              : 'background:rgba(255,240,200,0.06);border:1px solid rgba(212,175,55,0.18);color:rgba(212,175,55,0.55)'">
            <span class="text-lg">{{ inst.icon }}</span>{{ inst.label }}
          </button>
        </div>

        <!-- 4 actions in one row -->
        <div class="grid grid-cols-4 gap-1.5 shrink-0">
          <button @click="dashboard.canonPlaying ? dashboard.stopCanon() : (stopJazzBg(), dashboard.playCanon())"
            class="gold-btn text-[11px] font-bold rounded-xl py-2 transition-all leading-tight"
            :style="dashboard.canonPlaying
              ? 'background:rgba(185,60,60,0.75);border:1px solid rgba(255,100,100,0.3);color:#FFF5D6'
              : 'background:linear-gradient(135deg,#7A5C0E,#C8981A,#7A5C0E);color:#1A0800;box-shadow:0 2px 8px rgba(212,175,55,0.2)'">
            {{ dashboard.canonPlaying ? '⏹' : '🎼' }}<br>卡農
          </button>

          <button @click="caravanPlaying ? stopCaravan() : playCaravan()"
            class="gold-btn text-[11px] font-bold rounded-xl py-2 transition-all leading-tight"
            :style="caravanPlaying
              ? 'background:rgba(185,60,60,0.75);border:1px solid rgba(255,100,100,0.3);color:#FFF5D6'
              : 'background:linear-gradient(135deg,#7A5C0E,#C8981A,#7A5C0E);color:#1A0800;box-shadow:0 2px 8px rgba(212,175,55,0.2)'">
            {{ caravanPlaying ? '⏹' : '🎷' }}<br>Caravan
          </button>

          <button @click="cameraStatus === 'running' ? cameraRef.stop() : cameraRef.start()"
            :disabled="cameraStatus === 'starting'"
            class="gold-btn text-[11px] font-bold rounded-xl py-2 transition-all disabled:opacity-50 leading-tight"
            :style="cameraStatus === 'running'
              ? 'background:rgba(185,60,60,0.75);border:1px solid rgba(255,100,100,0.3);color:#FFF5D6'
              : 'background:rgba(255,240,200,0.07);border:1px solid rgba(212,175,55,0.22);color:rgba(212,175,55,0.7)'">
            <template v-if="cameraStatus === 'starting'">⏳<br>載入中</template>
            <template v-else-if="cameraStatus === 'running'">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse mb-0.5"></span><br>停止
            </template>
            <template v-else>📷<br>手勢</template>
          </button>

          <button @click="showLayoutEditor = true"
            class="gold-btn text-[11px] font-bold rounded-xl py-2 transition-all leading-tight"
            style="background:rgba(255,240,200,0.07);border:1px solid rgba(212,175,55,0.22);color:rgba(212,175,55,0.7);">
            🎵<br>音階
          </button>
        </div>
      </div>

      <!-- Drag handle -->
      <div class="hidden md:flex w-3 shrink-0 items-center justify-center cursor-col-resize group" @mousedown="onDragStart">
        <div class="w-px h-10 rounded-full transition-colors"
          style="background:rgba(212,175,55,0.2)"
          @mouseenter="e=>e.target.style.background='rgba(212,175,55,0.7)'"
          @mouseleave="e=>e.target.style.background='rgba(212,175,55,0.2)'"></div>
      </div>

      <!-- Center + Right -->
      <div class="flex-1 min-w-0 flex flex-col gap-3 md:min-h-0">

        <!-- Mobile tab bar -->
        <div class="flex md:hidden gap-2 shrink-0">
          <button @click="activeTab = 'notes'"
            class="flex-1 py-2 text-xs font-bold rounded-xl transition-all"
            :style="activeTab === 'notes'
              ? 'background:linear-gradient(135deg,#7A5C0E,#D4AF37,#7A5C0E);color:#1A0800'
              : 'background:rgba(255,240,200,0.07);border:1px solid rgba(212,175,55,0.22);color:rgba(212,175,55,0.6)'">
            🎵 音符串流
          </button>
          <button @click="activeTab = 'gestures'"
            class="flex-1 py-2 text-xs font-bold rounded-xl transition-all"
            :style="activeTab === 'gestures'
              ? 'background:linear-gradient(135deg,#7A5C0E,#D4AF37,#7A5C0E);color:#1A0800'
              : 'background:rgba(255,240,200,0.07);border:1px solid rgba(212,175,55,0.22);color:rgba(212,175,55,0.6)'">
            🤚 手勢紀錄
          </button>
        </div>

        <div class="flex-1 flex flex-col md:flex-row gap-3 md:min-h-0">

        <!-- Note feed -->
        <div v-show="!isMobile || activeTab === 'notes'"
          class="flex-1 min-w-0 rounded-2xl p-4 flex flex-col gap-3 md:min-h-0"
          style="background:rgba(10,4,0,0.68);backdrop-filter:blur(20px);border:1px solid rgba(212,175,55,0.22);">
          <div class="flex items-center justify-between shrink-0">
            <span :style="LABEL_STYLE">即時音符串流</span>
            <span style="color:rgba(212,175,55,0.25);font-size:0.7rem">最近 20 筆</span>
          </div>
          <div class="h-64 md:flex-1 md:min-h-0 overflow-y-auto flex flex-col-reverse gap-1.5 pr-1 maestro-scroll">
            <div v-for="event in dashboard.recentNotes" :key="event.id"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm shrink-0"
              :style="event.type === 'presence'
                ? 'background:rgba(212,175,55,0.07);border:1px solid rgba(212,175,55,0.2)'
                : 'background:rgba(255,240,200,0.05);border:1px solid rgba(212,175,55,0.1)'">

              <!-- Presence / join-leave event -->
              <template v-if="event.type === 'presence' || event.type === 'presence-leave'">
                <span style="font-size:10px" :style="event.type==='presence' ? 'color:rgba(212,175,55,0.6)' : 'color:rgba(180,60,60,0.6)'">
                  {{ event.type === 'presence' ? '✦' : '✧' }}
                </span>
                <span class="text-xs font-semibold" :class="event.color">{{ event.username }}</span>
                <span class="text-xs" style="color:rgba(212,175,55,0.45)">
                  {{ event.type === 'presence' ? '加入演奏廳' : '離開演奏廳' }}
                </span>
                <span class="text-xs ml-auto" style="color:rgba(212,175,55,0.25)">{{ event.time }}</span>
              </template>

              <!-- Regular note event -->
              <template v-else>
                <span class="w-2 h-2 rounded-full shrink-0" :class="event.color.replace('text-', 'bg-')"></span>
                <span class="font-bold w-8 text-xs" :class="event.color">{{ event.note }}</span>
                <span class="text-xs flex-1 truncate" style="color:rgba(255,240,200,0.65)">{{ event.username }}</span>
                <span class="text-xs" style="color:rgba(212,175,55,0.35)">{{ event.instrument }}</span>
                <span class="text-xs" style="color:rgba(212,175,55,0.22)">{{ event.time }}</span>
              </template>
            </div>
            <p v-if="!dashboard.recentNotes.length"
              class="text-center py-8 shrink-0 text-sm"
              style="color:rgba(212,175,55,0.2)">
              用食指 POINT 手勢進入音區即可觸發
            </p>
          </div>
        </div>

        <!-- Gesture history -->
        <div v-show="!isMobile || activeTab === 'gestures'"
          class="flex-1 min-w-0 rounded-2xl p-4 flex flex-col gap-3 md:min-h-0"
          style="background:rgba(10,4,0,0.68);backdrop-filter:blur(20px);border:1px solid rgba(212,175,55,0.22);">
          <div class="flex items-center justify-between shrink-0">
            <span :style="LABEL_STYLE">指令手勢紀錄</span>
            <button @click="dashboard.fetchRecentGestures()"
              class="text-xs transition-colors"
              style="color:rgba(212,175,55,0.35);"
              @mouseenter="e=>e.target.style.color='rgba(212,175,55,0.8)'"
              @mouseleave="e=>e.target.style.color='rgba(212,175,55,0.35)'">
              重新整理
            </button>
          </div>
          <div class="h-64 md:flex-1 md:min-h-0 overflow-y-auto space-y-1.5 pr-1 maestro-scroll">
            <div v-for="g in dashboard.recentGestures" :key="g.id"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
              style="background:rgba(255,240,200,0.05);border:1px solid rgba(212,175,55,0.1)">
              <span class="text-xl">{{ GESTURE_EMOJI[g.gesture] ?? '🤚' }}</span>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-semibold truncate" style="color:#FFF5D6">{{ g.gesture }}</div>
                <div class="text-xs" style="color:rgba(212,175,55,0.35)">信心 {{ (g.confidence * 100).toFixed(0) }}%</div>
              </div>
            </div>
            <p v-if="!dashboard.recentGestures.length"
              class="text-center py-8 text-sm" style="color:rgba(212,175,55,0.2)">尚無紀錄</p>
          </div>

          <!-- Legend -->
          <div class="shrink-0 space-y-1.5 pt-3"
            style="border-top:1px solid rgba(212,175,55,0.2);">
            <div class="text-sm font-medium" style="color:rgba(212,175,55,0.7)">👆 POINT + 音區 → 音符</div>
            <div class="text-sm font-medium" style="color:rgba(212,175,55,0.7)">✊ FIST + 左右揮 → 換樂器</div>
            <div class="text-sm font-medium" style="color:rgba(212,175,55,0.7)">🖐 OPEN + 轉腕 → 音量</div>
            <div class="text-sm font-medium" style="color:rgba(212,175,55,0.7)">👍 THUMB ・ ✌️ PEACE ・ 🖐 OPEN → 指令</div>
          </div>
        </div>

        </div><!-- end panels wrapper -->
      </div><!-- end center+right -->
    </main>

  </div>

  <LayoutEditor v-model="showLayoutEditor" />
  <StatsModal v-model="showStats"
    :username="auth.user?.username"
    :avatar-url="auth.user?.avatarUrl" />
</template>

<style scoped>
.maestro-scroll::-webkit-scrollbar { width: 4px; }
.maestro-scroll::-webkit-scrollbar-track { background: transparent; }
.maestro-scroll::-webkit-scrollbar-thumb { background: rgba(212,175,55,0.25); border-radius: 4px; }
.maestro-scroll::-webkit-scrollbar-thumb:hover { background: rgba(212,175,55,0.5); }

/* Gesture HUD toast transition */
.gesture-toast-enter-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.gesture-toast-leave-active { transition: opacity 0.55s ease, transform 0.55s ease; }
.gesture-toast-enter-from  { opacity: 0; transform: translateY(10px); }
.gesture-toast-leave-to    { opacity: 0; transform: translateY(6px); }

/* Gold hover effect for all dashboard action/instrument buttons */
.gold-btn {
  cursor: pointer;
  transition: box-shadow 0.15s, filter 0.15s, border-color 0.15s !important;
}
.gold-btn:not(:disabled):hover {
  filter: brightness(1.25) saturate(1.1);
  box-shadow: 0 0 0 1px rgba(212,175,55,0.65), 0 0 16px rgba(212,175,55,0.28) !important;
}
.gold-btn:not(:disabled):active {
  filter: brightness(1.05);
  transform: scale(0.97);
}

/* Header music button */
.music-hdr-btn {
  cursor: pointer; position: relative;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.music-hdr-btn:hover {
  transform: scale(1.15);
  border-color: rgba(212,175,55,0.75) !important;
  box-shadow: 0 0 12px rgba(212,175,55,0.3);
}

/* Avatar button hover */
.avatar-btn { cursor: pointer; }
.avatar-btn .avatar-ring {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.avatar-btn:hover .avatar-ring {
  transform: scale(1.18);
  box-shadow: 0 0 0 2px rgba(212,175,55,0.7), 0 0 12px rgba(212,175,55,0.4);
}

/* Note particle — manga style */
.manga-note {
  font-size: clamp(2rem, 4.5vw, 3.5rem);
  font-style: italic;
  font-family: 'Georgia', 'Times New Roman', serif;
  -webkit-text-stroke: 2.5px rgba(0,0,0,0.95);
  text-shadow:
    3px  3px 0 rgba(0,0,0,0.85),
   -2px -2px 0 rgba(0,0,0,0.85),
    2px -2px 0 rgba(0,0,0,0.85),
   -2px  2px 0 rgba(0,0,0,0.85);
  letter-spacing: -0.02em;
  line-height: 1;
}

/* Manga palette — purple tones */
.manga-gold   { color: #23C4B9; }
.manga-amber  { color: #23C4B9; }
.manga-cream  { color: #23C4B9; }
.manga-warm   { color: #23C4B9; }
.manga-bright { color: #23C4B9; }
.manga-pale   { color: #23C4B9; }

.note-particle-enter-active { animation: manga-pop 1.0s ease-out forwards; }
.note-particle-leave-active { display: none; }
@keyframes manga-pop {
  0%   { opacity: 0;    transform: scale(1.7) rotate(-10deg); }
  8%   { opacity: 0.5;  transform: scale(1.08) rotate(-4deg); }
  15%  {                transform: scale(0.97) rotate(-3deg); }
  78%  { opacity: 0.5;  transform: scale(0.97) rotate(-3deg); }
  100% { opacity: 0;    transform: scale(0.88) rotate(-3deg); }
}
</style>
