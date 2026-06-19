import {
  normalizeAudioProcessingSettings,
  type AudioProcessingSettings,
  type EqualizerBand
} from './audioEngineManager.ts'

export interface HeadphoneCompensationSettings {
  enabled: boolean
  productId: string
  productName: string
  vendorName: string
  eqId: string
  author: string
  details: string
  link: string
  preampDb: number
  bands: EqualizerBand[]
}

export const DEFAULT_HEADPHONE_COMPENSATION: HeadphoneCompensationSettings = {
  enabled: false,
  productId: '',
  productName: '',
  vendorName: '',
  eqId: '',
  author: '',
  details: '',
  link: '',
  preampDb: 0,
  bands: []
}

export function cloneEqualizerBands(bands: EqualizerBand[]): EqualizerBand[] {
  return bands.map((band) => ({ ...band }))
}

export function normalizeHeadphoneCompensationSettings(
  settings?: Partial<HeadphoneCompensationSettings>
): HeadphoneCompensationSettings {
  const rawBands = Array.isArray(settings?.bands) ? settings.bands : []
  const normalizedBands =
    rawBands.length > 0
      ? normalizeAudioProcessingSettings({
          eqMode: 'parametric',
          eqBands: rawBands
        }).eqBands
      : []

  return {
    enabled: settings?.enabled === true,
    productId: typeof settings?.productId === 'string' ? settings.productId : '',
    productName: typeof settings?.productName === 'string' ? settings.productName : '',
    vendorName: typeof settings?.vendorName === 'string' ? settings.vendorName : '',
    eqId: typeof settings?.eqId === 'string' ? settings.eqId : '',
    author: typeof settings?.author === 'string' ? settings.author : '',
    details: typeof settings?.details === 'string' ? settings.details : '',
    link: typeof settings?.link === 'string' ? settings.link : '',
    preampDb:
      typeof settings?.preampDb === 'number' && Number.isFinite(settings.preampDb)
        ? Math.min(24, Math.max(-24, settings.preampDb))
        : 0,
    bands: normalizedBands
  }
}

export function buildEffectiveAudioProcessingSettings(
  userProcessing: Partial<AudioProcessingSettings>,
  headphoneCompensation?: Partial<HeadphoneCompensationSettings>
): AudioProcessingSettings {
  const user = normalizeAudioProcessingSettings(userProcessing)
  const compensation = normalizeHeadphoneCompensationSettings(headphoneCompensation)

  if (!compensation.enabled || compensation.bands.length === 0) return user

  return normalizeAudioProcessingSettings({
    ...user,
    dspEnabled: true,
    eqEnabled: true,
    eqMode: 'parametric',
    eqPreamp: user.eqPreamp + compensation.preampDb,
    eqBands: [...cloneEqualizerBands(compensation.bands), ...cloneEqualizerBands(user.eqBands)]
  })
}
