import { extname } from 'node:path'

const MAX_THEME_ARCHIVE_BYTES = 20 * 1024 * 1024
const MAX_THEME_EXTRACTED_BYTES = 40 * 1024 * 1024
const MAX_THEME_ARCHIVE_FILES = 128
const MAX_THEME_JSON_BYTES = 2 * 1024 * 1024
const THEME_ASSET_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.woff2'])

export function validateThemeArchiveBuffer(archive: Buffer): void {
  if (archive.length < 22 || archive.length > MAX_THEME_ARCHIVE_BYTES) {
    throw new Error('主题包大小无效')
  }
  const minimumEocdOffset = Math.max(0, archive.length - (65_535 + 22))
  let eocdOffset = -1
  for (let offset = archive.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) throw new Error('主题包 ZIP 目录无效')
  const disk = archive.readUInt16LE(eocdOffset + 4)
  const directoryDisk = archive.readUInt16LE(eocdOffset + 6)
  const diskEntries = archive.readUInt16LE(eocdOffset + 8)
  const totalEntries = archive.readUInt16LE(eocdOffset + 10)
  const directorySize = archive.readUInt32LE(eocdOffset + 12)
  const directoryOffset = archive.readUInt32LE(eocdOffset + 16)
  const commentLength = archive.readUInt16LE(eocdOffset + 20)
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    diskEntries !== totalEntries ||
    totalEntries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    totalEntries > MAX_THEME_ARCHIVE_FILES ||
    eocdOffset + 22 + commentLength !== archive.length ||
    directoryOffset + directorySize > eocdOffset
  ) {
    throw new Error('主题包 ZIP 目录不受支持')
  }

  let offset = directoryOffset
  let totalBytes = 0
  let fileCount = 0
  const names = new Set<string>()
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('主题包 ZIP 条目无效')
    }
    const versionMadeBy = archive.readUInt16LE(offset + 4)
    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const entryCommentLength = archive.readUInt16LE(offset + 32)
    const externalAttributes = archive.readUInt32LE(offset + 38)
    const entryLength = 46 + nameLength + extraLength + entryCommentLength
    if (
      offset + entryLength > archive.length ||
      (flags & 0x1) !== 0 ||
      (method !== 0 && method !== 8) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff
    ) {
      throw new Error('主题包 ZIP 条目不受支持')
    }
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength)
    const segments = name.split('/')
    const pathSegments = name.endsWith('/') ? segments.slice(0, -1) : segments
    const unixMode = externalAttributes >>> 16
    const isSymlink = versionMadeBy >> 8 === 3 && (unixMode & 0o170000) === 0o120000
    if (
      !name ||
      name.includes('\\') ||
      name.startsWith('/') ||
      /^[a-zA-Z]:/.test(name) ||
      pathSegments.some((segment) => segment === '..' || segment === '') ||
      isSymlink ||
      names.has(name)
    ) {
      throw new Error('主题资源路径越界或重复')
    }
    names.add(name)
    if (!name.endsWith('/')) {
      fileCount += 1
      totalBytes += uncompressedSize
      if (name === 'theme.json') {
        if (uncompressedSize > MAX_THEME_JSON_BYTES) throw new Error('theme.json 过大')
      } else if (
        !name.startsWith('assets/') ||
        !THEME_ASSET_EXTENSIONS.has(extname(name).toLowerCase())
      ) {
        throw new Error('主题包只能包含 theme.json 与受支持的 assets/')
      }
    }
    if (totalBytes > MAX_THEME_EXTRACTED_BYTES || fileCount > MAX_THEME_ARCHIVE_FILES) {
      throw new Error('主题包解压规模超过限制')
    }
    offset += entryLength
  }
  if (offset !== directoryOffset + directorySize || !names.has('theme.json')) {
    throw new Error('主题包 ZIP 目录与 theme.json 不完整')
  }
}
