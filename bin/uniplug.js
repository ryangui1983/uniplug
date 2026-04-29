#!/usr/bin/env node
// This shim detects whether Bun is available.
// - If Bun is available: spawns `bun run <src/main.ts>` so no build step is needed.
// - If only Node.js is available: runs the pre-built `dist/main.js`.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const __dirname = import.meta.dirname
const root = resolve(__dirname, "..")

// Check if bun is available
const bunCheck = spawnSync("bun", ["--version"], {
  stdio: "ignore",
  shell: false,
})
const hasBun = bunCheck.status === 0

if (hasBun) {
  const srcMain = resolve(root, "src", "main.ts")
  const result = spawnSync("bun", ["run", srcMain, ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: false,
    env: process.env,
  })
  process.exit(result.status ?? 1)
} else {
  // Fall back to the compiled dist
  const distMain = resolve(root, "dist", "main.js")
  if (!existsSync(distMain)) {
    console.error(
      "[uniplug] Bun is not installed and dist/main.js does not exist.\n"
        + "Please either install Bun (https://bun.sh) or run `npm run build` first.",
    )
    process.exit(1)
  }
  // Dynamic import to run the built file
  await import(distMain)
}
