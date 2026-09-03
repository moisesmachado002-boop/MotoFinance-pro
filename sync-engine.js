'use strict';
(function () {
  const Core = window.MotoFinanceSyncCore;
  const UI = window.MotoFinanceSyncUI;
  const Store = window.MotoFinanceSyncStorage;
  const AppCore = window.MotoFinanceCore;

  async function start(client) {
    let session = null;
    let userId = null;
    let decision = null;
    let pending = null;
    let status = navigator.onLine ? 'Entre para sincronizar' : 'Offline';
    let observed = Store.raw();
    let previousState = Store.readState();
    let busy = false;
    let timer = null;
    let localOnlyIntent = null;
    const remote = Core.createRemoteStore(client, () => userId);

    const meta = () => Store.readMeta(userId);
    function patchMeta(patch) {
      try { return Store.writeMeta(userId, patch); }
      catch (error) { console.error(error); status = 'Erro de sincronização'; render(); return null; }
    }
    const localState = () => Store.readState();
    const render = () => UI.render({ session, status, lastSyncAt: userId ? meta().lastSyncAt : null, decision });
    const setStatus = value => { status = value; render(); };
    const localMeta = () => Core.normalizeSyncMeta(meta().syncMeta, localState(), Store.localUpdatedAt());

    function choose(kind, remoteRow, options = {}) {
      Store.ensureTime(Core.isMeaningfulState);
      pending = { kind, remoteRow: remoteRow || null };
      decision = {
        kind, localUpdatedAt: Store.localUpdatedAt(), remoteUpdatedAt: remoteRow?.updated_at || null,
        canMerge: options.canMerge !== false, conflictCount: options.conflictCount || 0
      };
      status = kind === 'conflict' ? 'Conflito encontrado' : 'Escolha necessária';
      render();
    }
    function clearChoice() { decision = null; pending = null; }
    function adoptAccount(state, syncMeta) {
      try {
        if (!Store.owner()) Store.saveAnonymousSnapshot(Store.raw());
        Store.setOwner(userId);
        Store.saveUserSnapshot(userId);
        if (syncMeta) patchMeta({ syncMeta });
        return true;
      } catch (error) { console.error(error); setStatus('Erro de sincronização'); return false; }
    }
    function markSynced(row, state, syncMeta) {
      const normalized = Core.normalizeSyncMeta(syncMeta || row?.sync_meta || meta().syncMeta, state, row?.updated_at || Store.localUpdatedAt());
      if (!patchMeta({ cloudEnabled: true, remoteVersion: row?.version ?? null, lastSyncedHash: Core.hashState(state), lastSyncAt: row?.updated_at || new Date().toISOString(), syncMeta: normalized })) return;
      adoptAccount(state, normalized);
      clearChoice();
      setStatus('Sincronizado');
    }

    async function isolateAccount() {
      const currentOwner = Store.owner();
      if (!userId || !currentOwner || currentOwner === userId) return false;
      try {
        Store.saveUserSnapshot(currentOwner);
        const target = Store.readUserSnapshot(userId);
        const nextRaw = target || JSON.stringify(AppCore.createInitialState());
        if (!Store.replaceRaw(nextRaw, 'account-isolation')) throw new Error('Falha ao trocar dados locais da conta.');
        Store.setOwner(userId);
        observed = Store.raw(); previousState = Store.readState();
        location.reload();
        return true;
      } catch (error) { console.error(error); setStatus('Erro de sincronização'); return true; }
    }

    async function saveLocalOverRemote(state, remoteRow, syncMeta = localMeta()) {
      setStatus('Salvando');
      try {
        const row = remoteRow ? await remote.update(state, syncMeta, remoteRow.version) : await remote.insert(state, syncMeta);
        if (!row) { choose('conflict', await remote.read()); return false; }
        markSynced(row, state, row.sync_meta || syncMeta);
        return true;
      } catch (error) {
        console.error(error);
        try { const latest = await remote.read(); if (latest) { choose('conflict', latest); return false; } } catch (nested) { console.error(nested); }
        setStatus(navigator.onLine ? 'Erro de sincronização' : 'Offline');
        return false;
      }
    }

    async function useRemote(row) {
      if (!row?.data) return false;
      if (!Store.replaceState(row.data, row.updated_at, 'use-remote')) { setStatus('Erro de sincronização'); return false; }
      observed = Store.raw(); previousState = Store.readState();
      markSynced(row, row.data, row.sync_meta);
      location.reload();
      return true;
    }

    async function merge(row) {
      const result = Core.mergeStates(localState(), row?.data || null, localMeta(), row?.sync_meta, Store.localUpdatedAt(), row?.updated_at);
      if (result.conflicts.length) {
        choose('conflict', row, { canMerge: false, conflictCount: result.conflicts.length });
        return false;
      }
      if (!Store.replaceState(result.state, undefined, 'merge')) { setStatus('Erro de sincronização'); return false; }
      observed = Store.raw(); previousState = Store.readState();
      if (!patchMeta({ syncMeta: result.meta })) return false;
      const saved = await saveLocalOverRemote(result.state, row, result.meta);
      if (saved) location.reload();
      return saved;
    }

    async function firstCheck() {
      if (!session || !userId) return;
      if (await isolateAccount()) return;
      if (!navigator.onLine) { setStatus('Offline'); return; }
      if (meta().cloudEnabled) { await reconcile(); return; }
      try {
        const row = await remote.read();
        const local = localState();
        const kind = Core.classifyCopies(local, row);
        if (kind === 'empty') {
          const syncMeta = Core.normalizeSyncMeta(meta().syncMeta, local, Store.localUpdatedAt());
          patchMeta({ cloudEnabled: true, remoteVersion: row?.version ?? null, lastSyncedHash: Core.hashState(local), lastSyncAt: new Date().toISOString(), syncMeta });
          adoptAccount(local, syncMeta); setStatus('Sincronizado'); return;
        }
        if (kind === 'same') { markSynced(row, local, row?.sync_meta); return; }
        choose(kind, row);
      } catch (error) { console.error(error); setStatus(navigator.onLine ? 'Erro de sincronização' : 'Offline'); }
    }

    async function reconcile() {
      if (!session || !userId || busy) return;
      if (!navigator.onLine) { setStatus('Offline'); return; }
      if (!meta().cloudEnabled) { await firstCheck(); return; }
      busy = true; setStatus('Salvando');
      try {
        const local = localState(); const syncMeta = localMeta(); const row = await remote.read();
        if (!row) {
          if (Core.isMeaningfulState(local)) await saveLocalOverRemote(local, null, syncMeta);
          else markSynced(null, local, syncMeta);
          return;
        }
        const localHash = Core.hashState(local); const remoteHash = Core.hashState(row.data);
        if (localHash === remoteHash) { markSynced(row, local, row.sync_meta || syncMeta); return; }
        const saved = meta(); const lastHash = saved.lastSyncedHash || null;
        const remoteChanged = Boolean(lastHash && remoteHash !== lastHash);
        const versionChanged = saved.remoteVersion != null && Number(row.version) !== Number(saved.remoteVersion);
        if (!lastHash || remoteChanged || versionChanged) { choose('conflict', row); return; }
        const updated = await remote.update(local, syncMeta, row.version);
        if (!updated) { choose('conflict', await remote.read()); return; }
        markSynced(updated, local, updated.sync_meta || syncMeta);
      } catch (error) { console.error(error); setStatus(navigator.onLine ? 'Erro de sincronização' : 'Offline'); }
      finally { busy = false; }
    }

    async function signOutSafely() {
      try {
        if (userId) Store.saveUserSnapshot(userId);
        const anonymous = Store.readAnonymousSnapshot() || JSON.stringify(AppCore.createInitialState());
        if (!Store.replaceRaw(anonymous, 'signout-account-isolation')) throw new Error('Falha ao separar os dados da conta.');
        Store.setOwner(null); observed = Store.raw(); previousState = Store.readState();
        await client.auth.signOut(); location.reload();
      } catch (error) { console.error(error); setStatus('Erro de sincronização'); }
    }

    async function action(name) {
      if (name === 'signout') { await signOutSafely(); return; }
      if (!session) return;
      if (name === 'sync-now') { if (meta().cloudEnabled) await reconcile(); else await firstCheck(); return; }
      if (name === 'download-auto-backup') { UI.downloadBackup(Store.backupHistory()); return; }
      if (!pending) return;
      const row = pending.remoteRow;
      if (name === 'later') { adoptAccount(localState(), localMeta()); patchMeta({ cloudEnabled: false }); clearChoice(); setStatus(navigator.onLine ? 'Somente neste aparelho' : 'Offline'); return; }
      if (name === 'upload-local' || name === 'use-local') { adoptAccount(localState(), localMeta()); patchMeta({ cloudEnabled: true }); await saveLocalOverRemote(localState(), row, localMeta()); return; }
      if (name === 'use-remote') { patchMeta({ cloudEnabled: true }); await useRemote(row); return; }
      if (name === 'merge') { patchMeta({ cloudEnabled: true }); await merge(row); }
    }

    function schedule() { clearTimeout(timer); timer = setTimeout(() => { if (session && meta().cloudEnabled && !decision) reconcile(); }, 550); }
    function armLocalOnly(kind) { localOnlyIntent = { kind, expiresAt: Date.now() + 120000 }; }
    function cancelLocalOnly() { localOnlyIntent = null; }
    function consumeLocalChange(nextState) {
      const now = new Date().toISOString();
      const nextMeta = Core.diffSyncMeta(previousState, nextState, meta().syncMeta, now);
      patchMeta({ syncMeta: nextMeta });
      previousState = nextState;
      if (userId && Store.owner() === userId) { try { Store.saveUserSnapshot(userId); } catch (error) { console.error(error); setStatus('Erro de sincronização'); return; } }
      if (localOnlyIntent && localOnlyIntent.expiresAt >= Date.now()) {
        patchMeta({ cloudEnabled: false });
        localOnlyIntent = null; clearChoice(); setStatus(navigator.onLine ? 'Somente neste aparelho' : 'Offline');
        return;
      }
      localOnlyIntent = null; schedule();
    }

    UI.init({ action });
    Store.ensureTime(Core.isMeaningfulState); render();
    document.addEventListener('click', event => {
      if (event.target.closest('[data-action="clear-data"]')) armLocalOnly('clear');
      if (event.target.closest('#confirmCancel')) cancelLocalOnly();
    }, true);
    const restoreInput = document.getElementById('restoreInput');
    if (restoreInput) restoreInput.addEventListener('change', () => armLocalOnly('restore'), true);
    const confirmDialog = document.getElementById('confirmDialog');
    if (confirmDialog) confirmDialog.addEventListener('cancel', cancelLocalOnly, true);

    const current = await client.auth.getSession();
    session = current.data?.session || null; userId = session?.user?.id || null;
    if (session) await firstCheck(); else render();

    client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession || null; userId = session?.user?.id || null; clearChoice();
      if (!session) { status = navigator.onLine ? 'Entre para sincronizar' : 'Offline'; render(); return; }
      setTimeout(firstCheck, 0);
    });
    window.addEventListener('online', () => { setStatus(session ? 'Salvando' : 'Entre para sincronizar'); if (session) schedule(); });
    window.addEventListener('offline', () => setStatus('Offline'));
    window.addEventListener('storage', event => { if (event.key === Store.STORAGE) { observed = event.newValue; Store.touch(); consumeLocalChange(Store.readState()); } });
    setInterval(() => {
      const raw = Store.raw(); if (raw === observed) return;
      observed = raw;
      try { Store.touch(); } catch (error) { console.error(error); setStatus('Erro de sincronização'); return; }
      consumeLocalChange(Store.readState());
    }, 1200);
  }

  window.MotoFinanceSyncEngine = { start };
})();
