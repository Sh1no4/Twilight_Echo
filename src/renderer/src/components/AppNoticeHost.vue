<script setup lang="ts">
import { useAppNoticeStore } from '../stores/useAppNoticeStore'

const { notices, dismissNotice } = useAppNoticeStore()

function runAction(id: number, run: () => void): void {
  try {
    run()
  } finally {
    dismissNotice(id)
  }
}
</script>

<template>
  <TransitionGroup
    tag="div"
    name="app-notice"
    class="app-notice-host"
    aria-live="polite"
    aria-relevant="additions text"
  >
    <div
      v-for="notice in notices"
      :key="notice.id"
      class="app-notice"
      :class="`app-notice-${notice.kind}`"
      role="status"
    >
      <i
        class="pi"
        :class="
          notice.kind === 'error'
            ? 'pi-exclamation-circle'
            : notice.kind === 'warning'
              ? 'pi-exclamation-triangle'
              : notice.kind === 'success'
                ? 'pi-check-circle'
                : 'pi-info-circle'
        "
        aria-hidden="true"
      ></i>
      <span class="app-notice-message">{{ notice.message }}</span>
      <button
        v-if="notice.action"
        type="button"
        class="app-notice-action"
        @click="runAction(notice.id, notice.action.run)"
      >
        {{ notice.action.label }}
      </button>
      <button
        type="button"
        class="app-notice-dismiss"
        aria-label="关闭通知"
        @click="dismissNotice(notice.id)"
      >
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.app-notice-host {
  position: fixed;
  top: 44px;
  right: 16px;
  z-index: 12000;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  width: min(420px, calc(100vw - 32px));
  pointer-events: none;
}

.app-notice {
  pointer-events: auto;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: start;
  gap: 0.55rem;
  padding: 0.72rem 0.8rem;
  border: 1px solid color-mix(in srgb, var(--te-border, #cbd5e1) 70%, transparent);
  border-radius: var(--te-toast-radius, 8px);
  background: color-mix(in srgb, var(--te-surface, #ffffff) 92%, transparent);
  color: var(--te-text, #0f172a);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
  backdrop-filter: blur(12px);
}

.app-notice > .pi {
  margin-top: 0.12rem;
  color: var(--te-accent, #7c4dff);
}

.app-notice-error > .pi {
  color: #ef4444;
}

.app-notice-warning > .pi {
  color: #f59e0b;
}

.app-notice-success > .pi {
  color: #22c55e;
}

.app-notice-message {
  min-width: 0;
  font-size: 0.86rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.app-notice-action,
.app-notice-dismiss {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0.1rem 0.2rem;
}

.app-notice-action {
  font-size: 0.78rem;
  font-weight: 650;
  color: var(--te-accent, #7c4dff);
  white-space: nowrap;
}

.app-notice-dismiss {
  opacity: 0.65;
}

.app-notice-dismiss:hover,
.app-notice-action:hover {
  opacity: 1;
}

/* Toasts slide in from the edge they are anchored to and collapse out of the
   stack, so a dismissal reads as "gone" rather than "replaced". */
.app-notice-enter-active {
  transition:
    opacity var(--te-toast-motion-duration, 220ms) ease-out,
    transform var(--te-toast-motion-duration, 220ms) cubic-bezier(0.22, 1, 0.36, 1);
}

.app-notice-leave-active {
  /* Out of flow so the remaining toasts close the gap with the move transition
     instead of jumping. */
  position: absolute;
  right: 0;
  width: 100%;
  transition:
    opacity 160ms ease-in,
    transform 160ms ease-in;
}

.app-notice-enter-from {
  opacity: 0;
  transform: translateX(16px) scale(0.97);
}

.app-notice-leave-to {
  opacity: 0;
  transform: translateX(16px) scale(0.97);
}

.app-notice-move {
  transition: transform var(--te-toast-motion-duration, 220ms) cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .app-notice-enter-active,
  .app-notice-leave-active,
  .app-notice-move {
    transition-duration: 1ms;
  }

  .app-notice-enter-from,
  .app-notice-leave-to {
    transform: none;
  }
}

html[data-theme='dark'] .app-notice {
  background: color-mix(in srgb, #0f172a 88%, transparent);
  border-color: rgba(148, 163, 184, 0.22);
  color: #e2e8f0;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.35);
}
</style>
