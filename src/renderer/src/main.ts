import './assets/main.css'
import '@phosphor-icons/web/regular'
import '@phosphor-icons/web/bold'
import '@phosphor-icons/web/fill'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { bootstrapThemeRuntime } from './stores/useThemeStore'

const query = new URLSearchParams(window.location.search)
const isMiniPlayer = query.get('window') === 'mini-player'
if (isMiniPlayer) {
  document.documentElement.classList.add('mini-player-document')
  document.body.classList.add('mini-player-document')
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.body.style.padding = '0'
}

async function mountApp(): Promise<void> {
  await bootstrapThemeRuntime()
  const rootComponent = isMiniPlayer
    ? (await import('./mini-player/MiniPlayerApp.vue')).default
    : (await import('./App.vue')).default
  createApp(rootComponent).use(createPinia()).mount('#app')
}

void mountApp()
