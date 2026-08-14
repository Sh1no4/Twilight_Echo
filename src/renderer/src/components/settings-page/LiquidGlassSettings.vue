<script setup lang="ts">
import { computed, ref } from 'vue'
import EditableRangeValue from '../EditableRangeValue.vue'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { LiquidGlassSettings, LiquidGlassTheme } from '../../types/settings'

const { settings, updateSettings } = useSettingsStore()

const liquidGlassOpen = ref(false)
const liquidGlassTab = ref<'light' | 'dark'>('light')
const liquidGlassScope = ref<'global' | 'home'>('global')

const hasSharedLiquidGlassProfile = computed(
  () =>
    settings.value.surfaceMaterial === 'liquidGlass' ||
    settings.value.liquidGlass.playbarEnabled ||
    settings.value.liquidGlass.settingsNavigationEnabled
)
const hasLiquidGlassEnabled = computed(
  () => hasSharedLiquidGlassProfile.value || settings.value.liquidGlass.homeCards.enabled
)
const activeLiquidGlassScope = computed<'global' | 'home'>(() => {
  if (liquidGlassScope.value === 'home' && settings.value.liquidGlass.homeCards.enabled) {
    return 'home'
  }
  return hasSharedLiquidGlassProfile.value ? 'global' : 'home'
})
const editingHomeCards = computed(() => activeLiquidGlassScope.value === 'home')
const activeLiquidGlassTheme = computed(() =>
  editingHomeCards.value
    ? settings.value.liquidGlass.homeCards[liquidGlassTab.value]
    : settings.value.liquidGlass[liquidGlassTab.value]
)
const activeOverLight = computed(() =>
  editingHomeCards.value
    ? settings.value.liquidGlass.homeCards.overLight
    : settings.value.liquidGlass.overLight
)

function cloneLiquidGlass(): LiquidGlassSettings {
  const lg = settings.value.liquidGlass
  return {
    followPointer: lg.followPointer,
    overLight: lg.overLight,
    light: { ...lg.light },
    dark: { ...lg.dark },
    playbarEnabled: lg.playbarEnabled,
    settingsNavigationEnabled: lg.settingsNavigationEnabled,
    homeCards: {
      enabled: lg.homeCards.enabled,
      overLight: lg.homeCards.overLight,
      light: { ...lg.homeCards.light },
      dark: { ...lg.homeCards.dark }
    }
  }
}

function toggleLiquidGlass(): void {
  const next = settings.value.surfaceMaterial === 'liquidGlass' ? 'standard' : 'liquidGlass'
  if (next === 'liquidGlass' || !settings.value.liquidGlass.homeCards.enabled) {
    liquidGlassScope.value = 'global'
  } else {
    liquidGlassScope.value = 'home'
  }
  void updateSettings({ surfaceMaterial: next })
}

function toggleHomeCardsLiquidGlass(): void {
  const liquidGlass = cloneLiquidGlass()
  liquidGlass.homeCards.enabled = !liquidGlass.homeCards.enabled
  if (liquidGlass.homeCards.enabled) liquidGlassScope.value = 'home'
  else if (settings.value.surfaceMaterial === 'liquidGlass') liquidGlassScope.value = 'global'
  void updateSettings({ liquidGlass })
}

function toggleSharedLiquidGlassTarget(
  target: 'playbarEnabled' | 'settingsNavigationEnabled'
): void {
  const liquidGlass = cloneLiquidGlass()
  liquidGlass[target] = !liquidGlass[target]
  if (liquidGlass[target]) liquidGlassScope.value = 'global'
  else if (
    settings.value.surfaceMaterial !== 'liquidGlass' &&
    !liquidGlass.playbarEnabled &&
    !liquidGlass.settingsNavigationEnabled &&
    liquidGlass.homeCards.enabled
  ) {
    liquidGlassScope.value = 'home'
  }
  void updateSettings({ liquidGlass })
}

function toggleLiquidGlassPointer(): void {
  const liquidGlass = cloneLiquidGlass()
  liquidGlass.followPointer = !liquidGlass.followPointer
  void updateSettings({ liquidGlass })
}

function setLiquidGlassField<K extends keyof LiquidGlassTheme>(
  field: K,
  value: LiquidGlassTheme[K]
): void {
  const liquidGlass = cloneLiquidGlass()
  if (editingHomeCards.value) {
    liquidGlass.homeCards[liquidGlassTab.value][field] = value
  } else {
    liquidGlass[liquidGlassTab.value][field] = value
  }
  void updateSettings({ liquidGlass })
}

function toggleActiveOverLight(): void {
  const liquidGlass = cloneLiquidGlass()
  if (editingHomeCards.value) {
    liquidGlass.homeCards.overLight = !liquidGlass.homeCards.overLight
  } else {
    liquidGlass.overLight = !liquidGlass.overLight
  }
  void updateSettings({ liquidGlass })
}
</script>

<template>
  <button
    type="button"
    class="settings-accordion-trigger"
    :class="{ open: liquidGlassOpen }"
    :aria-expanded="liquidGlassOpen"
    @click="liquidGlassOpen = !liquidGlassOpen"
  >
    <span class="setting-copy">
      <strong>液态玻璃材质</strong>
      <span>为卡片与播放栏启用折射玻璃质感，可与现有材质随时切换。</span>
    </span>
    <i class="pi pi-chevron-down"></i>
  </button>
  <div v-if="liquidGlassOpen" class="settings-accordion-body">
    <hr />
    <div class="setting-item">
      <div class="setting-copy">
        <strong>全局液态玻璃</strong>
        <span
          >统一为页面卡片、播放栏与设置导航启用折射玻璃材质。大型媒体库滚动时会有额外 GPU
          开销。</span
        >
      </div>
      <span
        class="toggle-switch"
        :class="{ active: settings.surfaceMaterial === 'liquidGlass' }"
        role="switch"
        :aria-checked="settings.surfaceMaterial === 'liquidGlass'"
        @click="toggleLiquidGlass"
      ></span>
    </div>
    <hr />
    <div class="setting-item">
      <div class="setting-copy">
        <strong>播放栏液态玻璃</strong>
        <span>独立为底部播放栏启用液态玻璃，复用全局的外观参数。</span>
      </div>
      <span
        class="toggle-switch"
        :class="{ active: settings.liquidGlass.playbarEnabled }"
        role="switch"
        :aria-checked="settings.liquidGlass.playbarEnabled"
        @click="toggleSharedLiquidGlassTarget('playbarEnabled')"
      ></span>
    </div>
    <hr />
    <div class="setting-item">
      <div class="setting-copy">
        <strong>设置导航液态玻璃</strong>
        <span>独立为设置页左侧导航启用液态玻璃，并保持文字和选中状态清晰。</span>
      </div>
      <span
        class="toggle-switch"
        :class="{ active: settings.liquidGlass.settingsNavigationEnabled }"
        role="switch"
        :aria-checked="settings.liquidGlass.settingsNavigationEnabled"
        @click="toggleSharedLiquidGlassTarget('settingsNavigationEnabled')"
      ></span>
    </div>
    <hr />
    <div class="setting-item">
      <div class="setting-copy">
        <strong>首页卡片液态玻璃</strong>
        <span>仅为本地首页的主卡片、信号、图表与日历使用独立的液态玻璃参数。</span>
      </div>
      <span
        class="toggle-switch"
        :class="{ active: settings.liquidGlass.homeCards.enabled }"
        role="switch"
        :aria-checked="settings.liquidGlass.homeCards.enabled"
        @click="toggleHomeCardsLiquidGlass"
      ></span>
    </div>
    <div v-if="hasLiquidGlassEnabled">
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>高光跟随指针</strong>
          <span>镜面高光角度随鼠标移动变化；全局与首页卡片共用此交互设置。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{ active: settings.liquidGlass.followPointer }"
          role="switch"
          :aria-checked="settings.liquidGlass.followPointer"
          @click="toggleLiquidGlassPointer"
        ></span>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>编辑范围</strong>
          <span>首页卡片可独立保存一套玻璃参数，不影响其他页面。</span>
        </div>
        <div class="theme-segment">
          <button
            v-if="hasSharedLiquidGlassProfile"
            type="button"
            :class="{ active: activeLiquidGlassScope === 'global' }"
            @click="liquidGlassScope = 'global'"
          >
            全局
          </button>
          <button
            v-if="settings.liquidGlass.homeCards.enabled"
            type="button"
            :class="{ active: activeLiquidGlassScope === 'home' }"
            @click="liquidGlassScope = 'home'"
          >
            首页
          </button>
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>亮色背景加深</strong>
          <span>浅色背景下使用深色玻璃，让当前编辑范围在亮背景上更清晰。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{ active: activeOverLight }"
          role="switch"
          :aria-checked="activeOverLight"
          @click="toggleActiveOverLight"
        ></span>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>编辑主题</strong>
          <span>分别设置浅色与深色模式下的玻璃参数。</span>
        </div>
        <div class="theme-segment">
          <button
            type="button"
            :class="{ active: liquidGlassTab === 'light' }"
            @click="liquidGlassTab = 'light'"
          >
            <i class="pi pi-sun"></i>
            浅色
          </button>
          <button
            type="button"
            :class="{ active: liquidGlassTab === 'dark' }"
            @click="liquidGlassTab = 'dark'"
          >
            <i class="pi pi-moon"></i>
            深色
          </button>
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>折射强度</strong>
          <span>边缘弯曲背景的位移量，越高玻璃感越强。</span>
        </div>
        <div class="range-pill">
          <span>折射</span>
          <input
            class="range-input"
            type="range"
            min="0"
            max="140"
            :value="activeLiquidGlassTheme.displacementScale"
            @input="
              setLiquidGlassField(
                'displacementScale',
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
          <EditableRangeValue
            :value="activeLiquidGlassTheme.displacementScale"
            :min="0"
            :max="140"
            aria-label="编辑折射强度"
            @change="setLiquidGlassField('displacementScale', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>色散强度</strong>
          <span>边缘彩色分离的程度，模拟玻璃的色散。</span>
        </div>
        <div class="range-pill">
          <span>色散</span>
          <input
            class="range-input"
            type="range"
            min="0"
            max="8"
            step="0.5"
            :value="activeLiquidGlassTheme.aberrationIntensity"
            @input="
              setLiquidGlassField(
                'aberrationIntensity',
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
          <EditableRangeValue
            :value="activeLiquidGlassTheme.aberrationIntensity"
            :min="0"
            :max="8"
            aria-label="编辑色散强度"
            @change="setLiquidGlassField('aberrationIntensity', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>玻璃模糊</strong>
          <span>玻璃后方背景的模糊半径。</span>
        </div>
        <div class="range-pill">
          <span>模糊</span>
          <input
            class="range-input"
            type="range"
            min="0"
            max="40"
            :value="activeLiquidGlassTheme.blurAmount"
            @input="
              setLiquidGlassField('blurAmount', Number(($event.target as HTMLInputElement).value))
            "
          />
          <EditableRangeValue
            :value="activeLiquidGlassTheme.blurAmount"
            :min="0"
            :max="40"
            suffix="px"
            aria-label="编辑玻璃模糊"
            @change="setLiquidGlassField('blurAmount', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>玻璃饱和度</strong>
          <span>透过玻璃的色彩饱和感。</span>
        </div>
        <div class="range-pill">
          <span>饱和度</span>
          <input
            class="range-input"
            type="range"
            min="80"
            max="200"
            :value="activeLiquidGlassTheme.saturation"
            @input="
              setLiquidGlassField('saturation', Number(($event.target as HTMLInputElement).value))
            "
          />
          <EditableRangeValue
            :value="activeLiquidGlassTheme.saturation"
            :min="80"
            :max="200"
            suffix="%"
            aria-label="编辑玻璃饱和度"
            @change="setLiquidGlassField('saturation', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>弹性跟随</strong>
          <span>玻璃向光标方向伸展的程度，0 表示固定不跟随。</span>
        </div>
        <div class="range-pill">
          <span>弹性</span>
          <input
            class="range-input"
            type="range"
            min="0"
            max="100"
            :value="activeLiquidGlassTheme.elasticity"
            @input="
              setLiquidGlassField('elasticity', Number(($event.target as HTMLInputElement).value))
            "
          />
          <EditableRangeValue
            :value="activeLiquidGlassTheme.elasticity"
            :min="0"
            :max="100"
            suffix="%"
            aria-label="编辑弹性跟随"
            @change="setLiquidGlassField('elasticity', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>镜面高光</strong>
          <span>描边与高光的亮度。</span>
        </div>
        <div class="range-pill">
          <span>高光</span>
          <input
            class="range-input"
            type="range"
            min="0"
            max="100"
            :value="activeLiquidGlassTheme.specularOpacity"
            @input="
              setLiquidGlassField(
                'specularOpacity',
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
          <EditableRangeValue
            :value="activeLiquidGlassTheme.specularOpacity"
            :min="0"
            :max="100"
            suffix="%"
            aria-label="编辑镜面高光"
            @change="setLiquidGlassField('specularOpacity', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>表面着色</strong>
          <span>玻璃自身的底色浓度，越低越通透。</span>
        </div>
        <div class="range-pill">
          <span>着色</span>
          <input
            class="range-input"
            type="range"
            min="0"
            max="100"
            :value="activeLiquidGlassTheme.tintOpacity"
            @input="
              setLiquidGlassField('tintOpacity', Number(($event.target as HTMLInputElement).value))
            "
          />
          <EditableRangeValue
            :value="activeLiquidGlassTheme.tintOpacity"
            :min="0"
            :max="100"
            suffix="%"
            aria-label="编辑表面着色"
            @change="setLiquidGlassField('tintOpacity', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
