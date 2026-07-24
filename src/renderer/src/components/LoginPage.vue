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
        <button class="login-action-btn" style="margin-top: 16px" @click="enterAfterLoggedIn">
          进入流媒体
        </button>
      </div>

      <div v-else class="login-qr-section">
        <!-- QR code only for non-OAuth providers -->
        <div
          v-if="qrImage && !activeUi?.showBrowserButton"
          class="qr-wrapper"
          :class="{ expired: pageState === 'qr_expired' }"
        >
          <img v-if="pageState !== 'qr_expired'" :src="qrImage" alt="登录二维码" class="qr-image" />
          <div v-else class="qr-expired-overlay" @click="handleRefresh">
            <i class="pi pi-refresh" style="font-size: 28px"></i>
            <span>点击刷新</span>
          </div>
        </div>

        <!-- OAuth providers: show browser icon instead of QR -->
        <div
          v-else-if="
            activeUi?.showBrowserButton &&
            pageState !== 'login_success' &&
            pageState !== 'qr_expired'
          "
          class="qr-placeholder"
        >
          <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #ccc"></i>
        </div>

        <div v-else-if="pageState === 'qr_loading'" class="qr-placeholder">
          <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #ccc"></i>
        </div>

        <p class="qr-status" :class="{ success: pageState === 'login_success' }">
          <i
            v-if="pageState === 'qr_ready' && !activeUi?.showBrowserButton"
            class="pi pi-mobile"
            style="margin-right: 6px"
          ></i>
          <i
            v-if="pageState === 'qr_ready' && activeUi?.showBrowserButton"
            class="pi pi-external-link"
            style="margin-right: 6px"
          ></i>
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
              class="account-login-small-btn"
              :disabled="captchaBusy || isLoginCoolingDown"
              @click="handleSendCaptcha"
            >
              {{ captchaBusy ? '发送中' : isLoginCoolingDown ? loginCooldownText : '发验证码' }}
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
            class="login-action-btn account-login-submit"
            type="submit"
            :disabled="accountLoginBusy || isLoginCoolingDown"
          >
            <i
              :class="accountLoginBusy ? 'pi pi-spin pi-spinner' : 'pi pi-sign-in'"
              style="margin-right: 6px"
            ></i>
            {{
              accountLoginBusy
                ? '登录中'
                : isLoginCoolingDown
                  ? `等待 ${loginCooldownText}`
                  : '账号登录'
            }}
          </button>
          <p v-if="isLoginCoolingDown" class="account-login-message">
            {{ loginBlockedReason || '登录请求正在冷却' }}，请 {{ loginCooldownText }} 后再试
          </p>
          <p v-if="accountLoginMessage" class="account-login-message">{{ accountLoginMessage }}</p>
        </form>

        <button v-if="pageState === 'qr_expired'" class="login-action-btn" @click="handleRefresh">
          <i class="pi pi-refresh" style="margin-right: 6px"></i>
          重新登录
        </button>

        <button
          v-if="
            activeUi?.showBrowserButton &&
            authUrl &&
            pageState !== 'login_success' &&
            pageState !== 'qr_expired'
          "
          class="login-action-btn"
          @click="openAuthUrl"
        >
          <i class="pi pi-external-link" style="margin-right: 6px"></i>
          在浏览器中打开
        </button>

        <button
          v-for="action in activeUi?.loginExtraActions ?? []"
          :key="action.method"
          v-show="pageState !== 'login_success'"
          class="login-action-btn"
          @click="handleExtraAction(action.method)"
        >
          <i :class="action.icon" style="margin-right: 6px"></i>
          {{ action.label }}
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
  inset: 0;
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
  padding: calc(32px + 14px) 24px 14px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
  background: var(--te-card-bg);
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
  background:
    radial-gradient(circle at 18% 20%, rgba(124, 77, 255, 0.08), transparent 34%),
    radial-gradient(circle at 82% 78%, rgba(34, 211, 238, 0.08), transparent 36%), #ffffff;
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
  background: var(--te-card-bg);
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
  background: var(--te-subtle-bg);
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
  background: var(--te-subtle-bg);
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
  background: var(--te-card-bg);
  color: #e74c3c;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.logout-btn:hover {
  background: var(--te-danger-soft-bg);
}

.login-qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: min(420px, 100%);
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
  background: var(--te-subtle-bg);
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
  background: var(--te-glass-bg-strong);
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

.qr-login-hint {
  margin: -6px 0 0;
  color: rgba(90, 90, 104, 0.72);
  font-size: 12px;
  line-height: 1.5;
}

.account-login-form {
  width: min(360px, 100%);
  display: grid;
  gap: 10px;
  padding-top: 4px;
}

.account-login-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  min-height: 34px;
}

.account-login-tab {
  min-width: 0;
  height: 34px;
  border: 1px solid rgba(124, 77, 255, 0.18);
  border-radius: 8px;
  background: var(--te-subtle-bg);
  color: rgba(36, 41, 70, 0.72);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.account-login-tab.active {
  background: rgba(124, 77, 255, 0.12);
  color: var(--te-primary-500);
  border-color: rgba(124, 77, 255, 0.34);
}

.account-login-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
}

.account-login-row.captcha {
  grid-template-columns: minmax(0, 1fr) 104px;
}

.account-login-input {
  min-width: 0;
  height: 38px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 8px;
  padding: 0 11px;
  background: var(--te-subtle-bg);
  color: #242946;
  font-size: 13px;
  outline: none;
}

.account-login-input:focus {
  border-color: rgba(124, 77, 255, 0.48);
  box-shadow: 0 0 0 3px rgba(124, 77, 255, 0.1);
}

.account-login-input.country {
  text-align: center;
}

.account-login-input.full {
  width: 100%;
}

.account-login-small-btn {
  height: 38px;
  border: 1px solid rgba(124, 77, 255, 0.22);
  border-radius: 8px;
  background: rgba(124, 77, 255, 0.1);
  color: var(--te-primary-500);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.account-login-small-btn:disabled,
.account-login-submit:disabled {
  opacity: 0.68;
  cursor: wait;
}

.account-login-submit {
  width: 100%;
  margin-top: 0;
}

.account-login-message {
  margin: -2px 0 0;
  min-height: 18px;
  color: rgba(82, 90, 122, 0.72);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
</style>
