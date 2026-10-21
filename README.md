# opencode-tarkov-theme

<img src="assets/icon.png" width="96" align="right" alt="Altyn">

以《逃离塔科夫》为灵感的 OpenCode 终端 UI 插件：事件提示音、Scav 语音、随机状态文案、Beta 警告横幅、Altyn 桌宠和背景音乐。

> 非官方社区插件，与 Battlestate Games、OpenCode 官方均无关联。
> 移植自 [dsh-theme-tarkov](https://github.com/ZHIGENGNIAO258/dsh-theme-tarkov)。

## 功能

| 功能 | 说明 |
| --- | --- |
| 提示音 | 会话完成、等待确认、失败/中断、工具调用失败时播放；工具失败每次都响，不按回合折叠 |
| Scav 语音 | 内置 361 条语音；点击桌宠或 `/tarkov-pet` 随机播放 |
| 状态行文案 | 运行时把状态行换成塔科夫风台词，每完成一步换一句 |
| Beta 横幅 | 首页和会话输入框上方显示 `ESCAPE FROM TARKOV // OPENCODE` 警示条 |
| Altyn 桌宠 | 侧栏底部 ASCII Altyn；支持左键说话、右键打开设置、可选图片模式 |
| 背景音乐 | 从插件内 `assets/music/` 循环播放，可与提示音分别调节音量 |
| 设置面板 | `/tarkov` 打开，所有开关和音量都在这里 |

## 环境要求

- OpenCode **V2**（`@opencode/plugin` >= 2.0.0；开发时使用 2.1.2）
- 支持鼠标事件的终端（桌宠点击、右键菜单需要）
- 图片模式额外要求终端支持 Kitty / iTerm2 / Sixel 图片协议；不支持时保持关闭即可

## 安装

### 方式一：下载后手动安装（推荐）

1. 下载本仓库的 ZIP，或克隆到本地
2. 把整个目录放到 OpenCode 的全局插件目录：

```text
~/.config/opencode/plugins/tarkov-theme/
```

Windows 对应：

```text
%USERPROFILE%\.config\opencode\plugins\tarkov-theme\
```

3. 重启 OpenCode

OpenCode 会自动发现 `plugins/` 下的插件目录，**不需要**修改 `opencode.jsonc`。

### 方式二：git clone

```bash
git clone https://github.com/Lannder358/opencode-tarkov-theme.git \
  ~/.config/opencode/plugins/tarkov-theme
```

### 方式三：npm（发布后可用）

```bash
opencode plugin add opencode-tarkov-theme
```

## 使用

### 命令

| 命令 | 作用 |
| --- | --- |
| `/tarkov` | 打开设置面板 |
| `/tarkov-pet` | Altyn 随机说一句 Scav 语音 |
| `/tarkov-bgm` | 选择或停止背景音乐 |

也可以按 `Ctrl+P` 打开命令面板，搜索 “Tarkov”。

### 桌宠

- **左键点击**：播放随机 Scav 语音
- **右键点击**：打开 `/tarkov` 设置
- 台词会随着对话步骤随机变化

### 设置项

| 设置 | 说明 |
| --- | --- |
| 提示音 | 所有事件音效的总开关 |
| 状态行随机文案 | 运行时状态行的塔科夫台词 |
| Beta 警告横幅 | 首页和会话页的警示条 |
| Altyn 桌宠 | 侧栏桌宠开关 |
| 桌宠图片模式 | 使用 `altyn.png` 代替 ASCII；需要终端图片协议 |
| 提示音与语音音量 | 提示音和 Scav 语音共用的滑块 |
| 背景音乐音量 | BGM 独立滑块 |
| 背景音乐 | 选择/停止曲目 |
| 试听提示音 | 分别试听四类音效 |

音量滑块操作：`←/→` 调整 1%，`Shift+←/→` 调整 5%，`Enter` 保存，`Esc` 取消。

## 资源目录

所有资源都在插件自己的 `assets/` 下，插件目录可以直接打包分享：

```text
assets/
├── sfx/                 # 四个提示音，替换同名文件即可
├── music/               # 背景音乐（mp3 / m4a / ogg / wav / flac）
├── pet/
│   ├── altyn.png        # 桌宠原图（图片模式）
│   └── voice/           # 361 条 Scav 语音
└── status/
    └── texts.zh.txt     # 状态行文案池，一行一句，# 开头为注释
```

添加或删除音乐后需要重开 OpenCode（曲目列表在启动时缓存）。

> 仓库默认不包含背景音乐（`.gitignore` 忽略 `assets/music/*`），避免分发受版权保护的音频。自行放入即可。

## 平台支持

- **Windows**：常驻 PowerShell + WinRT `MediaPlayer` 播放 m4a/mp3，无窗口、无需 ffmpeg
- **macOS**：使用 `afplay`
- **Linux**：自动探测 `ffplay`、`mpv` 或 `cvlc`，都没有时静默不播放

OGG/FLAC 在 Windows 上可能没有解码器支持，建议使用 m4a、mp3 或 wav。

## 与 DSH 原版的差异

| 原版（DSH Web UI） | 本插件（OpenCode TUI） |
| --- | --- |
| 网页 Beta 横幅 | 终端文本横幅 |
| 半透明动态视频背景 | 无（TUI 没有 DOM/视频层） |
| 右下角 BGM 浮窗 | 后台循环播放 + 命令控制 |
| 可拖拽 Altyn 桌宠 | 侧栏 ASCII 桌宠（可选图片模式） |
| 设置页卡片 | `/tarkov` 对话框 |
| 状态行随机文案 | 挂在 `prompt.footer.status` |

## 项目结构

```text
.
├── index.ts          # 服务端插件入口（空实现）
├── tui.tsx           # TUI 插件入口：音效、slot、桌宠、命令
├── src/
│   ├── assets.ts     # 资源路径、文案/语音/音乐加载
│   └── audio.ts      # 跨平台音频播放（音效 + BGM）
├── assets/           # 音效、图片、语音、文案、音乐
├── package.json
├── tsconfig.json
└── README.md
```

## 开发

```bash
npm install
npm run check   # tsc --noEmit
```

本地调试时，把本目录链接或复制到 `~/.config/opencode/plugins/tarkov-theme/`，修改 `tui.tsx` 或 `src/` 后 OpenCode 会热重载；修改 `index.ts` 后需要：

```bash
opencode service restart
```

## 版权与许可

- 代码：[MIT](LICENSE)
- 音效、Altyn 图片、Scav 语音、状态文案取自
  [ZHIGENGNIAO258/dsh-theme-tarkov](https://github.com/ZHIGENGNIAO258/dsh-theme-tarkov)（MIT）
- 内置音频的版权归原作者/素材权利人所有；本仓库仅用于个人学习与娱乐，请勿用于商业分发
- 《逃离塔科夫》及相关素材版权归 Battlestate Games 所有
