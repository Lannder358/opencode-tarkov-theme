import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"

export interface Player {
  play(file: string, volume?: number): void
  stop(): void
  dispose(): void
  /** Start the backend ahead of the first sound so playback has no startup latency. */
  warmup(): void
}

export interface Bgm {
  play(file: string): void
  stop(): void
  current(): string | null
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64")
}

function base64Path(path: string): string {
  return Buffer.from(path, "utf8").toString("base64")
}

/**
 * Shared bootstrap for Windows WinRT MediaPlayer scripts. Produces the
 * PowerShell preamble that creates `$p` (and `$sourceType`), sets the initial
 * volume, then runs `setup` inside the same try block. On failure it prints
 * FAIL and exits so the Node side can react. Used by both the sound player
 * and the BGM loop, which otherwise duplicated this preamble.
 */
function winRtBootstrap(volume: number, setup: string): string {
  const level = (Math.max(0, Math.min(100, Math.round(volume))) / 100).toFixed(2)
  return `
$ErrorActionPreference = 'SilentlyContinue'
try {
  $playerType = [Windows.Media.Playback.MediaPlayer, Windows.Media, ContentType=WindowsRuntime]
  $sourceType = [Windows.Media.Core.MediaSource, Windows.Media, ContentType=WindowsRuntime]
  $p = [Activator]::CreateInstance($playerType)
  if ($null -eq $p) { throw 'create failed' }
  $p.Volume = ${level}
${setup}
} catch { [Console]::Out.WriteLine('FAIL'); exit 1 }
`
}

/**
 * Windows: one long-lived PowerShell process hosting a WinRT MediaPlayer.
 * WMPlayer.OCX stalls at "opening" without a message pump, while MediaPlayer
 * plays m4a/mp3 through Media Foundation and needs no extra dependency.
 * Paths travel over stdin, base64 encoded, which avoids quoting and code-page
 * problems with non-ASCII paths.
 */
function windowsPlayer(getVolume: () => number): Player {
  let proc: ChildProcess | null = null
  let ready = false
  let broken = false
  let queue: Array<{ file: string; volume: number }> = []

  const script = winRtBootstrap(getVolume(), `
  [Console]::Out.WriteLine('READY')
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq 'Q') { break }
    if ($line -eq 'STOP') { $p.Pause(); continue }
    if ($line.StartsWith('V:')) { $p.Volume = [double]([int]$line.Substring(2)) / 100.0; continue }
    try {
      $path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))
      $p.Source = $sourceType::CreateFromUri([Uri]::new($path))
      $p.Play()
    } catch {}
  }
  try { $p.Dispose() } catch {}
`)

  function write(line: string) {
    try {
      proc?.stdin?.write(line + "\n")
    } catch {
      // process already gone
    }
  }

  function send(file: string) {
    if (!existsSync(file)) return
    write(base64Path(file))
  }

  function start() {
    if (broken || proc) return
    try {
      proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      })
    } catch {
      broken = true
      return
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.includes("READY")) {
        ready = true
        write("V:" + Math.max(0, Math.min(100, Math.round(getVolume()))))
        const pending = queue
        queue = []
        for (const item of pending) {
          write("V:" + Math.max(0, Math.min(100, Math.round(item.volume))))
          send(item.file)
        }
      } else if (text.includes("FAIL")) {
        broken = true
        ready = false
        proc?.kill()
        proc = null
      }
    })

    proc.on("error", () => {
      broken = true
      ready = false
      proc = null
    })
    proc.on("exit", () => {
      ready = false
      proc = null
    })
  }

  return {
    play(file, volume) {
      if (broken) return
      const level = Math.max(0, Math.min(100, Math.round(volume ?? getVolume())))
      start()
      if (ready) {
        write("V:" + level)
        send(file)
      } else {
        queue.push({ file, volume: level })
      }
    },
    warmup() {
      if (!broken) start()
    },
    stop() {
      write("STOP")
    },
    dispose() {
      write("Q")
      proc?.kill()
      proc = null
      ready = false
    },
  }
}

function commandFor(platform: NodeJS.Platform): { cmd: string; args: (file: string, volume: number) => string[] } | null {
  if (platform === "darwin") {
    return {
      cmd: "afplay",
      args: (file, volume) => ["-v", String(Math.round((volume / 100) * 255)), file],
    }
  }
  if (platform === "linux") {
    const candidates: { cmd: string; args: (file: string, volume: number) => string[] }[] = [
      {
        cmd: "ffplay",
        args: (file, volume) => ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", String(volume), file],
      },
      {
        cmd: "mpv",
        args: (file, volume) => ["--really-quiet", "--no-video", "--volume=" + volume, file],
      },
      {
        cmd: "cvlc",
        args: (file) => ["--play-and-exit", "--quiet", file],
      },
    ]
    return candidates.find((candidate) => spawnSync("which", [candidate.cmd]).status === 0) ?? null
  }
  return null
}

function commandPlayer(getVolume: () => number): Player {
  const backend = commandFor(process.platform)
  let current: ChildProcess | null = null
  return {
    play(file, volume) {
      if (!backend || !existsSync(file)) return
      try {
        current?.kill()
        current = spawn(backend.cmd, backend.args(file, volume ?? getVolume()), { stdio: "ignore" })
      } catch {
        current = null
      }
    },
    warmup() {
      // Command backends have no persistent process to start.
    },
    stop() {
      current?.kill()
      current = null
    },
    dispose() {
      current?.kill()
      current = null
    },
  }
}

export function createPlayer(getVolume: () => number): Player {
  if (process.platform === "win32") return windowsPlayer(getVolume)
  return commandPlayer(getVolume)
}

/**
 * Background music. Windows uses a dedicated WinRT MediaPlayer with looping
 * enabled; macOS loops afplay in a shell; Linux uses ffplay/mpv when available.
 */
export function createBgm(getVolume: () => number): Bgm {
  let proc: ChildProcess | null = null
  let track: string | null = null
  // Probe the Linux playback backend once instead of on every play().
  const linuxBackend = process.platform === "linux" ? commandFor("linux") : null

  function stop() {
    if (proc) {
      try {
        // macOS: kill the whole process group so the looping afplay child is
        // not left running as an orphan after the sh wrapper dies.
        if (process.platform === "darwin" && proc.pid) {
          process.kill(-proc.pid, "SIGTERM")
        } else {
          proc.kill()
        }
      } catch {
        // already gone
      }
    }
    proc = null
    track = null
  }

  function play(file: string) {
    stop()
    if (!existsSync(file)) return
    track = file
    try {
      if (process.platform === "win32") {
        const script = `
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Path(file)}'))
` + winRtBootstrap(getVolume(), `
  $p.IsLoopingEnabled = $true
  $p.Source = $sourceType::CreateFromUri([Uri]::new($path))
  $p.Play()
  while ($true) { Start-Sleep -Seconds 1 }
`)
        proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)], {
          windowsHide: true,
          stdio: "ignore",
        })
        return
      }

      if (process.platform === "darwin") {
        const volume = Math.round((getVolume() / 100) * 255)
        proc = spawn("sh", ["-c", 'while true; do afplay -v "$1" "$2"; done', "bgm", String(volume), file], {
          stdio: "ignore",
          // Detached so stop() can signal the whole process group and take the
          // looping afplay child down with it.
          detached: true,
        })
        return
      }

      const backend = linuxBackend
      if (!backend) {
        track = null
        return
      }
      const args =
        backend.cmd === "ffplay"
          ? ["-nodisp", "-loop", "0", "-loglevel", "quiet", file]
          : backend.cmd === "mpv"
            ? ["--really-quiet", "--no-video", "--loop=inf", file]
            : ["--loop", "--quiet", file]
      proc = spawn(backend.cmd, args, { stdio: "ignore" })
    } catch {
      proc = null
      track = null
    }
  }

  return { play, stop, current: () => track }
}
