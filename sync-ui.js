'use strict';
(function () {
  const STATUS_CLASS = {
    'Sincronizado': 'ok', 'Salvando': 'busy', 'Offline': 'offline',
    'Conflito encontrado': 'conflict', 'Erro de sincronização': 'error',
    'Somente neste aparelho': 'offline', 'Escolha necessária': 'busy'
  };
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
  function dateLabel(value) {
    if (!value) return 'sem registro';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'sem registro' : date.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
  }
  function ensureStyle() {
    if (document.getElementById('mfSyncStyle')) return;
    const style = document.createElement('style'); style.id = 'mfSyncStyle';
    style.textContent = `#mfSyncSection{margin-top:22px}.mf-sync-card{background:#fff;border:1px solid #e8e8e3;border-radius:18px;padding:18px;display:grid;gap:14px}.mf-sync-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.mf-sync-head strong{display:block;font-size:16px}.mf-sync-head small,.mf-sync-meta,.mf-sync-copy small{color:#73736d}.mf-sync-status{font-size:11px;font-weight:800;padding:6px 9px;border-radius:999px;background:#eee;white-space:nowrap}.mf-sync-status.ok{background:#e8f7ec;color:#176332}.mf-sync-status.busy{background:#fff5cc;color:#705b00}.mf-sync-status.offline{background:#efefef;color:#555}.mf-sync-status.conflict,.mf-sync-status.error{background:#ffeded;color:#8e2020}.mf-sync-actions{display:flex;flex-wrap:wrap;gap:8px}.mf-sync-actions button,.mf-sync-actions a{border:0;border-radius:11px;padding:10px 12px;font:inherit;font-weight:750;text-decoration:none;cursor:pointer;background:#171717;color:#fff}.mf-sync-actions .secondary{background:#f1f1ed;color:#262626}.mf-sync-actions .warn{background:#fff0d8;color:#6f4600}.mf-sync-decision{border-top:1px solid #eee;padding-top:14px;display:grid;gap:10px}.mf-sync-decision p{margin:0;color:#555;line-height:1.45;font-size:13px}.mf-sync-copies{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mf-sync-copy{padding:10px;border-radius:11px;background:#f6f6f3}.mf-sync-copy b{display:block;font-size:12px;margin-bottom:3px}@media(max-width:480px){.mf-sync-copies{grid-template-columns:1fr}.mf-sync-actions>*{flex:1;text-align:center}}`;
    document.head.appendChild(style);
  }
  function ensureSection() {
    let section = document.getElementById('mfSyncSection'); if (section) return section;
    const intro = document.getElementById('morePageIntro'); if (!intro) return null;
    section = document.createElement('section'); section.id = 'mfSyncSection'; section.className = 'settings-group';
    section.innerHTML = '<h2>Conta e nuvem</h2><div id="mfSyncCard" class="mf-sync-card"></div>';
    intro.insertAdjacentElement('afterend', section); return section;
  }
  function decisionHtml(decision) {
    if (!decision) return '';
    const copies = `<div class="mf-sync-copies"><div class="mf-sync-copy"><b>Neste aparelho</b><small>${esc(dateLabel(decision.localUpdatedAt))}</small></div><div class="mf-sync-copy"><b>Na nuvem</b><small>${esc(dateLabel(decision.remoteUpdatedAt))}</small></div></div>`;
    if (decision.kind === 'local-only') return `<div class="mf-sync-decision"><p>Há dados somente neste aparelho. Nada será enviado sem sua autorização.</p>${copies}<div class="mf-sync-actions"><button data-sync-action="upload-local">Enviar para a nuvem</button><button class="secondary" data-sync-action="later">Agora não</button></div></div>`;
    if (decision.kind === 'remote-only') return `<div class="mf-sync-decision"><p>Foi encontrada uma cópia na nuvem. Escolha antes de substituir os dados locais.</p>${copies}<div class="mf-sync-actions"><button data-sync-action="use-remote">Usar cópia da nuvem</button><button class="secondary" data-sync-action="later">Manter somente local</button></div></div>`;
    const conflictText = decision.conflictCount ? ` Há ${decision.conflictCount} item(ns) alterado(s) dos dois lados com a mesma prioridade; nesses casos a mesclagem automática foi bloqueada.` : '';
    const mergeButton = decision.canMerge === false ? '' : '<button class="warn" data-sync-action="merge">Mesclar com segurança</button>';
    return `<div class="mf-sync-decision"><p>${decision.kind === 'conflict' ? 'As duas cópias mudaram desde a última sincronização.' : 'Existem dados diferentes neste aparelho e na nuvem.'}${conflictText} Escolha qual deve prevalecer${decision.canMerge === false ? '.' : ' ou mescle as duas.'}</p>${copies}<div class="mf-sync-actions"><button data-sync-action="use-local">Usar local</button><button class="secondary" data-sync-action="use-remote">Usar nuvem</button>${mergeButton}<button class="secondary" data-sync-action="later">Agora não</button></div></div>`;
  }
  function downloadBackup(history) {
    if (!Array.isArray(history) || !history.length) return;
    const latest = history[0];
    const blob = new Blob([latest.raw], { type:'application/json' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'motofinance-backup-automatico-' + String(latest.savedAt || '').slice(0,10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  let actionHandler = null;
  function render(model) {
    ensureStyle(); if (!ensureSection()) return;
    const card = document.getElementById('mfSyncCard'); if (!card) return;
    const session = model?.session; const status = model?.status || (navigator.onLine ? 'Entre para sincronizar' : 'Offline'); const klass = STATUS_CLASS[status] || '';
    if (!session) {
      card.innerHTML = `<div class="mf-sync-head"><div><strong>Sincronização segura</strong><small>Os dados locais ficam neste aparelho até você entrar.</small></div><span class="mf-sync-status ${klass}">${esc(status)}</span></div><div class="mf-sync-actions"><a href="auth.html?mode=login">Entrar</a><a class="secondary" href="auth.html?mode=signup">Criar conta</a><a class="secondary" href="auth.html?mode=reset">Recuperar senha</a></div>`;
      return;
    }
    card.innerHTML = `<div class="mf-sync-head"><div><strong>${esc(session.user?.email || 'Conta conectada')}</strong><small>Dados separados por conta e protegidos por RLS</small></div><span class="mf-sync-status ${klass}">${esc(status)}</span></div><div class="mf-sync-meta">Última sincronização: ${esc(dateLabel(model.lastSyncAt))}</div><div class="mf-sync-actions"><button data-sync-action="sync-now">Sincronizar agora</button><button class="secondary" data-sync-action="download-auto-backup">Baixar backup automático</button><button class="secondary" data-sync-action="signout">Sair da conta</button></div>${decisionHtml(model.decision)}`;
  }
  function init(options = {}) {
    actionHandler = options.action || null; ensureStyle(); ensureSection();
    document.addEventListener('click', event => { const button = event.target.closest('[data-sync-action]'); if (!button || !actionHandler) return; event.preventDefault(); actionHandler(button.dataset.syncAction); });
  }
  window.MotoFinanceSyncUI = { init, render, dateLabel, downloadBackup };
})();
