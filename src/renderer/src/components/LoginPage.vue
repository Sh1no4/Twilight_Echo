<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useNcmStore } from '../stores/useNcmStore'
import { useProviderStore } from '../stores/useProviderStore'
import type { MediaProviderProfile } from '../providers/mediaProvider'

defineProps<{
  forceProfile?: boolean
}>()

const emit = defineEmits<{
  back: []
  loginSuccess: []
}>()

const {
  providerAvailable: ncmProviderAvailable,
  providerError: ncmProviderError,
  logout: storeNcmLogout,
  checkLogin: storeNcmCheckLogin,
  getQrKey: storeNcmGetQrKey,
  getQrImage: storeNcmGetQrImage,
  checkQrLogin: storeNcmCheckQrLogin,
  profile: ncmProfile
} = useNcmStore()
const providerStore = useProviderStore()

const POLL_INTERVAL = 3000
const QR_KEY_COOLDOWN = 5000

type LoginProviderId = 'ncm' | 'bili'
type PageState =
  | 'loading'
  | 'account_list'
  | 'logged_in'
  | 'qr_loading'
  | 'qr_ready'
  | 'qr_scanned'
  | 'qr_expired'
  | 'login_success'
  | 'error'

interface AccountState {
  available: boolean
  loggedIn: boolean
  profile: MediaProviderProfile | null
  error: string
}

interface ProviderCard {
  id: LoginProviderId
  name: string
  desc: string
  icon: string
  available: boolean
  loggedIn: boolean
  profile: MediaProviderProfile | null
  error: string
}

const pageState = ref<PageState>('loading')
const activeProvider = ref<LoginProviderId | null>(null)
const errorMsg = ref('')
const qrImage = ref('')
const qrKey = ref('')
const lastKeyGenTime = ref(0)
const accountStates = ref<Record<LoginProviderId, AccountState>>({
  ncm: { available: true, loggedIn: false, profile: null, error: '' },
  bili: { available: false, loggedIn: false, profile: null, error: '' }
})

let pollTimer: ReturnType<typeof setInterval> | null = null

const providerCards = computed<ProviderCard[]>(() => {
  const cards: ProviderCard[] = [
    {
      id: 'ncm',
      name: '网易云音乐',
      desc: '内置基础音源',
      icon: 'pi pi-cloud',
      ...accountStates.value.ncm
    }
  ]
  if (accountStates.value.bili.available) {
    cards.push({
      id: 'bili',
      name: 'Bilibili',
      desc: '收藏夹视频音频',
      icon: 'pi pi-video',
      ...accountStates.value.bili
    })
  }
  return cards
})

const activeCard = computed(() =>
  activeProvider.value
    ? providerCards.value.find((provider) => provider.id === activeProvider.value) ?? null
    : null
)

const activeProfile = computed(() =>
  activeProvider.value ? accountStates.value[activeProvider.value].profile : null
)

const statusText = computed(() => {
  const providerName = activeCard.value?.name ?? '在线账号'
  switch (pageState.value) {
    case 'loading':
      return '正在初始化...'
    case 'qr_loading':
      return '正在生成二维码...'
    case 'qr_ready':
      return activeProvider.value === 'bili'
        ? '请使用哔哩哔哩 App 扫码登录'
        : '请使用网易云音乐 App 扫码登录'
    case 'qr_scanned':
      return '已扫码，请在手机上确认登录'
    case 'qr_expired':
      return '二维码已过期，请点击刷新'
    case 'login_success':
      return `${providerName} 登录成功`
    case 'error':
      return errorMsg.value
    default:
      return ''
  }
})

async function refreshAccounts(): Promise<void> {
  await providerStore.syncProviders().catch(() => undefined)
  await Promise.all([refreshNcmAccount(), refreshBiliAccount()])
  if (!activeProvider.value && pageState.value === 'loading') pageState.value = 'account_list'
}

async function refreshNcmAccount(): Promise<void> {
  try {
    const loggedIn = await storeNcmCheckLogin()
    accountStates.value = {
      ...accountStates.value,
      ncm: {
        available: ncmProviderAvailable.value,
        loggedIn,
        profile: ncmProfile.value,
        error: ncmProviderError.value
      }
    }
  } catch (error) {
    accountStates.value = {
      ...accountStates.value,
      ncm: {
        available: false,
        loggedIn: false,
        profile: null,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

async function refreshBiliAccount(): Promise<void> {
  const available = providerStore.hasProvider('bili')
  if (!available) {
    accountStates.value = {
      ...accountStates.value,
      bili: { available: false, loggedIn: false, profile: null, error: '' }
    }
    return
  }
  try {
    const state = await providerStore.checkLogin('bili')
    accountStates.value = {
      ...accountStates.value,
      bili: {
        available: true,
        loggedIn: state.loggedIn,
        profile: state.profile,
        error: ''
      }
    }
  } catch (error) {
    accountStates.value = {
      ...accountStates.value,
      bili: {
        available: true,
        loggedIn: false,
        profile: null,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

function openAccount(providerId: LoginProviderId): void {
  activeProvider.value = providerId
  const state = accountStates.value[providerId]
  if (!state.available) {
    pageState.value = 'error'
    errorMsg.value = state.error || `${providerId === 'ncm' ? '网易云音乐' : 'Bilibili'} Provider 未启用`
    return
  }
  if (state.loggedIn) {
    pageState.value = 'logged_in'
    return
  }
  void startQrLogin()
}

async function checkQrScan(providerId: LoginProviderId, key: string): Promise<{ code: number }> {
  try {
    if (providerId === 'ncm') return await storeNcmCheckQrLogin(key)
    return await providerStore.checkQrLogin('bili', key)
  } catch {
    return { code: -1 }
  }
}

function startPolling(providerId: LoginProviderId, key: string): void {
  stopPolling()
  pollTimer = setInterval(async () => {
    const result = await checkQrScan(providerId, key)
    if (isQrExpired(providerId, result.code)) {
      pageState.value = 'qr_expired'
      stopPolling()
      return
    }
    if (isQrWaiting(providerId, result.code)) {
      pageState.value = 'qr_ready'
      return
    }
    if (isQrScanned(providerId, result.code)) {
      pageState.value = 'qr_scanned'
      return
    }
    if (isQrSuccess(providerId, result.code)) {
      stopPolling()
      pageState.value = 'login_success'
      await refreshAccounts()
      emit('loginSuccess')
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
  const providerId = activeProvider.value
  if (!providerId) return
  const now = Date.now()
  if (now - lastKeyGenTime.value < QR_KEY_COOLDOWN) return
  lastKeyGenTime.value = now

  pageState.value = 'qr_loading'
  qrImage.value = ''
  qrKey.value = ''
  errorMsg.value = ''

  try {
    if (providerId === 'ncm') {
      const key = await storeNcmGetQrKey()
      if (!key) throw new Error(ncmProviderError.value || '获取二维码密钥失败，请确认网易云插件已启用')
      qrKey.value = key
      const img = await storeNcmGetQrImage(key)
      if (!img) throw new Error('生成二维码失败，请稍后重试')
      qrImage.value = img
    } else {
      const qr = await providerStore.getQrLogin('bili')
      if (!qr?.key) throw new Error('获取 Bilibili 二维码失败')
      qrKey.value = qr.key
      qrImage.value =
        qr.imageDataUrl ||
        (await QRCode.toDataURL(qr.qrContent || qr.key, {
          margin: 1,
          width: 220
        }))
    }
    pageState.value = 'qr_ready'
    startPolling(providerId, qrKey.value)
  } catch (error) {
    pageState.value = 'error'
    errorMsg.value = error instanceof Error ? error.message : String(error)
  }
}

function isQrExpired(providerId: LoginProviderId, code: number): boolean {
  return providerId === 'ncm' ? code === 800 : code === 86038
}

function isQrWaiting(providerId: LoginProviderId, code: number): boolean {
  return providerId === 'ncm' ? code === 801 : code === 86101
}

function isQrScanned(providerId: LoginProviderId, code: number): boolean {
  return providerId === 'ncm' ? code === 802 : code === 86090
}

function isQrSuccess(providerId: LoginProviderId, code: number): boolean {
  return providerId === 'ncm' ? code === 803 : code === 0
}

function handleRefresh(): void {
  lastKeyGenTime.value = 0
  void startQrLogin()
}

async function handleLogout(): Promise<void> {
  const providerId = activeProvider.value
  if (!providerId) return
  if (providerId === 'ncm') {
    await storeNcmLogout()
  } else {
    await providerStore.logout('bili')
  }
  await refreshAccounts()
  openAccount(providerId)
}

function backToAccounts(): void {
  stopPolling()
  activeProvider.value = null
  pageState.value = 'account_list'
  qrImage.value = ''
  qrKey.value = ''
  errorMsg.value = ''
}

function handleBack(): void {
  if (activeProvider.value) {
    backToAccounts()
    return
  }
  stopPolling()
  emit('back')
}

onMounted(async () => {
  await refreshAccounts()
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
      <h2 class="login-title">
        {{ activeCard ? activeCard.name : '在线账号' }}
      </h2>
    </div>

    <div class="login-body">
      <div v-if="pageState === 'loading'" class="login-status">
        <i class="pi pi-spin pi-spinner" style="font-size: 32px; color: #999"></i>
        <p>{{ statusText }}</p>
      </div>

      <div v-else-if="pageState === 'account_list'" class="account-list">
        <button
          v-for="provider in providerCards"
          :key="provider.id"
          type="button"
          class="account-card"
          :class="{ unavailable: !provider.available }"
          @click="openAccount(provider.id)"
        >
          <span class="account-icon">
            <i :class="provider.icon"></i>
          </span>
          <span class="account-copy">
            <span class="account-title">{{ provider.name }}</span>
            <span class="account-desc">
              <template v-if="provider.loggedIn">
                已登录：{{ provider.profile?.nickname || provider.profile?.userId || '未知用户' }}
              </template>
              <template v-else-if="provider.available">{{ provider.desc }}</template>
              <template v-else>{{ provider.error || 'Provider 未启用' }}</template>
            </span>
          </span>
          <span class="account-action">
            {{ provider.loggedIn ? '管理' : provider.available ? '登录' : '不可用' }}
          </span>
        </button>
      </div>

      <div v-else-if="pageState === 'error'" class="login-status">
        <i class="pi pi-exclamation-triangle" style="font-size: 32px; color: #e74c3c"></i>
        <p class="error-text">{{ statusText }}</p>
        <button class="login-action-btn" @click="handleRefresh">重试</button>
      </div>

      <div v-else-if="pageState === 'logged_in'" class="login-profile">
        <div class="profile-card">
          <img
            v-if="activeProfile?.avatarUrl"
            :src="activeProfile.avatarUrl"
            class="profile-avatar"
            alt="头像"
          />
          <div v-else class="profile-avatar-placeholder">
            <i class="pi pi-user" style="font-size: 36px"></i>
          </div>
          <div class="profile-info">
            <span class="profile-nickname">{{ activeProfile?.nickname || '未知用户' }}</span>
            <span class="profile-uid">UID: {{ activeProfile?.userId }}</span>
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

      <div v-else class="login-qr-section">
        <div v-if="qrImage" class="qr-wrapper" :class="{ expired: pageState === 'qr_expired' }">
          <img v-if="pageState !== 'qr_expired'" :src="qrImage" alt="登录二维码" class="qr-image" />
          <div v-else class="qr-expired-overlay" @click="handleRefresh">
            <i class="pi pi-refresh" style="font-size: 28px"></i>
            <span>点击刷新</span>
          </div>
        </div>

        <div v-else-if="pageState === 'qr_loading'" class="qr-placeholder">
          <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #ccc"></i>
        </div>

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

        <button v-if="pageState === 'qr_expired'" class="login-action-btn" @click="handleRefresh">
          <i class="pi pi-refresh" style="margin-right: 6px"></i>
          刷新二维码
        </button>

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
  background:
    radial-gradient(circle at 18% 20%, rgba(124, 77, 255, 0.14), transparent 34%),
    radial-gradient(circle at 82% 78%, rgba(34, 211, 238, 0.12), transparent 36%), transparent;
}

.login-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.58);
  background: rgba(255, 255, 255, 0.34);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
  flex-shrink: 0;
}

.login-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 10px;
  background: rgba(124, 77, 255, 0.09);
  color: var(--te-primary-500);
  cursor: pointer;
  font-size: 16px;
  transition: background 0.15s;
}

.login-back-btn:hover {
  background: rgba(124, 77, 255, 0.16);
}

.login-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--te-neutral-900);
  margin: 0;
}

.login-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 34px;
}

.account-list {
  display: grid;
  gap: 12px;
  width: min(520px, 100%);
}

.account-card {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 82px;
  padding: 14px;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  background: #fff;
  color: #242946;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
}

.account-card:hover {
  box-shadow: 0 18px 38px rgba(34, 42, 68, 0.1);
  transform: translateY(-1px);
}

.account-card.unavailable {
  opacity: 0.66;
}

.account-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  color: var(--te-primary-500);
  background: #f3f0ff;
}

.account-icon i {
  font-size: 20px;
}

.account-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.account-title {
  font-size: 15px;
  font-weight: 800;
  color: #242946;
}

.account-desc {
  font-size: 12px;
  font-weight: 700;
  color: rgba(82, 90, 122, 0.62);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 62px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  background: #f8fafc;
  color: var(--te-primary-500);
  font-size: 12px;
  font-weight: 800;
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
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.5);
  color: var(--te-neutral-900);
  font-size: 14px;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.login-action-btn:hover {
  background: rgba(124, 77, 255, 0.1);
  border-color: rgba(124, 77, 255, 0.22);
}

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
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 18px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.54), rgba(248, 245, 255, 0.32)),
    rgba(255, 255, 255, 0.32);
  box-shadow: 0 24px 70px rgba(86, 70, 160, 0.14);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
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
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 18px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.66);
  box-shadow: 0 24px 70px rgba(86, 70, 160, 0.16);
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
