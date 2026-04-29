# UniPlug

**[中文](README.zh-CN.md) | English**

> [!WARNING]
> This project involves reverse-engineering GitHub Copilot and Amazon Kiro. It is not officially supported and may break at any time. Use at your own risk.

A multi-provider AI API proxy that unifies different AI backends into a single **OpenAI** and **Anthropic** compatible endpoint. Designed for [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) and OpenAI Codex.

## Supported Providers

| Provider | Type | API Format |
|----------|------|------------|
| **GitHub Copilot** | Reverse-engineered | Proprietary |
| **Amazon Kiro** | Reverse-engineered | Proprietary |
| **DeepSeek** | Cloud API | Anthropic-compatible |
| **OpenAI** | Cloud API | OpenAI |
| **MiMo** | Cloud API | OpenAI-compatible |
| **Claude Direct** | Anthropic | Anthropic (via `claude login`) |
| **Ollama** | Local | Anthropic / OpenAI-compatible |

## Quick Start

```bash
git clone https://github.com/ryangui1983/uniplug.git
cd uniplug
bun install
bun run dev
```

Then open **http://localhost:4141/admin** to configure providers.

### Docker

```bash
docker compose up -d
```

## Usage with Claude Code / OpenAI Codex

UniPlug is designed for Claude Code and OpenAI Codex. After starting the server, open `/admin` to see ready-to-use launch commands for both tools — copy and run.

To persist environment variables across terminal sessions, use the **"Write System Env Vars (setx)"** button at the bottom of the admin page. It writes:

- `ANTHROPIC_BASE_URL=http://localhost:4141`
- `ANTHROPIC_AUTH_TOKEN=dummy`
- `ANTHROPIC_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL` (current model config)

> **Note:** `setx` only affects **newly opened** terminals. For the current terminal, use the command shown on the admin page.

Switching providers in `/admin` takes effect immediately — no restart needed. UniPlug overrides the model routing at request time, so your client config stays unchanged.

## Provider Setup

### Amazon Kiro — Finding Your Credentials

Use **IDC mode** (Social mode is unreliable). After registering at [kiro.aws](https://kiro.aws) and linking your AWS account, credentials are in `~/.aws/sso/cache/`:

| Parameter | File | Field |
|-----------|------|-------|
| Refresh Token | `kiro-auth-token.json` | `refreshToken` |
| Client ID | The other JSON file in the same directory (hash-like filename) | `clientId` |
| Client Secret | Same file | `clientSecret` |

**Steps:**
1. Open `~/.aws/sso/cache/` and collect the three values above
2. Go to `/admin` → Kiro card, fill in the fields and click **Add**
3. Click **Verify Kiro Auth** — a popup says "Kiro 认证可用" on success; check your credentials if it fails
4. Click **Switch to Kiro** to activate

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4141` | Server port |
| `VERBOSE` | `false` | Enable verbose logging |
| `RATE_LIMIT` | - | Min seconds between requests |
| `RATE_LIMIT_WAIT` | `false` | Queue requests instead of returning errors |
| `PROXY_ENV` | `false` | Use `HTTP_PROXY`/`HTTPS_PROXY` from environment |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI Chat Completions |
| `/v1/responses` | POST | OpenAI Responses API |
| `/v1/models` | GET | List models |
| `/v1/embeddings` | POST | Text embeddings |
| `/v1/messages` | POST | Anthropic Messages API |
| `/v1/messages/count_tokens` | POST | Token counting |
| `/admin` | GET | Web admin console |
| `/usage` | GET | Usage statistics |

## Development

```bash
bun install
bun run dev       # dev server with hot reload
bun run typecheck # type checking
bun run lint      # lint
bun test          # tests
bun run build     # production build
```

## Things to Know

### Config file location

- **Linux / macOS:** `~/.local/share/uniplug/`
- **Windows:** `C:\Users\<username>\.local\share\uniplug\`
- **Docker:** mount `/data` (default in `docker-compose.yml`)

### Provider behavior

**Auto-switching only between Copilot and OpenAI.** When Copilot quota is exhausted, UniPlug automatically falls back to OpenAI (and vice versa). All other providers (Kiro, DeepSeek, Claude Direct, Ollama, MiMo) do not participate in auto-switching.

**Model name passthrough.** Claude Direct and Ollama pass through the model name from the client as-is. All other providers ignore the client's model field and use the model configured in `/admin`. Toggle the `passthroughModel` switch on each provider card to change this.

**Claude Direct token expiry.** Requests go directly to Anthropic. If the OAuth token expires, you'll get a 401 — run `claude login` again to refresh. UniPlug does not auto-refresh Claude tokens.

**Kiro and web_search.** The `web_search` tool is silently dropped in Kiro mode and never sent to the backend. Switch to another provider if you rely on search.

**Ollama thinking mode.** In Anthropic mode (default), the `thinking` parameter is passed through to Ollama. Whether it works depends on your local model. If thinking doesn't behave as expected, try switching `apiMode` to `openai` in the admin panel.

## Author

**ryangui** · [studynil.com](https://www.studynil.com/)

## Acknowledgements

- [ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api) — Original project (MIT)
- [yuegongzi/copilot-api](https://github.com/yuegongzi/copilot-api) — Fork maintainer (MIT)
- [justlovemaki/AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) — Kiro integration reference
- [HsnSaboor/CLIProxyAPIPlus](https://github.com/HsnSaboor/CLIProxyAPIPlus) — Kiro integration reference
- [xueyue33/codebuddy2api](https://github.com/xueyue33/codebuddy2api) — Kiro integration reference
- [jiji262/codebuddy-to-API](https://github.com/jiji262/codebuddy-to-API) — Kiro integration reference

## License

MIT — see [LICENSE](LICENSE)
