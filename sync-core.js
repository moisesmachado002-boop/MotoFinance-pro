'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MotoFinanceSyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const TABLE = 'motofinance_state';
  const COLLECTIONS = ['vehicles', 'transactions', 'reminders', 'odometerLogs'];

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function hashState(value) {
    const text = stable(value); let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function isMeaningfulState(state) {
    if (!state || typeof state !== 'object') return false;
    if ((state.transactions || []).length || (state.odometerLogs || []).length) return true;
    if ((state.vehicles || []).length > 1) return true;
    if ((state.vehicles || []).some(v => Number(v?.odometer || 0) > 0 || String(v?.plate || '').trim())) return true;
    if ((state.reminders || []).some(item => item?.byKm || item?.byTime || (item?.history || []).length)) return true;
    if (state.migratedFromV6 && state.migrationSummary) return true;
    return Number(state.preferences?.weeklyGoal || 0) > 0 || Number(state.preferences?.monthlyGoal || 0) > 0;
  }
  function iso(value, fallback = '') {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
  }
  function itemTime(item, fallback = '') { return iso(item?.updatedAt || item?.createdAt || item?.date, fallback); }
  function emptySyncMeta() { return { schema: 2, top: {}, collections: Object.fromEntries(COLLECTIONS.map(name => [name, {}])) }; }
  function normalizeSyncMeta(meta, state, fallbackTime = '') {
    const next = emptySyncMeta();
    if (meta && typeof meta === 'object') {
      next.schema = 2; next.top = clone(meta.top || {});
      COLLECTIONS.forEach(name => { next.collections[name] = clone(meta.collections?.[name] || {}); });
    }
    const fallback = iso(fallbackTime, new Date(0).toISOString());
    for (const key of ['profile', 'preferences']) {
      if (!next.top[key]) next.top[key] = { updatedAt: fallback };
      else next.top[key].updatedAt = iso(next.top[key].updatedAt, fallback);
    }
    COLLECTIONS.forEach(name => {
      for (const item of state?.[name] || []) {
        if (item?.id == null) continue;
        const id = String(item.id); const old = next.collections[name][id] || {};
        next.collections[name][id] = { updatedAt: iso(old.updatedAt, itemTime(item, fallback)), deletedAt: old.deletedAt ? iso(old.deletedAt, old.deletedAt) : null };
      }
    });
    return next;
  }
  function diffSyncMeta(previousState, nextState, meta, now = new Date().toISOString()) {
    const stamp = iso(now, new Date().toISOString()); const next = normalizeSyncMeta(meta, previousState, stamp);
    for (const key of ['profile', 'preferences']) if (hashState(previousState?.[key] || {}) !== hashState(nextState?.[key] || {})) next.top[key] = { updatedAt: stamp };
    COLLECTIONS.forEach(name => {
      const before = new Map((previousState?.[name] || []).filter(item => item?.id != null).map(item => [String(item.id), item]));
      const after = new Map((nextState?.[name] || []).filter(item => item?.id != null).map(item => [String(item.id), item]));
      const ids = new Set([...before.keys(), ...after.keys()]);
      ids.forEach(id => {
        const oldItem = before.get(id); const newItem = after.get(id); const oldMeta = next.collections[name][id] || {};
        if (!newItem && oldItem) next.collections[name][id] = { updatedAt: stamp, deletedAt: stamp };
        else if (newItem && !oldItem) next.collections[name][id] = { updatedAt: stamp, deletedAt: null };
        else if (newItem && oldItem && hashState(newItem) !== hashState(oldItem)) next.collections[name][id] = { updatedAt: stamp, deletedAt: null };
        else if (newItem) next.collections[name][id] = { updatedAt: iso(oldMeta.updatedAt, itemTime(newItem, stamp)), deletedAt: null };
      });
    });
    return next;
  }
  function timeOf(entry, item, fallback) {
    const deleted = iso(entry?.deletedAt, ''); const updated = iso(entry?.updatedAt, itemTime(item, fallback));
    return { deleted, updated, latest: deleted && deleted >= updated ? deleted : updated, isDeleted: Boolean(deleted && deleted >= updated) };
  }
  function chooseRecord(localItem, remoteItem, localEntry, remoteEntry, localFallback, remoteFallback, id, collection, conflicts) {
    const lt = timeOf(localEntry, localItem, localFallback); const rt = timeOf(remoteEntry, remoteItem, remoteFallback);
    if (lt.latest > rt.latest) return lt.isDeleted ? null : clone(localItem);
    if (rt.latest > lt.latest) return rt.isDeleted ? null : clone(remoteItem);
    if (lt.isDeleted !== rt.isDeleted) return lt.isDeleted ? null : clone(remoteItem);
    if (lt.isDeleted && rt.isDeleted) return null;
    if (hashState(localItem) === hashState(remoteItem)) return clone(localItem || remoteItem);
    conflicts.push({ collection, id }); return null;
  }
  function mergeStates(localState, remoteState, localMeta, remoteMeta, localFallback = '', remoteFallback = '') {
    if (!remoteState) return { state: clone(localState), meta: normalizeSyncMeta(localMeta, localState, localFallback), conflicts: [] };
    if (!localState) return { state: clone(remoteState), meta: normalizeSyncMeta(remoteMeta, remoteState, remoteFallback), conflicts: [] };
    const lm = normalizeSyncMeta(localMeta, localState, localFallback); const rm = normalizeSyncMeta(remoteMeta, remoteState, remoteFallback);
    const merged = clone(remoteState); const outMeta = emptySyncMeta(); const conflicts = [];
    merged.version = Math.max(Number(localState.version || 0), Number(remoteState.version || 0));
    for (const key of ['profile', 'preferences']) {
      const ltime = iso(lm.top[key]?.updatedAt, localFallback); const rtime = iso(rm.top[key]?.updatedAt, remoteFallback);
      if (ltime > rtime) merged[key] = clone(localState[key]);
      else if (rtime > ltime) merged[key] = clone(remoteState[key]);
      else if (hashState(localState[key] || {}) !== hashState(remoteState[key] || {})) conflicts.push({ collection: key, id: key });
      else merged[key] = clone(localState[key]);
      outMeta.top[key] = { updatedAt: ltime >= rtime ? ltime : rtime };
    }
    COLLECTIONS.forEach(name => {
      const localMap = new Map((localState[name] || []).filter(x => x?.id != null).map(x => [String(x.id), x]));
      const remoteMap = new Map((remoteState[name] || []).filter(x => x?.id != null).map(x => [String(x.id), x]));
      const ids = new Set([...localMap.keys(), ...remoteMap.keys(), ...Object.keys(lm.collections[name]), ...Object.keys(rm.collections[name])]);
      const rows = [];
      ids.forEach(id => {
        const chosen = chooseRecord(localMap.get(id), remoteMap.get(id), lm.collections[name][id], rm.collections[name][id], localFallback, remoteFallback, id, name, conflicts);
        if (chosen) rows.push(chosen);
        const le = lm.collections[name][id] || {}; const re = rm.collections[name][id] || {};
        const lLatest = timeOf(le, localMap.get(id), localFallback); const rLatest = timeOf(re, remoteMap.get(id), remoteFallback);
        outMeta.collections[name][id] = lLatest.latest >= rLatest.latest
          ? { updatedAt: lLatest.updated || lLatest.latest, deletedAt: lLatest.isDeleted ? lLatest.latest : null }
          : { updatedAt: rLatest.updated || rLatest.latest, deletedAt: rLatest.isDeleted ? rLatest.latest : null };
      });
      merged[name] = rows;
    });
    merged.migratedFromV6 = Boolean(localState.migratedFromV6 || remoteState.migratedFromV6);
    merged.migrationSummary = localState.migrationSummary || remoteState.migrationSummary || null;
    return { state: merged, meta: outMeta, conflicts };
  }
  function classifyCopies(localState, remoteRow) {
    const localMeaningful = isMeaningfulState(localState); const remoteState = remoteRow?.data || null; const remoteMeaningful = isMeaningfulState(remoteState);
    if (!localMeaningful && !remoteMeaningful) return 'empty';
    if (localMeaningful && !remoteMeaningful) return 'local-only';
    if (!localMeaningful && remoteMeaningful) return 'remote-only';
    if (hashState(localState) === hashState(remoteState)) return 'same';
    return 'both';
  }
  function createAuthService(client, redirectUrl) {
    return {
      signUp: (email, password) => client.auth.signUp({ email, password, options: redirectUrl ? { emailRedirectTo: redirectUrl } : undefined }),
      signIn: (email, password) => client.auth.signInWithPassword({ email, password }),
      resetPassword: email => client.auth.resetPasswordForEmail(email, redirectUrl ? { redirectTo: redirectUrl } : undefined),
      updatePassword: password => client.auth.updateUser({ password }),
      signOut: () => client.auth.signOut()
    };
  }
  function createRemoteStore(client, getUserId, table = TABLE) {
    function uid() { const value = getUserId(); if (!value) throw new Error('Usuário não autenticado.'); return value; }
    return {
      async read() { const userId = uid(); const { data, error } = await client.from(table).select('user_id,data,sync_meta,updated_at,version').eq('user_id', userId).maybeSingle(); if (error) throw error; return data || null; },
      async insert(state, syncMeta) { const userId = uid(); const { data, error } = await client.from(table).insert({ user_id: userId, data: state, sync_meta: syncMeta || emptySyncMeta() }).select('user_id,data,sync_meta,updated_at,version').single(); if (error) throw error; return data; },
      async update(state, syncMeta, expectedVersion) { const userId = uid(); const { data, error } = await client.from(table).update({ data: state, sync_meta: syncMeta || emptySyncMeta(), version: Number(expectedVersion) + 1 }).eq('user_id', userId).eq('version', Number(expectedVersion)).select('user_id,data,sync_meta,updated_at,version').maybeSingle(); if (error) throw error; return data || null; },
      async remove() { const userId = uid(); const { error } = await client.from(table).delete().eq('user_id', userId); if (error) throw error; return true; }
    };
  }
  return { TABLE, COLLECTIONS, stable, hashState, isMeaningfulState, emptySyncMeta, normalizeSyncMeta, diffSyncMeta, mergeStates, classifyCopies, createAuthService, createRemoteStore };
});
