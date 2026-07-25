import { ref, type Ref } from 'vue'

export type AppNoticeKind = 'info' | 'success' | 'warning' | 'error'

export type AppNoticeAction = {
  label: string
  run: () => void
}

export type AppNotice = {
  id: number
  kind: AppNoticeKind
  message: string
  action?: AppNoticeAction
  sticky?: boolean
}

const notices = ref<AppNotice[]>([])
let nextNoticeId = 1
const dismissTimers = new Map<number, ReturnType<typeof setTimeout>>()

function clearDismissTimer(id: number): void {
  const timer = dismissTimers.get(id)
  if (timer == null) return
  clearTimeout(timer)
  dismissTimers.delete(id)
}

export function useAppNoticeStore(): {
  notices: Ref<AppNotice[]>
  pushNotice: (input: {
    kind?: AppNoticeKind
    message: string
    action?: AppNoticeAction
    sticky?: boolean
    durationMs?: number
  }) => number
  dismissNotice: (id: number) => void
  clearNotices: () => void
} {
  function dismissNotice(id: number): void {
    clearDismissTimer(id)
    notices.value = notices.value.filter((item) => item.id !== id)
  }

  function clearNotices(): void {
    for (const id of dismissTimers.keys()) clearDismissTimer(id)
    notices.value = []
  }

  function pushNotice(input: {
    kind?: AppNoticeKind
    message: string
    action?: AppNoticeAction
    sticky?: boolean
    durationMs?: number
  }): number {
    const message = input.message.trim()
    if (!message) return 0
    const id = nextNoticeId++
    const notice: AppNotice = {
      id,
      kind: input.kind ?? 'info',
      message,
      action: input.action,
      sticky: input.sticky === true
    }
    notices.value = [...notices.value.slice(-4), notice]
    if (!notice.sticky) {
      const durationMs = Math.max(2500, input.durationMs ?? 6000)
      dismissTimers.set(
        id,
        setTimeout(() => {
          dismissNotice(id)
        }, durationMs)
      )
    }
    return id
  }

  return {
    notices,
    pushNotice,
    dismissNotice,
    clearNotices
  }
}
