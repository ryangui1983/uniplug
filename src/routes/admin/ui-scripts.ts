/* eslint-disable max-lines */
export const scripts = `
let config = null;
let status = null;
let authPollInterval = null;
let deviceCodeData = null;
let addAccountPollInterval = null;
let addAccountDeviceData = null;

async function api(path, opts) {
  const r = await fetch('/admin' + path, opts);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}

async function loadAll() {
  try {
    [status, config] = await Promise.all([
      api('/api/status'),
      api('/api/config'),
    ]);
    render();
  } catch(e) {
    console.error('Load failed:', e);
  }
}

function render() {
  renderHeader();
  renderSwitchLog();
  renderCopilotSection();
  renderDeepSeekSection();
  renderMimoSection();
  renderOpenAISection();
  renderClaudeSection();
  renderKiroSection();
  renderOllamaSection();
  renderCommands();
  if (config) {
    document.getElementById('autoSwitch').checked = config.autoSwitch ?? true;
  }
}

function renderHeader() {
  const provider = status?.provider || 'unknown';
  const activeKey = status?.activeKeyLabel || '';
  let label = 'GitHub Copilot';
  if (provider === 'openai') label = 'OpenAI' + (activeKey ? ' · ' + activeKey : '');
  else if (provider === 'deepseek') label = 'DeepSeek';
  else if (provider === 'mimo') label = 'XiaoMiMo';
  else if (provider === 'claude') label = 'Claude Direct';
  else if (provider === 'kiro') label = 'Kiro';
  else if (provider === 'ollama') label = 'Ollama';
  document.getElementById('headerProvider').textContent = label;
}

function renderSwitchLog() {
  const area = document.getElementById('switchAlertArea');
  const log = status?.switchLog || [];
  if (log.length === 0) { area.innerHTML = ''; return; }
  area.innerHTML = \`<div class="card">
    <div class="card-header"><span class="icon">⚠️</span> Provider 切换记录</div>
    <div class="card-body">
      <div class="switch-log">
        \${log.map(e => \`<div class="switch-log-item">
          <div class="switch-log-time">\${new Date(e.timestamp).toLocaleString()}</div>
          <div><strong>\${e.from}</strong> → <strong>\${e.to}</strong>：\${e.reason}</div>
          <div style="color:#999;font-size:12px">模型：\${e.oldModel} → \${e.newModel}</div>
        </div>\`).join('')}
      </div>
    </div>
  </div>\`;
}

async function renderCopilotSection() {
  const isCopilotCurrent = status?.provider === 'copilot';

  const switchBtn = document.getElementById('switchToCopilotBtn');
  const activeBadge = document.getElementById('copilotActiveBadge');
  if (switchBtn) switchBtn.style.display = isCopilotCurrent ? 'none' : '';
  if (activeBadge) activeBadge.style.display = isCopilotCurrent ? '' : 'none';

  // 账号列表
  try {
    const accountData = await api('/api/accounts');
    renderAccountList(accountData);
  } catch(e) {
    document.getElementById('accountList').innerHTML = '<li class="empty-state-item">加载账号失败</li>';
  }

  // 用量
  const usageEl = document.getElementById('copilotUsageSection');
  const usage = status?.copilotUsage;
  if (usage) {
    const detail = usage.quota_snapshots?.premium_interactions;
    if (detail) {
      const total = detail.entitlement;
      const remaining = detail.remaining;
      const used = total - remaining;
      const threshold = total || config?.copilot?.quotaThreshold;
      const pct = total > 0 ? Math.min(100, (used / threshold) * 100) : 0;
      const fillClass = pct > 90 ? 'danger' : pct > 70 ? 'warning' : '';
      const displayRemaining = remaining < 0 ? \`超出 \${-remaining}\` : String(remaining);
      const thresholdNote = threshold < total ? \`，警戒线 \${threshold}\` : '';
      usageEl.innerHTML = \`<div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:13px;font-weight:500">Premium Interactions 用量</span>
          <span style="font-size:13px;color:#666">\${used} / \${total}\${thresholdNote}</span>
        </div>
        <div class="usage-bar"><div class="usage-fill \${fillClass}" style="width:\${pct}%"></div></div>
        <div class="usage-text">剩余 \${displayRemaining}，重置日期：\${usage.quota_reset_date || '未知'}</div>
      </div>\`;
    } else {
      usageEl.innerHTML = '<div style="color:#999;font-size:13px">暂无用量数据</div>';
    }
  } else {
    usageEl.innerHTML = \`<button class="btn btn-outline btn-sm" onclick="loadCopilotUsage()">查询 Copilot 用量</button>\`;
  }

  if (config) {
    const loadedModels = status?.copilotModels || [];
    const mainSel = document.getElementById('copilotMainModel');
    const smallSel = document.getElementById('copilotSmallModel');
    const refreshBtn = document.getElementById('copilotRefreshModelsBtn');
    const savedMain = config.copilot?.mainModel || '';
    const savedSmall = config.copilot?.smallModel || '';
    if (loadedModels.length === 0) {
      if (savedMain || savedSmall) {
        populateModelSelect(mainSel, [], savedMain);
        populateModelSelect(smallSel, [], savedSmall);
      } else {
        mainSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
        smallSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
      }
      if (refreshBtn) refreshBtn.style.display = '';
    } else {
      populateModelSelect(mainSel, loadedModels, savedMain || 'gpt-5');
      populateModelSelect(smallSel, loadedModels, savedSmall || 'gpt-5-mini');
      if (refreshBtn) refreshBtn.style.display = 'none';
    }
    const entitlementEl = document.getElementById('copilotEntitlement');
    const detail = status?.copilotUsage?.quota_snapshots?.premium_interactions;
    if (entitlementEl && detail) {
      entitlementEl.textContent = detail.unlimited ? '套餐上限：无限制' : \`套餐上限：\${detail.entitlement} 次\`;
    }
    document.getElementById('copilotForce').checked = config.copilot?.force || false;
  }
}

function renderAccountList(accountData) {
  const list = document.getElementById('accountList');
  const accounts = accountData?.accounts || [];
  const activeId = accountData?.activeAccountId;

  if (accounts.length === 0) {
    list.innerHTML = '<li class="empty-state-item">暂无账号，请点击"添加账号"完成 GitHub 授权。</li>';
    return;
  }

  list.innerHTML = accounts.map(acc => {
    const isActive = acc.id === activeId;
    const avatarHtml = acc.avatarUrl
      ? \`<img class="account-avatar" src="\${escHtml(acc.avatarUrl)}" alt="" onerror="this.style.display='none'">\`
      : \`<div class="account-avatar-placeholder">\${escHtml(acc.login[0]?.toUpperCase() || '?')}</div>\`;
    const typeLabel = acc.accountType === 'business' ? '企业' : acc.accountType === 'enterprise' ? '企业高级' : '个人';
    return \`<li class="account-item\${isActive ? ' account-active' : ''}">
      \${avatarHtml}
      <div class="account-info">
        <div class="account-name">@\${escHtml(acc.login)}</div>
        <div class="account-type">\${typeLabel}</div>
      </div>
      \${isActive ? '<span class="account-badge">活跃</span>' : ''}
      <div class="account-actions">
        \${!isActive ? \`<button class="btn btn-outline btn-sm" onclick="switchAccount('\${acc.id}')">切换</button>\` : ''}
        <button class="btn btn-danger btn-sm" onclick="deleteAccount('\${acc.id}', '\${escHtml(acc.login)}')">删除</button>
      </div>
    </li>\`;
  }).join('');
}

async function switchAccount(id) {
  if (!confirm('确认切换到该账号？')) return;
  try {
    const result = await api('/api/accounts/' + id + '/activate', {method: 'POST'});
    await loadAll();
    if (result.warning) {
      alert('⚠️ ' + result.warning);
    }
  } catch(e) {
    alert('切换失败：' + e.message);
  }
}

async function deleteAccount(id, login) {
  if (!confirm('确认删除账号 @' + login + '？此操作不可撤销。')) return;
  try {
    await api('/api/accounts/' + id, {method: 'DELETE'});
    await loadAll();
  } catch(e) {
    alert('删除失败：' + e.message);
  }
}

function showAddAccountModal() {
  showModalStep(1);
  document.getElementById('newAccountType').value = 'individual';
  document.getElementById('addAccountModal').classList.add('active');
}

function closeAddAccountModal() {
  document.getElementById('addAccountModal').classList.remove('active');
  if (addAccountPollInterval) { clearInterval(addAccountPollInterval); addAccountPollInterval = null; }
  addAccountDeviceData = null;
  loadAll();
}

function showModalStep(n) {
  document.getElementById('modalStep1').style.display = n === 1 ? '' : 'none';
  document.getElementById('modalStep2').style.display = n === 2 ? '' : 'none';
  document.getElementById('modalStep3').style.display = n === 3 ? '' : 'none';
}

async function startAddAccount() {
  const accountType = document.getElementById('newAccountType').value;
  try {
    const data = await api('/api/auth/device-code', {method: 'POST'});
    if (data.error) { alert(data.error.message); return; }
    addAccountDeviceData = {...data, accountType};
    document.getElementById('modalAuthCode').textContent = data.userCode;
    const link = document.getElementById('modalAuthUri');
    link.href = data.verificationUri;
    link.textContent = data.verificationUri;
    document.getElementById('modalPollStatus').textContent = '等待授权...';
    showModalStep(2);
    const interval = (data.interval || 5) + 1;
    if (addAccountPollInterval) clearInterval(addAccountPollInterval);
    addAccountPollInterval = setInterval(pollAddAccount, interval * 1000);
  } catch(e) {
    alert('启动授权失败：' + e.message);
  }
}

async function pollAddAccount() {
  if (!addAccountDeviceData) return;
  try {
    const result = await api('/api/auth/poll', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        deviceCode: addAccountDeviceData.deviceCode,
        accountType: addAccountDeviceData.accountType,
      }),
    });
    if (result.success) {
      clearInterval(addAccountPollInterval);
      addAccountPollInterval = null;
      showModalStep(3);
    } else if (result.error) {
      clearInterval(addAccountPollInterval);
      addAccountPollInterval = null;
      document.getElementById('modalPollStatus').textContent = '授权失败：' + result.error.message;
    } else if (result.slowDown) {
      clearInterval(addAccountPollInterval);
      addAccountPollInterval = setInterval(pollAddAccount, (result.interval + 1) * 1000);
      document.getElementById('modalPollStatus').textContent = '请求过频，已降低检查频率...';
    } else {
      document.getElementById('modalPollStatus').textContent = '等待用户授权...';
    }
  } catch(e) {
    console.warn('Poll error:', e);
  }
}

function renderOpenAISection() {
  if (!config) return;
  const keys = config.openai?.keys || [];
  const activeKeyId = config.openai?.activeKeyId;
  const keyStatuses = status?.keyStatuses || {};
  const isOpenAICurrent = status?.provider === 'openai';

  const switchBtn = document.getElementById('switchToOpenAIBtn');
  const activeBadge = document.getElementById('openaiActiveBadge');
  if (switchBtn) switchBtn.style.display = isOpenAICurrent ? 'none' : '';
  if (activeBadge) activeBadge.style.display = isOpenAICurrent ? '' : 'none';

  const keyList = document.getElementById('keyList');
  if (keys.length === 0) {
    keyList.innerHTML = '<div style="color:#999;font-size:14px;text-align:center;padding:20px">暂无 OpenAI Key，请添加</div>';
  } else {
    keyList.innerHTML = keys.map(k => {
      const isActive = k.id === activeKeyId;
      const ks = keyStatuses[k.id] || {};
      const isExhausted = ks.exhausted;
      const requests = ks.sessionRequests || 0;
      const statusClass = isExhausted ? 'exhausted' : isActive ? 'active' : '';
      const statusBadge = isExhausted ? '<span class="key-status status-exhausted">耗尽</span>' :
        isActive ? '<span class="key-status status-active">活跃</span>' :
        '<span class="key-status" style="background:#eee;color:#666">备用</span>';
      return \`<div class="key-item \${statusClass}">
        <div>
          <div class="key-label">\${escHtml(k.label)}</div>
          <div class="key-value">\${escHtml(k.key)}</div>
        </div>
        \${statusBadge}
        <div class="key-requests">本次 \${requests} 请求</div>
        <div class="actions">
          \${!isActive ? \`<button class="btn btn-outline btn-sm" onclick="activateKey('\${k.id}')">切为活跃</button>\` : ''}
          \${isExhausted ? \`<button class="btn btn-outline btn-sm" onclick="resetKeyExhausted('\${k.id}')">重置耗尽</button>\` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteKey('\${k.id}')">删除</button>
        </div>
      </div>\`;
    }).join('');
  }

  const allModelsForOpenAI = status?.openaiModels || [];
  const mainSel = document.getElementById('openaiMainModel');
  const smallSel = document.getElementById('openaiSmallModel');
  const refreshBtn = document.getElementById('openaiRefreshModelsBtn');
  const savedMain = config.openai?.mainModel || '';
  const savedSmall = config.openai?.smallModel || '';
  if (allModelsForOpenAI.length === 0) {
    if (savedMain || savedSmall) {
      populateModelSelect(mainSel, [], savedMain);
      populateModelSelect(smallSel, [], savedSmall);
    } else {
      mainSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
      smallSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
    }
    if (refreshBtn) refreshBtn.style.display = '';
  } else {
    populateModelSelect(mainSel, allModelsForOpenAI, savedMain || 'gpt-4o');
    populateModelSelect(smallSel, allModelsForOpenAI, savedSmall || 'gpt-4o-mini');
    if (refreshBtn) refreshBtn.style.display = 'none';
  }
}

function renderDeepSeekSection() {
  if (!config) return;
  const keys = config.deepseek?.keys || [];
  const activeKeyId = config.deepseek?.activeKeyId || status?.activeDeepSeekKeyId;
  const isDeepSeekCurrent = status?.provider === 'deepseek';

  const switchBtn = document.getElementById('switchToDeepSeekBtn');
  const activeBadge = document.getElementById('deepseekActiveBadge');
  if (switchBtn) switchBtn.style.display = isDeepSeekCurrent ? 'none' : '';
  if (activeBadge) activeBadge.style.display = isDeepSeekCurrent ? '' : 'none';

  const keyList = document.getElementById('deepseekKeyList');
  if (keys.length === 0) {
    keyList.innerHTML = '<div style="color:#999;font-size:14px;text-align:center;padding:20px">暂无 DeepSeek Key，请添加</div>';
  } else {
    keyList.innerHTML = keys.map(k => {
      const isActive = k.id === activeKeyId;
      const statusBadge = isActive
        ? '<span class="key-status status-active">活跃</span>'
        : '<span class="key-status" style="background:#eee;color:#666">备用</span>';
      return \`<div class="key-item \${isActive ? 'active' : ''}">
        <div>
          <div class="key-label">\${escHtml(k.label)}</div>
          <div class="key-value">\${escHtml(k.key)}</div>
        </div>
        \${statusBadge}
        <div class="actions">
          \${!isActive ? \`<button class="btn btn-outline btn-sm" onclick="activateDeepSeekKey('\${k.id}')">切为活跃</button>\` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteDeepSeekKey('\${k.id}')">删除</button>
        </div>
      </div>\`;
    }).join('');
  }

  const allModels = status?.deepseekModels || [];
  const mainSel = document.getElementById('deepseekMainModel');
  const smallSel = document.getElementById('deepseekSmallModel');
  const refreshBtn = document.getElementById('deepseekRefreshModelsBtn');
  const savedMain = config.deepseek?.mainModel || '';
  const savedSmall = config.deepseek?.smallModel || '';
  if (allModels.length === 0) {
    if (savedMain || savedSmall) {
      populateModelSelect(mainSel, [], savedMain);
      populateModelSelect(smallSel, [], savedSmall);
    } else {
      mainSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
      smallSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
    }
    if (refreshBtn) refreshBtn.style.display = '';
  } else {
    populateModelSelect(mainSel, allModels, savedMain || 'deepseek-v4-pro');
    populateModelSelect(smallSel, allModels, savedSmall || 'deepseek-v4-flash');
    if (refreshBtn) refreshBtn.style.display = 'none';
  }
}

function renderMimoSection() {
  if (!config) return;
  const keys = config.mimo?.keys || [];
  const activeKeyId = config.mimo?.activeKeyId || status?.activeMimoKeyId;
  const isMimoCurrent = status?.provider === 'mimo';

  const switchBtn = document.getElementById('switchToMimoBtn');
  const activeBadge = document.getElementById('mimoActiveBadge');
  if (switchBtn) switchBtn.style.display = isMimoCurrent ? 'none' : '';
  if (activeBadge) activeBadge.style.display = isMimoCurrent ? '' : 'none';

  const keyList = document.getElementById('mimoKeyList');
  if (keys.length === 0) {
    keyList.innerHTML = '<div style="color:#999;font-size:14px;text-align:center;padding:20px">暂无 MiMo Key，请添加</div>';
  } else {
    keyList.innerHTML = keys.map(k => {
      const isActive = k.id === activeKeyId;
      const statusBadge = isActive
        ? '<span class="key-status status-active">活跃</span>'
        : '<span class="key-status" style="background:#eee;color:#666">备用</span>';
      return \`<div class="key-item \${isActive ? 'active' : ''}">
        <div>
          <div class="key-label">\${escHtml(k.label)}</div>
          <div class="key-value">\${escHtml(k.key)}</div>
        </div>
        \${statusBadge}
        <div class="actions">
          \${!isActive ? \`<button class="btn btn-outline btn-sm" onclick="activateMimoKey('\${k.id}')">切为活跃</button>\` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteMimoKey('\${k.id}')">删除</button>
        </div>
      </div>\`;
    }).join('');
  }

  const allModelsForMimo = status?.mimoModels || [];
  const mainSel = document.getElementById('mimoMainModel');
  const smallSel = document.getElementById('mimoSmallModel');
  const refreshBtn = document.getElementById('mimoRefreshModelsBtn');
  const savedMain = config.mimo?.mainModel || '';
  const savedSmall = config.mimo?.smallModel || '';
  if (allModelsForMimo.length === 0) {
    if (savedMain || savedSmall) {
      populateModelSelect(mainSel, [], savedMain);
      populateModelSelect(smallSel, [], savedSmall);
    } else {
      mainSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
      smallSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
    }
    if (refreshBtn) refreshBtn.style.display = '';
  } else {
    populateModelSelect(mainSel, allModelsForMimo, savedMain || 'mimo-v2-flash');
    populateModelSelect(smallSel, allModelsForMimo, savedSmall || 'mimo-v2-flash');
    if (refreshBtn) refreshBtn.style.display = 'none';
  }
}

function renderClaudeSection() {
  if (!config) return;
  const isClaudeCurrent = status?.provider === 'claude';

  const switchBtn = document.getElementById('switchToClaudeBtn');
  const activeBadge = document.getElementById('claudeActiveBadge');
  if (switchBtn) switchBtn.style.display = isClaudeCurrent ? 'none' : '';
  if (activeBadge) activeBadge.style.display = isClaudeCurrent ? '' : 'none';

  // Credentials status
  const credEl = document.getElementById('claudeCredentialsStatus');
  if (credEl) {
    const creds = status?.claudeCredentials;
    if (!creds || !creds.available) {
      credEl.innerHTML = '<span style="color:#dc3545">❌ 未找到凭证 — 请在终端运行 <code>claude login</code></span>';
    } else if (creds.expired) {
      credEl.innerHTML = '<span style="color:#ffc107">⚠️ 凭证已过期 — 请重新运行 <code>claude login</code></span>';
    } else {
      const expiry = creds.expiresAt ? new Date(creds.expiresAt).toLocaleString() : '未知';
      credEl.innerHTML = '<span style="color:#28a745">✅ 已登录</span>' +
        (creds.expiresAt ? \` <span style="color:#666;font-size:12px">（有效期至 \${expiry}）</span>\` : '');
    }
  }

  // Model selects
  const claudeModels = status?.claudeModels || [];
  const mainSel = document.getElementById('claudeMainModel');
  const smallSel = document.getElementById('claudeSmallModel');
  const savedMain = config.claude?.mainModel || 'claude-opus-4-6';
  const savedSmall = config.claude?.smallModel || 'claude-haiku-4-5';
  if (claudeModels.length === 0) {
    if (savedMain) populateModelSelect(mainSel, [], savedMain);
    else mainSel.innerHTML = '<option>无模型数据</option>';
    if (savedSmall) populateModelSelect(smallSel, [], savedSmall);
    else smallSel.innerHTML = '<option>无模型数据</option>';
  } else {
    populateModelSelect(mainSel, claudeModels, savedMain);
    populateModelSelect(smallSel, claudeModels, savedSmall);
  }

  // Passthrough toggle
  const passthroughEl = document.getElementById('claudePassthrough');
  if (passthroughEl) passthroughEl.checked = config.claude?.passthroughModel ?? true;
}

async function saveClaudeConfig() {
  if (!config) return;
  const updated = {
    ...config,
    claude: {
      ...config.claude,
      mainModel: document.getElementById('claudeMainModel').value,
      smallModel: document.getElementById('claudeSmallModel').value,
      passthroughModel: document.getElementById('claudePassthrough').checked,
    }
  };
  try {
    config = await api('/api/config', {
      method: 'PUT',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(updated),
    });
  } catch(e) {
    console.warn('Save Claude config failed:', e);
  }
}

function renderKiroSection() {
  if (!config) return;
  const isKiroCurrent = status?.provider === 'kiro';
  const switchBtn = document.getElementById('switchToKiroBtn');
  const activeBadge = document.getElementById('kiroActiveBadge');
  if (switchBtn) switchBtn.style.display = isKiroCurrent ? 'none' : '';
  if (activeBadge) activeBadge.style.display = isKiroCurrent ? '' : 'none';

  const models = status?.kiroModels || [];
  const mainSel = document.getElementById('kiroMainModel');
  const smallSel = document.getElementById('kiroSmallModel');
  populateModelSelect(mainSel, models, config.kiro?.mainModel || 'claude-sonnet-4-5');
  populateModelSelect(smallSel, models, config.kiro?.smallModel || 'claude-3-5-haiku-20241022');
  const passthroughEl = document.getElementById('kiroPassthrough');
  if (passthroughEl) passthroughEl.checked = config.kiro?.passthroughModel ?? true;

  const authList = document.getElementById('kiroAuthList');
  const authItems = config.kiro?.auth || [];
  if (!authList) return;
  if (authItems.length === 0) {
    const envHint = status?.kiroAuth?.configured ? '已通过环境变量配置 KIRO_AUTH_TOKEN' : '暂无 Kiro 认证，请添加';
    authList.innerHTML = '<div style="color:#999;font-size:14px;text-align:center;padding:20px">' + envHint + '</div>';
    return;
  }
  authList.innerHTML = authItems.map(item =>
    '<div class="key-item ' + (item.disabled ? '' : 'active') + '">' +
      '<div><div class="key-label">' + escHtml(item.label) + ' · ' + escHtml(item.auth) + '</div>' +
      '<div class="key-value">' + escHtml(item.refreshToken) + '</div></div>' +
      (item.disabled ? '<span class="key-status" style="background:#eee;color:#666">禁用</span>' : '<span class="key-status status-active">启用</span>') +
      '<div class="actions">' +
        '<button class="btn btn-outline btn-sm" onclick="toggleKiroAuth(' + "'" + item.id + "'" + ')">' + (item.disabled ? '启用' : '禁用') + '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteKiroAuth(' + "'" + item.id + "'" + ')">删除</button>' +
      '</div>' +
    '</div>'
  ).join('');
}

async function saveKiroConfig() {
  if (!config) return;
  const updated = {
    ...config,
    kiro: {
      ...config.kiro,
      mainModel: document.getElementById('kiroMainModel').value,
      smallModel: document.getElementById('kiroSmallModel').value,
      passthroughModel: document.getElementById('kiroPassthrough').checked,
    }
  };
  try {
    config = await api('/api/config', {
      method: 'PUT',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(updated),
    });
  } catch(e) {
    console.warn('Save Kiro config failed:', e);
  }
}

async function addKiroAuth() {
  const label = document.getElementById('kiroNewAuthLabel').value.trim();
  const auth = document.getElementById('kiroNewAuthType').value;
  const refreshToken = document.getElementById('kiroNewRefreshToken').value.trim();
  const clientId = document.getElementById('kiroNewClientId').value.trim();
  const clientSecret = document.getElementById('kiroNewClientSecret').value.trim();
  const resultEl = document.getElementById('addKiroAuthResult');
  if (!refreshToken) { alert('请输入 Refresh Token'); return; }
  try {
    await api('/api/config/kiro/auth', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({label, auth, refreshToken, clientId, clientSecret}),
    });
    document.getElementById('kiroNewAuthLabel').value = '';
    document.getElementById('kiroNewRefreshToken').value = '';
    document.getElementById('kiroNewClientId').value = '';
    document.getElementById('kiroNewClientSecret').value = '';
    resultEl.innerHTML = '<div class="alert alert-success" style="margin-top:8px">Kiro 认证已添加</div>';
    await loadAll();
    setTimeout(() => resultEl.innerHTML = '', 3000);
  } catch(e) {
    resultEl.innerHTML = '<div class="alert alert-error" style="margin-top:8px">添加失败：' + escHtml(e.message) + '</div>';
  }
}

async function deleteKiroAuth(id) {
  if (!confirm('确认删除该 Kiro 认证？')) return;
  try {
    await api('/api/config/kiro/auth/' + id, {method:'DELETE'});
    await loadAll();
  } catch(e) {
    alert('删除失败：' + e.message);
  }
}

async function toggleKiroAuth(id) {
  try {
    await api('/api/config/kiro/auth/' + id + '/toggle-disabled', {method:'PUT'});
    await loadAll();
  } catch(e) {
    alert('切换失败：' + e.message);
  }
}

async function verifyKiroAuth() {
  try {
    await api('/api/config/kiro/auth/verify', {method:'POST'});
    alert('Kiro 认证可用');
  } catch(e) {
    alert('验证失败：' + e.message);
  }
}

function renderOllamaSection() {
  if (!config) return;
  const isOllamaCurrent = status?.provider === 'ollama';

  const switchBtn = document.getElementById('switchToOllamaBtn');
  const activeBadge = document.getElementById('ollamaActiveBadge');
  if (switchBtn) switchBtn.style.display = isOllamaCurrent ? 'none' : '';
  if (activeBadge) activeBadge.style.display = isOllamaCurrent ? '' : 'none';

  // baseUrl
  const baseUrlEl = document.getElementById('ollamaBaseUrl');
  if (baseUrlEl && !baseUrlEl.dataset.dirty) {
    baseUrlEl.value = config.ollama?.baseUrl || 'http://localhost:11434';
  }

  // apiMode
  const apiModeEl = document.getElementById('ollamaApiMode');
  if (apiModeEl) apiModeEl.value = config.ollama?.apiMode || 'anthropic';

  // Models
  const ollamaModels = status?.ollamaModels || [];
  const mainSel = document.getElementById('ollamaMainModel');
  const smallSel = document.getElementById('ollamaSmallModel');
  const refreshBtn = document.getElementById('ollamaRefreshModelsBtn');
  const savedMain = config.ollama?.mainModel || '';
  const savedSmall = config.ollama?.smallModel || '';
  if (ollamaModels.length === 0) {
    if (savedMain || savedSmall) {
      populateModelSelect(mainSel, [], savedMain);
      populateModelSelect(smallSel, [], savedSmall);
    } else {
      mainSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
      smallSel.innerHTML = '<option>无模型数据，请先请求列表</option>';
    }
    if (refreshBtn) refreshBtn.style.display = '';
  } else {
    populateModelSelect(mainSel, ollamaModels, savedMain || ollamaModels[0]?.id || '');
    populateModelSelect(smallSel, ollamaModels, savedSmall || ollamaModels[0]?.id || '');
    if (refreshBtn) refreshBtn.style.display = 'none';
  }

  // Passthrough toggle
  const passthroughEl = document.getElementById('ollamaPassthrough');
  if (passthroughEl) passthroughEl.checked = config.ollama?.passthroughModel ?? true;
}

let ollamaSaveTimer = null;
async function saveOllamaConfig() {
  if (!config) return;
  // Debounce to avoid spamming API on text input
  if (ollamaSaveTimer) clearTimeout(ollamaSaveTimer);
  ollamaSaveTimer = setTimeout(async () => {
    const updated = {
      ...config,
      ollama: {
        ...config.ollama,
        baseUrl: document.getElementById('ollamaBaseUrl').value.trim() || 'http://localhost:11434',
        apiMode: document.getElementById('ollamaApiMode').value,
        mainModel: document.getElementById('ollamaMainModel').value,
        smallModel: document.getElementById('ollamaSmallModel').value,
        passthroughModel: document.getElementById('ollamaPassthrough').checked,
      }
    };
    try {
      config = await api('/api/config', {
        method: 'PUT',
        headers: {'content-type':'application/json'},
        body: JSON.stringify(updated),
      });
    } catch(e) {
      console.warn('Save Ollama config failed:', e);
    }
  }, 600);
}

async function addDeepSeekKey() {
  const key = document.getElementById('deepseekNewKeyValue').value.trim();
  if (!key) { alert('请输入 Key'); return; }
  const label = document.getElementById('deepseekNewKeyLabel').value.trim();
  const resultEl = document.getElementById('addDeepSeekKeyResult');
  try {
    await api('/api/config/deepseek/keys', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({label, key}),
    });
    document.getElementById('deepseekNewKeyLabel').value = '';
    document.getElementById('deepseekNewKeyValue').value = '';
    resultEl.innerHTML = '<div class="alert alert-success" style="margin-top:8px">Key 已添加</div>';
    await loadAll();
    setTimeout(() => resultEl.innerHTML = '', 3000);
  } catch(e) {
    resultEl.innerHTML = '<div class="alert alert-error" style="margin-top:8px">添加失败：' + escHtml(e.message) + '</div>';
  }
}

async function deleteDeepSeekKey(id) {
  if (status?.provider === 'deepseek' && (config?.deepseek?.keys?.length ?? 0) <= 1) {
    alert('当前 DeepSeek 是活跃 Provider，且只有 1 个 Key，无法删除。请先切换到其他 Provider 或添加新 Key 后再删除。');
    return;
  }
  if (id === config?.deepseek?.activeKeyId && (config?.deepseek?.keys?.length ?? 0) > 1) {
    if (!confirm('正在删除当前活跃 Key，删除后将自动切换到其他 Key，确认继续？')) return;
  } else {
    if (!confirm('确认删除该 Key？')) return;
  }
  try {
    await api('/api/config/deepseek/keys/' + id, {method:'DELETE'});
    await loadAll();
  } catch(e) {
    alert('删除失败：' + e.message);
  }
}

async function activateDeepSeekKey(id) {
  try {
    await api('/api/config/deepseek/keys/' + id + '/activate', {method:'PUT'});
    await loadAll();
  } catch(e) {
    alert('激活失败：' + e.message);
  }
}

async function saveDeepSeekModelConfig() {
  if (!config) return;
  const updated = {
    ...config,
    deepseek: {
      ...config.deepseek,
      mainModel: document.getElementById('deepseekMainModel').value,
      smallModel: document.getElementById('deepseekSmallModel').value,
    }
  };
  try {
    config = await api('/api/config', {
      method: 'PUT',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(updated),
    });
  } catch(e) {
    console.warn('Save DeepSeek model config failed:', e);
  }
}

async function addMimoKey() {
  const key = document.getElementById('mimoNewKeyValue').value.trim();
  if (!key) { alert('请输入 Key'); return; }
  const resultEl = document.getElementById('addMimoKeyResult');
  try {
    await api('/api/config/mimo/keys', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({label, key}),
    });
    document.getElementById('mimoNewKeyLabel').value = '';
    document.getElementById('mimoNewKeyValue').value = '';
    resultEl.innerHTML = '<div class="alert alert-success" style="margin-top:8px">Key 已添加</div>';
    await loadAll();
    setTimeout(() => resultEl.innerHTML = '', 3000);
  } catch(e) {
    resultEl.innerHTML = '<div class="alert alert-error" style="margin-top:8px">添加失败：' + escHtml(e.message) + '</div>';
  }
}

async function deleteMimoKey(id) {
  if (status?.provider === 'mimo' && (config?.mimo?.keys?.length ?? 0) <= 1) {
    alert('当前 MiMo 是活跃 Provider，且只有 1 个 Key，无法删除。请先切换到其他 Provider 或添加新 Key 后再删除。');
    return;
  }
  if (id === config?.mimo?.activeKeyId && (config?.mimo?.keys?.length ?? 0) > 1) {
    if (!confirm('正在删除当前活跃 Key，删除后将自动切换到其他 Key，确认继续？')) return;
  } else {
    if (!confirm('确认删除该 Key？')) return;
  }
  try {
    await api('/api/config/mimo/keys/' + id, {method:'DELETE'});
    await loadAll();
  } catch(e) {
    alert('删除失败：' + e.message);
  }
}

async function activateMimoKey(id) {
  try {
    await api('/api/config/mimo/keys/' + id + '/activate', {method:'PUT'});
    await loadAll();
  } catch(e) {
    alert('激活失败：' + e.message);
  }
}

async function saveMimoModelConfig() {
  if (!config) return;
  const updated = {
    ...config,
    mimo: {
      ...config.mimo,
      mainModel: document.getElementById('mimoMainModel').value,
      smallModel: document.getElementById('mimoSmallModel').value,
    }
  };
  try {
    config = await api('/api/config', {
      method: 'PUT',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(updated),
    });
  } catch(e) {
    console.warn('Save MiMo model config failed:', e);
  }
}

function populateModelSelect(sel, models, currentValue) {
  const current = sel.value || currentValue;
  sel.innerHTML = '';
  const values = models.map(m => m.id || m);
  const allValues = current && !values.includes(current) ? [current, ...values] : values;
  allValues.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    if (id === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderCommands() {
  if (!status) return;
  const port = status.port || 4141;
  const base = 'http://localhost:' + port;
  let mainModel, smallModel;
  if (status.provider === 'openai') {
    mainModel = config?.openai?.mainModel;
    smallModel = config?.openai?.smallModel;
  } else if (status.provider === 'mimo') {
    mainModel = config?.mimo?.mainModel;
    smallModel = config?.mimo?.smallModel;
  } else if (status.provider === 'claude') {
    mainModel = config?.claude?.mainModel;
    smallModel = config?.claude?.smallModel;
  } else if (status.provider === 'ollama') {
    mainModel = config?.ollama?.mainModel;
    smallModel = config?.ollama?.smallModel;
  } else if (status.provider === 'kiro') {
    mainModel = config?.kiro?.mainModel;
    smallModel = config?.kiro?.smallModel;
  } else {
    mainModel = config?.copilot?.mainModel;
    smallModel = config?.copilot?.smallModel;
  }
  mainModel = mainModel || 'claude-sonnet-4-6';
  smallModel = smallModel || 'gpt-5-mini';
  const claudeCmd = [
    'ANTHROPIC_BASE_URL=' + base,
    'ANTHROPIC_AUTH_TOKEN=dummy',
    'ANTHROPIC_MODEL=' + mainModel,
    'ANTHROPIC_DEFAULT_SONNET_MODEL=' + mainModel,
    'ANTHROPIC_SMALL_FAST_MODEL=' + smallModel,
    'ANTHROPIC_DEFAULT_HAIKU_MODEL=' + smallModel,
    'DISABLE_NON_ESSENTIAL_MODEL_CALLS=1',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
    'claude',
  ].join(' ');
  const codexCmd = 'OPENAI_BASE_URL=' + base + '/v1 OPENAI_API_KEY=dummy codex';
  document.getElementById('claudeCmd').value = claudeCmd;
  document.getElementById('codexCmd').value = codexCmd;
  const logDirEl = document.getElementById('logDirPath');
  if (logDirEl && status.logDir) logDirEl.value = status.logDir;
}

async function loadCopilotUsage() {
  try {
    const usage = await api('/api/usage/copilot');
    if (!status) status = {};
    status.copilotUsage = usage;
    renderCopilotSection();
  } catch(e) {
    alert('查询失败：' + e.message);
  }
}

async function addKey() {
  const label = document.getElementById('newKeyLabel').value.trim() || 'Key ' + Date.now();
  const key = document.getElementById('newKeyValue').value.trim();
  if (!key) { alert('请输入 Key'); return; }
  const resultEl = document.getElementById('addKeyResult');
  try {
    await api('/api/config/openai/keys', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({label, key}),
    });
    document.getElementById('newKeyLabel').value = '';
    document.getElementById('newKeyValue').value = '';
    resultEl.innerHTML = '<div class="alert alert-success" style="margin-top:8px">Key 已添加</div>';
    await loadAll();
    setTimeout(() => resultEl.innerHTML = '', 3000);
  } catch(e) {
    resultEl.innerHTML = '<div class="alert alert-error" style="margin-top:8px">添加失败：' + escHtml(e.message) + '</div>';
  }
}

async function deleteKey(id) {
  if (status?.provider === 'openai' && (config?.openai?.keys?.length ?? 0) <= 1) {
    alert('当前 OpenAI 是活跃 Provider，且只有 1 个 Key，无法删除。请先切换到其他 Provider 或添加新 Key 后再删除。');
    return;
  }
  if (id === config?.openai?.activeKeyId && (config?.openai?.keys?.length ?? 0) > 1) {
    if (!confirm('正在删除当前活跃 Key，删除后将自动切换到其他 Key，确认继续？')) return;
  } else {
    if (!confirm('确认删除该 Key？')) return;
  }
  try {
    await api('/api/config/openai/keys/' + id, {method:'DELETE'});
    await loadAll();
  } catch(e) {
    alert('删除失败：' + e.message);
  }
}

async function activateKey(id) {
  try {
    await api('/api/config/openai/keys/' + id + '/activate', {method:'PUT'});
    await loadAll();
  } catch(e) {
    alert('激活失败：' + e.message);
  }
}

async function saveCopilotConfig() {
  if (!config) return;
  const updated = {
    ...config,
    copilot: {
      ...config.copilot,
      mainModel: document.getElementById('copilotMainModel').value,
      smallModel: document.getElementById('copilotSmallModel').value,
      force: document.getElementById('copilotForce').checked,
    }
  };
  try {
    config = await api('/api/config', {
      method: 'PUT',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(updated),
    });
  } catch(e) {
    console.warn('Save copilot config failed:', e);
  }
}

async function saveAutoSwitchConfig() {
  if (!config) return;
  const updated = { ...config, autoSwitch: document.getElementById('autoSwitch').checked };
  try {
    config = await api('/api/config', {
      method: 'PUT',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(updated),
    });
  } catch(e) {
    console.warn('Save auto-switch config failed:', e);
  }
}

async function saveOpenAIModelConfig() {
  if (!config) return;
  const updated = {
    ...config,
    openai: {
      ...config.openai,
      mainModel: document.getElementById('openaiMainModel').value,
      smallModel: document.getElementById('openaiSmallModel').value,
    }
  };
  try {
    config = await api('/api/config', {
      method: 'PUT',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(updated),
    });
  } catch(e) {
    console.warn('Save OpenAI model config failed:', e);
  }
}

async function switchProvider(provider) {
  try {
    await api('/api/provider/switch', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({provider}),
    });
    await loadAll();
  } catch(e) {
    alert('切换失败：' + e.message);
  }
}

async function resetKeyExhausted(id) {
  try {
    await api('/api/config/openai/keys/' + id + '/reset-exhausted', {method: 'POST'});
    await loadAll();
  } catch(e) {
    alert('重置失败：' + e.message);
  }
}

async function refreshModels(provider) {
  const btnId = provider === 'copilot' ? 'copilotRefreshModelsBtn'
    : provider === 'mimo' ? 'mimoRefreshModelsBtn'
    : provider === 'claude' ? 'claudeRefreshModelsBtn'
    : provider === 'ollama' ? 'ollamaRefreshModelsBtn'
    : provider === 'kiro' ? 'kiroRefreshModelsBtn'
    : provider === 'deepseek' ? 'deepseekRefreshModelsBtn'
    : 'openaiRefreshModelsBtn';
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = '请求中...'; }
  try {
    const result = await api('/api/models/refresh', {
      method:'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({provider}),
    });
    if (!status) status = {};
    if (provider === 'copilot') {
      status.copilotModels = result.models;
      renderCopilotSection();
    } else if (provider === 'mimo') {
      status.mimoModels = result.models;
      renderMimoSection();
    } else if (provider === 'claude') {
      status.claudeModels = result.models;
      renderClaudeSection();
    } else if (provider === 'ollama') {
      status.ollamaModels = result.models;
      renderOllamaSection();
    } else if (provider === 'kiro') {
      status.kiroModels = result.models;
      renderKiroSection();
    } else if (provider === 'deepseek') {
      status.deepseekModels = result.models;
      renderDeepSeekSection();
    } else {
      status.openaiModels = result.models;
      renderOpenAISection();
    }
  } catch(e) {
    alert('获取模型列表失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 请求模型列表'; }
  }
}

async function applyEnvVars() {
  const resultEl = document.getElementById('envResult');
  resultEl.innerHTML = '<span style="color:#666;font-size:13px">正在写入...</span>';
  try {
    const result = await api('/api/apply-env', {method:'POST'});
    if (result.success) {
      resultEl.innerHTML = '<div class="alert alert-success">✅ 环境变量已写入，新开终端即可生效</div>';
    } else {
      resultEl.innerHTML = '<div class="alert alert-error">⚠️ 部分写入失败：' + escHtml(result.errors.join(', ')) + '</div>';
    }
  } catch(e) {
    resultEl.innerHTML = '<div class="alert alert-error">失败：' + escHtml(e.message) + '</div>';
  }
}

async function clearEnvVars() {
  const resultEl = document.getElementById('envResult');
  resultEl.innerHTML = '<span style="color:#666;font-size:13px">正在清除...</span>';
  try {
    const result = await api('/api/clear-env', {method:'POST'});
    if (result.success) {
      resultEl.innerHTML = '<div class="alert alert-success">✅ 环境变量已清除，新开终端即可生效</div>';
    } else {
      resultEl.innerHTML = '<div class="alert alert-error">⚠️ 部分清除失败：' + escHtml(result.errors.join(', ')) + '</div>';
    }
  } catch(e) {
    resultEl.innerHTML = '<div class="alert alert-error">失败：' + escHtml(e.message) + '</div>';
  }
}

function copyText(id) {
  const el = document.getElementById(id);
  el.select();
  document.execCommand('copy');
  const btn = el.nextElementSibling;
  btn.textContent = '已复制';
  setTimeout(() => btn.textContent = '复制', 2000);
}

function toggleCard(header) {
  header.classList.toggle('collapsed');
  const body = header.nextElementSibling;
  body.classList.toggle('hidden');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Init
loadAll();
setInterval(loadAll, 30000);
`
