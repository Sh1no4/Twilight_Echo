<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  text: string
}>()

const rootRef = ref<HTMLElement | null>(null)
const innerRef = ref<HTMLElement | null>(null)
const overflowing = ref(false)
const contentWidth = ref(0)

// Scale the loop speed with the content length so short overflows crawl and
// very long titles do not race off the window edge.
const durationSeconds = computed(() => {
  if (!overflowing.value || contentWidth.value <= 0) return 10
  return Math.min(24, Math.max(7, Math.round(contentWidth.value / 28)))
})

function measure(): void {
  const root = rootRef.value
  const inner = innerRef.value
  if (!root || !inner) {
    overflowing.value = false
    return
  }
  const nextOverflowing = inner.scrollWidth > root.clientWidth + 1
  overflowing.value = nextOverflowing
  contentWidth.value = nextOverflowing ? inner.scrollWidth : 0
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measure)
    if (rootRef.value) resizeObserver.observe(rootRef.value)
  } else {
    window.addEventListener('resize', measure)
  }
})

watch(
  () => props.text,
  () => {
    requestAnimationFrame(measure)
  }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <span
    ref="rootRef"
    class="te-scroll-text"
    :class="{ 'is-overflowing': overflowing }"
    :style="{ '--te-scroll-duration': `${durationSeconds}s` }"
  >
    <span ref="innerRef" class="te-scroll-text-inner">
      <span class="te-scroll-text-item">{{ text }}</span>
      <span v-if="overflowing" class="te-scroll-text-item" aria-hidden="true">{{ text }}</span>
    </span>
  </span>
</template>

<style scoped>
.te-scroll-text {
  display: block;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.te-scroll-text-inner {
  display: inline-flex;
  min-width: 100%;
  white-space: nowrap;
  will-change: transform;
}

.te-scroll-text-item {
  display: inline-block;
  white-space: nowrap;
}

.te-scroll-text.is-overflowing .te-scroll-text-item {
  padding-right: 48px;
}

.te-scroll-text.is-overflowing .te-scroll-text-inner {
  /* Longhand form only: Vue's scoped-style keyframe rewriting cannot parse a
     CSS variable inside the `animation` shorthand and would drop every
     longhand, so the marquee never runs. */
  animation-name: te-scroll-text-loop;
  animation-duration: var(--te-scroll-duration, 10s);
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-delay: 1.4s;
}

@keyframes te-scroll-text-loop {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

/* The marquee carries information: a long title is unreadable when truncated,
   so the mini window's text keeps scrolling in the reduced tier — just slower.
   See docs/ui-playback-refactor-audit.md:696 for why the component's own
   prefers-reduced-motion disable rule was removed. */
:global(html[data-te-motion='reduced'] .te-scroll-text.is-overflowing .te-scroll-text-inner) {
  animation-name: te-scroll-text-loop !important;
  animation-duration: calc(var(--te-scroll-duration, 10s) * 2) !important;
  animation-timing-function: linear !important;
  animation-iteration-count: infinite !important;
  animation-delay: 2.4s !important;
}
</style>
