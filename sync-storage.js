'use strict';
(function () {
  const LOCAL_TIME = 'motofinance_local_updated_at_v1';
  const BACKUP = 'motofinance_sync_last_local_backup';
  const META_PREFIX = 'motofinance_sync_meta_v1:';
  const STORAGE = window.MotoFinanceSyncConfig.storageKey;

  function get(key) {
    try { return localStorage.getItem(key); } catch (error) { console.error(error); return null; }
  }
  function set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (error) { console.error(error); return false; }
  }
  function readState() {
    const raw = get(STORAGE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (error) { console.error(error); return null; }
  }
  function raw() { return get(STORAGE); }
  function touch(value = new Date().toISOString()) { set(LOCAL_TIME, value); return value; }
  function localUpdatedAt() { return get(LOCAL_TIME); }
  function ensureTime(isMeaningful) {
    if (!localUpdatedAt() && isMeaningful(readState())) touch();
  }
  function readMeta(userId) {
    if (!userId) return {};
    try { return JSON.parse(get(META_PREFIX + userId) || '{}') || {}; } catch { return {}; }
  }
  function writeMeta(userId, patch) {
    if (!userId) return {};
    const next = { ...readMeta(userId), ...patch };
    set(META_PREFIX + userId, JSON.stringify(next));
    return next;
  }
  function replaceState(nextState, updatedAt) {
    const previousRaw = raw();
    const backup = JSON.stringify({ savedAt: new Date().toISOString(), raw: previousRaw });
    if (!set(BACKUP, backup)) return false;
    let nextRaw;
    try { nextRaw = JSON.stringify(nextState); } catch (error) { console.error(error); return false; }
    if (!set(STORAGE, nextRaw)) return false;
    touch(updatedAt || new Date().toISOString());
    return true;
  }

  window.MotoFinanceSyncStorage = { STORAGE, readState, raw, touch, localUpdatedAt, ensureTime, readMeta, writeMeta, replaceState };
})();
