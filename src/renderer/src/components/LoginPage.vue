<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useNcmStore } from '../stores/useNcmStore'

const props = defineProps<{
  forceProfile?: boolean
}>()

const emit = defineEmits<{
  back: []
  loginSuccess: []
}>()

const { setLogin: setStoreLogin, logout: storeLogout, buildProfile } = useNcmStore()

const POLL_INTERVAL = 3000
const QR_KEY_COOLDOWN = 5000

type PageState =
  | 'loading'
  | 'logged_in'
  | 'qr_loading'
  | 'qr_ready'
  | 'qr_scanned'
  | 'qr_expired'
  | 'login_success'
  | 'error'

const pageState = ref<PageState>('loading')
const errorMsg = ref('')
const qrImage = ref('')
const qrKey = ref('')
const profile = ref<{
  userId: number
  nickname: string
  avatarUrl: string
  signature?: string
} | null>(null)
const loginCookie = ref('')
const lastKeyGenTime = ref(0)

let pollTimer: ReturnType<typeof setInterval> | null = null

const statusText = computed(() => {
  switch (pageState.value) {
    case 'loading':
      return '正在初始化...'
    case 'qr_loading':
      return '正在生成二维码...'
    case 'qr_ready':
      return '请使用网易云音乐 App 扫码登录'
    case 'qr_scanned':
      return '已扫码，请在手机上确认登录'
    case 'qr_expired':
      return '二维码已过期，请点击刷新'
    case 'login_success':
      return '登录成功！'
    case 'error':
      return errorMsg.value
    default:
      return ''
  }
})

function getNcmUrl(path: string): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}ua=pc`
}

async function fetchNcm(path: string, cookie?: string): Promise<unknown> {
  return window.api.ncm.request(getNcmUrl(path), cookie)
}

async function checkLoginStatus(cookie?: string): Promise<boolean> {
  try {
    const data = (await fetchNcm('/login/status', cookie)) as {
      code?: number
      data?: {
        code: number
        profile?: { userId: number; nickname: string; avatarUrl: string }
        account?: unknown
      }
    }
    const profileData = data.data?.profile
    if (data.data?.code === 200 && profileData) {
      profile.value = profileData
      if (cookie) loginCookie.value = cookie
      return true
    }
    if (data.code === 200 && (data as Record<string, unknown>).profile) {
      const p = (data as Record<string, unknown>).profile as {
        userId: number
        nickname: string
        avatarUrl: string
      }
      profile.value = p
      if (cookie) loginCookie.value = cookie
      return true
    }
    return false
  } catch {
    return false
  }
}

async function getQrKey(): Promise<string | null> {
  try {
    const data = (await fetchNcm('/login/qr/key')) as {
      code: number
      data: { unikey: string }
    }
    if (data.code === 200 && data.data?.unikey) {
      return data.data.unikey
    }
    return null
  } catch {
    return null
  }
}

async function getQrImage(key: string): Promise<string | null> {
  try {
    const data = (await fetchNcm(`/login/qr/create?key=${key}&qrimg=true&platform=web`)) as {
      code: number
      data: { qrimg?: string }
    }
    if (data.code === 200 && data.data?.qrimg) {
      const raw = data.data.qrimg
      return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`
    }
    return null
  } catch {
    return null
  }
}

async function checkQrScan(key: string): Promise<{ code: number; cookie?: string }> {
  try {
    const data = (await fetchNcm(`/login/qr/check?key=${key}`)) as {
      code: number
      cookie?: string
    }
    return { code: data.code, cookie: data.cookie }
  } catch {
    return { code: -1 }
  }
}

function startPolling(key: string): void {
  stopPolling()
  pollTimer = setInterval(async () => {
    const result = await checkQrScan(key)
    switch (result.code) {
      case 800:
        pageState.value = 'qr_expired'
        stopPolling()
        break
      case 801:
        pageState.value = 'qr_ready'
        break
      case 802:
        pageState.value = 'qr_scanned'
        break
      case 803: {
        stopPolling()
        const cookie = result.cookie || ''
        if (cookie) {
          loginCookie.value = cookie
          await window.api.data.saveCookie(cookie)
        }
        await checkLoginStatus(cookie)
        if (profile.value) {
          const storeProfile = await buildProfile(profile.value)
          setStoreLogin(storeProfile)
        }
        emit('loginSuccess')
        break
      }
      default:
        break
    }
  }, POLL_INTERVAL)
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function startQrLogin(): Promise<void> {
  const now = Date.now()
  if (now - lastKeyGenTime.value < QR_KEY_COOLDOWN) {
    return
  }
  lastKeyGenTime.value = now

  pageState.value = 'qr_loading'
  qrImage.value = ''
  qrKey.value = ''
  errorMsg.value = ''

  const key = await getQrKey()
  if (!key) {
    pageState.value = 'error'
    errorMsg.value = '获取二维码密钥失败，请检查 API 服务是否启动'
    return
  }
  qrKey.value = key

  const img = await getQrImage(key)
  if (!img) {
    pageState.value = 'error'
    errorMsg.value = '生成二维码失败，请稍后重试'
    return
  }
  qrImage.value = img
  pageState.value = 'qr_ready'

  startPolling(key)
}

function handleRefresh(): void {
  startQrLogin()
}

async function handleLogout(): Promise<void> {
  await storeLogout()
  loginCookie.value = ''
  profile.value = null
  pageState.value = 'qr_loading'
  qrImage.value = ''
  qrKey.value = ''
  startQrLogin()
}

function handleBack(): void {
  stopPolling()
  emit('back')
}

onMounted(async () => {
  const savedCookie = await window.api.data.loadCookie()
  if (savedCookie) {
    loginCookie.value = savedCookie
    const loggedIn = await checkLoginStatus(savedCookie)
    if (loggedIn) {
      if (profile.value) {
        const storeProfile = await buildProfile(profile.value)
        setStoreLogin(storeProfile)
      }
      if (props.forceProfile) {
        pageState.value = 'logged_in'
        return
      }
      emit('loginSuccess')
      return
    }
    await window.api.data.saveCookie('')
    loginCookie.value = ''
  }

  await startQrLogin()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="login-page">
    <div class="login-header">
      <button class="login-back-btn" title="返回" @click="handleBack">
        <i class="pi pi-arrow-left"></i>
      </button>
      <h2 class="login-title">网易云音乐登录</h2>
    </div>

    <div class="login-body">
      <!-- Loading state -->
      <div v-if="pageState === 'loading'" class="login-status">
        <i class="pi pi-spin pi-spinner" style="font-size: 32px; color: #999"></i>
        <p>{{ statusText }}</p>
      </div>

      <!-- Error state -->
      <div v-else-if="pageState === 'error'" class="login-status">
        <i class="pi pi-exclamation-triangle" style="font-size: 32px; color: #e74c3c"></i>
        <p class="error-text">{{ statusText }}</p>
        <button class="login-action-btn" @click="startQrLogin">重试</button>
      </div>

      <!-- Logged in state -->
      <div v-else-if="pageState === 'logged_in'" class="login-profile">
        <div class="profile-card">
          <img
            v-if="profile?.avatarUrl"
            :src="profile.avatarUrl"
            class="profile-avatar"
            alt="头像"
          />
          <div v-else class="profile-avatar-placeholder">
            <i class="pi pi-user" style="font-size: 36px"></i>
          </div>
          <div class="profile-info">
            <span class="profile-nickname">{{ profile?.nickname || '未知用户' }}</span>
            <span class="profile-uid">UID: {{ profile?.userId }}</span>
          </div>
          <button class="logout-btn" @click="handleLogout">
            <i class="pi pi-sign-out"></i>
            <span>退出登录</span>
          </button>
        </div>
        <button class="login-action-btn" style="margin-top: 16px" @click="$emit('loginSuccess')">
          进入流媒体
        </button>
      </div>

      <!-- QR login states -->
      <div v-else class="login-qr-section">
        <!-- QR code -->
        <div v-if="qrImage" class="qr-wrapper" :class="{ expired: pageState === 'qr_expired' }">
          <img v-if="pageState !== 'qr_expired'" :src="qrImage" alt="登录二维码" class="qr-image" />
          <div v-else class="qr-expired-overlay" @click="handleRefresh">
            <i class="pi pi-refresh" style="font-size: 28px"></i>
            <span>点击刷新</span>
          </div>
        </div>

        <!-- QR loading placeholder -->
        <div v-else-if="pageState === 'qr_loading'" class="qr-placeholder">
          <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #ccc"></i>
        </div>

        <!-- Status text -->
        <p class="qr-status" :class="{ success: pageState === 'login_success' }">
          <i v-if="pageState === 'qr_ready'" class="pi pi-mobile" style="margin-right: 6px"></i>
          <i
            v-if="pageState === 'qr_scanned'"
            class="pi pi-check-circle"
            style="margin-right: 6px; color: #2ecc71"
          ></i>
          <i
            v-if="pageState === 'login_success'"
            class="pi pi-check-circle"
            style="margin-right: 6px; color: #2ecc71"
          ></i>
          {{ statusText }}
        </p>

        <!-- Refresh button -->
        <button v-if="pageState === 'qr_expired'" class="login-action-btn" @click="handleRefresh">
          <i class="pi pi-refresh" style="margin-right: 6px"></i>
          刷新二维码
        </button>

        <!-- Back button on success -->
        <button
          v-if="pageState === 'login_success'"
          class="login-action-btn"
          @click="$emit('loginSuccess')"
        >
          进入流媒体
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: fixed;
  inset: 32px 0 0 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.login-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}

.login-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #333;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.15s;
}

.login-back-btn:hover {
  background: #f0f0f0;
}

.login-title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0;
}

.login-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.login-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #666;
  font-size: 14px;
}

.login-status p {
  margin: 0;
}

.error-text {
  color: #e74c3c !important;
}

.login-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 20px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  color: #333;
  font-size: 14px;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.login-action-btn:hover {
  background: #f5f5f5;
  border-color: #bbb;
}

/* Profile (logged in) */
.login-profile {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.profile-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 40px;
  border: 1px solid #eee;
  border-radius: 12px;
  background: #fafafa;
}

.profile-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #e0e0e0;
}

.profile-avatar-placeholder {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
}

.profile-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.profile-nickname {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.profile-uid {
  font-size: 12px;
  color: #999;
}

.logout-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 16px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fff;
  color: #e74c3c;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.logout-btn:hover {
  background: #fef0f0;
}

/* QR section */
.login-qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.qr-wrapper {
  position: relative;
  width: 200px;
  height: 200px;
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}

.qr-wrapper.expired {
  cursor: pointer;
}

.qr-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qr-expired-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.85);
  color: #999;
  font-size: 14px;
  backdrop-filter: blur(2px);
}

.qr-expired-overlay:hover {
  color: #333;
}

.qr-placeholder {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #eee;
  border-radius: 8px;
}

.qr-status {
  font-size: 14px;
  color: #666;
  margin: 0;
  display: flex;
  align-items: center;
}

.qr-status.success {
  color: #2ecc71;
}
</style>
