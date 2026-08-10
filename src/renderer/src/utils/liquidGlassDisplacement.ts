/**
 * Liquid glass displacement map generation.
 *
 * The SVG filter chain needs a displacement map whose R channel encodes X offset
 * and B channel encodes Y offset (0x80 = no displacement). Rather than shipping
 * prebaked base64 JPEGs — the reference implementation carries ~41KB of them and
 * the renderer CSS chunk budget is 400KB — the map is generated once at runtime
 * and cached per aspect bucket.
 *
 * Profile note: this does NOT port the reference's `shader` mode SDF. With its
 * parameters (corner radius 0.6 against half-extents 0.3/0.2) the resulting scale
 * factor is ~1.0 across the entire surface, so the map comes out essentially flat
 * and nothing refracts — consistent with that mode being documented as "not the
 * most stable". The reference's default look comes from its prebaked bitmap.
 *
 * Instead the map encodes a rim refraction profile: no displacement through the
 * middle, magnitude ramping up toward the borders, pulling samples inward. That is
 * how a glass edge actually bends what is behind it, and it matches what the
 * filter's own edge mask expects to composite.
 *
 * The math is DOM-free so it can be unit tested; only `getDisplacementMapUrl`
 * touches canvas.
 */

export interface DisplacementBucket {
  width: number
  height: number
}

/**
 * Maps are generated per aspect-ratio bucket, not per element. `feImage` uses
 * `preserveAspectRatio="xMidYMid slice"`, so one map serves every element sharing
 * a rough aspect. Cards are near-square; the playbar is a wide strip.
 */
export const CARD_DISPLACEMENT_BUCKET: DisplacementBucket = { width: 256, height: 256 }
export const PLAYBAR_DISPLACEMENT_BUCKET: DisplacementBucket = { width: 512, height: 64 }

/**
 * Fraction of the half-extent occupied by the refracting rim. Smaller values give a
 * tighter, more pronounced glass edge; larger values bend more of the surface.
 */
export const DEFAULT_RIM_FRACTION = 0.38

/** Byte value meaning "no displacement" for a signed channel. */
export const NEUTRAL_BYTE = 128

export function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Signed distance to a rounded rectangle centered on the origin. */
export function roundedRectSDF(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  radius: number
): number {
  const qx = Math.abs(x) - halfWidth + radius
  const qy = Math.abs(y) - halfHeight + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

/**
 * Relative refraction magnitude for one axis, given a normalized coordinate in
 * [0, 1]. Returns 1 at the border and eases to 0 at the inner edge of the rim.
 */
export function rimMagnitude(coordinate: number, rimFraction: number): number {
  const distanceToBorder = Math.min(coordinate, 1 - coordinate)
  const rim = Math.max(1e-6, rimFraction * 0.5)
  const normalized = Math.min(1, Math.max(0, distanceToBorder / rim))
  return 1 - smoothStep(0, 1, normalized)
}

export interface DisplacementVector {
  x: number
  y: number
}

/**
 * Relative displacement at a normalized coordinate. Points inward (toward the
 * center) with magnitude driven by rim proximity, so the middle stays unrefracted.
 * Values are relative; `feDisplacementMap scale` sets the real amplitude.
 */
export function rimDisplacement(
  u: number,
  v: number,
  rimFraction: number = DEFAULT_RIM_FRACTION
): DisplacementVector {
  // Sign is inward: left half pushes right, right half pushes left. Dead center
  // gets zero so there is no discontinuity at the midline.
  const dirX = u < 0.5 ? 1 : u > 0.5 ? -1 : 0
  const dirY = v < 0.5 ? 1 : v > 0.5 ? -1 : 0
  return {
    x: dirX * rimMagnitude(u, rimFraction),
    y: dirY * rimMagnitude(v, rimFraction)
  }
}

/**
 * Builds RGBA bytes for the displacement map. R holds X offset, G and B both hold
 * Y offset — the filter selects R and B, and G is kept in sync so the map is also
 * readable as a conventional offset map.
 */
export function buildDisplacementPixels(
  width: number,
  height: number,
  rimFraction: number = DEFAULT_RIM_FRACTION
): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`invalid displacement map size: ${width}x${height}`)
  }

  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    // Sample at pixel centers so the field stays symmetric for any size.
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width
      const displacement = rimDisplacement(u, v, rimFraction)

      // Map [-1, 1] onto the byte range around neutral.
      const r = displacement.x * 0.5 + 0.5
      const g = displacement.y * 0.5 + 0.5

      const p = (y * width + x) * 4
      pixels[p] = r * 255
      pixels[p + 1] = g * 255
      pixels[p + 2] = g * 255
      pixels[p + 3] = 255
    }
  }

  return pixels
}

const cache = new Map<string, string>()

function bucketKey(bucket: DisplacementBucket, rimFraction: number): string {
  return `${bucket.width}x${bucket.height}@${rimFraction}`
}

/**
 * Renders the map to a data URL, memoized per bucket. Returns an empty string when
 * canvas is unavailable (non-DOM context), letting callers skip the filter rather
 * than throw.
 */
export function getDisplacementMapUrl(
  bucket: DisplacementBucket,
  rimFraction: number = DEFAULT_RIM_FRACTION
): string {
  const key = bucketKey(bucket, rimFraction)
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  if (typeof document === 'undefined') return ''

  const canvas = document.createElement('canvas')
  canvas.width = bucket.width
  canvas.height = bucket.height
  const context = canvas.getContext('2d')
  if (!context) return ''

  const imageData = context.createImageData(bucket.width, bucket.height)
  imageData.data.set(buildDisplacementPixels(bucket.width, bucket.height, rimFraction))
  context.putImageData(imageData, 0, 0)

  const url = canvas.toDataURL()
  cache.set(key, url)
  return url
}

/** Test hook — the cache is process-lifetime otherwise. */
export function clearDisplacementMapCache(): void {
  cache.clear()
}
