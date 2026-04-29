# UniPlug — 万能 AI API 插座

**中文 | [English](README.md)**

> [!WARNING]
> 本项目涉及 GitHub Copilot、Amazon Kiro 等服务的逆向工程接入，不受官方支持，可能随时失效。使用风险自负。

将多种 AI 后端统一暴露为 **OpenAI** 和 **Anthropic** 兼容接口的代理服务，方便 [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)、OpenAI Codex 等 AI 工具无缝切换不同后端。

## 支持的 Provider

| Provider | 类型 | 说明 |
|----------|------|------|
| **GitHub Copilot** | 逆向工程 | 需要 GitHub 账号 + Copilot 订阅，支持多账号轮转 |
| **Amazon Kiro** | 逆向工程 | 需要 AWS 账号绑定 Kiro |
| **DeepSeek** | 云端 API | 需要 DeepSeek API Key，支持 V4-Pro / V4-Flash（Thinking 模式）|
| **OpenAI** | 云端 API | 支持多 Key 配置和自动故障切换 |
| **MiMo** | 云端 API | OpenAI 兼容接口 |
| **Claude Direct** | Anthropic 官方 | 使用本机 `claude login` 的 OAuth Token 直连 |
| **Ollama** | 本地运行 | 无需 API Key，支持本地任意模型 |

## 快速开始

```bash
git clone https://github.com/ryangui1983/uniplug.git
cd uniplug
bun install
bun run dev
```

访问 **http://localhost:4141/admin** 开始配置。

### Docker

```bash
docker compose up -d
```

## 与 Claude Code / OpenAI Codex 配合使用

UniPlug 专为 Claude Code 和 OpenAI Codex 设计。启动服务后，访问 `/admin` 页面可以看到为这两个工具生成的启动命令，直接复制执行即可。

如果想让环境变量持久生效（新开终端也有效），Admin 页面底部有一个**"写入系统环境变量 (setx)"**按钮，点击后会一次性写入以下变量：

- `ANTHROPIC_BASE_URL=http://localhost:4141`
- `ANTHROPIC_AUTH_TOKEN=dummy`
- `ANTHROPIC_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL`（当前配置的模型）

> **注意：** setx 仅对**新开的终端**生效，当前终端需手动执行页面上显示的命令。

切换 Provider 时**无需重启**，UniPlug 会在收到请求时动态替换模型路由，直接在 `/admin` 切换即可生效。

## 配置各 Provider

### GitHub Copilot

1. 访问 `/admin` → Copilot 卡片 → **添加账户**
2. 用浏览器打开显示的 GitHub 设备激活链接，输入验证码

### Amazon Kiro

推荐使用 **IDC 模式**授权（Social 模式目前验证效果不稳定）。

**第一步：找到凭证**

完成 [kiro.aws](https://kiro.aws) 注册和 AWS 账户绑定后，所需凭证均位于本机的 `~/.aws/sso/cache/` 目录：

| 参数 | 来源文件 | 字段名 |
|------|---------|--------|
| Refresh Token | `kiro-auth-token.json` | `refreshToken` |
| Client ID | 同目录另一个 JSON 文件（文件名为哈希字符串） | `clientId` |
| Client Secret | 同上 | `clientSecret` |

**第二步：在 Admin 页面添加认证**

1. 访问 `/admin` → Kiro 卡片
2. 填写 Refresh Token、Client ID、Client Secret，点击**添加**
3. 点击**验证 Kiro 认证** — 弹出"Kiro 认证可用"则成功，否则检查凭证是否正确
4. 点击**切换到 Kiro** 激活

### DeepSeek / OpenAI / MiMo

1. 访问 `/admin` → 对应卡片 → **添加 API Key**
2. 点击**切换到 XXX** 激活

### Claude Direct

1. 本机执行 `claude login` 完成 Anthropic OAuth 认证
2. 访问 `/admin` → Claude Direct 卡片 → **切换到 Claude**

### Ollama

1. 本地启动 Ollama 服务（默认 `http://localhost:11434`）
2. 访问 `/admin` → Ollama 卡片，配置 Base URL 后切换

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4141` | 服务端口 |
| `VERBOSE` | `false` | 详细日志 |
| `RATE_LIMIT` | - | 请求最小间隔（秒） |
| `RATE_LIMIT_WAIT` | `false` | 达到限制时排队而非报错 |
| `PROXY_ENV` | `false` | 从环境变量读取代理设置 |

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/chat/completions` | POST | OpenAI 聊天补全 |
| `/v1/responses` | POST | OpenAI Responses API |
| `/v1/models` | GET | 模型列表 |
| `/v1/embeddings` | POST | 文本嵌入 |
| `/v1/messages` | POST | Anthropic Messages API |
| `/v1/messages/count_tokens` | POST | Token 计数 |
| `/admin` | GET | Web 控制台 |
| `/usage` | GET | 使用量统计 |

## 关于这个项目

这个项目是为了解决一个实际问题：Claude Code 很好用，但 Anthropic 官方 API 对中国用户不友好，GitHub Copilot 订阅相对划算。所以写了这个代理，把多种 AI 服务接入同一个入口，用 `/admin` 界面随时切换，不需要改 Claude Code 的配置。

作者：**ryangui** · [studynil.com](https://www.studynil.com/)

## 使用须知

### 配置文件路径

配置和 token 存储在：

- **Linux / macOS**：`~/.local/share/uniplug/`
- **Windows**：`C:\Users\<用户名>\.local\share\uniplug\`
- **Docker**：挂载 `/data` 目录（`docker-compose.yml` 默认配置）

### Provider 行为差异

**GitHub Copilot / OpenAI 自动切换**
- 仅这两个 provider 之间会自动互切（配额耗尽时），其余 provider（Kiro、DeepSeek、Claude Direct、Ollama、MiMo）不参与自动切换。
- OpenAI 多 key 按**日历天（UTC 0 点）**重置耗尽标记，不是 24 小时滑动窗口。

**模型名透传**
- Claude Direct 和 Ollama 默认**透传**客户端指定的模型名，不强制覆盖。
- 其他 provider（Copilot、OpenAI、DeepSeek、MiMo、Kiro）默认使用 Admin 中配置的主模型，忽略客户端传的 model 字段。
- 如需改变透传行为，在 `/admin` 对应 provider 卡片中切换 `passthroughModel` 开关。

**Claude Direct token 过期**
- 请求直接转发到 Anthropic，token 过期后会报 401，需要重新运行 `claude login` 刷新。UniPlug 不会自动刷新 Claude OAuth token。

**Kiro 工具限制**
- Claude Code 的 `web_search` 工具在 Kiro 模式下会被**过滤掉**，不会发送到后端。如果你依赖搜索功能，请切换到其他 provider。
- 工具名超过 63 字符时会自动截断（加 hash 后缀），不影响功能。

**Ollama 思考模式**
- Anthropic 模式（默认）下 `thinking` 参数直接透传给 Ollama，实际效果取决于本地模型是否支持。
- 如果模型没有按预期思考，尝试改用 OpenAI 模式（在 Admin 页面切换 `apiMode`）。

## 致谢

- [ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api) — 原始项目（MIT）
- [yuegongzi/copilot-api](https://github.com/yuegongzi/copilot-api) — 分支维护（MIT）
- [justlovemaki/AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) — Kiro 接入参考
- [HsnSaboor/CLIProxyAPIPlus](https://github.com/HsnSaboor/CLIProxyAPIPlus) — Kiro 接入参考
- [xueyue33/codebuddy2api](https://github.com/xueyue33/codebuddy2api) — Kiro 接入参考
- [jiji262/codebuddy-to-API](https://github.com/jiji262/codebuddy-to-API) — Kiro 接入参考

## License

MIT — 详见 [LICENSE](LICENSE)
