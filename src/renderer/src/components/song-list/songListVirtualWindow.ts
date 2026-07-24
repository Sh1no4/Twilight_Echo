export interface SongListVirtualWindowInput {
  trackCount: number
  scrollTop: number
  viewportHeight: number
  tableOffsetTop: number
  rowHeight: number
  overscanRows?: number
}

export function getSongListVirtualRange({
  trackCount,
  scrollTop,
  viewportHeight,
  tableOffsetTop,
  rowHeight,
  overscanRows = 6
}: SongListVirtualWindowInput): { start: number; end: number } {
  const virtualScrollTop = Math.max(0, scrollTop - tableOffsetTop)
  const start = Math.floor(virtualScrollTop / rowHeight)
  const count = Math.ceil(viewportHeight / rowHeight) + overscanRows
  return {
    start: Math.max(0, start),
    end: Math.min(trackCount, start + count)
  }
}
