import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { buildNetworkEntryId, normalizeRemotePath } from '../networkPath.ts'
import { NetworkSourceFailure } from '../errors.ts'
import { entryKind } from '../entryKinds.ts'
import type { NetworkAuth, NetworkSourceAdapter, NetworkSourceSession } from './types.ts'
import type { NetworkEntry, NetworkSourceProfile } from '../../../shared/networkSources.ts'

export interface MountCommandResult {
  code: number
  stdout: string
  stderr: string
}

export type MountCommandRunner = (
  command: string,
  args: string[]
) => Promise<MountCommandResult>

/**
 * SMB 系统挂载 adapter（B 方案）：
 * - Windows：`net use \\host\share [password] /user:user`，本地路径为 UNC；
 * - Linux：`gio mount smb://host/share`（仅匿名/已缓存凭据，非交互式不支持口令）；
 * - 挂载后按本地文件读取；close 时卸载。
 * NFS 需要 root 权限的 mount，另行评估（见施工文档 §10）。
 */
export function createSmbMountAdapter(deps?: {
  platform?: NodeJS.Platform
  runCommand?: MountCommandRunner
  localMap?: (uncOrUri: string, remotePath: string) => string
}): NetworkSourceAdapter {
  const platform = deps?.platform ?? process.platform
  const runCommand = deps?.runCommand ?? defaultRunCommand

  function shareName(profile: NetworkSourceProfile): string {
    return normalizeRemotePath(profile.rootPath).replace(/^\//, '')
  }

  function uncFor(profile: NetworkSourceProfile): string {
    return `\\\\${profile.host}\\${shareName(profile)}`
  }

  function gioUri(profile: NetworkSourceProfile, username?: string): string {
    const user = username ? `${username}@` : ''
    return `smb://${user}${profile.host}/${shareName(profile)}`
  }

  function defaultLocalMap(profile: NetworkSourceProfile): (remotePath: string) => string {
    if (platform === 'win32') {
      const unc = uncFor(profile)
      return (remotePath) => join(unc, remotePath.replace(/^\//, ''))
    }
    const uri = gioUri(profile)
    return (remotePath) => join(uri, remotePath.replace(/^\//, ''))
  }

  function throwForMountResult(result: MountCommandResult, action: string): void {
    if (result.code === 0) return
    const stderr = result.stderr
    if (/access is denied|logon failure|invalid username/i.test(stderr)) {
      throw new NetworkSourceFailure('auth', 'SMB 认证失败，请检查用户名或密码')
    }
    if (/network name cannot be found|not found|no such/i.test(stderr)) {
      throw new NetworkSourceFailure('notFound', 'SMB 共享不存在')
    }
    throw new NetworkSourceFailure('network', `SMB ${action} 失败：${stderr.trim() || `exit ${result.code}`}`)
  }

  return {
    protocol: 'smb',
    async createSession(
      profile: NetworkSourceProfile,
      auth: NetworkAuth
    ): Promise<NetworkSourceSession> {
      if (platform !== 'win32' && platform !== 'linux') {
        throw new NetworkSourceFailure('unsupportedProtocol', '当前系统不支持 SMB 系统挂载')
      }
      if (platform === 'linux' && auth.kind === 'password') {
        throw new NetworkSourceFailure(
          'auth',
          'Linux 系统挂载仅支持匿名或已缓存凭据，请先在文件管理器连接该共享'
        )
      }

      const localMap = deps?.localMap
        ? (remotePath: string) => deps.localMap!(platform === 'win32' ? uncFor(profile) : gioUri(profile), remotePath)
        : defaultLocalMap(profile)

      let mounted = false

      async function ensureMounted(): Promise<void> {
        if (mounted) return
        if (platform === 'win32') {
          const unc = uncFor(profile)
          const password = auth.kind === 'password' ? auth.password : ''
          const user = auth.kind === 'password' ? auth.username ?? profile.username ?? 'guest' : 'guest'
          const result = await runCommand('net', ['use', unc, password, `/user:${user}`])
          throwForMountResult(result, '挂载')
        } else {
          const result = await runCommand('gio', ['mount', gioUri(profile)])
          throwForMountResult(result, '挂载')
        }
        mounted = true
      }

      function toEntry(remotePath: string, isDirectory: boolean, size: number): NetworkEntry {
        const path = normalizeRemotePath(remotePath)
        const name = path === '/' ? '/' : path.split('/').pop() ?? path
        return {
          id: buildNetworkEntryId(profile.protocol, profile.id, path),
          profileId: profile.id,
          name,
          kind: entryKind(name, { directory: isDirectory }),
          path,
          sizeBytes: isDirectory ? undefined : size
        }
      }

      return {
        protocol: profile.protocol,
        async list(remotePath: string): Promise<NetworkEntry[]> {
          await ensureMounted()
          const parent = normalizeRemotePath(remotePath)
          const local = localMap(parent)
          let dirents
          try {
            dirents = await readdir(local, { withFileTypes: true })
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              throw new NetworkSourceFailure('notFound', '远程路径不存在')
            }
            throw new NetworkSourceFailure('network', `SMB 列目录失败：${(err as Error).message}`)
          }
          const entries: NetworkEntry[] = []
          for (const dirent of dirents) {
            const childPath = parent === '/' ? `/${dirent.name}` : `${parent}/${dirent.name}`
            const size = dirent.isDirectory()
              ? undefined
              : (await stat(localMap(childPath)).catch(() => undefined))?.size
            entries.push(toEntry(childPath, dirent.isDirectory(), size ?? 0))
          }
          return entries
        },
        async stat(remotePath: string): Promise<NetworkEntry | null> {
          await ensureMounted()
          const path = normalizeRemotePath(remotePath)
          try {
            const info = await stat(localMap(path))
            return toEntry(path, info.isDirectory(), info.size)
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              throw new NetworkSourceFailure('notFound', '远程路径不存在')
            }
            throw new NetworkSourceFailure('network', `SMB stat 失败：${(err as Error).message}`)
          }
        },
        async readStream(remotePath: string): Promise<NodeJS.ReadableStream> {
          await ensureMounted()
          return createReadStream(localMap(normalizeRemotePath(remotePath)))
        },
        async resolvePlaybackUrl(): Promise<string | null> {
          return null
        },
        async close(): Promise<void> {
          if (!mounted) return
          if (platform === 'win32') {
            await runCommand('net', ['use', uncFor(profile), '/delete', '/y']).catch(() => undefined)
          } else {
            await runCommand('gio', ['mount', '-u', gioUri(profile)]).catch(() => undefined)
          }
          mounted = false
        }
      }
    }
  }
}

async function defaultRunCommand(command: string, args: string[]): Promise<MountCommandResult> {
  const { execFile } = await import('node:child_process')
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          code: typeof error === 'object' && error !== null ? (error as { code?: number }).code ?? 1 : 0
        })
      }
    )
  })
}
