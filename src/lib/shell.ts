import { execSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

type ShellName = "bash" | "zsh" | "fish" | "powershell" | "cmd" | "sh"
type EnvVars = Record<string, string | undefined>

function getShell(): ShellName {
  const { platform, ppid, env } = process

  if (platform === "win32") {
    try {
      const command = `wmic process get ParentProcessId,Name | findstr "${ppid}"`
      const parentProcess = execSync(command, { stdio: "pipe" }).toString()

      if (parentProcess.toLowerCase().includes("powershell.exe")) {
        return "powershell"
      }
    } catch {
      return "cmd"
    }

    return "cmd"
  } else {
    const shellPath = env.SHELL
    if (shellPath) {
      if (shellPath.endsWith("zsh")) return "zsh"
      if (shellPath.endsWith("fish")) return "fish"
      if (shellPath.endsWith("bash")) return "bash"
    }

    return "sh"
  }
}

/**
 * Generates a copy-pasteable script to set multiple environment variables
 * and run a subsequent command.
 * @param {EnvVars} envVars - An object of environment variables to set.
 * @param {string} commandToRun - The command to run after setting the variables.
 * @returns {string} The formatted script string.
 */
export function generateEnvScript(
  envVars: EnvVars,
  commandToRun: string = "",
): string {
  const shell = getShell()
  const filteredEnvVars = Object.entries(envVars).filter(
    ([, value]) => value !== undefined,
  ) as Array<[string, string]>

  let commandBlock: string

  switch (shell) {
    case "powershell": {
      commandBlock = filteredEnvVars
        .map(([key, value]) => `$env:${key} = ${value}`)
        .join("; ")
      break
    }
    case "cmd": {
      commandBlock = filteredEnvVars
        .map(([key, value]) => `set ${key}=${value}`)
        .join(" & ")
      break
    }
    case "fish": {
      commandBlock = filteredEnvVars
        .map(([key, value]) => `set -gx ${key} ${value}`)
        .join("; ")
      break
    }
    default: {
      // bash, zsh, sh
      const assignments = filteredEnvVars
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")
      commandBlock = filteredEnvVars.length > 0 ? `export ${assignments}` : ""
      break
    }
  }

  if (commandBlock && commandToRun) {
    const separator = shell === "cmd" ? " & " : " && "
    return `${commandBlock}${separator}${commandToRun}`
  }

  return commandBlock || commandToRun
}

export interface ApplyEnvResult {
  success: boolean
  errors: Array<string>
}

const MARKER_START = "# uniplug-env-start"
const MARKER_END = "# uniplug-env-end"

function applyEnvVarsUnix(vars: Record<string, string>): ApplyEnvResult {
  const shell = getShell()
  const rcFile =
    shell === "zsh" ?
      path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc")

  const exportLines = Object.entries(vars)
    .map(([k, v]) => `export ${k}="${v}"`)
    .join("\n")
  const block = `${MARKER_START}\n${exportLines}\n${MARKER_END}`

  try {
    let content = ""
    try {
      content = fs.readFileSync(rcFile, "utf8")
    } catch {
      content = ""
    }

    const startIdx = content.indexOf(MARKER_START)
    const endIdx = content.indexOf(MARKER_END)

    content =
      startIdx !== -1 && endIdx !== -1 ?
        content.slice(0, startIdx)
        + block
        + content.slice(endIdx + MARKER_END.length)
      : content + "\n" + block + "\n"

    fs.writeFileSync(rcFile, content, "utf8")
    return { success: true, errors: [] }
  } catch (error) {
    return { success: false, errors: [String(error)] }
  }
}

function applyEnvVarsWindows(vars: Record<string, string>): ApplyEnvResult {
  const errors: Array<string> = []

  for (const [key, value] of Object.entries(vars)) {
    try {
      execSync(`setx ${key} "${value}"`, { timeout: 5000, stdio: "pipe" })
    } catch (error) {
      errors.push(`Failed to setx ${key}: ${String(error)}`)
    }
  }

  return { success: errors.length === 0, errors }
}

/**
 * Writes environment variables permanently to the system.
 * On Windows: uses setx (affects new shells only).
 * On Unix: writes to ~/.bashrc or ~/.zshrc (affects new shells only).
 */
export function applyEnvVarsToSystem(
  vars: Record<string, string>,
): ApplyEnvResult {
  if (process.platform === "win32") {
    return applyEnvVarsWindows(vars)
  }
  return applyEnvVarsUnix(vars)
}

function clearEnvVarsWindows(keys: Array<string>): ApplyEnvResult {
  const errors: Array<string> = []

  for (const key of keys) {
    try {
      execSync(`REG delete HKCU\\Environment /v ${key} /f`, {
        timeout: 5000,
        stdio: "pipe",
      })
    } catch (error) {
      const msg = String(error)
      // Ignore "not found" errors — variable simply didn't exist
      if (!msg.includes("ERROR: The system was unable to find")) {
        errors.push(`Failed to delete ${key}: ${msg}`)
      }
    }
  }

  return { success: errors.length === 0, errors }
}

function clearEnvVarsUnix(): ApplyEnvResult {
  const shell = getShell()
  const rcFile =
    shell === "zsh" ?
      path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc")

  try {
    let content = ""
    try {
      content = fs.readFileSync(rcFile, "utf8")
    } catch {
      return { success: true, errors: [] }
    }

    const startIdx = content.indexOf(MARKER_START)
    const endIdx = content.indexOf(MARKER_END)

    if (startIdx === -1 || endIdx === -1) {
      return { success: true, errors: [] }
    }

    content =
      content.slice(0, startIdx) + content.slice(endIdx + MARKER_END.length)

    // Remove leading blank line left behind
    content = content.replaceAll(/\n{3,}/g, "\n\n")

    fs.writeFileSync(rcFile, content, "utf8")
    return { success: true, errors: [] }
  } catch (error) {
    return { success: false, errors: [String(error)] }
  }
}

/**
 * Removes the environment variables written by applyEnvVarsToSystem.
 * On Windows: uses REG delete (affects new shells only).
 * On Unix: removes the marker block from ~/.bashrc or ~/.zshrc.
 */
export function clearEnvVarsFromSystem(keys: Array<string>): ApplyEnvResult {
  if (process.platform === "win32") {
    return clearEnvVarsWindows(keys)
  }
  return clearEnvVarsUnix()
}
