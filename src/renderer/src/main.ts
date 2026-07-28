import './assets/main.css'
import '@phosphor-icons/web/regular'
import '@phosphor-icons/web/bold'
import '@phosphor-icons/web/fill'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { bootstrapThemeRuntime } from './stores/useThemeStore'

const query = new URLSearchParams(window.location.search)
const windowKind = query.get('window')
const isMiniPlayer = windowKind === 'mini-player'
const isTrayPlayer = windowKind === 'tray-player'
if (isMiniPlayer || isTrayPlayer) {
  const documentClass = isMiniPlayer ? 'mini-player-document' : 'tray-player-document'
  document.documentElement.classList.add(documentClass)
  document.body.classList.add(documentClass)
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.body.style.padding = '0'
}

async function mountApp(): Promise<void> {
  if (!isTrayPlayer) await bootstrapThemeRuntime()
  const rootComponent = isMiniPlayer
    ? (await import('./mini-player/MiniPlayerApp.vue')).default
    : isTrayPlayer
      ? (await import('./tray-player/TrayPlayerApp.vue')).default
      : (await import('./App.vue')).default
  createApp(rootComponent).use(createPinia()).mount('#app')
}

void mountApp()
