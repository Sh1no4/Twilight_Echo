import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const styles = readFileSync(new URL('./settings-page/SettingsPage.css', import.meta.url), 'utf8')

test('settings option bars define dark-mode container and active option surfaces', () => {
  assert.match(
    styles,
    /html\[data-theme='dark'\] \.segmented-control,[\s\S]*?background:\s*var\(--te-subtle-bg\)/
  )
  assert.match(
    styles,
    /html\[data-theme='dark'\] \.segmented-control button\.active,[\s\S]*?background:\s*var\(--te-card-bg\)/
  )
})
