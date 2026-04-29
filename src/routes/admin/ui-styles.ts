export const styles = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333;min-height:100vh}
.header{background:#1a1a2e;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.header h1{font-size:20px;font-weight:600}
.status-dot{width:10px;height:10px;border-radius:50%;background:#4caf50;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.provider-badge{margin-left:auto;background:rgba(255,255,255,.15);padding:4px 12px;border-radius:20px;font-size:13px}
.main{max-width:900px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:20px}
.card{background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden}
.card-header{padding:16px 20px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:8px;font-weight:600;font-size:15px;cursor:pointer;user-select:none}
.card-header .icon{font-size:18px}
.card-header .toggle{margin-left:auto;color:#999;transition:transform .2s}
.card-header.collapsed .toggle{transform:rotate(-90deg)}
.card-body{padding:20px}
.card-body.hidden{display:none}
.alert{padding:12px 16px;border-radius:8px;margin-bottom:12px;font-size:14px}
.alert-warning{background:#fff3cd;border:1px solid #ffc107;color:#856404}
.alert-success{background:#d4edda;border:1px solid #28a745;color:#155724}
.alert-error{background:#f8d7da;border:1px solid #dc3545;color:#721c24}
.alert-info{background:#d1ecf1;border:1px solid #17a2b8;color:#0c5460}
.form-row{display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.form-row label{font-size:13px;color:#666;white-space:nowrap;min-width:120px}
.form-row input,.form-row select{flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;min-width:160px}
.form-row input:focus,.form-row select:focus{outline:none;border-color:#007bff;box-shadow:0 0 0 2px rgba(0,123,255,.15)}
.btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all .2s;display:inline-flex;align-items:center;gap:6px}
.btn-primary{background:#007bff;color:#fff}
.btn-primary:hover{background:#0056b3}
.btn-danger{background:#dc3545;color:#fff}
.btn-danger:hover{background:#c82333}
.btn-success{background:#28a745;color:#fff}
.btn-success:hover{background:#218838}
.btn-outline{background:transparent;border:1px solid #ddd;color:#333}
.btn-outline:hover{background:#f5f5f5}
.btn-sm{padding:4px 10px;font-size:12px}
.btn:disabled{opacity:.6;cursor:not-allowed}
.key-list{display:flex;flex-direction:column;gap:8px}
.key-item{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #e0e0e0;border-radius:8px;background:#fafafa}
.key-item.active{border-color:#007bff;background:#f0f8ff}
.key-item.exhausted{border-color:#dc3545;background:#fff5f5;opacity:.8}
.key-label{font-weight:500;font-size:14px}
.key-value{font-family:monospace;font-size:12px;color:#666;flex:1}
.key-status{font-size:12px;padding:2px 8px;border-radius:10px;font-weight:500}
.status-active{background:#d4edda;color:#155724}
.status-exhausted{background:#f8d7da;color:#721c24}
.status-invalid{background:#fff3cd;color:#856404}
.key-requests{font-size:12px;color:#999;white-space:nowrap}
.actions{display:flex;gap:6px;margin-left:auto}
.switch-container{display:flex;align-items:center;gap:10px}
.toggle-switch{position:relative;width:44px;height:24px;cursor:pointer}
.toggle-switch input{opacity:0;width:0;height:0}
.slider{position:absolute;top:0;left:0;right:0;bottom:0;background:#ccc;border-radius:24px;transition:.3s}
.slider:before{position:absolute;content:'';height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.3s}
input:checked+.slider{background:#007bff}
input:checked+.slider:before{transform:translateX(20px)}
.usage-bar{height:8px;background:#eee;border-radius:4px;overflow:hidden;margin-top:4px}
.usage-fill{height:100%;border-radius:4px;transition:width .5s;background:#007bff}
.usage-fill.warning{background:#ffc107}
.usage-fill.danger{background:#dc3545}
.usage-text{font-size:12px;color:#666;margin-top:4px}
.command-box{display:flex;gap:8px;align-items:center}
.command-box input{flex:1;font-family:monospace;font-size:12px;background:#f8f8f8;border:1px solid #ddd;padding:8px 12px;border-radius:6px}
.section-divider{border:none;border-top:1px solid #eee;margin:16px 0}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid-3{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end;margin-bottom:12px}
@media(max-width:600px){.grid-2,.grid-3{grid-template-columns:1fr}.form-row{flex-direction:column;align-items:flex-start}.form-row label{min-width:0}}
.auth-flow{padding:16px;background:#f8f9ff;border-radius:8px;border:1px solid #dee2ff;text-align:center}
.code-display{font-size:32px;font-weight:700;letter-spacing:6px;color:#007bff;margin:12px 0;font-family:monospace}
.switch-log{font-size:13px}
.switch-log-item{padding:8px 12px;border-left:3px solid #ffc107;margin-bottom:8px;background:#fffbf0;border-radius:0 6px 6px 0}
.switch-log-time{color:#999;font-size:11px}
.link{color:#007bff;text-decoration:none}
.link:hover{text-decoration:underline}
.flex-gap{display:flex;gap:8px;flex-wrap:wrap}
.provider-panel{border:1px solid #e0e0e0;border-radius:10px;padding:16px;min-width:0}
.provider-panel.active-provider{border-color:#007bff;background:#f0f8ff}
.section-label{font-size:13px;font-weight:600;color:#555;margin-bottom:8px}
.account-list{list-style:none;display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.account-item{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #e0e0e0;border-radius:8px;background:#fafafa}
.account-active{border-color:#007bff;background:#f0f8ff}
.account-avatar{width:36px;height:36px;border-radius:50%;background:#e0e0e0;object-fit:cover;flex-shrink:0}
.account-avatar-placeholder{width:36px;height:36px;border-radius:50%;background:#c0c0c0;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;flex-shrink:0}
.account-info{flex:1;min-width:0}
.account-name{font-weight:600;font-size:14px}
.account-type{font-size:12px;color:#666}
.account-badge{font-size:11px;padding:2px 8px;border-radius:10px;background:#d4edda;color:#155724;white-space:nowrap}
.account-actions{display:flex;gap:6px;margin-left:auto}
.empty-state-item{padding:16px;color:#999;font-size:13px;text-align:center}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:100}
.modal-overlay.active{display:flex}
.modal{background:#fff;border-radius:12px;padding:24px;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.18)}
.modal-title{font-size:18px;font-weight:600;margin-bottom:16px}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
`
