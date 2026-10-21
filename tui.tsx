import { Plugin } from "@opencode/plugin/tui"
import { NativeImage, type RGBA } from "@opentui/core"
import { readFileSync } from "node:fs"
import { Show, createSignal } from "solid-js"
import { createBgm, createPlayer, type Bgm, type Player } from "./src/audio"
import { MUSIC_DIR, PET_IMAGE, SFX, loadMusic, loadPetVoices, loadStatusTexts, type SfxName } from "./src/assets"

const GOLD = "#d8b45f"
const TARKOV_DIM = "#8b8577"

/** Minimal shape of the TUI theme we read colors from. */
interface TarkovTheme {
  background?: { base?: RGBA }
  text?: { muted?: RGBA; base?: RGBA }
}

const ALTYN_ART = [
  "  ▄▄▄▄▄  ",
  " █ ▄ ▄ █ ",
  " █  ▽  █ ",
  "  ▀▀▀▀▀  ",
].join("\n")

const PET_LINES = [
  "别开枪，我是 scav。",
  "Cheeki breeki!",
  "看见了吗？那边有动静。",
  "装备不错，可惜是我的了。",
  "该撤离了，朋友。",
  "你听见枪声了吗？",
  "再搜一个箱子就走。",
]

const SFX_LABELS: Record<SfxName, string> = {
  done: "完成",
  approval: "等待确认",
  error: "失败 / 中断",
  tool_error: "工具调用失败",
}

/**
 * Shared across plugin generations: OpenCode can keep an older TUI plugin
 * instance alive during hot reload, and both instances would otherwise play
 * the same completion sound.
 */
interface SoundDedupe {
  events: Set<string>
  lastTurn: Map<string, number>
}

const DEDUPE_KEY = Symbol.for("opencode-tarkov.sound-dedupe")

function parseColor(value: string | RGBA): [number, number, number] | null {
  if (typeof value !== "string") {
    const [r, g, b] = value.toInts()
    return [r, g, b]
  }
  const hex = value.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(hex)
  if (short) {
    return [parseInt(short[1][0] + short[1][0], 16), parseInt(short[1][1] + short[1][1], 16), parseInt(short[1][2] + short[1][2], 16)]
  }
  const long = /^#([0-9a-f]{6})/i.exec(hex)
  if (long) {
    return [parseInt(long[1].slice(0, 2), 16), parseInt(long[1].slice(2, 4), 16), parseInt(long[1].slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(hex)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

/**
 * Terminals without alpha support paint transparent PNG pixels black, which
 * makes the pet a solid black card. Flatten the alpha channel onto the current
 * theme background instead, so the image blends into the interface.
 */
function petImageOnBackground(path: string, background: string | RGBA): NativeImage | string {
  try {
    const color = parseColor(background) ?? [26, 26, 26]
    const image = NativeImage.decode(new Uint8Array(readFileSync(path)))
    const raw = image.raw("rgba8")
    const pixels = new Uint8Array(raw.data)
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) {
        pixels[i] = color[0]
        pixels[i + 1] = color[1]
        pixels[i + 2] = color[2]
        pixels[i + 3] = 255
      }
    }
    const flattened = NativeImage.fromRgba(pixels, raw.width, raw.height, raw.stride)
    image.dispose()
    return flattened
  } catch {
    return path
  }
}

function soundDedupe(): SoundDedupe {
  const holder = globalThis as unknown as Record<symbol, SoundDedupe | undefined>
  holder[DEDUPE_KEY] ??= { events: new Set(), lastTurn: new Map() }
  return holder[DEDUPE_KEY]!
}

export default Plugin.define({
  id: "tarkov-theme.tui",
  setup(context) {
    const [prefs, updatePrefs] = context.storage.store("tarkov-theme.prefs", {
      initial: {
        sounds: true,
        banner: true,
        status: true,
        pet: true,
        petImage: false,
        volume: 70,
        bgmVolume: 60,
        bgm: false,
      },
    })

    const player: Player = createPlayer(() => prefs.volume)
    const bgm: Bgm = createBgm(() => prefs.bgmVolume)
    const warmupTimer = setTimeout(() => player.warmup(), 1500)
    const texts = loadStatusTexts()
    const voices = loadPetVoices()
    const petImageSource = petImageOnBackground(PET_IMAGE, (context.theme as TarkovTheme)?.background?.base ?? "#1a1a1a")

    const [step, setStep] = createSignal(0)
    const [live, setLive] = createSignal<Record<string, boolean>>({})

    const muted = () => {
      const theme = context.theme as TarkovTheme
      return theme?.text?.muted ?? TARKOV_DIM
    }
    const base = () => {
      const theme = context.theme as TarkovTheme
      return theme?.text?.base ?? "#dddddd"
    }

    const dedupe = soundDedupe()

    function isChildSession(sessionID: string): boolean {
      try {
        if (context.data.session.root(sessionID) !== sessionID) return true
        return Boolean(context.data.session.get(sessionID)?.parentID)
      } catch {
        return false
      }
    }

    /** Event ids are unique, so a reconnecting stream cannot replay a sound. */
    function firstTime(event: { id: string }): boolean {
      if (dedupe.events.has(event.id)) return false
      dedupe.events.add(event.id)
      if (dedupe.events.size > 2000) dedupe.events.clear()
      return true
    }

    function isRunning(sessionID: string | undefined): boolean {
      if (!sessionID) return false
      if (live()[sessionID]) return true
      try {
        return context.data.session.status(sessionID) === "running"
      } catch {
        return false
      }
    }

    let lastPlayed = 0
    function play(name: SfxName) {
      if (!prefs.sounds) return
      const now = Date.now()
      // Tool failures are intentionally not folded: every failed call gets a sound.
      if (name !== "tool_error" && now - lastPlayed < 600) return
      lastPlayed = now
      player.play(SFX[name], prefs.volume)
    }

    /** One completion/error sound per session per turn, even if the server emits duplicates. */
    function playTurn(name: SfxName, sessionID: string) {
      const now = Date.now()
      if (now - (dedupe.lastTurn.get(sessionID) ?? 0) < 1500) return
      dedupe.lastTurn.set(sessionID, now)
      // Cap the map like the events set: session IDs can accumulate across a
      // long-lived (hot-reloaded) plugin instance.
      if (dedupe.lastTurn.size > 2000) {
        const cutoff = now - 1500
        for (const [id, ts] of dedupe.lastTurn) {
          if (ts < cutoff) dedupe.lastTurn.delete(id)
        }
      }
      play(name)
    }

    function mark(sessionID: string, running: boolean) {
      setLive((current) => ({ ...current, [sessionID]: running }))
      if (running) setStep((value) => value + 1)
    }

    const offs: Array<() => void> = []

    offs.push(
      context.data.on("session.execution.started", (event) => {
        if (!firstTime(event) || isChildSession(event.data.sessionID)) return
        mark(event.data.sessionID, true)
      }),
      context.data.on("session.execution.succeeded", (event) => {
        if (!firstTime(event) || isChildSession(event.data.sessionID)) return
        mark(event.data.sessionID, false)
        playTurn("done", event.data.sessionID)
      }),
      context.data.on("session.execution.failed", (event) => {
        if (!firstTime(event) || isChildSession(event.data.sessionID)) return
        mark(event.data.sessionID, false)
        playTurn("error", event.data.sessionID)
      }),
      context.data.on("session.execution.interrupted", (event) => {
        if (!firstTime(event) || isChildSession(event.data.sessionID)) return
        mark(event.data.sessionID, false)
        playTurn("error", event.data.sessionID)
      }),
      context.data.on("permission.asked", (event) => {
        if (!firstTime(event) || isChildSession(event.data.sessionID)) return
        play("approval")
      }),
      context.data.on("session.tool.failed", (event) => {
        if (!firstTime(event) || isChildSession(event.data.sessionID)) return
        play("tool_error")
      }),
      context.data.on("session.step.ended", (event) => {
        if (!firstTime(event) || isChildSession(event.data.sessionID)) return
        setStep((value) => value + 1)
      }),
      context.data.on("session.step.failed", (event) => {
        if (!firstTime(event) || isChildSession(event.data.sessionID)) return
        setStep((value) => value + 1)
      }),
    )

    function currentStatusText(): string {
      if (!texts.length) return ""
      return texts[step() % texts.length]
    }

    const statusSlot = context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => (
        <Show when={prefs.status && isRunning(input.sessionID)}>
          <text fg={muted()}>◆ {currentStatusText()}</text>
        </Show>
      ),
    })

    const bannerSlot = context.ui.slot({
      append: "session.composer.top",
      render: () => (
        <Show when={prefs.banner}>
          <box flexDirection="row" height={1}>
            <box backgroundColor={GOLD}>
              <text fg="#121212"> BETA </text>
            </box>
            <text fg={GOLD}> 塔科夫主题 · 这不是最终产品，存档可能被清除 </text>
          </box>
        </Show>
      ),
    })

    const homeBannerSlot = context.ui.slot({
      before: "home.footer",
      render: () => (
        <Show when={prefs.banner}>
          <box flexDirection="column" flexShrink={0} paddingLeft={1}>
            <box flexDirection="row" gap={1}>
              <text fg={GOLD}>ESCAPE FROM TARKOV</text>
              <text fg={TARKOV_DIM}>// OPENCODE</text>
            </box>
            <box flexDirection="row">
              <box backgroundColor={GOLD}>
                <text fg="#121212"> BETA </text>
              </box>
              <text fg={GOLD}> 这不是最终产品，存档可能被清除 </text>
            </box>
          </box>
        </Show>
      ),
    })

    let rightHeld = false

    const petSlot = context.ui.slot({
      append: "sidebar.footer",
      render: () => (
        <Show when={prefs.pet}>
          <box
            flexDirection="column"
            onMouseDown={(event) => {
              if (event.button === 0) {
                event.stopPropagation()
                speak()
              } else if (event.button === 2) {
                // Open on release: the dialog treats the release as an outside
                // click when it is opened on press, which closes it immediately.
                event.stopPropagation()
                event.preventDefault()
                rightHeld = true
              }
            }}
            onMouseUp={(event) => {
              if (event.button !== 2) return
              event.stopPropagation()
              event.preventDefault()
              if (!rightHeld) return
              rightHeld = false
              void openSettings()
            }}
          >
            <Show when={prefs.petImage} fallback={<text fg={GOLD}>{ALTYN_ART}</text>}>
              <image source={petImageSource} width={16} height={12} />
            </Show>
            <text fg={muted()}>“{PET_LINES[step() % PET_LINES.length]}”</text>
          </box>
        </Show>
      ),
    })

    function speak() {
      if (!voices.length) {
        context.ui.toast.show({ message: "语音目录里没有音频文件", variant: "warning" })
        return
      }
      const file = voices[Math.floor(Math.random() * voices.length)]
      player.play(file, prefs.volume)
      context.ui.toast.show({ message: "Altyn：Cheeki breeki!", variant: "info", duration: 2000 })
    }

    async function pickSfx(): Promise<void> {
      const choice = (await context.ui.dialog.select({
        title: "试听提示音",
        options: (Object.keys(SFX) as SfxName[]).map((name) => ({
          title: SFX_LABELS[name],
          value: name,
        })),
      })) as SfxName | undefined
      if (!choice) return
      lastPlayed = 0
      player.play(SFX[choice], prefs.volume)
    }

    async function openBgm(): Promise<void> {
      const tracks = loadMusic()
      if (!tracks.length) {
        context.ui.toast.show({
          title: "背景音乐",
          message: `把 mp3 / m4a / ogg / wav 放进插件目录的 ${MUSIC_DIR} 再试`,
          variant: "info",
          duration: 5000,
        })
        return
      }
      const choice = (await context.ui.dialog.select({
        title: "背景音乐",
        options: [
          { title: "停止播放", value: "__stop__" },
          ...tracks.map((file) => ({
            title: file.split(/[\\/]/).pop() ?? file,
            value: file,
          })),
        ],
      })) as string | undefined
      if (!choice) return
      if (choice === "__stop__") {
        bgm.stop()
        await updatePrefs((draft) => {
          draft.bgm = false
        })
        return
      }
      bgm.play(choice)
      await updatePrefs((draft) => {
        draft.bgm = true
      })
    }

    function openVolumeSlider(
      title: string,
      initial: number,
      onSave: (value: number) => Promise<void> | void,
    ): Promise<void> {
      return new Promise((resolve) => {
        const [value, setValue] = createSignal(initial)
        let done = false

        const finish = async (save: boolean) => {
          if (done) return
          done = true
          if (save) await onSave(value())
          context.ui.dialog.clear()
          resolve()
        }

        context.ui.dialog.set({ centered: true })
        context.ui.dialog.show(() => {
          context.keymap.layer(() => ({
            mode: "global",
            priority: 100,
            commands: [
              {
                id: "tarkov.volume.left",
                bind: "left",
                run: () => {
                  setValue((current) => Math.max(0, current - 1))
                },
              },
              {
                id: "tarkov.volume.right",
                bind: "right",
                run: () => {
                  setValue((current) => Math.min(100, current + 1))
                },
              },
              {
                id: "tarkov.volume.left5",
                bind: "shift+left",
                run: () => {
                  setValue((current) => Math.max(0, current - 5))
                },
              },
              {
                id: "tarkov.volume.right5",
                bind: "shift+right",
                run: () => {
                  setValue((current) => Math.min(100, current + 5))
                },
              },
              {
                id: "tarkov.volume.save",
                bind: "return",
                run: () => void finish(true),
              },
              {
                id: "tarkov.volume.cancel",
                bind: "escape",
                run: () => void finish(false),
              },
            ],
            bindings: [
              "tarkov.volume.left",
              "tarkov.volume.right",
              "tarkov.volume.left5",
              "tarkov.volume.right5",
              "tarkov.volume.save",
              "tarkov.volume.cancel",
            ],
          }))

          const filled = () => Math.round((value() / 100) * 28)
          return (
            <box flexDirection="column" padding={1} gap={1}>
              <text fg={base()}>{title}</text>
              <text fg={GOLD}>
                {`${"█".repeat(filled())}${"░".repeat(28 - filled())} ${String(value()).padStart(3, " ")}%`}
              </text>
              <text fg={muted()}>←/→ 1% · Shift+←/→ 5% · Enter 保存 · Esc 取消</text>
            </box>
          )
        })
      })
    }

    async function openSettings(): Promise<void> {
      while (true) {
        const choice = (await context.ui.dialog.select({
          title: "塔科夫主题 · 设置",
          options: [
            { title: `提示音：${prefs.sounds ? "开" : "关"}`, value: "sounds" },
            { title: `状态行随机文案：${prefs.status ? "开" : "关"}`, value: "status" },
            { title: `Beta 警告横幅：${prefs.banner ? "开" : "关"}`, value: "banner" },
            { title: `Altyn 桌宠：${prefs.pet ? "开" : "关"}`, value: "pet" },
            { title: `桌宠图片模式：${prefs.petImage ? "开" : "关"}（需终端支持图片协议）`, value: "petImage" },
            { title: `提示音与语音音量：${prefs.volume}%`, value: "volume" },
            { title: `背景音乐音量：${prefs.bgmVolume}%`, value: "bgmVolume" },
            { title: `背景音乐：${prefs.bgm && bgm.current() ? "播放中" : "关"}`, value: "bgm" },
            { title: "试听提示音", value: "test" },
            { title: "关闭", value: "close" },
          ],
        })) as string | undefined

        if (!choice || choice === "close") return

        if (choice === "sounds") {
          await updatePrefs((draft) => {
            draft.sounds = !draft.sounds
          })
          continue
        }
        if (choice === "status") {
          await updatePrefs((draft) => {
            draft.status = !draft.status
          })
          continue
        }
        if (choice === "banner") {
          await updatePrefs((draft) => {
            draft.banner = !draft.banner
          })
          continue
        }
        if (choice === "pet") {
          await updatePrefs((draft) => {
            draft.pet = !draft.pet
          })
          continue
        }
        if (choice === "petImage") {
          await updatePrefs((draft) => {
            draft.petImage = !draft.petImage
          })
          continue
        }
        if (choice === "volume") {
          await openVolumeSlider("提示音与语音音量", prefs.volume, async (value) => {
            await updatePrefs((draft) => {
              draft.volume = value
            })
            player.play(SFX.approval, value)
          })
          continue
        }
        if (choice === "bgmVolume") {
          await openVolumeSlider("背景音乐音量", prefs.bgmVolume, async (value) => {
            await updatePrefs((draft) => {
              draft.bgmVolume = value
            })
            const current = bgm.current()
            if (current) bgm.play(current)
          })
          continue
        }
        if (choice === "bgm") {
          await openBgm()
          continue
        }
        if (choice === "test") {
          await pickSfx()
          continue
        }
      }
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "tarkov.settings",
          title: "塔科夫主题设置",
          group: "Tarkov",
          palette: true,
          slash: { name: "tarkov" },
          run: () => void openSettings(),
        },
        {
          id: "tarkov.pet",
          title: "Altyn 说句话",
          group: "Tarkov",
          slash: { name: "tarkov-pet" },
          run: () => speak(),
        },
        {
          id: "tarkov.bgm",
          title: "塔科夫背景音乐",
          group: "Tarkov",
          slash: { name: "tarkov-bgm" },
          run: () => void openBgm(),
        },
      ],
    }))

    if (prefs.bgm) {
      const tracks = loadMusic()
      if (tracks.length) bgm.play(tracks[0])
    }

    return () => {
      clearTimeout(warmupTimer)
      for (const off of offs) off()
      statusSlot()
      bannerSlot()
      homeBannerSlot()
      petSlot()
      player.dispose()
      bgm.stop()
      if (typeof petImageSource !== "string") petImageSource.dispose()
    }
  },
})
