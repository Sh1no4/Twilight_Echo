import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

function vueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

test('all native select controls inherit an explicit dark popup and field palette', () => {
  const root = resolve(import.meta.dirname)
  const consumers = vueFiles(root).filter((path) => readFileSync(path, 'utf8').includes('<select'))
  const baseCss = readFileSync(join(root, '../assets/base.css'), 'utf8')

  assert.ok(consumers.length >= 9, 'audit must cover every select-owning renderer component')
  assert.match(
    baseCss,
    /html\[data-theme='dark'\] select\s*\{[\s\S]*color-scheme:\s*dark;[\s\S]*background-color:\s*var\(--te-settings-control-bg\) !important;[\s\S]*color:\s*var\(--te-settings-text\) !important/
  )
  assert.match(
    baseCss,
    /html\[data-theme='dark'\] select option\s*\{[\s\S]*background-color:\s*var\(--te-settings-control-bg\) !important;[\s\S]*color:\s*var\(--te-settings-text\) !important/
  )
})

test('Playbar lyric source selects use the deck palette for both field and popup', () => {
  const source = readFileSync(new URL('./player-bar/HiFiSidebar.vue', import.meta.url), 'utf8')
  const selector = source.match(/\.deck-lyric-source-controls select \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.match(selector, /background:\s*var\(--d-well\)/)
  assert.match(selector, /color:\s*var\(--d-ink\)/)
  assert.match(source, /\.deck-lyric-source-controls select option \{[\s\S]*background:\s*var\(--d-card\)[\s\S]*color:\s*var\(--d-ink\)/)
})
