import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { compileStyle } from '@vue/compiler-sfc'

const scopedStyleFiles = [
  './DspRackPage.vue',
  './EqualizerPage.vue',
  './LocalDashboard.css',
  './player-bar/PlayerBar.css',
  './PlayingMusic.vue',
  './SideMenu.vue',
  './StreamingLibrary.vue',
  './StreamingSearch.vue',
  './TitleBar.vue',
  './streaming-page/StreamingPage.css'
]

test('scoped component styles keep descendants inside global theme selectors', () => {
  for (const relativePath of scopedStyleFiles) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    assert.doesNotMatch(
      source,
      /:global\([^\r\n)]+\)\s+[^,{\r\n]+[,{]/,
      `${relativePath} contains a global ancestor whose scoped descendant will be dropped by Vue`
    )
  }
})

test('compiled dashboard dark styles never dim or filter the document root', () => {
  const source = readFileSync(new URL('./LocalDashboard.css', import.meta.url), 'utf8')
  const result = compileStyle({
    source,
    filename: 'LocalDashboard.css',
    id: 'data-v-mini-player-dark-mode-regression',
    scoped: true
  })

  assert.deepEqual(result.errors, [])
  assert.doesNotMatch(
    result.code,
    /html\[data-theme=['"]dark['"]\]\s*\{[^}]*(?:filter|opacity)\s*:/
  )
  assert.match(
    result.code,
    /html\[data-theme=['"]dark['"]\]\s+\.home\s+\.feature-backdrop\s+img\s*\{/
  )
})
