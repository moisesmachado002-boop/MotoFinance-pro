'use strict';
(function () {
  const STORAGE = 'motofinance_pro_v1';
  const HISTORY = 'motofinance_sync_backup_history_v2';
  const MAX = 3;
  const MAX_CHARS = 750000;
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw || raw.length > MAX_CHARS) return;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(HISTORY) || '[]'); if (!Array.isArray(list)) list = []; } catch { list = []; }
    if (list[0]?.raw === raw) return;
    list.unshift({ savedAt: new Date().toISOString(), reason: 'pre-normalization', raw });
    localStorage.setItem(HISTORY, JSON.stringify(list.slice(0, MAX)));
  } catch (error) { console.warn('Não foi possível preservar a cópia pré-normalização.', error); }
})();
