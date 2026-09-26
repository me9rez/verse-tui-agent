/**
 * Windows 剪贴板图片读取（Alt+V 贴图的数据源）。
 *
 * 实测依据（2026-09-26）：PowerShell `Get-Clipboard -Format Image` 拿到
 * System.Drawing.Bitmap，转 PNG 后 base64 单行输出；无图时约定输出 NO-IMAGE。
 * 子进程约束遵循仓库已知坑：windowsHide + maxBuffer 上限 + timeout 兜底，
 * 绝不无上限等 stdout。非 Windows（找不到 powershell.exe）静默返回 null。
 */
import { execFile } from 'node:child_process'

const PS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  '$img = [Windows.Forms.Clipboard]::GetImage();',
  'if ($img) {',
  '$ms = New-Object System.IO.MemoryStream;',
  '$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);',
  "[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))",
  "} else { [Console]::Out.Write('NO-IMAGE') }",
].join(' ')

export type ClipboardImage = { media_type: 'image/png'; data: string; bytes: number }

/** 读剪贴板图片；无图 / 失败 / 非 Windows → null（调用方给提示，不抛错）。 */
export function readClipboardImage(): Promise<ClipboardImage | null> {
  return new Promise((resolve) => {
    const done = (v: ClipboardImage | null): void => resolve(v)
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
        { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 10_000 },
        (err, stdout) => {
          if (err) return done(null)
          const out = String(stdout).trim()
          if (!out || out === 'NO-IMAGE') return done(null)
          // bytes = 解码后大小：base64 每 4 字符承载 3 字节
          done({ media_type: 'image/png', data: out, bytes: Math.floor((out.length * 3) / 4) })
        },
      )
    } catch {
      done(null)
    }
  })
}
