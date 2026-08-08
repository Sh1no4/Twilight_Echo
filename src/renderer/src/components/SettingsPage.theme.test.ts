import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const styles = readFileSync(new URL('./settings-page/SettingsPage.css', import.meta.url), 'utf8')
const baseStyles = readFileSync(new URL('../assets/base.css', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('./SettingsPage.vue', import.meta.url), 'utf8')

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

test('dark settings folder controls and switches avoid light fixed-color surfaces', () => {
  assert.match(
    pageSource,
    /html\[data-theme='dark'\] \.settings-preview-page \.dashed-button,[\s\S]*?html\[data-theme='dark'\] \.settings-preview-page \.folder-empty-hint\s*\{[\s\S]*?background:\s*var\(--te-card-bg\)/
  )
  assert.match(
    baseStyles,
    /html\[data-theme='dark'\] \.settings-preview-layout \.toggle-switch\.inactive\s*\{[\s\S]*?background:\s*var\(--te-subtle-bg\)/
  )
})

test('native checkboxes inherit the active dark color scheme and theme accent', () => {
  assert.match(
    baseStyles,
    /input\[type='checkbox'\][\s\S]*?accent-color:\s*var\(--te-primary-500\)/
  )
  assert.match(
    baseStyles,
    /html\[data-theme='dark'\] input\[type='checkbox'\][\s\S]*?color-scheme:\s*dark/
  )
  assert.match(
    baseStyles,
    /html\[data-theme='dark'\] input\[type='checkbox'\][\s\S]*?appearance:\s*none/
  )
  assert.match(
    baseStyles,
    /html\[data-theme='dark'\] input\[type='checkbox'\]:checked\s*\{[\s\S]*?background-color:\s*var\(--te-primary-500\)/
  )
  assert.match(
    baseStyles,
    /html\[data-theme='dark'\] input\[type='checkbox'\]:checked::after\s*\{[\s\S]*?content:\s*''/
  )
})
