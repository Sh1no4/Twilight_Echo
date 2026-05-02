export function extractDominantColor(imageSrc: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const size = 50
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve('#1a73e8')
        return
      }
      ctx.drawImage(img, 0, 0, size, size)
      const data = ctx.getImageData(0, 0, size, size).data

      const buckets = 12
      const hist = new Map<number, number>()

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]
        if (a < 128) continue

        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        if (max - min < 15) continue
        if (max < 40 || min > 220) continue

        const ri = Math.floor((r / 255) * (buckets - 1))
        const gi = Math.floor((g / 255) * (buckets - 1))
        const bi = Math.floor((b / 255) * (buckets - 1))
        const key = (ri << 16) | (gi << 8) | bi
        hist.set(key, (hist.get(key) || 0) + 1)
      }

      if (hist.size === 0) {
        resolve('#1a73e8')
        return
      }

      let bestKey = 0
      let bestCount = 0
      for (const [key, count] of hist) {
        if (count > bestCount) {
          bestCount = count
          bestKey = key
        }
      }

      const r = Math.round(((bestKey >> 16) & 0xff) / (buckets - 1) * 255)
      const g = Math.round(((bestKey >> 8) & 0xff) / (buckets - 1) * 255)
      const b = Math.round((bestKey & 0xff) / (buckets - 1) * 255)

      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      resolve(hex)
    }
    img.onerror = () => resolve('#1a73e8')
    img.src = imageSrc
  })
}
