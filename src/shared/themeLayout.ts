export const THEME_SHELL_SLOT_IDS = ['titleBar', 'navigation', 'content', 'playerBar'] as const
export type ThemeShellSlotId = (typeof THEME_SHELL_SLOT_IDS)[number]

export const THEME_SHELL_TRACK_IDS = [
  'auto',
  'content',
  'narrow',
  'standard',
  'wide',
  'fill',
  'double'
] as const
export type ThemeShellTrackId = (typeof THEME_SHELL_TRACK_IDS)[number]
export const THEME_SHELL_MANAGED_DATA_ATTRIBUTES = [
  'data-te-shell-layout',
  'data-te-shell-navigation'
] as const

export type ThemeShellNavigationMode = 'toggle' | 'persistent' | 'hidden'
export type ThemeShellGridArea = ThemeShellSlotId | '.'

export interface ThemeShellGrid {
  columns: ThemeShellTrackId[]
  rows: ThemeShellTrackId[]
  areas: ThemeShellGridArea[][]
}

export interface ThemeShellLayout {
  desktop: ThemeShellGrid
  compact?: ThemeShellGrid
  navigation?: ThemeShellNavigationMode
}

const MAX_GRID_TRACKS = 4
const REQUIRED_SHELL_SLOTS = new Set<ThemeShellSlotId>(['titleBar', 'content'])
const SHELL_SLOT_SET = new Set<string>(THEME_SHELL_SLOT_IDS)
const SHELL_TRACK_SET = new Set<string>(THEME_SHELL_TRACK_IDS)
const SHELL_TRACK_CSS: Readonly<Record<ThemeShellTrackId, string>> = Object.freeze({
  auto: 'auto',
  content: 'max-content',
  narrow: 'minmax(56px, 0.45fr)',
  standard: 'minmax(164px, 0.9fr)',
  wide: 'minmax(240px, 1.5fr)',
  fill: 'minmax(0, 1fr)',
  double: 'minmax(0, 2fr)'
})

export function normalizeThemeShellLayout(value: unknown): ThemeShellLayout | undefined {
  if (findInvalidThemeShellLayoutFields(value).length > 0 || !isRecord(value)) return undefined
  const desktop = normalizeThemeShellGrid(value.desktop)
  if (!desktop) return undefined
  const compact = value.compact == null ? undefined : normalizeThemeShellGrid(value.compact)
  if (value.compact != null && !compact) return undefined
  const navigation =
    value.navigation === 'toggle' ||
    value.navigation === 'persistent' ||
    value.navigation === 'hidden'
      ? value.navigation
      : undefined
  return {
    desktop,
    ...(compact ? { compact } : {}),
    ...(navigation ? { navigation } : {})
  }
}

export function findInvalidThemeShellLayoutFields(value: unknown): string[] {
  if (!isRecord(value)) return ['layout']
  const invalid = new Set<string>()
  for (const key of Object.keys(value)) {
    if (key !== 'desktop' && key !== 'compact' && key !== 'navigation') invalid.add(`layout.${key}`)
  }
  collectGridIssues(value.desktop, 'layout.desktop', invalid)
  if (value.compact != null) collectGridIssues(value.compact, 'layout.compact', invalid)
  if (
    value.navigation != null &&
    value.navigation !== 'toggle' &&
    value.navigation !== 'persistent' &&
    value.navigation !== 'hidden'
  ) {
    invalid.add('layout.navigation')
  }
  return [...invalid].sort()
}

export function themeShellLayoutToCssVariables(
  layout: ThemeShellLayout | undefined
): Record<string, string> {
  if (!layout) return {}
  const desktop = shellGridToCssVariables(layout.desktop)
  const compact = shellGridToCssVariables(layout.compact ?? layout.desktop)
  return {
    '--te-shell-template-columns': desktop.columns,
    '--te-shell-template-rows': desktop.rows,
    '--te-shell-template-areas': desktop.areas,
    '--te-shell-navigation-display': slotDisplay(layout.desktop, 'navigation', layout.navigation),
    '--te-shell-player-bar-display': slotDisplay(layout.desktop, 'playerBar'),
    '--te-shell-compact-template-columns': compact.columns,
    '--te-shell-compact-template-rows': compact.rows,
    '--te-shell-compact-template-areas': compact.areas,
    '--te-shell-compact-navigation-display': slotDisplay(
      layout.compact ?? layout.desktop,
      'navigation',
      layout.navigation
    ),
    '--te-shell-compact-player-bar-display': slotDisplay(
      layout.compact ?? layout.desktop,
      'playerBar'
    )
  }
}

export function themeShellLayoutToDataAttributes(
  layout: ThemeShellLayout | undefined
): Record<`data-te-${string}`, string> {
  if (!layout) return {}
  return {
    'data-te-shell-layout': 'custom',
    'data-te-shell-navigation': layout.navigation ?? 'toggle'
  }
}

function collectGridIssues(value: unknown, path: string, invalid: Set<string>): void {
  if (!isRecord(value)) {
    invalid.add(path)
    return
  }
  for (const key of Object.keys(value)) {
    if (key !== 'columns' && key !== 'rows' && key !== 'areas') invalid.add(`${path}.${key}`)
  }
  const columns = value.columns
  const rows = value.rows
  const areas = value.areas
  if (!isTrackList(columns)) invalid.add(`${path}.columns`)
  if (!isTrackList(rows)) invalid.add(`${path}.rows`)
  if (!Array.isArray(areas)) {
    invalid.add(`${path}.areas`)
    return
  }
  if (Array.isArray(rows) && areas.length !== rows.length) invalid.add(`${path}.areas`)
  let hasRequiredSlots = true
  const cells: ThemeShellGridArea[][] = []
  for (let rowIndex = 0; rowIndex < areas.length; rowIndex += 1) {
    const row = areas[rowIndex]
    if (!Array.isArray(row) || (Array.isArray(columns) && row.length !== columns.length)) {
      invalid.add(`${path}.areas`)
      continue
    }
    const normalizedRow: ThemeShellGridArea[] = []
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = row[columnIndex]
      if (cell !== '.' && (typeof cell !== 'string' || !SHELL_SLOT_SET.has(cell))) {
        invalid.add(`${path}.areas[${rowIndex}][${columnIndex}]`)
        continue
      }
      normalizedRow.push(cell)
    }
    cells.push(normalizedRow)
  }
  for (const slot of REQUIRED_SHELL_SLOTS) {
    if (!cells.some((row) => row.includes(slot))) {
      invalid.add(`${path}.areas.${slot}`)
      hasRequiredSlots = false
    }
  }
  if (hasRequiredSlots && cells.length > 0) collectNonRectangularAreas(cells, path, invalid)
}

function isTrackList(value: unknown): value is ThemeShellTrackId[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_GRID_TRACKS &&
    value.every((track) => typeof track === 'string' && SHELL_TRACK_SET.has(track))
  )
}

function normalizeThemeShellGrid(value: unknown): ThemeShellGrid | undefined {
  if (!isRecord(value)) return undefined
  const columns = value.columns
  const rows = value.rows
  const sourceAreas = value.areas
  if (!isTrackList(columns) || !isTrackList(rows) || !Array.isArray(sourceAreas)) {
    return undefined
  }
  const areas = sourceAreas.map((row) =>
    Array.isArray(row)
      ? row.filter(
          (cell): cell is ThemeShellGridArea =>
            cell === '.' || (typeof cell === 'string' && SHELL_SLOT_SET.has(cell))
        )
      : []
  )
  if (
    areas.length !== rows.length ||
    areas.some((row) => row.length !== columns.length) ||
    findInvalidThemeShellLayoutFields({ desktop: value }).length > 0
  ) {
    return undefined
  }
  return { columns: [...columns], rows: [...rows], areas }
}

function collectNonRectangularAreas(
  cells: ThemeShellGridArea[][],
  path: string,
  invalid: Set<string>
): void {
  for (const slot of THEME_SHELL_SLOT_IDS) {
    const coordinates: Array<[number, number]> = []
    for (let row = 0; row < cells.length; row += 1) {
      for (let column = 0; column < cells[row].length; column += 1) {
        if (cells[row][column] === slot) coordinates.push([row, column])
      }
    }
    if (coordinates.length === 0) continue
    const rows = coordinates.map(([row]) => row)
    const columns = coordinates.map(([, column]) => column)
    const firstRow = Math.min(...rows)
    const lastRow = Math.max(...rows)
    const firstColumn = Math.min(...columns)
    const lastColumn = Math.max(...columns)
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        if (cells[row][column] !== slot) {
          invalid.add(`${path}.areas.${slot}`)
          break
        }
      }
    }
  }
}

function shellGridToCssVariables(grid: ThemeShellGrid): {
  columns: string
  rows: string
  areas: string
} {
  return {
    columns: grid.columns.map((track) => SHELL_TRACK_CSS[track]).join(' '),
    rows: grid.rows.map((track) => SHELL_TRACK_CSS[track]).join(' '),
    areas: grid.areas.map((row) => `'${row.join(' ')}'`).join(' ')
  }
}

function slotDisplay(
  grid: ThemeShellGrid,
  slot: ThemeShellSlotId,
  navigation?: ThemeShellNavigationMode
): 'block' | 'none' {
  if (slot === 'navigation' && navigation === 'hidden') return 'none'
  return grid.areas.some((row) => row.includes(slot)) ? 'block' : 'none'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
