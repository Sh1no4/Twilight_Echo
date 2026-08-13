<script setup lang="ts">
import { ref } from 'vue'
import EditableRangeValue from '../EditableRangeValue.vue'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { LiquidGlassSettings, LiquidGlassTheme } from '../../types/settings'

const { settings, updateSettings } = useSettingsStore()

const liquidGlassOpen = ref(false)
const liquidGlassTab = ref<'light' | 'dark'>('light')

function cloneLiquidGlass(): LiquidGlassSettings {
  const lg = settings.value.liquidGlass
  return {
    followPointer: lg.followPointer,
    overLight: lg.overLight,
    fullGlass: lg.fullGlass,
    light: { ...lg.light },
    dark: { ...lg.dark }
  }
}

function toggleLiquidGlass(): void {
  void updateSettings({
    surfaceMaterial: settings.value.surfaceMaterial === 'liquidGlass' ? 'standard' : 'liquidGlass'
  })
}

function toggleLiquidGlassPointer(): void {
  const liquidGlass = cloneLiquidGlass()
  liquidGlass.followPointer = !liquidGlass.followPointer
  void updateSettings({ liquidGlass })
}

function toggleLiquidGlassFull(): void {
  const liquidGlass = cloneLiquidGlass()
  liquidGlass.fullGlass = !liquidGlass.fullGlass
  void updateSettings({ liquidGlass })
}

function setLiquidGlassField<K extends keyof LiquidGlassTheme>(
  field: K,
  value: LiquidGlassTheme[K]
): void {
  const liquidGlass = cloneLiquidGlass()
  liquidGlass[liquidGlassTab.value][field] = value
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
        <strong>启用液态玻璃</strong>
        <span> 开启后卡片与播放栏改用折射玻璃材质。大型媒体库滚动时会有额外 GPU 开销。 </span>
      </div>
      <span
        class="toggle-switch"
        :class="{ active: settings.surfaceMaterial === 'liquidGlass' }"
        role="switch"
        :aria-checked="settings.surfaceMaterial === 'liquidGlass'"
        @click="toggleLiquidGlass"
      ></span>
    </div>
    <div v-if="settings.surfaceMaterial === 'liquidGlass'">
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>高光跟随指针</strong>
          <span>镜面高光角度随鼠标移动变化；关闭后使用固定光源。</span>
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
          <strong>完整液态玻璃</strong>
          <span>始终启用背景模糊与边缘折射；关闭后仅悬停时启动，可降低滚动功耗。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{ active: settings.liquidGlass.fullGlass }"
          role="switch"
          :aria-checked="settings.liquidGlass.fullGlass"
          @click="toggleLiquidGlassFull"
        ></span>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>亮色背景加深</strong>
          <span>浅色背景下使用深色玻璃，让玻璃在亮背景上更清晰。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{ active: settings.liquidGlass.overLight }"
          role="switch"
          :aria-checked="settings.liquidGlass.overLight"
          @click="
            updateSettings({
              liquidGlass: {
                ...cloneLiquidGlass(),
                overLight: !settings.liquidGlass.overLight
              }
            })
          "
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
            :value="settings.liquidGlass[liquidGlassTab].displacementScale"
            @input="
              setLiquidGlassField(
                'displacementScale',
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
          <EditableRangeValue
            :value="settings.liquidGlass[liquidGlassTab].displacementScale"
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
            :value="settings.liquidGlass[liquidGlassTab].aberrationIntensity"
            @input="
              setLiquidGlassField(
                'aberrationIntensity',
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
          <EditableRangeValue
            :value="settings.liquidGlass[liquidGlassTab].aberrationIntensity"
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
            :value="settings.liquidGlass[liquidGlassTab].blurAmount"
            @input="
              setLiquidGlassField('blurAmount', Number(($event.target as HTMLInputElement).value))
            "
          />
          <EditableRangeValue
            :value="settings.liquidGlass[liquidGlassTab].blurAmount"
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
            :value="settings.liquidGlass[liquidGlassTab].saturation"
            @input="
              setLiquidGlassField('saturation', Number(($event.target as HTMLInputElement).value))
            "
          />
          <EditableRangeValue
            :value="settings.liquidGlass[liquidGlassTab].saturation"
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
            :value="settings.liquidGlass[liquidGlassTab].elasticity"
            @input="
              setLiquidGlassField('elasticity', Number(($event.target as HTMLInputElement).value))
            "
          />
          <EditableRangeValue
            :value="settings.liquidGlass[liquidGlassTab].elasticity"
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
            :value="settings.liquidGlass[liquidGlassTab].specularOpacity"
            @input="
              setLiquidGlassField(
                'specularOpacity',
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
          <EditableRangeValue
            :value="settings.liquidGlass[liquidGlassTab].specularOpacity"
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
            :value="settings.liquidGlass[liquidGlassTab].tintOpacity"
            @input="
              setLiquidGlassField('tintOpacity', Number(($event.target as HTMLInputElement).value))
            "
          />
          <EditableRangeValue
            :value="settings.liquidGlass[liquidGlassTab].tintOpacity"
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
