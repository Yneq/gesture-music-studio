<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/authStore'
import apiClient from '../services/api'

const auth = useAuthStore()
const router = useRouter()

const username = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

// Real-time username availability
const usernameStatus = ref(null)   // null | 'checking' | 'available' | 'taken'
let checkTimer = null

watch(username, (val) => {
  usernameStatus.value = null
  clearTimeout(checkTimer)
  if (val.length < 3) return
  usernameStatus.value = 'checking'
  checkTimer = setTimeout(async () => {
    try {
      const { data } = await apiClient.get('/auth/check-username', { params: { username: val } })
      usernameStatus.value = data.taken ? 'taken' : 'available'
    } catch {
      usernameStatus.value = null
    }
  }, 500)
})

async function submit() {
  if (usernameStatus.value === 'taken') return
  error.value = ''
  loading.value = true
  try {
    await auth.register(username.value, password.value, email.value || null)
    await auth.login(username.value, password.value)
    router.push('/')
  } catch (e) {
    error.value = e.response?.data?.message ?? '註冊失敗，請確認輸入內容。'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-900 flex items-center justify-center px-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold text-white">AI Gesture Music Studio</h1>
        <p class="text-slate-400 text-sm mt-1">建立新帳號</p>
      </div>

      <form @submit.prevent="submit" class="bg-slate-800 rounded-2xl p-6 space-y-4">
        <div>
          <label class="block text-slate-300 text-sm mb-1">帳號（3–50 字元）</label>
          <div class="relative">
            <input
              v-model="username"
              type="text"
              required
              minlength="3"
              maxlength="50"
              autocomplete="username"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 pr-24"
            />
            <span v-if="usernameStatus === 'checking'"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
              檢查中…
            </span>
            <span v-else-if="usernameStatus === 'available'"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 text-xs font-semibold">
              ✓ 可以使用
            </span>
            <span v-else-if="usernameStatus === 'taken'"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-red-400 text-xs font-semibold">
              ✗ 已被使用
            </span>
          </div>
        </div>

        <div>
          <label class="block text-slate-300 text-sm mb-1">Email（選填）</label>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label class="block text-slate-300 text-sm mb-1">密碼（至少 6 字元）</label>
          <input
            v-model="password"
            type="password"
            required
            minlength="6"
            autocomplete="new-password"
            class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading || usernameStatus === 'taken'"
          class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg py-2 transition-colors"
        >
          {{ loading ? '註冊中…' : '註冊並登入' }}
        </button>
      </form>

      <p class="text-center text-slate-400 text-sm">
        已有帳號？
        <router-link to="/login" class="text-emerald-400 hover:underline">前往登入</router-link>
      </p>
    </div>
  </div>
</template>
