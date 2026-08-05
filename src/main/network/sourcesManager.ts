import { NetworkSourceFailure } from './errors.ts'
import { downloadEntryToCache } from './networkCache.ts'
import type {
  NetworkSourceAdapter,
  NetworkSourceSession,
  NetworkAuth
} from './adapters/types.ts'
import type {
  NetworkProfileStore,
  NetworkSourceProfileInput
} from './profileStore.ts'
import type {
  NetworkEntry,
  NetworkPlaybackPlan,
  NetworkSourceErrorCode,
  NetworkSourceProfile,
  NetworkSourceProfileSummary
} from '../../shared/networkSources.ts'

export interface NetworkSourcesManager {
  listProfiles(): Promise<NetworkSourceProfileSummary[]>
  createProfile(input: NetworkSourceProfileInput): Promise<NetworkSourceProfileSummary>
  updateProfile(
    id: string,
    patch: Partial<NetworkSourceProfileInput>
  ): Promise<NetworkSourceProfileSummary>
  deleteProfile(id: string): Promise<void>
  listDirectory(profileId: string, remotePath: string, signal?: AbortSignal): Promise<NetworkEntry[]>
  testConnection(profileId: string): Promise<{ ok: boolean; errorCode?: NetworkSourceErrorCode }>
  resolvePlayback(
    profileId: string,
    entry: NetworkEntry,
    signal?: AbortSignal
  ): Promise<NetworkPlaybackPlan>
}

export function createNetworkSourcesManager(deps: {
  store: NetworkProfileStore
  cacheRoot: string
  getAdapter: (protocol: NetworkSourceProfile['protocol']) => Promise<NetworkSourceAdapter | null>
}): NetworkSourcesManager {
  const { store, cacheRoot, getAdapter } = deps

  async function openSession(profileId: string): Promise<{
    profile: NetworkSourceProfile
    auth: NetworkAuth
    session: NetworkSourceSession
  }> {
    const profile = await store.getProfile(profileId)
    const auth = await store.resolveAuth(profileId)
    const adapter = await getAdapter(profile.protocol)
    if (!adapter) {
      throw new NetworkSourceFailure('unsupportedProtocol', `协议暂不支持：${profile.protocol}`)
    }
    return { profile, auth, session: await adapter.createSession(profile, auth) }
  }

  return {
    async listProfiles() {
      return store.listProfiles()
    },
    async createProfile(input) {
      return store.createProfile(input)
    },
    async updateProfile(id, patch) {
      return store.updateProfile(id, patch)
    },
    async deleteProfile(id) {
      return store.deleteProfile(id)
    },
    async listDirectory(profileId, remotePath, signal) {
      const { session } = await openSession(profileId)
      try {
        return await session.list(remotePath, signal)
      } finally {
        await session.close()
      }
    },
    async testConnection(profileId) {
      try {
        const { session, profile } = await openSession(profileId)
        try {
          await session.list(profile.rootPath)
          return { ok: true }
        } finally {
          await session.close()
        }
      } catch (err) {
        const failure =
          err instanceof NetworkSourceFailure ? err : new NetworkSourceFailure('network', String(err))
        return { ok: false, errorCode: failure.code }
      }
    },
    async resolvePlayback(profileId, entry, signal) {
      const { session } = await openSession(profileId)
      try {
        const directUrl = await session.resolvePlaybackUrl(entry.path, signal)
        if (directUrl) {
          return { kind: 'direct-url', url: directUrl, displayName: entry.name }
        }
        const cacheFilePath = await downloadEntryToCache({ session, entry, cacheRoot, signal })
        return { kind: 'local-cache', cacheFilePath, displayName: entry.name }
      } finally {
        await session.close()
      }
    }
  }
}
