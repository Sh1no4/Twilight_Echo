import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sideMenu = readFileSync(new URL('./SideMenu.vue', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const playerBarCss = readFileSync(new URL('./player-bar/PlayerBar.css', import.meta.url), 'utf8')

test('local sidebar opening follows the streaming navigation timing', () => {
  assert.match(sideMenu, /transform 0\.32s var\(--te-ease-soft\),\s*box-shadow 0\.32s;/)
  assert.doesNotMatch(sideMenu, /side-menu-item-in/)
  assert.match(app, /transition: padding-left 0\.32s var\(--te-ease-soft\);/)
  assert.match(
    app,
    /transform 0\.48s cubic-bezier\(0\.16, 1, 0\.3, 1\),\s*filter 0\.42s cubic-bezier\(0\.16, 1, 0\.3, 1\)/
  )
  assert.match(app, /translate3d\(0, 40px, 0\) scale\(0\.99\)/)
  assert.match(
    app,
    /transform 0\.3s cubic-bezier\(0\.4, 0, 0\.2, 1\),\s*filter 0\.28s cubic-bezier\(0\.4, 0, 0\.2, 1\)/
  )
  assert.match(app, /translate3d\(0, -40px, 0\) scale\(0\.99\)/)
  assert.match(playerBarCss, /transition:\s*left 0\.32s var\(--te-ease-soft\),\s*opacity 0\.2s ease,\s*translate 0\.24s var\(--te-ease-spring, ease-out\);/)
})
