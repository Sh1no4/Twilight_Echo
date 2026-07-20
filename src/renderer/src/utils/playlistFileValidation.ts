import { MAX_PLAYLIST_IMPORT_BYTES } from './playlistLifecycle.ts'

export const MAX_PLAYLIST_COVER_BYTES = 6 * 1024 * 1024
export const MAX_PLAYLIST_COVER_PIXELS = 16_000_000

export interface PlaylistImportFile {
  size: number
  text(): Promise<string>
}

export interface PlaylistCoverFile {
  size: number
  type: string
}

export function assertPlaylistImportFileSize(file: Pick<PlaylistImportFile, 'size'>): void {
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_PLAYLIST_IMPORT_BYTES) {
    throw new Error('Playlist file exceeds the 8 MiB import limit')
  }
}

/** Validates the browser-supplied byte length before File.text() allocates the document. */
export async function readPlaylistImportFile(file: PlaylistImportFile): Promise<string> {
  assertPlaylistImportFileSize(file)
  return file.text()
}

export function assertPlaylistCoverFile(file: PlaylistCoverFile): void {
  if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type)) {
    throw new Error('Playlist cover must be a PNG, JPEG, or WebP image')
  }
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_PLAYLIST_COVER_BYTES) {
    throw new Error('Playlist cover must not exceed 6 MiB')
  }
}

export function assertPlaylistCoverDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_PLAYLIST_COVER_PIXELS
  ) {
    throw new Error('Playlist cover must not exceed 16 megapixels')
  }
}
