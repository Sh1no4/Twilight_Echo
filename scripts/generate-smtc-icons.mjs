// Source: phosphor-icons/core assets (fill set), MIT license.
// Generates Windows .ico files consumed by the main-process SMTC thumbar
// integration (src/main/integrations/smtc.ts).
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'build', 'smtc')

const VIEWBOX = 256
// Windows taskbar thumbnail toolbar expects small icons; 24px is the standard density.
const SIZE = 24
const SCALE = SIZE / VIEWBOX

const ICONS = [
  { name: 'play', file: 'play.svg' },
  { name: 'pause', file: 'pause.svg' },
  { name: 'previous', file: 'skip-back.svg' },
  { name: 'next', file: 'skip-forward.svg' }
]

function parsePath(d) {
  const tokens = d.replace(/,/g, ' ').match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d+(?:\.\d+)?/g) ?? []
  const paths = []
  let current = null
  let cursor = { x: 0, y: 0 }
  let startX = 0
  let startY = 0
  let i = 0

  function read() {
    return Number(tokens[i++])
  }

  while (i < tokens.length) {
    const cmd = tokens[i++]
    const isRel = cmd === cmd.toLowerCase()
    if (cmd === 'M' || cmd === 'm') {
      const x = read()
      const y = read()
      const point = { x: isRel ? cursor.x + x : x, y: isRel ? cursor.y + y : y }
      current = [point]
      paths.push(current)
      cursor = point
      startX = point.x
      startY = point.y
      continue
    }
    if (!current) continue
    if (cmd === 'L' || cmd === 'l') {
      const x = read()
      const y = read()
      const point = { x: isRel ? cursor.x + x : x, y: isRel ? cursor.y + y : y }
      current.push(point)
      cursor = point
      continue
    }
    if (cmd === 'H' || cmd === 'h') {
      const x = read()
      const point = { x: isRel ? cursor.x + x : x, y: cursor.y }
      current.push(point)
      cursor = point
      continue
    }
    if (cmd === 'V' || cmd === 'v') {
      const y = read()
      const point = { x: cursor.x, y: isRel ? cursor.y + y : y }
      current.push(point)
      cursor = point
      continue
    }
    // Curves / arcs: approximate by the segment to the final control point. The
    // Phosphor fill icons only use curves for small corners (rounded button
    // edges), the overall silhouette is governed by straight segments.
    if (cmd === 'C' || cmd === 'c') {
      const _x1 = read()
      const _y1 = read()
      const _x2 = read()
      const _y2 = read()
      const x = read()
      const y = read()
      const point = { x: isRel ? cursor.x + x : x, y: isRel ? cursor.y + y : y }
      current.push(point)
      cursor = point
      continue
    }
    if (cmd === 'S' || cmd === 's' || cmd === 'Q' || cmd === 'q') {
      const _x1 = read()
      const _y1 = read()
      const x = read()
      const y = read()
      const point = { x: isRel ? cursor.x + x : x, y: isRel ? cursor.y + y : y }
      current.push(point)
      cursor = point
      continue
    }
    if (cmd === 'T' || cmd === 't') {
      const x = read()
      const y = read()
      const point = { x: isRel ? cursor.x + x : x, y: isRel ? cursor.y + y : y }
      current.push(point)
      cursor = point
      continue
    }
    if (cmd === 'A' || cmd === 'a') {
      const _rx = read()
      const _ry = read()
      const _rot = read()
      const _large = read()
      const _sweep = read()
      const x = read()
      const y = read()
      const point = { x: isRel ? cursor.x + x : x, y: isRel ? cursor.y + y : y }
      current.push(point)
      cursor = point
      continue
    }
    if (cmd === 'Z' || cmd === 'z') {
      current.push({ x: startX, y: startY })
      cursor = { x: startX, y: startY }
      current = null
      continue
    }
    i -= 1 // unknown number token: bail out of this path
    break
  }
  return paths
}

function pointInPolygon(x, y, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function rasterize(svg, size) {
  const pathMatch = svg.match(/<path[^>]*d="([^"]+)"/)
  if (!pathMatch) throw new Error('No path found in SVG')
  const polygons = parsePath(pathMatch[1])
  const png = new PNG({ width: size, height: size, colorType: 6, inputColorType: 6 })
  const center = 0.5
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const wx = (px + center) / SCALE
      const wy = (py + center) / SCALE
      let covered = false
      for (const polygon of polygons) {
        if (pointInPolygon(wx, wy, polygon)) {
          covered = true
          break
        }
      }
      const idx = (py * size + px) << 2
      png.data[idx] = 255
      png.data[idx + 1] = 255
      png.data[idx + 2] = 255
      png.data[idx + 3] = covered ? 255 : 0
    }
  }
  return PNG.sync.write(png)
}

function createIco(pngBuffer, size) {
  // ICO: 6-byte header, 16-byte entry, then PNG payload.
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(1, 4) // count

  const entry = Buffer.alloc(16)
  entry.writeUInt8(size === 256 ? 0 : size, 0) // width
  entry.writeUInt8(size === 256 ? 0 : size, 1) // height
  entry.writeUInt8(0, 2) // color palette
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8)
  entry.writeUInt32LE(6 + 16, 12)

  return Buffer.concat([header, entry, pngBuffer])
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const icon of ICONS) {
    const svg = readFileSync(join(ROOT, 'build', 'smtc-src', icon.file), 'utf8')
    const png = rasterize(svg, SIZE)
    const ico = createIco(png, SIZE)
    writeFileSync(join(OUT_DIR, `${icon.name}.ico`), ico)
    console.log(`[smtc] wrote build/smtc/${icon.name}.ico (${png.length} bytes)`)
  }
}

main()
