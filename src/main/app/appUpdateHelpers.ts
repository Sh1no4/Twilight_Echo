export type GithubAssetLike = {
  name?: string
  size?: number
  browser_download_url?: string
  content_type?: string
  digest?: string
}

export type GithubReleaseLike = {
  tag_name?: string
  draft?: boolean
}

const WINDOWS_SETUP_RE = /setup\.exe$/i
const WINDOWS_EXE_RE = /\.exe$/i
const SHA256_HEX_RE = /\b[a-f0-9]{64}\b/i
const SHA256_ASSET_DIGEST_RE = /^sha256:([a-f0-9]{64})$/i

export function pickWindowsAsset(assets: GithubAssetLike[]): GithubAssetLike | null {
  const named = assets.filter(
    (asset) => typeof asset.name === 'string' && typeof asset.browser_download_url === 'string'
  )
  const setup = named.find((asset) => WINDOWS_SETUP_RE.test(asset.name || ''))
  if (setup) return setup
  const exe = named.find((asset) => WINDOWS_EXE_RE.test(asset.name || ''))
  return exe || null
}

export function pickLatestAvailableRelease<T extends GithubReleaseLike>(
  releases: readonly T[]
): T | null {
  return (
    releases.find(
      (release) =>
        release.draft !== true &&
        typeof release.tag_name === 'string' &&
        release.tag_name.trim().length > 0
    ) ?? null
  )
}

export function extractAssetDigestSha256(digest?: string): string | undefined {
  return digest?.trim().match(SHA256_ASSET_DIGEST_RE)?.[1]?.toLowerCase()
}

export function extractChecksumFromBody(body: string, assetName: string): string | undefined {
  if (!body || !assetName) return undefined
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    if (!line.toLowerCase().includes(assetName.toLowerCase())) continue
    const match = line.match(SHA256_HEX_RE)
    if (match) return match[0].toLowerCase()
  }
  const reverse = body.match(
    new RegExp(`${escapeRegExp(assetName)}[^\\n]*${SHA256_HEX_RE.source}`, 'i')
  )
  if (reverse) {
    const hash = reverse[0].match(SHA256_HEX_RE)
    if (hash) return hash[0].toLowerCase()
  }
  return undefined
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export { SHA256_HEX_RE }
