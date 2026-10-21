import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** Plugin root, resolved from this file's location. */
export const ROOT = fileURLToPath(new URL("../", import.meta.url))
export const ASSETS = join(ROOT, "assets")

/**
 * Every asset lives inside the plugin directory, so copying the directory is
 * enough to install it and deleting the directory removes it completely.
 */
export const MUSIC_DIR = join(ASSETS, "music")
export const VOICE_DIR = join(ASSETS, "pet", "voice")
export const STATUS_POOL = join(ASSETS, "status", "texts.zh.txt")

export const SFX = {
  done: join(ASSETS, "sfx", "done.m4a"),
  approval: join(ASSETS, "sfx", "approval.m4a"),
  error: join(ASSETS, "sfx", "error.m4a"),
  tool_error: join(ASSETS, "sfx", "tool_error.m4a"),
} as const

export type SfxName = keyof typeof SFX

export const PET_IMAGE = join(ASSETS, "pet", "altyn.png")

const FALLBACK_TEXTS = [
  "正在搜索板条箱...",
  "正在检查弹匣...",
  "正在前往撤离点...",
  "正在寻找加密 U 盘...",
  "正在标记油罐车...",
  "等待电梯到达...",
]

function parsePool(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith("#")) continue
    if (seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

/** Status-line pool bundled with the plugin: assets/status/texts.zh.txt. */
export function loadStatusTexts(): string[] {
  try {
    if (existsSync(STATUS_POOL)) {
      const pool = parsePool(readFileSync(STATUS_POOL, "utf8"))
      if (pool.length) return pool
    }
  } catch {
    // fall through to the built-in fallback
  }
  return FALLBACK_TEXTS
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|wav|flac|opus)$/i

function listAudio(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && AUDIO_EXT.test(entry.name))
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch {
    return []
  }
}

/** Bundled Scav voice lines: assets/pet/voice. */
export function loadPetVoices(): string[] {
  return listAudio(VOICE_DIR)
}

/** Background music: assets/music. Cached; add files then restart OpenCode. */
let musicCache: string[] | null = null

export function loadMusic(): string[] {
  musicCache ??= listAudio(MUSIC_DIR)
  return musicCache
}
