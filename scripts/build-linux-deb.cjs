/**
 * Deterministic .deb builder for Linux (no fpm/Ruby required).
 *
 * electron-builder's deb target shells out to its bundled fpm (portable Ruby),
 * which needs legacy libcrypt.so.1 that is absent on modern Arch (libxcrypt
 * only ships libcrypt.so.2). This script assembles the .deb directly from the
 * electron-builder linux-unpacked output with ar/tar/xz so the same artifact
 * can be produced on any Linux host.
 *
 * Usage: node scripts/build-linux-deb.cjs
 * Requires: dist/linux-unpacked (electron-builder --linux AppImage tar.gz),
 *           ar (binutils), tar, xz.
 */
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const distDir = path.join(root, 'dist')
const unpacked = path.join(distDir, 'linux-unpacked')
const name = 'twilight-echo'
const product = 'TwilightEcho'
const version = pkg.version
const arch = 'amd64'
const appDir = `/opt/${product}`

const DEPENDS = [
  'libc6', 'libstdc++6', 'libasound2', 'libatomic1', 'libxml2', 'libbz2-1.0',
  'libz1', 'liblzma5', 'libgmp10',
  // Audio engine is built against system FFmpeg 8.x sonames.
  'libavformat62', 'libavcodec62', 'libavutil60', 'libswresample6', 'libebur128-1',
  // Electron runtime deps (mirrors electron-builder auto-detection).
  'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
  'libatspi2.0-0', 'libuuid1', 'libsecret-1-0'
]

function run(args, cwd) {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`command failed (${args[0]}): ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function copy(src, dest, isDir) {
  if (isDir) {
    fs.cpSync(src, dest, { recursive: true, force: true })
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

function deterministicTar(srcDir, outFile, prefix) {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const abs = path.join(dir, entry.name)
      const rel = path.relative(srcDir, abs)
      files.push({ abs, rel, dir: entry.isDirectory(), symlink: entry.isSymbolicLink() })
      if (entry.isDirectory()) walk(abs)
    }
  }
  walk(srcDir)
  // Build a tar listing deterministically; tar reads file list from stdin.
  const list = files
    .map((f) => {
      const arc = (prefix ? `${prefix}/` : '') + f.rel.replaceAll('\\', '/')
      return arc
    })
    .join('\n')
  // tar --no-recursion --owner=0 --group=0 --mtime='@0' with files from list
  const args = [
    'tar', '-cJf', outFile,
    '--no-recursion',
    '--owner=0', '--group=0',
    '--numeric-owner',
    '--mtime=@0',
    '--files-from', '-'
  ]
  const result = spawnSync(args[0], args.slice(1), {
    cwd: srcDir,
    input: list,
    encoding: 'utf8'
  })
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`)
}

function main() {
  if (!fs.existsSync(path.join(unpacked, 'twilightecho'))) {
    throw new Error(
      `dist/linux-unpacked not found at ${unpacked}. Run 'pnpm run build:linux' first.`
    )
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'te-deb-'))
  const dataRoot = path.join(work, 'data')
  const payload = path.join(dataRoot, appDir.replace(/^\//, ''))
  const debianDir = path.join(work, 'DEBIAN')
  try {
    // 1. Payload from linux-unpacked.
    fs.mkdirSync(payload, { recursive: true })
    for (const entry of fs.readdirSync(unpacked, { withFileTypes: true })) {
      copy(
        path.join(unpacked, entry.name),
        path.join(payload, entry.name),
        entry.isDirectory()
      )
    }
    // 2. usr/bin symlink, desktop entry, icon.
    const usrBin = path.join(dataRoot, 'usr/bin')
    fs.mkdirSync(usrBin, { recursive: true })
    fs.symlinkSync(`${appDir}/twilightecho`, path.join(usrBin, name))
    const desktopDir = path.join(dataRoot, 'usr/share/applications')
    fs.mkdirSync(desktopDir, { recursive: true })
    fs.writeFileSync(
      path.join(desktopDir, `${name}.desktop`),
      `[Desktop Entry]
Name=Twilight Echo
Name[zh_CN]=暮光回声
Comment=Local and streaming music player with lyrics and DSP
Exec=${appDir}/twilightecho %U
Icon=${name}
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Player;
StartupWMClass=TwilightEcho
`
    )
    const iconDir = path.join(dataRoot, 'usr/share/icons/hicolor/512x512/apps')
    fs.mkdirSync(iconDir, { recursive: true })
    fs.copyFileSync(path.join(root, 'build/icon.png'), path.join(iconDir, `${name}.png`))

    // 3. md5sums + control.
    fs.mkdirSync(debianDir, { recursive: true })
    const md5 = []
    const walkData = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      )) {
        const abs = path.join(dir, entry.name)
        const rel = path.relative(dataRoot, abs).replaceAll('\\', '/')
        if (entry.isDirectory()) {
          walkData(abs)
        } else if (entry.isSymbolicLink()) {
          // symlinks are not checksummed
        } else {
          md5.push(`${createHash('md5').update(fs.readFileSync(abs)).digest('hex')}  ${rel}`)
        }
      }
    }
    walkData(dataRoot)
    fs.writeFileSync(path.join(debianDir, 'md5sums'), md5.join('\n') + '\n')

    const installedKb = Math.floor(
      (function size(dir) {
        let total = 0
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name)
          if (entry.isDirectory()) total += size(abs)
          else if (!entry.isSymbolicLink()) total += fs.statSync(abs).size
        }
        return total
      })(dataRoot) / 1024
    )
    fs.writeFileSync(
      path.join(debianDir, 'control'),
      `Package: ${name}
Version: ${version}
Section: sound
Priority: optional
Architecture: ${arch}
Depends: ${DEPENDS.join(', ')}
Recommends: libappindicator3-1
Installed-Size: ${installedKb}
Maintainer: Twilight Echo Developers <dev@twilight-echo.app>
Description: Local and streaming music player with lyrics and DSP
 Twilight Echo is a cross-platform music player for local libraries and
 NetEase Cloud Music streaming, featuring synchronized and word-level
 lyrics, an integrated DSP rack / equalizer, and high-resolution audio
 playback (including DSD).
`
    )
    fs.writeFileSync(
      path.join(debianDir, 'postinst'),
      `#!/bin/sh
set -e
chown root:root ${appDir}/chrome-sandbox 2>/dev/null || true
chmod 4755 ${appDir}/chrome-sandbox 2>/dev/null || true
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi
exit 0
`
    )
    fs.writeFileSync(
      path.join(debianDir, 'postrm'),
      `#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi
exit 0
`
    )
    fs.chmodSync(path.join(debianDir, 'postinst'), 0o755)
    fs.chmodSync(path.join(debianDir, 'postrm'), 0o755)

    // 4. control.tar.xz + data.tar.xz.
    const controlTar = path.join(work, 'control.tar.xz')
    deterministicTar(debianDir, controlTar, '')
    const dataTar = path.join(work, 'data.tar.xz')
    deterministicTar(dataRoot, dataTar, '.')

    // 5. Assemble with ar.
    const wrap = path.join(work, 'wrap')
    fs.mkdirSync(wrap, { recursive: true })
    fs.writeFileSync(path.join(wrap, 'debian-binary'), '2.0\n')
    fs.copyFileSync(controlTar, path.join(wrap, 'control.tar.xz'))
    fs.copyFileSync(dataTar, path.join(wrap, 'data.tar.xz'))
    const deb = path.join(distDir, `${name}_${version}_${arch}.deb`)
    run(['ar', 'rcs', deb, 'debian-binary', 'control.tar.xz', 'data.tar.xz'], wrap)
    const sizeMiB = (fs.statSync(deb).size / 1024 / 1024).toFixed(1)
    console.log(`deb written: ${deb} (${sizeMiB} MiB)`)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

main()
