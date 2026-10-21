import { Plugin } from "@opencode/plugin"

/**
 * Server half. The Tarkov experience lives in the terminal UI (tui.tsx):
 * sounds are played locally, which is where the TUI plugin runs.
 */
export default Plugin.define({
  id: "tarkov-theme",
  setup() {},
})
