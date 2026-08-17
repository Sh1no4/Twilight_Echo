import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/**
 * 跨主题骨架契约（阶段 D）。
 *
 * 六个内置预设的 layout 样式都必须满足：导航条目同时携带图标与标签（不可 display:none），
 * hover / active 语义存在，播放栏保持三列 grid。主题允许改变圆角/材质/色彩/字体，
 * 但不得移除骨架。详见 docs/theme-skeleton-contract.md。
 */
const layoutFiles = [
  'aurora-reference.css',
  'obsidian-glass.css',
  'paper-light.css',
  'neon-gradient.css',
  'studio-split.css',
  'zen-minimal.css'
] as const

const layoutDir = fileURLToPath(new URL('../assets/theme-layouts/', import.meta.url))

const layoutSources = Object.fromEntries(
  layoutFiles.map((file) => [file, readFileSync(`${layoutDir}${file}`, 'utf8')])
)

test('every preset stylesheet declares hover and active semantics for navigation items', () => {
  for (const file of layoutFiles) {
    const css = layoutSources[file]
    assert.match(
      css,
      /\.menu-item(?::not\([^)]*\))?\.active|\.[a-z-]+\.active\b[^{]*\{/,
      `${file} must keep an active state`
    )
    assert.match(css, /\.menu-item[^{]*:hover\b[^{]*\{/, `${file} must keep a hover state`)
  }
})

test('nav entries keep both icon and label visible in every preset', () => {
  for (const file of layoutFiles) {
    const css = layoutSources[file]
    const iconHidden = new RegExp(
      String.raw`\.menu-item\b[^{]*\.item-icon\b[^{]*\{[^}]*display:\s*none`,
      'm'
    )
    const labelHidden = new RegExp(
      String.raw`\.menu-item\b[^{]*\.item-label\b[^{]*\{[^}]*display:\s*none`,
      'm'
    )
    assert.doesNotMatch(css, iconHidden, `${file} must not hide navigation icons`)
    assert.doesNotMatch(css, labelHidden, `${file} must not hide navigation labels`)
  }
})

test('every preset keeps a three-column player-bar grid', () => {
  for (const file of layoutFiles) {
    const css = layoutSources[file]
    assert.match(
      css,
      /\.player-bar\b[^{]*\{[^}]*grid-template-columns:\s*[^;]+;/,
      `${file} must keep the player-bar grid`
    )
    const grid = css.match(/\.player-bar\b[^{]*\{[^}]*grid-template-columns:\s*([^;]+);/)?.[1]
    assert.ok(grid, `${file} player-bar grid-template-columns is missing`)
    assert.ok(
      grid.split(' ').filter((part) => part.trim()).length >= 3,
      `${file} player-bar must have three columns, got: ${grid}`
    )
  }
})