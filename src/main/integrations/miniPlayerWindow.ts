import type { Rectangle } from 'electron'
import type { MiniPlayerSettings } from '../../shared/miniPlayer'

export const MINI_PLAYER_MIN_WIDTH = 360
export const MINI_PLAYER_MIN_HEIGHT = 140
export const MINI_PLAYER_MAX_WIDTH = 900
export const MINI_PLAYER_MAX_HEIGHT = 520

export function clampMiniPlayerBoundsToWorkArea(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const maxWidth = Math.max(1, Math.min(MINI_PLAYER_MAX_WIDTH, Math.round(workArea.width)))
  const maxHeight = Math.max(1, Math.min(MINI_PLAYER_MAX_HEIGHT, Math.round(workArea.height)))
  const minWidth = Math.min(MINI_PLAYER_MIN_WIDTH, maxWidth)
  const minHeight = Math.min(MINI_PLAYER_MIN_HEIGHT, maxHeight)
  const width = clampNumber(Math.round(bounds.width), minWidth, maxWidth)
  const height = clampNumber(Math.round(bounds.height), minHeight, maxHeight)
  const minX = Math.round(workArea.x)
  const minY = Math.round(workArea.y)
  const maxX = minX + Math.round(workArea.width) - width
  const maxY = minY + Math.round(workArea.height) - height

  return {
    x: clampNumber(Math.round(bounds.x), minX, maxX),
    y: clampNumber(Math.round(bounds.y), minY, maxY),
    width,
    height
  }
}

export function miniPlayerBoundsPatch(
  bounds: Rectangle
): Pick<MiniPlayerSettings, 'windowX' | 'windowY' | 'windowWidth' | 'windowHeight'> {
  return {
    windowX: Math.round(bounds.x),
    windowY: Math.round(bounds.y),
    windowWidth: Math.round(bounds.width),
    windowHeight: Math.round(bounds.height)
  }
}

export function createMiniPlayerWindowShape(
  width: number,
  height: number,
  cornerRadius: number
): Rectangle[] {
  const roundedWidth = Math.max(1, Math.round(width))
  const roundedHeight = Math.max(1, Math.round(height))
  const radius = Math.min(
    Math.max(0, Math.round(cornerRadius)),
    Math.floor(roundedWidth / 2),
    Math.floor(roundedHeight / 2)
  )
  if (radius === 0) return [{ x: 0, y: 0, width: roundedWidth, height: roundedHeight }]

  const shape: Rectangle[] = []
  const middleHeight = roundedHeight - radius * 2
  if (middleHeight > 0) {
    shape.push({ x: 0, y: radius, width: roundedWidth, height: middleHeight })
  }

  for (let y = 0; y < radius; y += 1) {
    const distanceFromCenter = radius - y - 0.5
    const inset = Math.ceil(
      radius - Math.sqrt(Math.max(0, radius * radius - distanceFromCenter * distanceFromCenter))
    )
    const rowWidth = roundedWidth - inset * 2
    if (rowWidth <= 0) continue
    shape.push({ x: inset, y, width: rowWidth, height: 1 })
    const mirroredY = roundedHeight - y - 1
    if (mirroredY !== y) shape.push({ x: inset, y: mirroredY, width: rowWidth, height: 1 })
  }

  return shape
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
