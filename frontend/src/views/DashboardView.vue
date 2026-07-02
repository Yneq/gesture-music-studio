<script setup>
import { onMounted, onUnmounted, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/authStore'
import { useDashboardStore, DRUM_LABELS } from '../stores/dashboardStore'
import GestureCamera from '../components/GestureCamera.vue'

const auth = useAuthStore()
const dashboard = useDashboardStore()
const router = useRouter()

const cameraRef = ref(null)
const cameraStatus = ref('idle')

// ── Resizable left panel ──────────────────────────────────────────────────────
const mainRef = ref(null)
const leftPct = ref(48)   // default: left ≈ 48 %, center+right share the rest

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
// ─────────────────────────────────────────────────────────────────────────────

onMounted(async () => {
  dashboard.connect()
  dashboard.fetchRecentGestures()
  await nextTick()
  cameraRef.value?.start()
})
onUnmounted(() => {
  dashboard.disconnect()
  onDragEnd()
})

function logout() {
  dashboard.disconnect()
  cameraRef.value?.stop()
  auth.logout()
  router.push('/login')
}

function autoEnableAudio() {
  if (!dashboard.audioEnabled) dashboard.enableAudio()
}

const INSTRUMENTS = [
  { id: 'piano',  label: 'Piano',  icon: '🎹' },
  { id: 'guitar', label: 'Acoustic', icon: '🎸' },
  { id: 'synth',  label: 'Synth',  icon: '🎛️' },
  { id: 'drum',   label: 'Drum',   icon: '🥁' },
]

const GESTURE_EMOJI = {
  OPEN_HAND: '🖐', FIST: '✊', THUMB_UP: '👍',
  PEACE: '✌️', POINT: '👆',
}
</script>

<template>
  <div class="h-screen bg-slate-900 text-slate-100 flex flex-col overflow-hidden"
    @click.capture="autoEnableAudio">

    <!-- Header -->
    <header class="bg-slate-800 border-b border-slate-700 px-6 py-3 flex items-center justify-between shrink-0">
      <h1 class="text-lg font-bold tracking-wide">AI Gesture Music Studio</h1>
      <div class="flex items-center gap-4">
        <span class="flex items-center gap-2 text-sm">
          <span class="w-2.5 h-2.5 rounded-full"
            :class="dashboard.wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'"></span>
          <span :class="dashboard.wsConnected ? 'text-emerald-400' : 'text-slate-400'">
            {{ dashboard.wsConnected ? 'Live' : '未連線' }}
          </span>
        </span>
        <span class="text-slate-400 text-sm">{{ auth.user?.username }}</span>
        <button @click="logout" class="text-sm text-slate-400 hover:text-white transition-colors">登出</button>
      </div>
    </header>

    <!-- Main: flex row with draggable divider between left and center+right -->
    <main ref="mainRef" class="flex-1 min-h-0 flex gap-0 p-4">

      <!-- ── Left panel (resizable) ─────────────────────────────────────── -->
      <div :style="{ width: leftPct + '%' }"
        class="shrink-0 min-h-0 bg-slate-800 rounded-2xl p-4 flex flex-col gap-3 overflow-hidden">

        <!-- Current note badge -->
        <div class="flex items-center justify-between shrink-0">
          <h2 class="text-slate-400 text-xs uppercase tracking-widest font-semibold">即時音符</h2>
          <div class="flex items-center gap-2">
            <span class="font-black text-lg transition-all duration-200"
              :class="dashboard.currentNote ? dashboard.noteColor : 'text-slate-700'">
              {{ dashboard.selectedInstrument === 'drum' && dashboard.currentNote
                  ? (DRUM_LABELS[dashboard.currentNote] ?? dashboard.currentNote)
                  : (dashboard.currentNote ?? '—') }}
            </span>
            <span v-if="dashboard.currentUsername" class="text-xs" :class="dashboard.noteColor">
              {{ dashboard.currentUsername }}
            </span>
          </div>
        </div>

        <!-- Camera: 4:3 fixed ratio so circle never distorts -->
        <div class="w-full aspect-[4/3] relative shrink-0">
          <GestureCamera ref="cameraRef" class="absolute inset-0" @status="v => cameraStatus = v" />
        </div>

        <div class="flex-1 min-h-0"></div>

        <!-- Instrument Selector -->
        <div class="grid grid-cols-4 gap-2 shrink-0">
          <button
            v-for="inst in INSTRUMENTS" :key="inst.id"
            @click="dashboard.setInstrument(inst.id)"
            class="flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-semibold transition-colors"
            :class="dashboard.selectedInstrument === inst.id
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-700 text-slate-400 hover:bg-slate-600'">
            <span class="text-lg">{{ inst.icon }}</span>{{ inst.label }}
          </button>
        </div>

        <!-- Canon + Gesture buttons -->
        <div class="grid grid-cols-2 gap-2 shrink-0">
          <button
            @click="dashboard.canonPlaying ? dashboard.stopCanon() : dashboard.playCanon()"
            class="text-sm font-semibold rounded-xl py-2 transition-colors"
            :class="dashboard.canonPlaying
              ? 'bg-rose-600 hover:bg-rose-500 text-white'
              : 'bg-amber-600 hover:bg-amber-500 text-white'">
            {{ dashboard.canonPlaying ? '⏹ 卡農' : '🎼 彈卡農' }}
          </button>
          <button
            @click="cameraStatus === 'running' ? cameraRef.stop() : cameraRef.start()"
            :disabled="cameraStatus === 'starting'"
            class="text-sm font-semibold rounded-xl py-2 transition-colors disabled:opacity-50"
            :class="cameraStatus === 'running'
              ? 'bg-rose-700 hover:bg-rose-600 text-white'
              : 'bg-slate-600 hover:bg-slate-500 text-white'">
            <span v-if="cameraStatus === 'starting'">載入中…</span>
            <span v-else-if="cameraStatus === 'running'" class="flex items-center justify-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>停止手勢
            </span>
            <span v-else>📷 開啟手勢</span>
          </button>
        </div>
      </div>

      <!-- ── Drag handle ─────────────────────────────────────────────────── -->
      <div class="w-3 shrink-0 flex items-center justify-center cursor-col-resize group"
        @mousedown="onDragStart">
        <div class="w-0.5 h-12 rounded-full bg-slate-700 group-hover:bg-emerald-500 transition-colors"></div>
      </div>

      <!-- ── Center + Right share remaining width ─────────────────────────── -->
      <div class="flex-1 min-h-0 min-w-0 flex gap-4">

        <!-- Center: Note Feed -->
        <div class="flex-1 min-h-0 min-w-0 bg-slate-800 rounded-2xl p-5 flex flex-col gap-3">
          <div class="flex items-center justify-between shrink-0">
            <h2 class="text-slate-400 text-xs uppercase tracking-widest font-semibold">即時音符串流</h2>
            <span class="text-slate-600 text-xs">最近 20 筆</span>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto flex flex-col-reverse gap-1.5 pr-1">
            <div v-for="event in dashboard.recentNotes" :key="event.id"
              class="flex items-center gap-2 bg-slate-700/60 rounded-lg px-3 py-2 text-sm shrink-0">
              <span class="w-2 h-2 rounded-full shrink-0"
                :class="event.color.replace('text-', 'bg-')"></span>
              <span class="font-bold w-8" :class="event.color">{{ event.note }}</span>
              <span class="text-slate-300 text-xs flex-1 truncate">{{ event.username }}</span>
              <span class="text-slate-500 text-xs">{{ event.instrument }}</span>
              <span class="text-slate-600 text-xs">{{ event.time }}</span>
            </div>
            <p v-if="!dashboard.recentNotes.length"
              class="text-slate-600 text-sm text-center py-8 shrink-0">
              用食指 POINT 手勢進入音區即可觸發
            </p>
          </div>
        </div>

        <!-- Right: Gesture History -->
        <div class="flex-1 min-h-0 min-w-0 bg-slate-800 rounded-2xl p-5 flex flex-col gap-3">
          <div class="flex items-center justify-between shrink-0">
            <h2 class="text-slate-400 text-xs uppercase tracking-widest font-semibold">指令手勢紀錄</h2>
            <button @click="dashboard.fetchRecentGestures()"
              class="text-slate-500 hover:text-white text-xs transition-colors">重新整理</button>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
            <div v-for="g in dashboard.recentGestures" :key="g.id"
              class="flex items-center gap-3 bg-slate-700/60 rounded-lg px-3 py-2 text-sm">
              <span class="text-xl">{{ GESTURE_EMOJI[g.gesture] ?? '🤚' }}</span>
              <div class="flex-1 min-w-0">
                <div class="text-slate-200 font-medium truncate">{{ g.gesture }}</div>
                <div class="text-slate-500 text-xs">信心 {{ (g.confidence * 100).toFixed(0) }}%</div>
              </div>
            </div>
            <p v-if="!dashboard.recentGestures.length"
              class="text-slate-600 text-sm text-center py-8">尚無紀錄</p>
          </div>
          <div class="border-t border-slate-700 pt-3 space-y-1 text-xs text-slate-500 shrink-0">
            <div>✊ FIST + 左右揮 → 換樂器</div>
            <div>👍 THUMB_UP ・ ✌️ PEACE ・ 🖐 OPEN_HAND → 指令</div>
            <div>👆 POINT + 音區 → 音符 ・ 🖐 OPEN + 轉腕 → 音量</div>
          </div>
        </div>

      </div><!-- end center+right -->

    </main>

  </div>
</template>
