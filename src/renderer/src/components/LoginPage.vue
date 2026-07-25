<script setup lang="ts">
import QRCode from 'qrcode'
import { createVisibilityPollingController } from '../utils/visibilityPolling.ts'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useNcmStore } from '../stores/useNcmStore'
import { useProviderStore, type ProviderInfo } from '../stores/useProviderStore'
import type { MediaProviderProfile } from '../providers/mediaProvider'

const props = defineProps<{
  forceProfile?: boolean
  initialProviderId?: string | null
}>()

const emit = defineEmits<{
  back: []
  loginSuccess: []
}>()

const providerStore = useProviderStore()
const ncmStore = useNcmStore()

const POLL_INTERVAL = 5000
const QR_KEY_COOLDOWN = 5000

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
  id: string
  name: string
  desc: string
  icon: string
  color?: string
  available: boolean
  loggedIn: boolean
  profile: MediaProviderProfile | null
  error: string
}

const pageState = ref<PageState>('loading')
const activeProviderId = ref<string | null>(null)
const errorMsg = ref('')
const qrImage = ref('')
const qrKey = ref('')
const lastKeyGenTime = ref(0)
const authUrl = ref('') // OAuth device flow URL (for showBrowserButton providers)
const accountStates = ref<Record<string, AccountState>>({})
const accountLoginMode = ref<'phoneCaptcha' | 'phonePassword' | 'emailPassword'>('phoneCaptcha')
const accountPhone = ref('')
const accountCountryCode = ref('86')
const accountCaptcha = ref('')
const accountEmail = ref('')
const accountPassword = ref('')
const accountLoginBusy = ref(false)
const captchaBusy = ref(false)
const accountLoginMessage = ref('')
const loginBlockedUntil = ref(0)
const loginBlockedReason = ref('')

let pollTimer: ReturnType<typeof setInterval> | null = null
let cooldownTimer: ReturnType<typeof setInterval> | null = null

/** 所有声明了 login 能力的 provider（无论是否声明 ui 元数据，都显示在登录页） */
const loginProviders = computed<ProviderInfo[]>(() =>
  providerStore.providers.value.filter((p) => p.capabilities.includes('login'))
)

/** 默认 QR 状态码（兼容大多数 QR 登录流程） */
const DEFAULT_QR_STATUS_CODES = {
  waiting: 801,
  scanned: 802,
  expired: 800,
  denied: undefined as number | undefined,
  success: 803
}

const providerCards = computed<ProviderCard[]>(() =>
  loginProviders.value.map((provider) => {
    const state = accountStates.value[provider.id] ?? {
      available: false,
      loggedIn: false,
      profile: null,
      error: ''
    }
    return {
      id: provider.id,
      name: provider.name,
      desc: provider.ui?.description ?? '在线音源',
      icon: provider.ui?.icon ?? 'pi pi-cloud',
      color: provider.ui?.color,
      available: state.available,
      loggedIn: state.loggedIn,
      profile: state.profile,
      error: state.error
    }
  })
)

const activeProvider = computed<ProviderInfo | null>(() =>
  activeProviderId.value
    ? (loginProviders.value.find((p) => p.id === activeProviderId.value) ?? null)
    : null
)

const activeCard = computed(() =>
  activeProviderId.value
    ? (providerCards.value.find((card) => card.id === activeProviderId.value) ?? null)
    : null
)

const activeProfile = computed(() =>
  activeProviderId.value ? (accountStates.value[activeProviderId.value]?.profile ?? null) : null
)

const activeUi = computed(() => activeProvider.value?.ui)
const showNcmAccountLogin = computed(
  () => activeProviderId.value === 'ncm' && pageState.value !== 'login_success'
)
const loginCooldownRemaining = ref(0)
const isLoginCoolingDown = computed(() => loginCooldownRemaining.value > 0)
const loginCooldownText = computed(() => {
  if (!isLoginCoolingDown.value) return ''
  const minutes = Math.floor(loginCooldownRemaining.value / 60)
  const seconds = loginCooldownRemaining.value % 60
  return minutes > 0 ? `${minutes}分${String(seconds).padStart(2, '0')}秒` : `${seconds}秒`
})

const statusText = computed(() => {
  const providerName = activeCard.value?.name ?? '在线账号'
  switch (pageState.value) {
    case 'loading':
      return '正在初始化...'
    case 'qr_loading':
      return '正在生成二维码...'
    case 'qr_ready':
      return activeUi.value?.loginInstructions ?? '请扫码登录'
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
  const providers = loginProviders.value
  await Promise.all(providers.map((p) => refreshAccount(p.id)))
  if (!activeProviderId.value && pageState.value === 'loading') {
    pageState.value = 'account_list'
  }
}

async function refreshAccount(providerId: string): Promise<void> {
  const available = providerStore.hasProvider(providerId)
  if (!available) {
    accountStates.value = {
      ...accountStates.value,
      [providerId]: { available: false, loggedIn: false, profile: null, error: '' }
    }
    return
  }
  try {
    const state = await providerStore.checkLogin(providerId)
    accountStates.value = {
      ...accountStates.value,
      [providerId]: {
        available: true,
        loggedIn: state.loggedIn,
        profile: state.profile,
        error: ''
      }
    }
  } catch (error) {
    accountStates.value = {
      ...accountStates.value,
      [providerId]: {
        available: true,
        loggedIn: false,
        profile: null,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

async function syncSuccessfulLogin(providerId: string): Promise<void> {
  await refreshAccounts()
  if (providerId === 'ncm') {
    await ncmStore.checkLogin()
  }
  emit('loginSuccess')
}

function openAccount(providerId: string): void {
  activeProviderId.value = providerId
  const state = accountStates.value[providerId]
  if (!state?.available) {
    pageState.value = 'error'
    errorMsg.value =
      state?.error ||
      `${providerCards.value.find((c) => c.id === providerId)?.name ?? 'Provider'} 未启用`
    return
  }
  if (state.loggedIn) {
    pageState.value = 'logged_in'
    return
  }
  void startQrLogin()
}

function clearAccountLoginFeedback(): void {
  accountLoginMessage.value = ''
}

function refreshCooldownRemaining(): void {
  loginCooldownRemaining.value = Math.max(
    0,
    Math.ceil((loginBlockedUntil.value - Date.now()) / 1000)
  )
  if (loginCooldownRemaining.value === 0) {
    loginBlockedReason.value = ''
    if (cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }
}

function startLoginCooldown(seconds: number, reason: string): void {
  loginBlockedUntil.value = Date.now() + seconds * 1000
  loginBlockedReason.value = reason
  refreshCooldownRemaining()
  if (!cooldownTimer) {
    cooldownTimer = setInterval(refreshCooldownRemaining, 1000)
  }
}

function applyLoginCooldownFromMessage(message: string): void {
  if (/安全风险|设备环境异常|操作已拦截|24 小时|24小时/i.test(message)) {
    startLoginCooldown(24 * 60 * 60, '网易云已拦截当前网络或设备环境')
    return
  }
  if (/503|高频|风控/i.test(message)) {
    startLoginCooldown(180, '网易云登录接口触发高频或风控限制')
  }
}

async function checkQrScan(
  providerId: string,
  key: string
): Promise<{ code: number; message?: string; retryAfterSeconds?: number }> {
  try {
    return await providerStore.checkQrLogin(providerId, key)
  } catch (error) {
    return {
      code: -1,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function getQrErrorMessage(result: {
  code: number
  message?: string
  retryAfterSeconds?: number
}): string {
  if (result.message) return result.message
  if (result.code === 301) return '登录态无效或接口缓存了未登录结果，请重新登录或等待 2 分钟后重试'
  if (result.code === 502) return '二维码状态检查失败，请刷新二维码后重试'
  if (result.code === 503) return '登录接口触发高频限制，请等待几分钟后再试'
  if (result.code === 460) return '当前网络环境被网易云限制，请切换网络或稍后重试'
  return '二维码登录状态异常，请刷新二维码后重试'
}

function isQrStatus(code: number, type: 'waiting' | 'scanned' | 'expired' | 'success'): boolean {
  const codes = activeUi.value?.qrStatusCodes ?? DEFAULT_QR_STATUS_CODES
  switch (type) {
    case 'waiting':
      return code === codes.waiting
    case 'scanned':
      return codes.scanned !== null && code === codes.scanned
    case 'expired':
      return code === codes.expired || codes.denied === code
    case 'success':
      return code === codes.success
    default:
      return false
  }
}

function startPolling(providerId: string, key: string): void {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (document.hidden) return
    const result = await checkQrScan(providerId, key)
    if (isQrStatus(result.code, 'expired')) {
      pageState.value = 'qr_expired'
      stopPolling()
      return
    }
    if (
      result.code === -1 ||
      result.code === 301 ||
      result.code === 502 ||
      result.code === 503 ||
      result.code === 460
    ) {
      errorMsg.value = getQrErrorMessage(result)
      applyLoginCooldownFromMessage(errorMsg.value)
      pageState.value = 'error'
      stopPolling()
      return
    }
    if (isQrStatus(result.code, 'waiting')) {
      pageState.value = 'qr_ready'
      return
    }
    if (isQrStatus(result.code, 'scanned')) {
      pageState.value = 'qr_scanned'
      return
    }
    if (isQrStatus(result.code, 'success')) {
      stopPolling()
      pageState.value = 'login_success'
      await syncSuccessfulLogin(providerId)
    }
  }, POLL_INTERVAL)
}

function onDocumentVisibilityChange(): void {
  qrVisibilityPolling.onVisibilityChange()
}

const qrVisibilityPolling = createVisibilityPollingController({
  isHidden: () => document.hidden,
  stop: stopPolling,
  resume: () => {
    if (qrKey.value && activeProviderId.value && pollTimer === null)
      startPolling(activeProviderId.value, qrKey.value)
  }
})

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function startQrLogin(): Promise<void> {
  const providerId = activeProviderId.value
  if (!providerId) return
  const now = Date.now()
  if (now - lastKeyGenTime.value < QR_KEY_COOLDOWN) return
  lastKeyGenTime.value = now

  pageState.value = 'qr_loading'
  qrImage.value = ''
  qrKey.value = ''
  authUrl.value = ''
  errorMsg.value = ''

  try {
    const providerName = activeCard.value?.name ?? providerId
    const qr = await providerStore.getQrLogin(providerId)
    if (!qr?.key) throw new Error(`获取 ${providerName} 登录信息失败`)
    qrKey.value = qr.key
    authUrl.value = activeUi.value?.showBrowserButton ? qr.qrContent || '' : ''
    qrImage.value =
      qr.imageDataUrl ||
      (await QRCode.toDataURL(qr.qrContent || qr.key, {
        margin: 1,
        width: 220
      }))
    // Auto-open browser for OAuth-type providers
    if (activeUi.value?.showBrowserButton && authUrl.value) {
      window.open(authUrl.value, '_blank')
    }
    pageState.value = 'qr_ready'
    startPolling(providerId, qrKey.value)
  } catch (error) {
    pageState.value = 'error'
    errorMsg.value = error instanceof Error ? error.message : String(error)
  }
}

function handleRefresh(): void {
  lastKeyGenTime.value = 0
  void startQrLogin()
}

function openAuthUrl(): void {
  if (authUrl.value) {
    window.open(authUrl.value, '_blank')
  }
}

async function handleExtraAction(method: string): Promise<void> {
  if (!activeProviderId.value) return
  stopPolling()
  pageState.value = 'qr_loading'
  qrImage.value = ''
  qrKey.value = ''
  errorMsg.value = ''
  try {
    const providerId = activeProviderId.value
    await providerStore.callProvider(providerId, method)
    pageState.value = 'login_success'
    await syncSuccessfulLogin(providerId)
  } catch (error) {
    pageState.value = 'error'
    errorMsg.value = error instanceof Error ? error.message : String(error)
  }
}

function normalizeLoginError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/301/.test(message))
    return '登录态无效或接口缓存了未登录结果，请等待 2 分钟或重新生成登录请求'
  if (/安全风险|设备环境异常|操作已拦截/i.test(message)) {
    return '网易云拦截了当前网络或设备环境。请停止频繁重试，切换网络/设备或按官方提示 24 小时后再试。'
  }
  if (/503|高频|风控/i.test(message)) return '登录接口触发高频或风控限制，请等待几分钟后再试'
  if (/460/.test(message)) return '当前网络环境被网易云限制，请切换网络或稍后重试'
  if (/fetch failed|Failed to fetch|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|offline/i.test(message)) {
    return '网络不可用或无法连接网易云服务，请检查网络后重试'
  }
  return message || '登录失败，请检查账号信息后重试'
}

async function handleSendCaptcha(): Promise<void> {
  if (!activeProviderId.value || captchaBusy.value) return
  refreshCooldownRemaining()
  if (isLoginCoolingDown.value) {
    accountLoginMessage.value = `${loginBlockedReason.value || '登录请求正在冷却'}，请 ${loginCooldownText.value} 后再试`
    return
  }
  clearAccountLoginFeedback()
  const phone = accountPhone.value.trim()
  if (!phone) {
    accountLoginMessage.value = '请先输入手机号'
    return
  }
  captchaBusy.value = true
  try {
    const result = await providerStore.callProvider<{ code: number; message?: string }>(
      activeProviderId.value,
      'sendCaptcha',
      [phone, accountCountryCode.value.trim() || '86']
    )
    accountLoginMessage.value =
      result.code === 200 ? '验证码已发送' : result.message || '验证码发送失败'
    if (result.code !== 200) applyLoginCooldownFromMessage(accountLoginMessage.value)
  } catch (error) {
    accountLoginMessage.value = normalizeLoginError(error)
    applyLoginCooldownFromMessage(accountLoginMessage.value)
  } finally {
    captchaBusy.value = false
  }
}

async function handleAccountLogin(): Promise<void> {
  if (!activeProviderId.value || accountLoginBusy.value) return
  refreshCooldownRemaining()
  if (isLoginCoolingDown.value) {
    accountLoginMessage.value = `${loginBlockedReason.value || '登录请求正在冷却'}，请 ${loginCooldownText.value} 后再试`
    return
  }
  stopPolling()
  clearAccountLoginFeedback()
  accountLoginBusy.value = true
  try {
    const providerId = activeProviderId.value
    if (accountLoginMode.value === 'phoneCaptcha') {
      await providerStore.callProvider(providerId, 'loginByPhoneCaptcha', [
        accountPhone.value.trim(),
        accountCaptcha.value.trim(),
        accountCountryCode.value.trim() || '86'
      ])
    } else if (accountLoginMode.value === 'phonePassword') {
      await providerStore.callProvider(providerId, 'loginByPhonePassword', [
        accountPhone.value.trim(),
        accountPassword.value,
        accountCountryCode.value.trim() || '86'
      ])
    } else {
      await providerStore.callProvider(providerId, 'loginByEmailPassword', [
        accountEmail.value.trim(),
        accountPassword.value
      ])
    }
    pageState.value = 'login_success'
    await syncSuccessfulLogin(providerId)
  } catch (error) {
    accountLoginMessage.value = normalizeLoginError(error)
    applyLoginCooldownFromMessage(accountLoginMessage.value)
  } finally {
    accountLoginBusy.value = false
  }
}

async function handleLogout(): Promise<void> {
  if (!activeProviderId.value) return
  await providerStore.logout(activeProviderId.value)
  await refreshAccounts()
  openAccount(activeProviderId.value)
}

function backToAccounts(): void {
  stopPolling()
  activeProviderId.value = null
  pageState.value = 'account_list'
  qrImage.value = ''
  qrKey.value = ''
  authUrl.value = ''
  errorMsg.value = ''
  clearAccountLoginFeedback()
}

function handleBack(): void {
  if (activeProviderId.value) {
    backToAccounts()
    return
  }
  stopPolling()
  emit('back')
}

async function enterAfterLoggedIn(): Promise<void> {
  if (activeProviderId.value) {
    await syncSuccessfulLogin(activeProviderId.value)
    return
  }
  emit('loginSuccess')
}

onMounted(async () => {
  document.addEventListener('visibilitychange', onDocumentVisibilityChange)
  await refreshAccounts()
  if (props.initialProviderId && !activeProviderId.value) {
    openAccount(props.initialProviderId)
    return
  }
  if (props.forceProfile && !activeProviderId.value) {
    const loggedIn = providerCards.value.find((card) => card.available && card.loggedIn)
    if (loggedIn) {
      openAccount(loggedIn.id)
    }
  }
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
  stopPolling()
  if (cooldownTimer) clearInterval(cooldownTimer)
})
</script>

<template>
  <div class="login-page">
    <div class="login-deco" aria-hidden="true">
      <div class="deco-orb deco-orb-a"></div>
      <div class="deco-orb deco-orb-b"></div>
      <div class="deco-orb deco-orb-c"></div>
      <div class="deco-grain"></div>
    </div>

    <header class="login-header">
      <button class="login-back-btn" title="返回" @click="handleBack">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
      </button>
      <h2 class="login-title">
        {{ activeCard ? activeCard.name : '连接你的音乐世界' }}
      </h2>
    </header>

    <main class="login-body">
      <div v-if="pageState === 'loading'" class="login-status">
        <div class="status-spinner"></div>
        <p>{{ statusText }}</p>
      </div>

      <div v-else-if="pageState === 'account_list'" class="account-list">
        <p class="account-list-hint">选择你的音乐平台</p>
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
                已登录 · {{ provider.profile?.nickname || provider.profile?.userId || '未知用户' }}
              </template>
              <template v-else-if="provider.available">{{ provider.desc }}</template>
              <template v-else>{{ provider.error || 'Provider 未启用' }}</template>
            </span>
          </span>
          <span class="account-action">
            <template v-if="provider.loggedIn">管理</template>
            <template v-else-if="provider.available">登录</template>
            <template v-else>不可用</template>
          </span>
        </button>
      </div>

      <div v-else-if="pageState === 'error'" class="login-status">
        <div class="status-error-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <p class="error-text">{{ statusText }}</p>
        <button class="btn-primary" @click="handleRefresh">重试</button>
      </div>

      <div v-else-if="pageState === 'logged_in'" class="login-profile">
        <div class="profile-card">
          <div class="profile-avatar-ring">
            <img
              v-if="activeProfile?.avatarUrl"
              :src="activeProfile.avatarUrl"
              class="profile-avatar"
              alt="头像"
            />
            <div v-else class="profile-avatar-placeholder">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
          </div>
          <div class="profile-info">
            <span class="profile-nickname">{{ activeProfile?.nickname || '未知用户' }}</span>
            <span class="profile-uid">UID {{ activeProfile?.userId }}</span>
          </div>
          <button class="btn-ghost-danger" @click="handleLogout">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>退出登录</span>
          </button>
        </div>
        <button class="btn-primary" style="margin-top: 20px" @click="enterAfterLoggedIn">
          进入流媒体
        </button>
      </div>

      <div v-else class="login-qr-section">
        <div
          v-if="qrImage && !activeUi?.showBrowserButton"
          class="qr-wrapper"
          :class="{ expired: pageState === 'qr_expired' }"
        >
          <img v-if="pageState !== 'qr_expired'" :src="qrImage" alt="登录二维码" class="qr-image" />
          <div v-else class="qr-expired-overlay" @click="handleRefresh">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>点击刷新</span>
          </div>
        </div>

        <div
          v-else-if="
            activeUi?.showBrowserButton &&
            pageState !== 'login_success' &&
            pageState !== 'qr_expired'
          "
          class="qr-placeholder"
        >
          <div class="status-spinner"></div>
        </div>

        <div v-else-if="pageState === 'qr_loading'" class="qr-placeholder">
          <div class="status-spinner"></div>
        </div>

        <p class="qr-status" :class="{ success: pageState === 'login_success' }">
          <span v-if="pageState === 'login_success'" class="qr-status-dot success"></span>
          <span v-else-if="pageState === 'qr_scanned'" class="qr-status-dot scanned"></span>
          <span v-else class="qr-status-dot waiting"></span>
          {{ statusText }}
        </p>

        <p
          v-if="activeUi?.loginExtraActions?.length && pageState !== 'login_success'"
          class="qr-login-hint"
        >
          如果登录失败，请尝试其他方式
        </p>

        <form
          v-if="showNcmAccountLogin"
          class="account-login-form"
          @submit.prevent="handleAccountLogin"
        >
          <div class="account-login-tabs" role="tablist" aria-label="网易云账号登录方式">
            <button
              type="button"
              class="account-login-tab"
              :class="{ active: accountLoginMode === 'phoneCaptcha' }"
              @click="
                accountLoginMode = 'phoneCaptcha';
                clearAccountLoginFeedback()
              "
            >
              验证码
            </button>
            <button
              type="button"
              class="account-login-tab"
              :class="{ active: accountLoginMode === 'phonePassword' }"
              @click="
                accountLoginMode = 'phonePassword';
                clearAccountLoginFeedback()
              "
            >
              手机密码
            </button>
            <button
              type="button"
              class="account-login-tab"
              :class="{ active: accountLoginMode === 'emailPassword' }"
              @click="
                accountLoginMode = 'emailPassword';
                clearAccountLoginFeedback()
              "
            >
              邮箱密码
            </button>
          </div>

          <div v-if="accountLoginMode !== 'emailPassword'" class="account-login-row">
            <input
              v-model="accountCountryCode"
              class="account-login-input country"
              autocomplete="tel-country-code"
              inputmode="numeric"
              placeholder="86"
            />
            <input
              v-model="accountPhone"
              class="account-login-input"
              autocomplete="tel"
              inputmode="tel"
              placeholder="手机号"
            />
          </div>

          <input
            v-if="accountLoginMode === 'emailPassword'"
            v-model="accountEmail"
            class="account-login-input full"
            autocomplete="email"
            type="email"
            placeholder="网易邮箱"
          />

          <div v-if="accountLoginMode === 'phoneCaptcha'" class="account-login-row captcha">
            <input
              v-model="accountCaptcha"
              class="account-login-input"
              autocomplete="one-time-code"
              inputmode="numeric"
              placeholder="短信验证码"
            />
            <button
              type="button"
              class="btn-captcha"
              :disabled="captchaBusy || isLoginCoolingDown"
              @click="handleSendCaptcha"
            >
              {{ captchaBusy ? '发送中' : isLoginCoolingDown ? loginCooldownText : '获取验证码' }}
            </button>
          </div>

          <input
            v-if="accountLoginMode !== 'phoneCaptcha'"
            v-model="accountPassword"
            class="account-login-input full"
            autocomplete="current-password"
            type="password"
            placeholder="密码"
          />

          <button
            class="btn-primary account-login-submit"
            type="submit"
            :disabled="accountLoginBusy || isLoginCoolingDown"
          >
            <span v-if="accountLoginBusy" class="btn-spinner"></span>
            {{
              accountLoginBusy
                ? '登录中...'
                : isLoginCoolingDown
                  ? `等待 ${loginCooldownText}`
                  : '登录'
            }}
          </button>
          <p v-if="isLoginCoolingDown" class="account-login-message">
            {{ loginBlockedReason || '登录请求正在冷却' }}，请 {{ loginCooldownText }} 后再试
          </p>
          <p v-if="accountLoginMessage" class="account-login-message">{{ accountLoginMessage }}</p>
        </form>

        <button v-if="pageState === 'qr_expired'" class="btn-primary" @click="handleRefresh">
          重新获取二维码
        </button>

        <button
          v-if="
            activeUi?.showBrowserButton &&
            authUrl &&
            pageState !== 'login_success' &&
            pageState !== 'qr_expired'
          "
          class="btn-secondary"
          @click="openAuthUrl"
        >
          在浏览器中打开
        </button>

        <button
          v-for="action in activeUi?.loginExtraActions ?? []"
          :key="action.method"
          v-show="pageState !== 'login_success'"
          class="btn-secondary"
          @click="handleExtraAction(action.method)"
        >
          <i :class="action.icon" style="margin-right: 6px"></i>
          {{ action.label }}
        </button>

        <button
          v-if="pageState === 'login_success'"
          class="btn-primary"
          @click="$emit('loginSuccess')"
        >
          进入流媒体
        </button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.login-page {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: #faf8f4;
  overflow: hidden;
}

.login-deco {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.deco-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.55;
  animation: orbFloat 18s ease-in-out infinite alternate;
}

.deco-orb-a {
  width: 420px;
  height: 420px;
  top: -120px;
  right: -80px;
  background: linear-gradient(135deg, #f6d365 0%, #fda085 100%);
}

.deco-orb-b {
  width: 340px;
  height: 340px;
  bottom: -100px;
  left: -60px;
  background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
  animation-delay: -6s;
}

.deco-orb-c {
  width: 200px;
  height: 200px;
  top: 40%;
  left: 60%;
  background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);
  animation-delay: -12s;
}

@keyframes orbFloat {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(20px, -18px) scale(1.06); }
  100% { transform: translate(-12px, 14px) scale(0.96); }
}

.deco-grain {
  position: absolute;
  inset: 0;
  opacity: 0.028;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
}

.login-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: calc(32px + 16px) 28px 16px;
  flex-shrink: 0;
}

.login-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 12px;
  background: rgba(42, 33, 24, 0.06);
  color: #5a4a3a;
  cursor: pointer;
  transition: all 0.2s ease;
}

.login-back-btn:hover {
  background: rgba(42, 33, 24, 0.1);
  transform: translateX(-2px);
}

.login-title {
  font-size: 18px;
  font-weight: 800;
  color: #2a2118;
  margin: 0;
  letter-spacing: -0.02em;
}

.login-body {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.status-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(194, 112, 61, 0.15);
  border-top-color: #c2703d;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.btn-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  margin-right: 6px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: #7a6a5a;
  font-size: 14px;
}

.login-status p {
  margin: 0;
}

.status-error-icon {
  color: #d4573b;
}

.error-text {
  color: #d4573b !important;
  max-width: 320px;
  text-align: center;
  line-height: 1.6;
}

.account-list {
  display: grid;
  gap: 14px;
  width: min(480px, 100%);
}

.account-list-hint {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: #a08a72;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.account-card {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 84px;
  padding: 16px 18px;
  border: 1px solid rgba(194, 112, 61, 0.1);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.82);
  color: #2a2118;
  text-align: left;
  cursor: pointer;
  box-shadow:
    0 4px 24px rgba(194, 112, 61, 0.06),
    0 1px 3px rgba(42, 33, 24, 0.04);
  backdrop-filter: blur(12px);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.account-card:hover {
  box-shadow:
    0 12px 40px rgba(194, 112, 61, 0.12),
    0 2px 8px rgba(42, 33, 24, 0.06);
  transform: translateY(-3px);
  border-color: rgba(194, 112, 61, 0.2);
}

.account-card.unavailable {
  opacity: 0.55;
}

.account-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  color: #c2703d;
  background: linear-gradient(135deg, #fef3e2 0%, #fde8d0 100%);
}

.account-icon i {
  font-size: 22px;
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
  color: #2a2118;
  letter-spacing: -0.01em;
}

.account-desc {
  font-size: 12px;
  font-weight: 600;
  color: #a08a72;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  height: 32px;
  padding: 0 14px;
  border-radius: 10px;
  background: linear-gradient(135deg, #c2703d 0%, #d4573b 100%);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  padding: 12px 28px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #c2703d 0%, #d4573b 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 16px rgba(194, 112, 61, 0.25);
}

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(194, 112, 61, 0.35);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: wait;
  transform: none;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  padding: 10px 22px;
  border: 1.5px solid rgba(194, 112, 61, 0.25);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  color: #c2703d;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: rgba(194, 112, 61, 0.06);
  border-color: rgba(194, 112, 61, 0.4);
}

.btn-ghost-danger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
  padding: 8px 18px;
  border: 1.5px solid rgba(212, 87, 59, 0.2);
  border-radius: 12px;
  background: transparent;
  color: #d4573b;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-ghost-danger:hover {
  background: rgba(212, 87, 59, 0.06);
  border-color: rgba(212, 87, 59, 0.35);
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
  gap: 16px;
  padding: 40px 48px;
  border: 1px solid rgba(194, 112, 61, 0.1);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.85);
  box-shadow:
    0 20px 60px rgba(194, 112, 61, 0.1),
    0 4px 16px rgba(42, 33, 24, 0.04);
  backdrop-filter: blur(20px) saturate(140%);
}

.profile-avatar-ring {
  padding: 4px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f6d365, #fda085, #a8edea);
}

.profile-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid #fff;
}

.profile-avatar-placeholder {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #fef3e2;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c2703d;
  border: 3px solid #fff;
}

.profile-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.profile-nickname {
  font-size: 20px;
  font-weight: 800;
  color: #2a2118;
  letter-spacing: -0.02em;
}

.profile-uid {
  font-size: 12px;
  font-weight: 600;
  color: #a08a72;
}

.login-qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  width: min(400px, 100%);
}

.qr-wrapper {
  position: relative;
  width: 210px;
  height: 210px;
  border: 1px solid rgba(194, 112, 61, 0.12);
  border-radius: 24px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
  box-shadow:
    0 16px 48px rgba(194, 112, 61, 0.1),
    0 4px 12px rgba(42, 33, 24, 0.04);
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
  gap: 10px;
  background: rgba(250, 248, 244, 0.88);
  color: #a08a72;
  font-size: 13px;
  font-weight: 600;
  backdrop-filter: blur(4px);
  transition: color 0.2s;
}

.qr-expired-overlay:hover {
  color: #c2703d;
}

.qr-placeholder {
  width: 210px;
  height: 210px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(194, 112, 61, 0.1);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.7);
}

.qr-status {
  font-size: 14px;
  font-weight: 600;
  color: #5a4a3a;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.qr-status.success {
  color: #2d8a6a;
}

.qr-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.qr-status-dot.waiting {
  background: #f6d365;
  animation: pulse 1.6s ease-in-out infinite;
}

.qr-status-dot.scanned {
  background: #2d8a6a;
  animation: pulse 1s ease-in-out infinite;
}

.qr-status-dot.success {
  background: #2d8a6a;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

.qr-login-hint {
  margin: -8px 0 0;
  color: #a08a72;
  font-size: 12px;
  line-height: 1.5;
}

.account-login-form {
  width: min(360px, 100%);
  display: grid;
  gap: 12px;
  padding-top: 8px;
}

.account-login-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  min-height: 38px;
  padding: 4px;
  border-radius: 14px;
  background: rgba(42, 33, 24, 0.04);
}

.account-login-tab {
  min-width: 0;
  height: 34px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #7a6a5a;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.account-login-tab.active {
  background: #fff;
  color: #c2703d;
  box-shadow: 0 2px 8px rgba(42, 33, 24, 0.08);
}

.account-login-row {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 10px;
}

.account-login-row.captcha {
  grid-template-columns: minmax(0, 1fr) 110px;
}

.account-login-input {
  min-width: 0;
  height: 44px;
  border: 1.5px solid rgba(42, 33, 24, 0.1);
  border-radius: 14px;
  padding: 0 14px;
  background: rgba(255, 255, 255, 0.8);
  color: #2a2118;
  font-size: 14px;
  outline: none;
  transition: all 0.2s ease;
}

.account-login-input::placeholder {
  color: #bfae9a;
}

.account-login-input:focus {
  border-color: rgba(194, 112, 61, 0.5);
  box-shadow: 0 0 0 4px rgba(194, 112, 61, 0.08);
  background: #fff;
}

.account-login-input.country {
  text-align: center;
}

.account-login-input.full {
  width: 100%;
}

.btn-captcha {
  height: 44px;
  border: 1.5px solid rgba(194, 112, 61, 0.25);
  border-radius: 14px;
  background: rgba(194, 112, 61, 0.06);
  color: #c2703d;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-captcha:hover:not(:disabled) {
  background: rgba(194, 112, 61, 0.12);
}

.btn-captcha:disabled,
.account-login-submit:disabled {
  opacity: 0.6;
  cursor: wait;
}

.account-login-submit {
  width: 100%;
  margin-top: 4px;
}

.account-login-message {
  margin: -4px 0 0;
  min-height: 18px;
  color: #a08a72;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}
</style>
