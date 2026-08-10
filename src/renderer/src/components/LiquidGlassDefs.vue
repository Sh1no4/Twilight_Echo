<script setup lang="ts">
/**
 * Shared SVG filter definitions for the liquid glass material, mounted once by the
 * app shell.
 *
 * One `<defs>` serves every glass surface: cards reference `te-lg-card` and the
 * playbar references `te-lg-playbar`. Sharing definitions keeps the DOM flat — it
 * does not make the filter itself cheaper, since Chromium still runs one filter pass
 * per referencing element.
 *
 * `feDisplacementMap scale` and `feImage href` are SVG attributes and cannot read
 * CSS variables, so the tuning values are read back out of computed style (the theme
 * runtime writes `--te-lg-*` into a stylesheet) and bound as attributes here.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_LIQUID_GLASS_LIGHT,
  LIQUID_GLASS_CARD_FILTER_ID,
  LIQUID_GLASS_PLAYBAR_FILTER_ID,
  resolveAberrationBlur,
  resolveChannelScales
} from '../../../shared/liquidGlass.ts'
import {
  CARD_DISPLACEMENT_BUCKET,
  getDisplacementMapUrl,
  PLAYBAR_DISPLACEMENT_BUCKET
} from '../utils/liquidGlassDisplacement.ts'
import {
  createFrameCoalescer,
  pointerCssVariables,
  resolveViewportPointerOffset,
  staticPointerCssVariables,
  type LiquidGlassPointerVariables
} from '../utils/liquidGlassPointer.ts'

const props = defineProps<{
  /** Whether liquid glass is the active material. */
  active: boolean
  /** Whether the specular highlight tracks the pointer. */
  followPointer: boolean
}>()

const cardMapUrl = ref('')
const playbarMapUrl = ref('')
const displacementScale = ref(DEFAULT_LIQUID_GLASS_LIGHT.displacementScale)
const aberrationIntensity = ref(DEFAULT_LIQUID_GLASS_LIGHT.aberrationIntensity)

const channelScales = computed(() =>
  resolveChannelScales(displacementScale.value, aberrationIntensity.value)
)
const aberrationBlur = computed(() => resolveAberrationBlur(aberrationIntensity.value))
/**
 * Alpha ramp for the edge mask. The middle stop scales with aberration so a higher
 * setting lets more of the refracted band through before the hard cutoff.
 */
const edgeMaskTable = computed(() => `0 ${(aberrationIntensity.value * 0.05).toFixed(3)} 1`)

function readNumericVariable(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Re-reads the theme-written tuning variables into bound attribute values. */
function syncFilterInputs(): void {
  if (!props.active) return
  displacementScale.value = readNumericVariable(
    '--te-lg-displacement',
    DEFAULT_LIQUID_GLASS_LIGHT.displacementScale
  )
  aberrationIntensity.value = readNumericVariable(
    '--te-lg-aberration',
    DEFAULT_LIQUID_GLASS_LIGHT.aberrationIntensity
  )
}

function ensureMaps(): void {
  if (!props.active) return
  if (!cardMapUrl.value) cardMapUrl.value = getDisplacementMapUrl(CARD_DISPLACEMENT_BUCKET)
  if (!playbarMapUrl.value) {
    playbarMapUrl.value = getDisplacementMapUrl(PLAYBAR_DISPLACEMENT_BUCKET)
  }
}

function writePointerVariables(variables: LiquidGlassPointerVariables): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value)
  }
}

const pointerFrames = createFrameCoalescer<{ x: number; y: number }>((point) => {
  writePointerVariables(
    pointerCssVariables(
      resolveViewportPointerOffset(point.x, point.y, window.innerWidth, window.innerHeight)
    )
  )
})

function onPointerMove(event: PointerEvent): void {
  pointerFrames.schedule({ x: event.clientX, y: event.clientY })
}

/**
 * A single document-level listener drives the shared light source for every card.
 * The album grid renders in batches up to the full library, so per-card listeners
 * would scale with library size; one listener does not.
 */
function resolveMotionMode(): string {
  return document.documentElement.dataset.teMotion ?? 'full'
}

let pointerAttached = false

function detachPointer(): void {
  if (!pointerAttached) return
  window.removeEventListener('pointermove', onPointerMove)
  pointerFrames.cancel()
  pointerAttached = false
}

function syncPointerTracking(): void {
  // Motion-reduced users get a fixed light source rather than a moving one.
  const shouldTrack =
    props.active && props.followPointer && resolveMotionMode() !== 'off' && !isReducedMotion()

  if (shouldTrack === pointerAttached) return
  if (shouldTrack) {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    pointerAttached = true
    return
  }
  detachPointer()
  writePointerVariables(staticPointerCssVariables())
}

function isReducedMotion(): boolean {
  return resolveMotionMode() === 'reduced'
}

let motionObserver: MutationObserver | null = null

onMounted(() => {
  ensureMaps()
  syncFilterInputs()
  writePointerVariables(staticPointerCssVariables())
  syncPointerTracking()

  // The theme runtime rewrites its stylesheet and `data-te-*` attributes on tone or
  // profile change; both can move the tuning values and the motion mode.
  motionObserver = new MutationObserver(() => {
    syncFilterInputs()
    syncPointerTracking()
  })
  motionObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-te-motion', 'data-theme', 'data-te-surface-material']
  })
})

onBeforeUnmount(() => {
  detachPointer()
  motionObserver?.disconnect()
  motionObserver = null
})

watch(
  () => [props.active, props.followPointer],
  () => {
    ensureMaps()
    syncFilterInputs()
    syncPointerTracking()
  }
)
</script>

<template>
  <svg v-if="props.active" class="liquid-glass-defs" aria-hidden="true" focusable="false">
    <defs>
      <filter
        :id="LIQUID_GLASS_CARD_FILTER_ID"
        x="-35%"
        y="-35%"
        width="170%"
        height="170%"
        color-interpolation-filters="sRGB"
      >
        <feImage
          x="0"
          y="0"
          width="100%"
          height="100%"
          result="MAP"
          preserveAspectRatio="xMidYMid slice"
          :href="cardMapUrl"
        />
        <!-- Luminance of the map doubles as an edge mask: the rim is where the map
             deviates from neutral, so that is where aberration is allowed to show. -->
        <feColorMatrix
          in="MAP"
          type="matrix"
          values="0.3 0.3 0.3 0 0
                  0.3 0.3 0.3 0 0
                  0.3 0.3 0.3 0 0
                  0 0 0 1 0"
          result="EDGE_INTENSITY"
        />
        <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
          <feFuncA type="discrete" :tableValues="edgeMaskTable" />
        </feComponentTransfer>

        <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />

        <!-- Each channel is displaced by a slightly different amount; recombining
             them with a screen blend is what produces the chromatic fringe. -->
        <feDisplacementMap
          in="SourceGraphic"
          in2="MAP"
          :scale="channelScales.red"
          xChannelSelector="R"
          yChannelSelector="B"
          result="RED_DISPLACED"
        />
        <feColorMatrix
          in="RED_DISPLACED"
          type="matrix"
          values="1 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 1 0"
          result="RED_CHANNEL"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="MAP"
          :scale="channelScales.green"
          xChannelSelector="R"
          yChannelSelector="B"
          result="GREEN_DISPLACED"
        />
        <feColorMatrix
          in="GREEN_DISPLACED"
          type="matrix"
          values="0 0 0 0 0
                  0 1 0 0 0
                  0 0 0 0 0
                  0 0 0 1 0"
          result="GREEN_CHANNEL"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="MAP"
          :scale="channelScales.blue"
          xChannelSelector="R"
          yChannelSelector="B"
          result="BLUE_DISPLACED"
        />
        <feColorMatrix
          in="BLUE_DISPLACED"
          type="matrix"
          values="0 0 0 0 0
                  0 0 0 0 0
                  0 0 1 0 0
                  0 0 0 1 0"
          result="BLUE_CHANNEL"
        />
        <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
        <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
        <feGaussianBlur
          in="RGB_COMBINED"
          :stdDeviation="aberrationBlur"
          result="ABERRATED_BLURRED"
        />

        <!-- Keep aberration at the rim, keep the middle of the surface honest. -->
        <feComposite
          in="ABERRATED_BLURRED"
          in2="EDGE_MASK"
          operator="in"
          result="EDGE_ABERRATION"
        />
        <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
          <feFuncA type="table" tableValues="1 0" />
        </feComponentTransfer>
        <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />
        <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
      </filter>

      <!-- Same chain against the wide-strip map, so the playbar's short axis keeps a
           proportionate rim instead of a stretched one. -->
      <filter
        :id="LIQUID_GLASS_PLAYBAR_FILTER_ID"
        x="-35%"
        y="-35%"
        width="170%"
        height="170%"
        color-interpolation-filters="sRGB"
      >
        <feImage
          x="0"
          y="0"
          width="100%"
          height="100%"
          result="MAP"
          preserveAspectRatio="xMidYMid slice"
          :href="playbarMapUrl"
        />
        <feColorMatrix
          in="MAP"
          type="matrix"
          values="0.3 0.3 0.3 0 0
                  0.3 0.3 0.3 0 0
                  0.3 0.3 0.3 0 0
                  0 0 0 1 0"
          result="EDGE_INTENSITY"
        />
        <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
          <feFuncA type="discrete" :tableValues="edgeMaskTable" />
        </feComponentTransfer>
        <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="MAP"
          :scale="channelScales.red"
          xChannelSelector="R"
          yChannelSelector="B"
          result="RED_DISPLACED"
        />
        <feColorMatrix
          in="RED_DISPLACED"
          type="matrix"
          values="1 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 1 0"
          result="RED_CHANNEL"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="MAP"
          :scale="channelScales.green"
          xChannelSelector="R"
          yChannelSelector="B"
          result="GREEN_DISPLACED"
        />
        <feColorMatrix
          in="GREEN_DISPLACED"
          type="matrix"
          values="0 0 0 0 0
                  0 1 0 0 0
                  0 0 0 0 0
                  0 0 0 1 0"
          result="GREEN_CHANNEL"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="MAP"
          :scale="channelScales.blue"
          xChannelSelector="R"
          yChannelSelector="B"
          result="BLUE_DISPLACED"
        />
        <feColorMatrix
          in="BLUE_DISPLACED"
          type="matrix"
          values="0 0 0 0 0
                  0 0 0 0 0
                  0 0 1 0 0
                  0 0 0 1 0"
          result="BLUE_CHANNEL"
        />
        <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
        <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
        <feGaussianBlur
          in="RGB_COMBINED"
          :stdDeviation="aberrationBlur"
          result="ABERRATED_BLURRED"
        />
        <feComposite
          in="ABERRATED_BLURRED"
          in2="EDGE_MASK"
          operator="in"
          result="EDGE_ABERRATION"
        />
        <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
          <feFuncA type="table" tableValues="1 0" />
        </feComponentTransfer>
        <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />
        <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
      </filter>
    </defs>
  </svg>
</template>

<style scoped>
/* Definitions only — must occupy no space and never intercept input. */
.liquid-glass-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}
</style>
