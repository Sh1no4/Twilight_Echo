# Twilight Echo — AUR package

PKGBUILD 引用 GitHub Release 的通用 Linux tar.gz 产物（Electron 应用，
音频引擎为系统 FFmpeg 动态链接，因此 `depends` 包含 ffmpeg 及引擎所需库）。

## 发布流程

1. 先把 `dist/TwilightEcho-<ver>.tar.gz` 上传到 GitHub Release
   `v<ver>`（文件名必须与 PKGBUILD 中 `source` 一致）。
2. 若产物变了，重新计算校验和并更新 PKGBUILD / .SRCINFO：
   ```bash
   sha256sum TwilightEcho-<ver>.tar.gz
   ```
3. 本地验证（可选）：
   ```bash
   makepkg -f
   ```
4. 推送到 AUR：
   ```bash
   git clone ssh://aur@aur.archlinux.org/twilight-echo.git /tmp/twilight-echo-aur
   cp PKGBUILD .SRCINFO README.md /tmp/twilight-echo-aur/
   cd /tmp/twilight-echo-aur
   git add PKGBUILD .SRCINFO README.md
   git commit -m "bump to <ver>"
   git push origin master
   ```

注意：`sha256sums` 必须与 Release 上的实际文件一致，否则 AUR 构建会校验失败。
