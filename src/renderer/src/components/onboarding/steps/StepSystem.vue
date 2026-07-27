<script setup lang="ts">
import type { PlaybackResumeMode } from '@renderer/types/settings'

const props = defineProps<{
  closeToTray: boolean
  launchAtLogin: boolean
  resumeMode: PlaybackResumeMode
  globalShortcuts: boolean
  smtcEnabled: boolean
  discordRpcEnabled: boolean
}>()
const emit = defineEmits<{
  'update:closeToTray': [value: boolean]
  'update:launchAtLogin': [value: boolean]
  'update:resumeMode': [value: PlaybackResumeMode]
  'update:globalShortcuts': [value: boolean]
  'update:smtcEnabled': [value: boolean]
  'update:discordRpcEnabled': [value: boolean]
}>()
</script>

<template>
  <section class="onb-stage" data-scene="06">
    <p class="onb-kicker">系统集成</p>
    <h1 class="onb-title">让它<em>融入你的桌面</em></h1>
    <p class="onb-subtitle">
      这些开关决定 Twilight Echo 与系统相处的方式——托盘、开机自启、快捷键与媒体控制。
    </p>
    <div class="onb-panel">
      <div class="onb-toggle-row">
        <div class="onb-toggle-copy">
          <strong>关闭窗口时最小化到托盘</strong>
          <span>音乐继续播放，从系统托盘随时唤回窗口。</span>
        </div>
        <button
          type="button"
          class="onb-toggle"
          :class="{ 'is-on': props.closeToTray }"
          role="switch"
          :aria-checked="props.closeToTray"
          aria-label="关闭窗口时最小化到托盘"
          @click="emit('update:closeToTray', !props.closeToTray)"
        ></button>
      </div>
      <div class="onb-toggle-row">
        <div class="onb-toggle-copy">
          <strong>开机自动启动</strong>
          <span>登录系统后在后台静候，随时开始播放。</span>
        </div>
        <button
          type="button"
          class="onb-toggle"
          :class="{ 'is-on': props.launchAtLogin }"
          role="switch"
          :aria-checked="props.launchAtLogin"
          aria-label="开机自动启动"
          @click="emit('update:launchAtLogin', !props.launchAtLogin)"
        ></button>
      </div>
      <div class="onb-toggle-row">
        <div class="onb-toggle-copy">
          <strong>记住播放进度</strong>
          <span>下次启动时从上次停下的那首歌、那一秒继续。</span>
        </div>
        <button
          type="button"
          class="onb-toggle"
          :class="{ 'is-on': props.resumeMode === 'trackAndPosition' }"
          role="switch"
          :aria-checked="props.resumeMode === 'trackAndPosition'"
          aria-label="记住播放进度"
          @click="
            emit(
              'update:resumeMode',
              props.resumeMode === 'trackAndPosition' ? 'off' : 'trackAndPosition'
            )
          "
        ></button>
      </div>
    </div>
    <div class="onb-panel">
      <div class="onb-toggle-row">
        <div class="onb-toggle-copy">
          <strong>全局快捷键</strong>
          <span>在任何应用里用媒体键切歌、暂停，无需切回窗口。</span>
        </div>
        <button
          type="button"
          class="onb-toggle"
          :class="{ 'is-on': props.globalShortcuts }"
          role="switch"
          :aria-checked="props.globalShortcuts"
          aria-label="全局快捷键"
          @click="emit('update:globalShortcuts', !props.globalShortcuts)"
        ></button>
      </div>
      <div class="onb-toggle-row">
        <div class="onb-toggle-copy">
          <strong>系统媒体控制（SMTC）</strong>
          <span>在系统音量条与锁屏界面显示正在播放的歌曲。</span>
        </div>
        <button
          type="button"
          class="onb-toggle"
          :class="{ 'is-on': props.smtcEnabled }"
          role="switch"
          :aria-checked="props.smtcEnabled"
          aria-label="系统媒体控制"
          @click="emit('update:smtcEnabled', !props.smtcEnabled)"
        ></button>
      </div>
      <div class="onb-toggle-row">
        <div class="onb-toggle-copy">
          <strong>Discord 状态展示</strong>
          <span>把正在听的歌曲展示在你的 Discord 个人状态上。</span>
        </div>
        <button
          type="button"
          class="onb-toggle"
          :class="{ 'is-on': props.discordRpcEnabled }"
          role="switch"
          :aria-checked="props.discordRpcEnabled"
          aria-label="Discord 状态展示"
          @click="emit('update:discordRpcEnabled', !props.discordRpcEnabled)"
        ></button>
      </div>
    </div>
  </section>
</template>
