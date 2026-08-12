<script setup lang="ts">
import EditableRangeValue from '../EditableRangeValue.vue'
import type { DesktopLyricsLayout, DesktopLyricsSettings, LyricAlign } from '../../types/settings'

const props = defineProps<{
  desktopLyrics: DesktopLyricsSettings
}>()

const emit = defineEmits<{
  toggle: []
  update: [patch: Partial<DesktopLyricsSettings>]
}>()

function update<K extends keyof DesktopLyricsSettings>(
  key: K,
  value: DesktopLyricsSettings[K]
): void {
  emit('update', { [key]: value } as Partial<DesktopLyricsSettings>)
}
</script>

<template>
  <section id="desktopLyrics" class="glass-card preview-section">
    <div class="section-title-row">
      <i class="pi pi-window-maximize"></i>
      <h2>桌面歌词 (Desktop Lyrics)</h2>
    </div>

    <div class="setting-list">
      <div class="setting-item">
        <div class="setting-copy">
          <strong>启用桌面歌词</strong>
          <span>在独立窗口中显示桌面歌词，可拖拽移动位置。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{
            active: props.desktopLyrics.enabled,
            inactive: !props.desktopLyrics.enabled
          }"
          role="switch"
          :aria-checked="props.desktopLyrics.enabled"
          @click="$emit('toggle')"
        ></span>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>字体大小 (Font Size)</strong>
          <span>调整桌面歌词的字号大小。</span>
        </div>
        <div class="inline-controls">
          <input
            type="range"
            class="range-input"
            min="12"
            max="80"
            :value="props.desktopLyrics.fontSize"
            @input="update('fontSize', Number(($event.target as HTMLInputElement).value))"
          />
          <EditableRangeValue
            :value="props.desktopLyrics.fontSize"
            :min="12"
            :max="80"
            suffix="px"
            aria-label="编辑桌面歌词字号"
            @change="update('fontSize', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>字体粗细 (Font Weight)</strong>
          <span>调整歌词文本的粗细程度。</span>
        </div>
        <select
          class="preview-select wide"
          :value="props.desktopLyrics.fontWeight"
          @change="update('fontWeight', Number(($event.target as HTMLSelectElement).value))"
        >
          <option :value="300">细体 (300)</option>
          <option :value="400">常规 (400)</option>
          <option :value="500">中等 (500)</option>
          <option :value="600">半粗 (600)</option>
          <option :value="700">粗体 (700)</option>
          <option :value="800">特粗 (800)</option>
          <option :value="900">黑体 (900)</option>
        </select>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>行间距 (Line Spacing)</strong>
          <span>调整多行歌词之间的间距。</span>
        </div>
        <div class="inline-controls">
          <input
            type="range"
            class="range-input"
            min="1"
            max="3"
            step="0.1"
            :value="props.desktopLyrics.lineSpacing"
            @input="update('lineSpacing', Number(($event.target as HTMLInputElement).value))"
          />
          <EditableRangeValue
            :value="props.desktopLyrics.lineSpacing"
            :min="1"
            :max="3"
            :step="0.1"
            aria-label="编辑桌面歌词行间距"
            @change="update('lineSpacing', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>最大显示行数 (Max Lines)</strong>
          <span>限制桌面歌词最多显示的行数。</span>
        </div>
        <div class="inline-controls">
          <input
            type="range"
            class="range-input"
            min="1"
            max="5"
            :value="props.desktopLyrics.maxLines"
            @input="update('maxLines', Number(($event.target as HTMLInputElement).value))"
          />
          <EditableRangeValue
            :value="props.desktopLyrics.maxLines"
            :min="1"
            :max="5"
            suffix="行"
            aria-label="编辑桌面歌词最大显示行数"
            @change="update('maxLines', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>行水平偏移 (Line Offset)</strong>
          <span>多行时交错左右位置：正值=第1行偏左、第2行偏右；0 为对齐。</span>
        </div>
        <div class="inline-controls">
          <input
            type="range"
            class="range-input"
            min="-200"
            max="200"
            step="1"
            :value="props.desktopLyrics.lineOffset ?? 0"
            @input="update('lineOffset', Number(($event.target as HTMLInputElement).value))"
          />
          <EditableRangeValue
            :value="props.desktopLyrics.lineOffset ?? 0"
            :min="-200"
            :max="200"
            suffix="px"
            aria-label="编辑桌面歌词行水平偏移"
            @change="update('lineOffset', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>默认文字颜色 (Text Color)</strong>
          <span>未播放到该句时的歌词颜色。</span>
        </div>
        <input
          type="color"
          :value="props.desktopLyrics.color"
          @input="update('color', ($event.target as HTMLInputElement).value)"
          class="color-picker"
        />
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>高亮文字颜色 (Highlight Color)</strong>
          <span>当前正在播放的歌词颜色。</span>
        </div>
        <input
          type="color"
          :value="props.desktopLyrics.highlightColor"
          @input="update('highlightColor', ($event.target as HTMLInputElement).value)"
          class="color-picker"
        />
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>背景颜色 (Background Color)</strong>
          <span>桌面歌词窗口的背景色。</span>
        </div>
        <input
          type="color"
          :value="props.desktopLyrics.bgColor"
          @input="update('bgColor', ($event.target as HTMLInputElement).value)"
          class="color-picker"
        />
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>背景透明度 (Background Opacity)</strong>
          <span>调整背景颜色的透明程度。</span>
        </div>
        <div class="inline-controls">
          <input
            type="range"
            class="range-input"
            min="0"
            max="100"
            :value="props.desktopLyrics.bgOpacity"
            @input="update('bgOpacity', Number(($event.target as HTMLInputElement).value))"
          />
          <EditableRangeValue
            :value="props.desktopLyrics.bgOpacity"
            :min="0"
            :max="100"
            suffix="%"
            aria-label="编辑桌面歌词背景透明度"
            @change="update('bgOpacity', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>文字阴影 (Text Shadow)</strong>
          <span>为歌词文字添加阴影以提高辨识度。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{
            active: props.desktopLyrics.shadow,
            inactive: !props.desktopLyrics.shadow
          }"
          role="switch"
          :aria-checked="props.desktopLyrics.shadow"
          @click="update('shadow', !props.desktopLyrics.shadow)"
        ></span>
      </div>
      <hr v-if="props.desktopLyrics.shadow" />
      <div class="setting-item" v-if="props.desktopLyrics.shadow">
        <div class="setting-copy">
          <strong>阴影模糊度 (Shadow Blur)</strong>
          <span>文字阴影的扩散程度。</span>
        </div>
        <div class="inline-controls">
          <input
            type="range"
            class="range-input"
            min="0"
            max="30"
            :value="props.desktopLyrics.shadowBlur"
            @input="update('shadowBlur', Number(($event.target as HTMLInputElement).value))"
          />
          <EditableRangeValue
            :value="props.desktopLyrics.shadowBlur"
            :min="0"
            :max="30"
            suffix="px"
            aria-label="编辑桌面歌词阴影模糊度"
            @change="update('shadowBlur', $event)"
          />
        </div>
      </div>
      <hr v-if="props.desktopLyrics.shadow" />
      <div class="setting-item" v-if="props.desktopLyrics.shadow">
        <div class="setting-copy">
          <strong>阴影颜色 (Shadow Color)</strong>
          <span>文字阴影的颜色。</span>
        </div>
        <input
          type="color"
          :value="props.desktopLyrics.shadowColor"
          @input="update('shadowColor', ($event.target as HTMLInputElement).value)"
          class="color-picker"
        />
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>对齐方式 (Alignment)</strong>
          <span>歌词文本的水平对齐方式。</span>
        </div>
        <select
          class="preview-select wide"
          :value="props.desktopLyrics.align"
          @change="update('align', ($event.target as HTMLSelectElement).value as LyricAlign)"
        >
          <option value="center">居中对齐 (Center)</option>
          <option value="left">靠左对齐 (Left)</option>
        </select>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>窗口宽度 (Window Width)</strong>
          <span>调整桌面歌词窗口的宽度。</span>
        </div>
        <div class="inline-controls">
          <input
            type="range"
            class="range-input"
            min="200"
            max="3000"
            step="10"
            :value="props.desktopLyrics.windowWidth"
            @input="update('windowWidth', Number(($event.target as HTMLInputElement).value))"
          />
          <EditableRangeValue
            :value="props.desktopLyrics.windowWidth"
            :min="200"
            :max="3000"
            :step="10"
            suffix="px"
            aria-label="编辑桌面歌词窗口宽度"
            @change="update('windowWidth', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>窗口高度 (Window Height)</strong>
          <span>调整桌面歌词窗口的高度。</span>
        </div>
        <div class="inline-controls">
          <input
            type="range"
            class="range-input"
            min="60"
            max="800"
            step="10"
            :value="props.desktopLyrics.windowHeight"
            @input="update('windowHeight', Number(($event.target as HTMLInputElement).value))"
          />
          <EditableRangeValue
            :value="props.desktopLyrics.windowHeight"
            :min="60"
            :max="800"
            :step="10"
            suffix="px"
            aria-label="编辑桌面歌词窗口高度"
            @change="update('windowHeight', $event)"
          />
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>始终置顶 (Always on Top)</strong>
          <span>桌面歌词窗口始终显示在其他窗口之前。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{
            active: props.desktopLyrics.alwaysOnTop,
            inactive: !props.desktopLyrics.alwaysOnTop
          }"
          role="switch"
          :aria-checked="props.desktopLyrics.alwaysOnTop"
          @click="update('alwaysOnTop', !props.desktopLyrics.alwaysOnTop)"
        ></span>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>鼠标穿透 (Click Through)</strong>
          <span
            >开启后鼠标点击会穿透歌词窗口。穿透时窗口内难以操作，请在本页关闭穿透，或关闭桌面歌词。</span
          >
        </div>
        <span
          class="toggle-switch"
          :class="{
            active: props.desktopLyrics.clickThrough,
            inactive: !props.desktopLyrics.clickThrough
          }"
          role="switch"
          :aria-checked="props.desktopLyrics.clickThrough"
          @click="update('clickThrough', !props.desktopLyrics.clickThrough)"
        ></span>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>布局模式 (Layout)</strong>
          <span>多行：连续多句歌词；双语：第一行原文、第二行翻译（当前句）。</span>
        </div>
        <select
          class="preview-select wide"
          :value="props.desktopLyrics.layout ?? 'bilingual'"
          @change="
            update('layout', ($event.target as HTMLSelectElement).value as DesktopLyricsLayout)
          "
        >
          <option value="multi">多行歌词 (Multi)</option>
          <option value="bilingual">双语分行 (Original + Translation)</option>
        </select>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>显示翻译 (Show Translation)</strong>
          <span>多行模式下在原文下附带翻译；双语模式下控制是否显示第二行翻译。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{
            active: props.desktopLyrics.showTranslation,
            inactive: !props.desktopLyrics.showTranslation
          }"
          role="switch"
          :aria-checked="props.desktopLyrics.showTranslation"
          @click="update('showTranslation', !props.desktopLyrics.showTranslation)"
        ></span>
      </div>
    </div>
  </section>
</template>
