import type { PlaylistFileFormat } from './playlistLifecycle.ts'

export const PLAYLIST_EXPORT_FORMATS = [
  { value: 'm3u', label: 'M3U' },
  { value: 'm3u8', label: 'M3U8' },
  { value: 'pls', label: 'PLS' }
] as const satisfies ReadonlyArray<{ value: PlaylistFileFormat; label: string }>

export function playlistExportMimeType(format: PlaylistFileFormat): string {
  return format === 'pls' ? 'audio/x-scpls;charset=utf-8' : 'audio/x-mpegurl;charset=utf-8'
}

export function playlistExportFilename(playlistName: string, format: PlaylistFileFormat): string {
  return `${playlistName.replace(/[<>:"/\\|?*]/g, '_')}.${format}`
}
