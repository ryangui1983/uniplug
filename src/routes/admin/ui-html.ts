export const html = `
<div class="header">
  <div class="status-dot"></div>
  <h1>UniPlug 控制台</h1>
  <div class="provider-badge" id="headerProvider">加载中...</div>
</div>
<div class="main">

<!-- 切换警告区 -->
<div id="switchAlertArea"></div>

<!-- GitHub Copilot 区 -->
<div class="card">
  <div class="card-header" onclick="toggleCard(this)">
    <span class="icon">🐙</span> GitHub Copilot
    <span id="copilotActiveBadge" style="display:none;font-size:12px;color:#28a745;font-weight:500;margin-left:6px">✓ 使用中</span>
    <span class="toggle">▼</span>
  </div>
  <div class="card-body">
    <!-- 账号列表 -->
    <div class="section-label">GitHub 账号</div>
    <ul class="account-list" id="accountList"><li class="empty-state-item">加载中...</li></ul>
    <div style="margin-bottom:16px">
      <button class="btn btn-primary btn-sm" onclick="showAddAccountModal()">+ 添加账号</button>
    </div>
    <hr class="section-divider">
    <!-- Copilot 用量 -->
    <div class="section-label">Copilot 用量</div>
    <div id="copilotUsageSection" style="margin-bottom:12px"></div>
    <hr class="section-divider">
    <!-- 模型 + 开关 -->
    <div class="grid-3" style="align-items:end">
      <div class="form-row" style="margin:0">
        <label>主模型</label>
        <select id="copilotMainModel" onchange="saveCopilotConfig()"></select>
      </div>
      <div class="form-row" style="margin:0">
        <label>小模型</label>
        <select id="copilotSmallModel" onchange="saveCopilotConfig()"></select>
      </div>
      <div>
        <button id="copilotRefreshModelsBtn" class="btn btn-outline btn-sm" onclick="refreshModels('copilot')" style="display:none">🔄 请求模型列表</button>
        <span id="copilotEntitlement" style="font-size:13px;color:#666"></span>
      </div>
    </div>
    <div class="switch-container" style="margin-top:12px">
      <label class="toggle-switch">
        <input type="checkbox" id="copilotForce" onchange="saveCopilotConfig()">
        <span class="slider"></span>
      </label>
      <span style="font-size:14px">超出套餐继续使用（Force 模式，按次计费）</span>
    </div>
    <div style="margin-top:10px">
      <button id="switchToCopilotBtn" class="btn btn-outline btn-sm" style="display:none" onclick="switchProvider('copilot')">切换到 Copilot</button>
    </div>
  </div>
</div>

<!-- DeepSeek 区（默认折叠） -->
<div class="card">
  <div class="card-header collapsed" onclick="toggleCard(this)">
    <span class="icon">🐋</span> DeepSeek
    <span id="deepseekActiveBadge" style="display:none;font-size:12px;color:#28a745;font-weight:500;margin-left:6px">✓ 使用中</span>
    <span class="toggle">▼</span>
  </div>
  <div class="card-body hidden">
    <div class="form-row">
      <label>主模型</label>
      <select id="deepseekMainModel" onchange="saveDeepSeekModelConfig()"></select>
    </div>
    <div class="form-row">
      <label>小模型</label>
      <select id="deepseekSmallModel" onchange="saveDeepSeekModelConfig()"></select>
    </div>
    <div style="margin-bottom:10px">
      <button id="deepseekRefreshModelsBtn" class="btn btn-outline btn-sm" onclick="refreshModels('deepseek')" style="display:none">🔄 请求模型列表</button>
    </div>
    <hr class="section-divider">
    <div id="deepseekKeyList" class="key-list" style="margin-bottom:16px"></div>
    <hr class="section-divider">
    <div style="font-weight:500;margin-bottom:10px;font-size:14px">添加新 Key</div>
    <div class="form-row">
      <label>Label</label>
      <input type="text" id="deepseekNewKeyLabel" placeholder="Account 1" style="max-width:160px">
      <label>Key</label>
      <input type="text" id="deepseekNewKeyValue" placeholder="sk-..." style="flex:1;font-family:monospace">
      <button class="btn btn-primary" onclick="addDeepSeekKey()">添加</button>
    </div>
    <div id="addDeepSeekKeyResult"></div>
    <hr class="section-divider">
    <div>
      <button id="switchToDeepSeekBtn" class="btn btn-outline btn-sm" style="display:none" onclick="switchProvider('deepseek')">切换到 DeepSeek</button>
    </div>
  </div>
</div>

<!-- XiaoMiMo 区（默认折叠） -->
<div class="card">
  <div class="card-header collapsed" onclick="toggleCard(this)">
    <span class="icon">🤖</span> XiaoMiMo（小米 MiMo）
    <span id="mimoActiveBadge" style="display:none;font-size:12px;color:#28a745;font-weight:500;margin-left:6px">✓ 使用中</span>
    <span class="toggle">▼</span>
  </div>
  <div class="card-body hidden">
    <div class="form-row">
      <label>主模型</label>
      <select id="mimoMainModel" onchange="saveMimoModelConfig()"></select>
    </div>
    <div class="form-row">
      <label>小模型</label>
      <select id="mimoSmallModel" onchange="saveMimoModelConfig()"></select>
    </div>
    <div style="margin-bottom:10px">
      <button id="mimoRefreshModelsBtn" class="btn btn-outline btn-sm" onclick="refreshModels('mimo')" style="display:none">🔄 请求模型列表</button>
    </div>
    <hr class="section-divider">
    <div id="mimoKeyList" class="key-list" style="margin-bottom:16px"></div>
    <hr class="section-divider">
    <div style="font-weight:500;margin-bottom:10px;font-size:14px">添加新 Key</div>
    <div class="form-row">
      <label>Label</label>
      <input type="text" id="mimoNewKeyLabel" placeholder="Account 1" style="max-width:160px">
      <label>Key</label>
      <input type="text" id="mimoNewKeyValue" placeholder="sk-..." style="flex:1;font-family:monospace">
      <button class="btn btn-primary" onclick="addMimoKey()">添加</button>
    </div>
    <div id="addMimoKeyResult"></div>
    <hr class="section-divider">
    <div>
      <button id="switchToMimoBtn" class="btn btn-outline btn-sm" style="display:none" onclick="switchProvider('mimo')">切换到 MiMo</button>
    </div>
  </div>
</div>

<!-- OpenAI 区（默认折叠） -->
<div class="card">
  <div class="card-header collapsed" onclick="toggleCard(this)">
    <span class="icon">🔑</span> OpenAI
    <span id="openaiActiveBadge" style="display:none;font-size:12px;color:#28a745;font-weight:500;margin-left:6px">✓ 使用中</span>
    <span class="toggle">▼</span>
  </div>
  <div class="card-body hidden">
    <div class="form-row">
      <label>主模型</label>
      <select id="openaiMainModel" onchange="saveOpenAIModelConfig()"></select>
    </div>
    <div class="form-row">
      <label>小模型</label>
      <select id="openaiSmallModel" onchange="saveOpenAIModelConfig()"></select>
    </div>
    <div style="margin-bottom:10px">
      <button id="openaiRefreshModelsBtn" class="btn btn-outline btn-sm" onclick="refreshModels('openai')" style="display:none">🔄 请求模型列表</button>
    </div>
    <hr class="section-divider">
    <div id="keyList" class="key-list" style="margin-bottom:16px"></div>
    <hr class="section-divider">
    <div style="font-weight:500;margin-bottom:10px;font-size:14px">添加新 Key</div>
    <div class="form-row">
      <label>Label</label>
      <input type="text" id="newKeyLabel" placeholder="Account 1" style="max-width:160px">
      <label>Key</label>
      <input type="text" id="newKeyValue" placeholder="sk-..." style="flex:1;font-family:monospace">
      <button class="btn btn-primary" onclick="addKey()">添加</button>
    </div>
    <div id="addKeyResult"></div>
    <hr class="section-divider">
    <div>
      <button id="switchToOpenAIBtn" class="btn btn-outline btn-sm" style="display:none" onclick="switchProvider('openai')">切换到 OpenAI</button>
    </div>
  </div>
</div>

<!-- Claude Direct 区（默认折叠） -->
<div class="card">
  <div class="card-header collapsed" onclick="toggleCard(this)">
    <span class="icon">🔵</span> Claude Direct（Claude Pro）
    <span id="claudeActiveBadge" style="display:none;font-size:12px;color:#28a745;font-weight:500;margin-left:6px">✓ 使用中</span>
    <span class="toggle">▼</span>
  </div>
  <div class="card-body hidden">
    <div class="alert alert-info" style="font-size:13px;margin-bottom:14px">
      通过 Claude Pro 订阅的 OAuth 凭证，直接转发请求到 <code>api.anthropic.com</code>，无需 API Key。<br>
      使用前请先在终端运行：<code>claude login</code>
    </div>
    <div class="section-label">凭证状态</div>
    <div id="claudeCredentialsStatus" style="margin-bottom:14px;font-size:14px">加载中...</div>
    <hr class="section-divider">
    <div class="form-row">
      <label>主模型</label>
      <select id="claudeMainModel" onchange="saveClaudeConfig()"></select>
    </div>
    <div class="form-row">
      <label>小模型</label>
      <select id="claudeSmallModel" onchange="saveClaudeConfig()"></select>
    </div>
    <div class="switch-container" style="margin-top:8px;margin-bottom:12px">
      <label class="toggle-switch">
        <input type="checkbox" id="claudePassthrough" onchange="saveClaudeConfig()">
        <span class="slider"></span>
      </label>
      <span style="font-size:14px">模型透传（不强制覆盖客户端的模型名）</span>
    </div>
    <div>
      <button id="switchToClaudeBtn" class="btn btn-outline btn-sm" style="display:none" onclick="switchProvider('claude')">切换到 Claude Direct</button>
    </div>
  </div>
</div>

<!-- Kiro 区（默认折叠） -->
<div class="card">
  <div class="card-header collapsed" onclick="toggleCard(this)">
    <span class="icon">🧩</span> Kiro（CodeWhisperer）
    <span id="kiroActiveBadge" style="display:none;font-size:12px;color:#28a745;font-weight:500;margin-left:6px">✓ 使用中</span>
    <span class="toggle">▼</span>
  </div>
  <div class="card-body hidden">
    <div class="alert alert-info" style="font-size:13px;margin-bottom:14px">
      使用 Kiro / CodeWhisperer 上游。需要添加 Kiro refresh token；本项目自身的 API Key 鉴权继续沿用全局配置。
    </div>
    <div class="grid-3" style="align-items:end">
      <div class="form-row" style="margin:0">
        <label>主模型</label>
        <select id="kiroMainModel" onchange="saveKiroConfig()"></select>
      </div>
      <div class="form-row" style="margin:0">
        <label>小模型</label>
        <select id="kiroSmallModel" onchange="saveKiroConfig()"></select>
      </div>
      <div>
        <button id="kiroRefreshModelsBtn" class="btn btn-outline btn-sm" onclick="refreshModels('kiro')">🔄 请求模型列表</button>
      </div>
    </div>
    <div class="switch-container" style="margin-top:12px;margin-bottom:12px">
      <label class="toggle-switch">
        <input type="checkbox" id="kiroPassthrough" onchange="saveKiroConfig()">
        <span class="slider"></span>
      </label>
      <span style="font-size:14px">模型透传（不强制覆盖客户端的模型名）</span>
    </div>
    <hr class="section-divider">
    <div class="section-label">Kiro 认证</div>
    <div id="kiroAuthList" class="key-list" style="margin-bottom:16px"></div>
    <div class="form-row">
      <label>Label</label>
      <input type="text" id="kiroNewAuthLabel" placeholder="Kiro 1" style="max-width:140px">
      <label>类型</label>
      <select id="kiroNewAuthType" style="max-width:100px">
        <option value="Social">Social</option>
        <option value="IdC">IdC</option>
      </select>
    </div>
    <div class="form-row">
      <label>Refresh Token</label>
      <input type="password" id="kiroNewRefreshToken" placeholder="refresh token" style="flex:1;font-family:monospace">
    </div>
    <div class="form-row">
      <label>Client ID</label>
      <input type="text" id="kiroNewClientId" placeholder="IdC 可选/必填" style="flex:1;font-family:monospace">
      <label>Client Secret</label>
      <input type="password" id="kiroNewClientSecret" placeholder="IdC 必填" style="flex:1;font-family:monospace">
      <button class="btn btn-primary" onclick="addKiroAuth()">添加</button>
    </div>
    <div id="addKiroAuthResult"></div>
    <hr class="section-divider">
    <div>
      <button id="switchToKiroBtn" class="btn btn-outline btn-sm" style="display:none" onclick="switchProvider('kiro')">切换到 Kiro</button>
      <button class="btn btn-outline btn-sm" onclick="verifyKiroAuth()">验证 Kiro 认证</button>
    </div>
  </div>
</div>

<!-- Ollama 区（默认折叠） -->
<div class="card">
  <div class="card-header collapsed" onclick="toggleCard(this)">
    <span class="icon">🦙</span> Ollama（本地模型）
    <span id="ollamaActiveBadge" style="display:none;font-size:12px;color:#28a745;font-weight:500;margin-left:6px">✓ 使用中</span>
    <span class="toggle">▼</span>
  </div>
  <div class="card-body hidden">
    <div class="alert alert-info" style="font-size:13px;margin-bottom:14px">
      连接本地运行的 Ollama 服务。支持 Anthropic API 格式（默认）和 OpenAI API 格式。<br>
      确保 Ollama 已启动：<code>ollama serve</code>
    </div>
    <div class="form-row">
      <label>服务地址</label>
      <input type="text" id="ollamaBaseUrl" placeholder="http://localhost:11434" style="flex:1;font-family:monospace" oninput="saveOllamaConfig()">
    </div>
    <div class="form-row">
      <label>API 模式</label>
      <select id="ollamaApiMode" onchange="saveOllamaConfig()">
        <option value="anthropic">Anthropic API（/v1/messages，默认）</option>
        <option value="openai">OpenAI API（/v1/chat/completions）</option>
      </select>
    </div>
    <div class="grid-3" style="align-items:end">
      <div class="form-row" style="margin:0">
        <label>主模型</label>
        <select id="ollamaMainModel" onchange="saveOllamaConfig()"></select>
      </div>
      <div class="form-row" style="margin:0">
        <label>小模型</label>
        <select id="ollamaSmallModel" onchange="saveOllamaConfig()"></select>
      </div>
      <div>
        <button id="ollamaRefreshModelsBtn" class="btn btn-outline btn-sm" onclick="refreshModels('ollama')">🔄 请求模型列表</button>
      </div>
    </div>
    <div class="switch-container" style="margin-top:12px;margin-bottom:12px">
      <label class="toggle-switch">
        <input type="checkbox" id="ollamaPassthrough" onchange="saveOllamaConfig()">
        <span class="slider"></span>
      </label>
      <span style="font-size:14px">模型透传（不强制覆盖客户端的模型名）</span>
    </div>
    <div>
      <button id="switchToOllamaBtn" class="btn btn-outline btn-sm" style="display:none" onclick="switchProvider('ollama')">切换到 Ollama</button>
    </div>
  </div>
</div>

<!-- 自动切换配置区 -->
  <div class="card-body">
    <div class="switch-container" style="margin-bottom:12px">
      <label class="toggle-switch">
        <input type="checkbox" id="autoSwitch" onchange="saveAutoSwitchConfig()">
        <span class="slider"></span>
      </label>
      <span style="font-size:14px">启用自动切换</span>
    </div>
    <div class="alert alert-info" style="font-size:13px">
      切换优先级：OpenAI 优先 → 所有 OpenAI key 耗尽 → Copilot 保底。<br>
      Copilot 超限（套餐上限）→ 切回 OpenAI（如有可用 key）。
    </div>
  </div>
</div>

<!-- 连接命令区 -->
<div class="card">
  <div class="card-header collapsed" onclick="toggleCard(this)">
    <span class="icon">💻</span> 连接命令
    <span class="toggle">▼</span>
  </div>
  <div class="card-body hidden">
    <div style="font-size:13px;color:#666;margin-bottom:12px">
      Claude Code 使用 <code>/v1/messages</code>，Codex 使用 <code>/v1/chat/completions</code>，两者共用同一服务器。
    </div>
    <div style="font-weight:500;margin-bottom:8px;font-size:14px">Claude Code</div>
    <div class="command-box" style="margin-bottom:16px">
      <input type="text" id="claudeCmd" readonly>
      <button class="btn btn-outline btn-sm" onclick="copyText('claudeCmd')">复制</button>
    </div>
    <div style="font-weight:500;margin-bottom:8px;font-size:14px">OpenAI Codex</div>
    <div class="command-box" style="margin-bottom:16px">
      <input type="text" id="codexCmd" readonly>
      <button class="btn btn-outline btn-sm" onclick="copyText('codexCmd')">复制</button>
    </div>
    <div class="flex-gap">
      <button class="btn btn-success" onclick="applyEnvVars()">写入系统环境变量 (setx)</button>
      <button class="btn btn-danger" onclick="clearEnvVars()">清除系统环境变量</button>
      <span style="font-size:12px;color:#999;align-self:center">⚠️ setx 仅对新开终端生效，当前终端需手动执行命令</span>
    </div>
    <div id="envResult" style="margin-top:10px"></div>
  </div>
</div>

<!-- 日志路径 -->
<div class="card">
  <div class="card-header collapsed" onclick="toggleCard(this)">
    <span class="icon">📋</span> 日志路径
    <span class="toggle">▼</span>
  </div>
  <div class="card-body hidden">
    <div class="command-box">
      <input type="text" id="logDirPath" readonly>
      <button class="btn btn-outline btn-sm" onclick="copyText('logDirPath')">复制</button>
    </div>
    <div style="font-size:12px;color:#999;margin-top:8px">日志按日期存放，保留 7 天。可使用编辑器或 <code>tail -f</code> 查看实时日志。</div>
  </div>
</div>

</div>

<!-- 添加账号弹窗 -->
<div class="modal-overlay" id="addAccountModal">
  <div class="modal">
    <h2 class="modal-title">添加 GitHub 账号</h2>
    <div id="modalStep1">
      <div class="form-row" style="margin-bottom:16px">
        <label>账号类型</label>
        <select id="newAccountType" style="flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px">
          <option value="individual">Individual（个人）</option>
          <option value="business">Business（企业）</option>
          <option value="enterprise">Enterprise（企业高级）</option>
        </select>
      </div>
      <p style="font-size:13px;color:#666;margin-bottom:16px">点击下方按钮，将打开 GitHub 授权页面。</p>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeAddAccountModal()">取消</button>
        <button class="btn btn-primary" onclick="startAddAccount()">开始授权</button>
      </div>
    </div>
    <div id="modalStep2" style="display:none">
      <p style="font-size:13px;color:#666;margin-bottom:8px;text-align:center">请在浏览器中访问以下链接：</p>
      <a id="modalAuthUri" href="#" target="_blank" class="link" style="display:block;text-align:center;margin-bottom:12px;font-size:13px"></a>
      <p style="font-size:13px;color:#666;margin-bottom:4px;text-align:center">输入以下验证码：</p>
      <div class="code-display" id="modalAuthCode">------</div>
      <p id="modalPollStatus" style="color:#666;font-size:13px;text-align:center;margin-top:8px">等待授权...</p>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn btn-outline" onclick="closeAddAccountModal()">取消</button>
      </div>
    </div>
    <div id="modalStep3" style="display:none">
      <p style="color:#28a745;font-size:15px;text-align:center;margin-bottom:16px">✅ 账号添加成功！</p>
      <div class="modal-actions">
        <button class="btn btn-primary" onclick="closeAddAccountModal()">关闭</button>
      </div>
    </div>
  </div>
</div>
`
