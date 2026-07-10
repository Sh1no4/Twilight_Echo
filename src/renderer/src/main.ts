import './assets/main.css'
import '@phosphor-icons/web/regular'

import { createApp } from 'vue'

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
  const rootComponent = isMiniPlayer
    ? (await import('./mini-player/MiniPlayerApp.vue')).default
    : (await import('./App.vue')).default
  createApp(rootComponent).mount('#app')
}

void mountApp()
