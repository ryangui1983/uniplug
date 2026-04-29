import fs from "node:fs"
import os from "node:os"
import path from "node:path"

interface ClaudeOAuthCredentials {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

interface CredentialsFile {
  claudeAiOauth?: ClaudeOAuthCredentials
}

function getCredentialsPath(): string {
  const claudeConfigDir = process.env["CLAUDE_CONFIG_DIR"]
  if (claudeConfigDir) {
    return path.join(claudeConfigDir, ".credentials.json")
  }
  return path.join(os.homedir(), ".claude", ".credentials.json")
}

function readCredentialsFile(filePath: string): CredentialsFile {
  const raw = fs.readFileSync(filePath)
  return JSON.parse(raw as unknown as string) as CredentialsFile
}

export function isClaudeCredentialsAvailable(): boolean {
  try {
    fs.accessSync(getCredentialsPath(), fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

export function getClaudeCredentialsStatus(): {
  available: boolean
  expired: boolean
  expiresAt?: number
} {
  if (!isClaudeCredentialsAvailable()) {
    return { available: false, expired: false }
  }

  try {
    const creds = readCredentialsFile(getCredentialsPath())
    const oauth = creds.claudeAiOauth
    if (!oauth?.accessToken) {
      return { available: false, expired: false }
    }

    if (oauth.expiresAt) {
      const expired = Date.now() > oauth.expiresAt
      return { available: true, expired, expiresAt: oauth.expiresAt }
    }

    return { available: true, expired: false, expiresAt: oauth.expiresAt }
  } catch {
    return { available: false, expired: false }
  }
}

export function getClaudeOAuthToken(): string {
  const credPath = getCredentialsPath()

  try {
    const creds = readCredentialsFile(credPath)
    const token = creds.claudeAiOauth?.accessToken
    if (!token) {
      throw new Error(
        "Claude credentials file found but accessToken is missing. Please run `claude login` to authenticate.",
      )
    }
    return token
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Claude credentials not found at ${credPath}. Please run \`claude login\` to authenticate.`,
      )
    }
    throw error
  }
}
