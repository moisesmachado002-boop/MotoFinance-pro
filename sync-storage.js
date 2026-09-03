'use strict';
(function () {
  const LOCAL_TIME = 'motofinance_local_updated_at_v1';
  const BACKUP_HISTORY = 'motofinance_sync_backup_history_v2';
  const META_PREFIX = 'motofinance_sync_meta_v2:';
  const USER_STATE_PREFIX = 'motofinance_user_state_v1:';
  const ANON_STATE = 'motofinance_anonymous_state_v1';
  const OWNER = 'motofinance_local_owner_v1';
  const STORAGE = window.MotoFinanceSyncConfig.storageKey;
  const MAX_BACKUPS = 3;
  const MAX_BACKUP_CHARS = 750000;

  function get(key) { try { return localStorage.getItem(key); } catch (error) { console.error(error); return null; } }
  function set(key, value) { try { localStorage.setItem(key, value); return true; } catch (error) { console.error(error); return false; } }
  function mustSet(key, value) { if (!set(key, value)) throw new Error('Falha ao gravar metadados locais.'); }
  function readState() { const value = raw(); if (!value) return null; try { return JSON.parse(value); } catch (error) { console.error(error); return null; } }
  function raw() { return get(STORAGE); }
  function touch(value = new Date().toISOString()) { mustSet(LOCAL_TIME, value); return value; }
  function localUpdatedAt() { return get(LOCAL_TIME); }
  function ensureTime(isMeaningful) { if (!localUpdatedAt() && isMeaningful(readState())) touch(); }
  function readMeta(userId) { if (!userId) return {}; try { return JSON.parse(get(META_PREFIX + userId) || '{}') || {}; } catch { return {}; } }
  function writeMeta(userId, patch) {
    if (!userId) return {};
    const next = { ...readMeta(userId), ...patch };
    mustSet(META_PREFIX + userId, JSON.stringify(next));
    return next;
  }
  function backupRaw(reason, value = raw()) {
    if (!value || value.length > MAX_BACKUP_CHARS) return false;
    let list = [];
    try { list = JSON.parse(get(BACKUP_HISTORY) || '[]'); if (!Array.isArray(list)) list = []; } catch { list = []; }
    if (list[0]?.raw === value) return true;
    list.unshift({ savedAt: new Date().toISOString(), reason: String(reason || 'automatic'), raw: value });
    return set(BACKUP_HISTORY, JSON.stringify(list.slice(0, MAX_BACKUPS)));
  }
  function backupHistory() { try { const value = JSON.parse(get(BACKUP_HISTORY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
  function replaceState(nextState, updatedAt, reason = 'replace') {
    const previousRaw = raw();
    if (previousRaw && !backupRaw(reason, previousRaw)) return false;
    let nextRaw;
    try { nextRaw = JSON.stringify(nextState); } catch (error) { console.error(error); return false; }
    if (!set(STORAGE, nextRaw)) return false;
    try { touch(updatedAt || new Date().toISOString()); } catch (error) { console.error(error); return false; }
    return true;
  }
  function owner() { return get(OWNER) || null; }
  function setOwner(userId) { if (userId) mustSet(OWNER, userId); else localStorage.removeItem(OWNER); }
  function saveUserSnapshot(userId, value = raw()) { if (!userId || !value) return false; mustSet(USER_STATE_PREFIX + userId, value); return true; }
  function readUserSnapshot(userId) { return userId ? get(USER_STATE_PREFIX + userId) : null; }
  function saveAnonymousSnapshot(value = raw()) { if (!value) return false; mustSet(ANON_STATE, value); return true; }
  function readAnonymousSnapshot() { return get(ANON_STATE); }
  function replaceRaw(value, reason = 'account-switch') {
    if (!value) return false;
    const previousRaw = raw();
    if (previousRaw && !backupRaw(reason, previousRaw)) return false;
    if (!set(STORAGE, value)) return false;
    try { touch(); } catch (error) { console.error(error); return false; }
    return true;
  }

  window.MotoFinanceSyncStorage = {
    STORAGE, readState, raw, touch, localUpdatedAt, ensureTime, readMeta, writeMeta,
    backupRaw, backupHistory, replaceState, replaceRaw, owner, setOwner,
    saveUserSnapshot, readUserSnapshot, saveAnonymousSnapshot, readAnonymousSnapshot
  };
})();
