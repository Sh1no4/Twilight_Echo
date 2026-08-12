'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildReport } = require('./ipc-channel-report.cjs')

test('main registrations and preload invokes are fully mapped', () => {
  const report = buildReport()
  assert.ok(report.summary.mainHandles >= 100, 'expected >100 ipcMain.handle registrations')
  assert.ok(report.summary.preloadInvokes >= 100, 'expected >100 preload invoke channels')
  assert.deepEqual(report.summary.preloadInvokeMissingMain, [])
})

test('ipcMain.on channels and preload event listeners are present for broadcast data flow', () => {
  const report = buildReport()
  assert.ok(report.summary.mainOn > 0, 'expected at least one ipcMain.on registration')
  assert.ok(
    report.summary.preloadEventListeners > 0,
    'expected at least one preload ipcRenderer.on listener'
  )
  assert.equal(
    report.summary.mainOn + report.summary.preloadEventListeners > 10,
    true,
    'expected a meaningful event surface'
  )
})

test('every renderer window.api domain maps to a declared preload domain', () => {
  const report = buildReport()
  assert.deepEqual(report.summary.rendererDomainsMissingPreload, [])
  assert.ok(report.summary.rendererApiUses > 100, 'expected >100 renderer window.api call sites')
})
