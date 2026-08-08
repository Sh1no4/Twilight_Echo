<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  DEFAULT_LYRICS_APPEARANCE,
  cloneLyricsAppearance,
  normalizeLyricsAppearance,
  resolveLyricsFontFamily,
  syncLegacyLyricsAppearance,
  type LyricsAppearanceSettings,
  type LyricsStyleTarget,
  type LyricsTextStyle
} from '../../../shared/lyricsAppearance.ts'
import { useSettingsStore } from '../stores/useSettingsStore'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { settings, updateSettings } = useSettingsStore()
const activeTarget = ref<LyricsStyleTarget>('normal')
const draft = ref(cloneLyricsAppearance(settings.value.lyricsAppearance))
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let saveTimer = 0
let saveSequence = 0

const targetOptions: Array<{ value: LyricsStyleTarget; label: string; hint: string }> = [
  { value: 'normal', label: '普通歌词', hint: '未播放与非当前行' },
  { value: 'active', label: '当前歌词', hint: '正在播放的主歌词' },
  { value: 'translation', label: '翻译歌词', hint: '当前与普通翻译共用' }
]
const fontOptions = [
  { value: 'inherit', label: '跟随界面' },
  { value: 'system', label: '系统默认' },
  { value: 'inter', label: 'Inter / Roboto' },
  { value: 'lxgw', label: '霞鹜文楷' },
  { value: 'sarasa', label: '更纱黑体' },
  { value: 'comic', label: 'Comic Sans' },
  { value: 'custom', label: '自定义字体名' }
] as const
const backgroundOptions = [
  { value: 'none', label: '无背景' },
  { value: 'solid', label: '纯色' },
  { value: 'glass', label: '磨砂' },
  { value: 'gradient', label: '渐变' }
] as const
const highlightOptions = [
  { value: 'none', label: '无' },
  { value: 'shadow', label: '阴影' },
  { value: 'glow', label: '柔光' },
  { value: 'outline', label: '描边' }
] as const
const style = computed(() => draft.value.styles[activeTarget.value])
const statusLabel = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'saved') return '已保存'
  if (saveState.value === 'error') return '保存失败'
  return '实时预览'
})

function patchStyle<K extends keyof LyricsTextStyle>(key: K, value: LyricsTextStyle[K]): void {
  if (key === 'fontSize') {
    draft.value = syncLegacyLyricsAppearance(draft.value, { fontSize: value as number })
    scheduleSave()
    return
  }
  draft.value = {
    ...draft.value,
    styles: {
      ...draft.value.styles,
      [activeTarget.value]: { ...style.value, [key]: value }
    }
  }
  scheduleSave()
}

function setGlobal<K extends 'inactiveOpacity' | 'focusLineCount' | 'karaokeEnabled'>(
  key: K,
  value: LyricsAppearanceSettings[K]
): void {
  draft.value = { ...draft.value, [key]: value }
  scheduleSave()
}

function resetTarget(): void {
  const defaults = cloneLyricsAppearance(DEFAULT_LYRICS_APPEARANCE)
  draft.value = {
    ...draft.value,
    styles: {
      ...draft.value.styles,
      [activeTarget.value]: { ...defaults.styles[activeTarget.value] }
    }
  }
  scheduleSave()
}

function resetAll(): void {
  draft.value = cloneLyricsAppearance(DEFAULT_LYRICS_APPEARANCE)
  scheduleSave(0)
}

function scheduleSave(delay = 180): void {
  if (saveTimer) window.clearTimeout(saveTimer)
  const normalized = normalizeLyricsAppearance(draft.value)
  draft.value = normalized
  settings.value = { ...settings.value, lyricsAppearance: cloneLyricsAppearance(normalized) }
  saveState.value = 'saving'
  const sequence = ++saveSequence
  saveTimer = window.setTimeout(async () => {
    saveTimer = 0
    try {
      await updateSettings({ lyricsAppearance: cloneLyricsAppearance(normalized) })
      if (sequence === saveSequence) saveState.value = 'saved'
    } catch {
      if (sequence === saveSequence) saveState.value = 'error'
    }
  }, delay)
}

function previewStyle(target: LyricsStyleTarget): Record<string, string> {
  const value = draft.value.styles[target]
  const alpha = value.opacity / 100
  const backgroundAlpha = value.backgroundOpacity / 100
  const intensity = value.highlightIntensity / 100
  const result: Record<string, string> = {
    fontFamily: resolveLyricsFontFamily(value),
    fontSize: `clamp(${Math.max(12, value.fontSize - 3)}px, ${value.fontSize / 16}vw, ${value.fontSize}px)`,
    fontWeight: String(value.fontWeight),
    lineHeight: String(value.lineHeight),
    textAlign: value.align,
    color:
      value.colorMode === 'custom'
        ? `color-mix(in srgb, ${value.color} ${alpha * 100}%, transparent)`
        : `color-mix(in srgb, var(--te-playback-lyric-active-text) ${Math.max(22, alpha * 100)}%, transparent)`,
    backgroundColor:
      value.backgroundStyle === 'none'
        ? 'transparent'
        : `color-mix(in srgb, ${value.backgroundColor} ${backgroundAlpha * 100}%, transparent)`
  }
  if (value.backgroundStyle === 'gradient') {
    result.backgroundImage = `linear-gradient(135deg, color-mix(in srgb, ${value.backgroundColor} ${backgroundAlpha * 100}%, transparent), transparent)`
  }
  if (value.backgroundStyle === 'glass') {
    result.backdropFilter = 'blur(16px) saturate(130%)'
  }
  if (value.highlightEffect === 'shadow') {
    result.textShadow = `0 3px ${Math.round(6 + intensity * 14)}px color-mix(in srgb, ${value.highlightColor} ${20 + intensity * 45}%, transparent)`
  }
  if (value.highlightEffect === 'glow') {
    result.textShadow = `0 0 ${Math.round(8 + intensity * 22)}px color-mix(in srgb, ${value.highlightColor} ${24 + intensity * 56}%, transparent)`
  }
  if (value.highlightEffect === 'outline') {
    result.webkitTextStroke = `${(0.3 + intensity * 1.2).toFixed(1)}px ${value.highlightColor}`
  }
  return result
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      draft.value = cloneLyricsAppearance(settings.value.lyricsAppearance)
      saveState.value = 'idle'
    }
  }
)

onBeforeUnmount(() => {
  if (saveTimer) window.clearTimeout(saveTimer)
})
</script>

<template>
  <Transition name="lyrics-customizer">
    <div v-if="open" class="lyrics-customizer-shell" @pointerdown.self="emit('close')">
      <aside
        class="lyrics-customizer"
        role="dialog"
        aria-modal="true"
        aria-label="PlayingMusic 歌词个性化"
      >
        <header class="customizer-header">
          <div>
            <span class="customizer-kicker">PlayingMusic</span>
            <h2>歌词个性化</h2>
            <p>分别调整普通、当前和翻译歌词，所有更改实时应用并自动保存。</p>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="关闭歌词个性化"
            @click="emit('close')"
          >
            <i class="pi pi-times"></i>
          </button>
        </header>

        <div class="customizer-status" :data-state="saveState">
          <span><i class="pi pi-eye"></i>{{ statusLabel }}</span>
          <button type="button" @click="resetAll">恢复全部默认</button>
        </div>

        <div class="style-tabs" role="tablist" aria-label="歌词样式对象">
          <button
            v-for="option in targetOptions"
            :key="option.value"
            type="button"
            role="tab"
            :aria-selected="activeTarget === option.value"
            @click="activeTarget = option.value"
          >
            <strong>{{ option.label }}</strong
            ><span>{{ option.hint }}</span>
          </button>
        </div>

        <section class="live-preview" aria-label="歌词样式实时预览">
          <span class="preview-label">实时预览</span>
          <div class="preview-lines">
            <p :style="previewStyle('normal')">在暮色里听见回声</p>
            <p class="is-active" :style="previewStyle('active')">此刻旋律正穿过夜色</p>
            <p class="is-translation" :style="previewStyle('translation')">
              The melody is crossing the night
            </p>
          </div>
        </section>

        <div class="customizer-scroll">
          <section class="control-section">
            <div class="section-heading">
              <h3>字体与排版</h3>
              <button type="button" @click="resetTarget">恢复本项默认</button>
            </div>
            <label class="control-field control-field--wide">
              <span>字体</span>
              <select
                :value="style.fontFamily"
                @change="
                  patchStyle(
                    'fontFamily',
                    ($event.target as HTMLSelectElement).value as LyricsTextStyle['fontFamily']
                  )
                "
              >
                <option v-for="option in fontOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label v-if="style.fontFamily === 'custom'" class="control-field control-field--wide">
              <span>本机字体名称</span>
              <input
                :value="style.customFontFamily"
                type="text"
                maxlength="96"
                placeholder="例如 Microsoft YaHei UI"
                @input="patchStyle('customFontFamily', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <div class="control-grid">
              <label class="range-field"
                ><span
                  >字号 <strong>{{ style.fontSize }}px</strong></span
                ><input
                  type="range"
                  min="12"
                  max="48"
                  step="1"
                  :value="style.fontSize"
                  @input="
                    patchStyle('fontSize', Number(($event.target as HTMLInputElement).value))
                  "
              /></label>
              <label class="range-field"
                ><span
                  >字重 <strong>{{ style.fontWeight }}</strong></span
                ><input
                  type="range"
                  min="300"
                  max="900"
                  step="100"
                  :value="style.fontWeight"
                  @input="
                    patchStyle('fontWeight', Number(($event.target as HTMLInputElement).value))
                  "
              /></label>
              <label class="range-field"
                ><span
                  >行间距 <strong>{{ style.lineHeight.toFixed(2) }}</strong></span
                ><input
                  type="range"
                  min="1.1"
                  max="2.8"
                  step="0.05"
                  :value="style.lineHeight"
                  @input="
                    patchStyle('lineHeight', Number(($event.target as HTMLInputElement).value))
                  "
              /></label>
              <label class="range-field"
                ><span
                  >文字透明度 <strong>{{ style.opacity }}%</strong></span
                ><input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  :value="style.opacity"
                  @input="patchStyle('opacity', Number(($event.target as HTMLInputElement).value))"
              /></label>
            </div>
            <div class="segment-field">
              <span>对齐方式</span>
              <div class="segment-control">
                <button
                  v-for="option in [
                    { value: 'left', label: '左' },
                    { value: 'center', label: '中' },
                    { value: 'right', label: '右' }
                  ]"
                  :key="option.value"
                  type="button"
                  :aria-pressed="style.align === option.value"
                  @click="patchStyle('align', option.value as LyricsTextStyle['align'])"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </section>

          <section class="control-section">
            <h3>文字颜色</h3>
            <div class="segment-field">
              <span>颜色来源</span>
              <div class="segment-control">
                <button
                  type="button"
                  :aria-pressed="style.colorMode === 'theme'"
                  @click="patchStyle('colorMode', 'theme')"
                >
                  跟随主题</button
                ><button
                  type="button"
                  :aria-pressed="style.colorMode === 'custom'"
                  @click="patchStyle('colorMode', 'custom')"
                >
                  自定义
                </button>
              </div>
            </div>
            <label v-if="style.colorMode === 'custom'" class="color-field"
              ><span>文字颜色</span
              ><input
                type="color"
                :value="style.color"
                @input="patchStyle('color', ($event.target as HTMLInputElement).value)"
              /><code>{{ style.color }}</code></label
            >
          </section>

          <section class="control-section">
            <h3>背景样式</h3>
            <div class="option-grid">
              <button
                v-for="option in backgroundOptions"
                :key="option.value"
                type="button"
                :aria-pressed="style.backgroundStyle === option.value"
                @click="patchStyle('backgroundStyle', option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <template v-if="style.backgroundStyle !== 'none'">
              <label class="color-field"
                ><span>背景颜色</span
                ><input
                  type="color"
                  :value="style.backgroundColor"
                  @input="patchStyle('backgroundColor', ($event.target as HTMLInputElement).value)"
                /><code>{{ style.backgroundColor }}</code></label
              >
              <label class="range-field"
                ><span
                  >背景透明度 <strong>{{ style.backgroundOpacity }}%</strong></span
                ><input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  :value="style.backgroundOpacity"
                  @input="
                    patchStyle(
                      'backgroundOpacity',
                      Number(($event.target as HTMLInputElement).value)
                    )
                  "
              /></label>
            </template>
          </section>

          <section class="control-section">
            <h3>高亮效果</h3>
            <div class="option-grid">
              <button
                v-for="option in highlightOptions"
                :key="option.value"
                type="button"
                :aria-pressed="style.highlightEffect === option.value"
                @click="patchStyle('highlightEffect', option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <template v-if="style.highlightEffect !== 'none'">
              <label class="color-field"
                ><span>效果颜色</span
                ><input
                  type="color"
                  :value="style.highlightColor"
                  @input="patchStyle('highlightColor', ($event.target as HTMLInputElement).value)"
                /><code>{{ style.highlightColor }}</code></label
              >
              <label class="range-field"
                ><span
                  >效果强度 <strong>{{ style.highlightIntensity }}%</strong></span
                ><input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  :value="style.highlightIntensity"
                  @input="
                    patchStyle(
                      'highlightIntensity',
                      Number(($event.target as HTMLInputElement).value)
                    )
                  "
              /></label>
            </template>
          </section>

          <section class="control-section">
            <h3>显示行为</h3>
            <label class="range-field"
              ><span
                >非当前行整体可见度 <strong>{{ draft.inactiveOpacity }}%</strong></span
              ><input
                type="range"
                min="10"
                max="100"
                step="5"
                :value="draft.inactiveOpacity"
                @input="
                  setGlobal('inactiveOpacity', Number(($event.target as HTMLInputElement).value))
                "
            /></label>
            <div class="segment-field">
              <span>聚焦范围</span>
              <div class="segment-control segment-control--four">
                <button
                  v-for="option in [
                    { value: 'all', label: '全部' },
                    { value: 1, label: '1行' },
                    { value: 3, label: '3行' },
                    { value: 5, label: '5行' }
                  ]"
                  :key="option.value"
                  type="button"
                  :aria-pressed="draft.focusLineCount === option.value"
                  @click="
                    setGlobal(
                      'focusLineCount',
                      option.value as LyricsAppearanceSettings['focusLineCount']
                    )
                  "
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <button
              type="button"
              class="switch-row"
              :aria-pressed="draft.karaokeEnabled"
              @click="setGlobal('karaokeEnabled', !draft.karaokeEnabled)"
            >
              <span><strong>逐字高亮</strong><small>仅在歌词含逐字时间戳时生效</small></span
              ><i :class="draft.karaokeEnabled ? 'pi pi-check-circle' : 'pi pi-circle'"></i>
            </button>
          </section>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.lyrics-customizer-shell {
  position: fixed;
  inset: 0;
  z-index: 15000;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--te-neutral-900) 48%, transparent);
  backdrop-filter: blur(8px);
}
.lyrics-customizer {
  width: min(560px, 100vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--te-neutral-900);
  border-left: 1px solid color-mix(in srgb, var(--te-card-border) 86%, transparent);
  background: color-mix(in srgb, var(--te-settings-bg) 94%, transparent);
  box-shadow: -24px 0 70px color-mix(in srgb, var(--te-neutral-900) 34%, transparent);
}
.customizer-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 24px 18px;
}
.customizer-kicker {
  color: var(--te-primary-400);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.customizer-header h2 {
  margin: 5px 0 4px;
  font-size: 24px;
}
.customizer-header p {
  margin: 0;
  max-width: 430px;
  color: var(--te-neutral-500);
  font-size: 13px;
  line-height: 1.6;
}
.icon-button {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border: 1px solid var(--te-card-border);
  border-radius: 12px;
  color: inherit;
  background: var(--te-card-bg);
  cursor: pointer;
}
.customizer-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 24px;
  border-block: 1px solid var(--te-card-border);
  color: var(--te-neutral-500);
  font-size: 12px;
}
.customizer-status span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.customizer-status[data-state='saved'] span {
  color: var(--te-success-500);
}
.customizer-status[data-state='error'] span {
  color: var(--te-favorite-500);
}
.customizer-status button,
.section-heading button {
  border: 0;
  color: var(--te-primary-400);
  background: transparent;
  cursor: pointer;
}
.style-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 16px 24px;
}
.style-tabs button {
  min-width: 0;
  padding: 11px 10px;
  border: 1px solid var(--te-card-border);
  border-radius: 12px;
  color: var(--te-neutral-500);
  text-align: left;
  background: var(--te-card-bg);
  cursor: pointer;
}
.style-tabs button[aria-selected='true'] {
  border-color: color-mix(in srgb, var(--te-primary-400) 70%, transparent);
  color: var(--te-neutral-900);
  background: color-mix(in srgb, var(--te-primary-500) 14%, var(--te-card-bg));
}
.style-tabs strong,
.style-tabs span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.style-tabs strong {
  font-size: 13px;
}
.style-tabs span {
  margin-top: 3px;
  font-size: 10px;
}
.live-preview {
  margin: 0 24px 16px;
  padding: 16px;
  overflow: hidden;
  border: 1px solid var(--te-card-border);
  border-radius: 16px;
  background:
    radial-gradient(
      circle at 80% 10%,
      color-mix(in srgb, var(--te-primary-500) 22%, transparent),
      transparent 34%
    ),
    linear-gradient(145deg, var(--te-playback-fluid-bg), var(--te-neutral-100));
}
.preview-label {
  color: color-mix(in srgb, var(--te-neutral-50) 46%, transparent);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.preview-lines {
  display: grid;
  gap: 7px;
  margin-top: 12px;
}
.preview-lines p {
  margin: 0;
  padding: 5px 9px;
  border-radius: 9px;
  transition: all 160ms ease;
}
.preview-lines .is-active {
  transform: scale(1.02);
}
.preview-lines .is-translation {
  margin-top: -4px;
}
.customizer-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 28px;
  scrollbar-width: thin;
}
.control-section {
  display: grid;
  gap: 14px;
  padding: 18px 0;
  border-top: 1px solid var(--te-card-border);
}
.control-section h3 {
  margin: 0;
  font-size: 14px;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.control-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px 18px;
}
.control-field,
.range-field,
.color-field,
.segment-field {
  display: grid;
  gap: 8px;
  min-width: 0;
  color: var(--te-neutral-500);
  font-size: 12px;
}
.control-field select,
.control-field input {
  width: 100%;
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid var(--te-card-border);
  border-radius: 10px;
  color: var(--te-neutral-900);
  background: var(--te-card-bg);
}
.range-field span,
.color-field span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.range-field strong {
  color: var(--te-neutral-900);
  font-variant-numeric: tabular-nums;
}
.range-field input[type='range'] {
  width: 100%;
  accent-color: var(--te-primary-500);
}
.segment-control {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 3px;
  border: 1px solid var(--te-card-border);
  border-radius: 11px;
  background: var(--te-card-bg);
}
.segment-control--four {
  grid-template-columns: repeat(4, 1fr);
}
.segment-control button,
.option-grid button {
  min-height: 34px;
  border: 0;
  border-radius: 8px;
  color: var(--te-neutral-500);
  background: transparent;
  cursor: pointer;
}
.segment-control button[aria-pressed='true'],
.option-grid button[aria-pressed='true'] {
  color: var(--te-playback-control-hover-text);
  background: var(--te-primary-500);
}
.option-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
}
.option-grid button {
  border: 1px solid var(--te-card-border);
  background: var(--te-card-bg);
}
.color-field {
  grid-template-columns: 1fr auto auto;
  align-items: center;
}
.color-field input {
  width: 42px;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--te-card-border);
  border-radius: 8px;
  background: transparent;
}
.color-field code {
  color: var(--te-neutral-500);
  font-size: 11px;
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 13px;
  border: 1px solid var(--te-card-border);
  border-radius: 12px;
  color: var(--te-neutral-900);
  text-align: left;
  background: var(--te-card-bg);
  cursor: pointer;
}
.switch-row span {
  display: grid;
  gap: 3px;
}
.switch-row small {
  color: var(--te-neutral-500);
}
.switch-row[aria-pressed='true'] i {
  color: var(--te-primary-400);
}
.lyrics-customizer-enter-active,
.lyrics-customizer-leave-active {
  transition:
    background 220ms ease,
    backdrop-filter 220ms ease;
}
.lyrics-customizer-enter-active .lyrics-customizer,
.lyrics-customizer-leave-active .lyrics-customizer {
  transition:
    transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 220ms ease;
}
.lyrics-customizer-enter-from,
.lyrics-customizer-leave-to {
  background: transparent;
  backdrop-filter: blur(0);
}
.lyrics-customizer-enter-from .lyrics-customizer,
.lyrics-customizer-leave-to .lyrics-customizer {
  transform: translateX(100%);
  opacity: 0.5;
}
@media (max-width: 620px) {
  .customizer-header {
    padding: 18px 16px 14px;
  }
  .customizer-status {
    padding-inline: 16px;
  }
  .style-tabs {
    padding: 12px 16px;
    gap: 5px;
  }
  .style-tabs button {
    padding-inline: 7px;
  }
  .live-preview {
    margin-inline: 16px;
  }
  .customizer-scroll {
    padding-inline: 16px;
  }
  .control-grid {
    grid-template-columns: 1fr;
  }
  .option-grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-height: 700px) {
  .customizer-header {
    padding-block: 14px 10px;
  }
  .customizer-header p {
    display: none;
  }
  .live-preview {
    padding-block: 11px;
    margin-bottom: 10px;
  }
  .style-tabs {
    padding-block: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lyrics-customizer-enter-active,
  .lyrics-customizer-leave-active,
  .lyrics-customizer-enter-active .lyrics-customizer,
  .lyrics-customizer-leave-active .lyrics-customizer,
  .preview-lines p {
    transition: none;
  }
}
</style>
