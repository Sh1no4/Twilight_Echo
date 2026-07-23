import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const rendererRoot = join(repositoryRoot, 'src', 'renderer', 'src')
const allowlist = JSON.parse(
  readFileSync(new URL('./theme-color-allowlist.json', import.meta.url), 'utf8')
) as Record<string, number>
const colorLiteral = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi

test('renderer business styles do not exceed the hard-coded color baseline', () => {
  const actual = collectColorCounts(rendererRoot)
  const regressions = Object.entries(actual)
    .filter(([file, count]) => count > (allowlist[file] ?? 0))
    .map(([file, count]) => `${file}: ${count} > ${allowlist[file] ?? 0}`)
  assert.deepEqual(regressions, [])
})

function collectColorCounts(directory: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      Object.assign(counts, collectColorCounts(path))
      continue
    }
    if (extname(entry.name) !== '.css' && extname(entry.name) !== '.vue') continue
    const file = relative(repositoryRoot, path).replaceAll('\\', '/')
    if (file === 'src/renderer/src/assets/base.css') continue
    const source = readFileSync(path, 'utf8')
    const styles = entry.name.endsWith('.vue')
      ? Array.from(
          source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),
          (match) => match[1]
        ).join('\n')
      : source
    const count = Array.from(styles.matchAll(colorLiteral)).length
    if (count > 0) counts[file] = count
  }
  return counts
}
