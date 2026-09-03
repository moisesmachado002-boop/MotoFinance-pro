'use strict';
(function () {
  const Core = window.MotoFinanceSyncCore;
  const UI = window.MotoFinanceSyncUI;
  const Store = window.MotoFinanceSyncStorage;

  async function start(client) {
    let session = null;
    let userId = null;
    let decision = null;
    let pending = null;
    let status = navigator.onLine ? 'Entre para sincronizar' : 'Offline';
    let observed = Store.raw();
    let busy = false;
    let timer = null;
    const remote = Core.createRemoteStore(client, () => userId);

    const meta = () => Store.readMeta(userId);
    const patchMeta = patch => Store.writeMeta(userId, patch);
    const localState = () => Store.readState();
    const render = () => UI.render({ session, status, lastSyncAt: userId ? meta().lastSyncAt : null, decision });
    const setStatus = value => { status = value; render(); };

    function choose(kind, remoteRow) {
      Store.ensureTime(Core.isMeaningfulState);
      pending = { kind, remoteRow: remoteRow || null };
      decision = { kind, localUpdatedAt: Store.localUpdatedAt(), remoteUpdatedAt: remoteRow?.updated_at || null };
      status = kind === 'conflict' ? 'Conflito encontrado' : 'Escolha necessária';
      render();
    }
    function clearChoice() { decision = null; pending = null; }
    function markSynced(row, state) {
      patchMeta({ cloudEnabled: true, remoteVersion: row?.version ?? null, lastSyncedHash: Core.hashState(state), lastSyncAt: row?.updated_at || new Date().toISOString() });
      clearChoice();
      setStatus('Sincronizado');
    }

    async function saveLocalOverRemote(state, remoteRow) {
      setStatus('Salvando');
      try {
        const row = remoteRow ? await remote.update(state, remoteRow.version) : await remote.insert(state);
        if (!row) { choose('conflict', await remote.read()); return false; }
        markSynced(row, state);
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
      if (!Store.replaceState(row.data, row.updated_at)) { setStatus('Erro de sincronização'); return false; }
      observed = Store.raw();
      markSynced(row, row.data);
      location.reload();
      return true;
    }

    async function merge(row) {
      const merged = Core.mergeStates(localState(), row?.data || null);
      if (!Store.replaceState(merged)) { setStatus('Erro de sincronização'); return false; }
      observed = Store.raw();
      return saveLocalOverRemote(merged, row);
    }

    async function firstCheck() {
      if (!session || !userId) return;
      if (!navigator.onLine) { setStatus('Offline'); return; }
      if (meta().cloudEnabled) { await reconcile(); return; }
      try {
        const row = await remote.read();
        const local = localState();
        const kind = Core.classifyCopies(local, row);
        if (kind === 'empty') { patchMeta({ cloudEnabled: true, remoteVersion: row?.version ?? null, lastSyncedHash: Core.hashState(local), lastSyncAt: new Date().toISOString() }); setStatus('Sincronizado'); return; }
        if (kind === 'same') { markSynced(row, local); return; }
        choose(kind, row);
      } catch (error) {
        console.error(error);
        setStatus(navigator.onLine ? 'Erro de sincronização' : 'Offline');
      }
    }

    async function reconcile() {
      if (!session || !userId || busy) return;
      if (!navigator.onLine) { setStatus('Offline'); return; }
      if (!meta().cloudEnabled) { await firstCheck(); return; }
      busy = true;
      setStatus('Salvando');
      try {
        const local = localState();
        const row = await remote.read();
        if (!row) {
          if (Core.isMeaningfulState(local)) await saveLocalOverRemote(local, null);
          else markSynced(null, local);
          return;
        }
        const localHash = Core.hashState(local);
        const remoteHash = Core.hashState(row.data);
        if (localHash === remoteHash) { markSynced(row, local); return; }
        const saved = meta();
        const lastHash = saved.lastSyncedHash || null;
        const remoteChanged = Boolean(lastHash && remoteHash !== lastHash);
        const versionChanged = saved.remoteVersion != null && Number(row.version) !== Number(saved.remoteVersion);
        if (!lastHash || remoteChanged || versionChanged) { choose('conflict', row); return; }
        const updated = await remote.update(local, row.version);
        if (!updated) { choose('conflict', await remote.read()); return; }
        markSynced(updated, local);
      } catch (error) {
        console.error(error);
        setStatus(navigator.onLine ? 'Erro de sincronização' : 'Offline');
      } finally { busy = false; }
    }

    async function action(name) {
      if (name === 'signout') { await client.auth.signOut(); return; }
      if (!session) return;
      if (name === 'sync-now') { if (meta().cloudEnabled) await reconcile(); else await firstCheck(); return; }
      if (!pending) return;
      const row = pending.remoteRow;
      if (name === 'later') { patchMeta({ cloudEnabled: false }); clearChoice(); setStatus(navigator.onLine ? 'Somente neste aparelho' : 'Offline'); return; }
      if (name === 'upload-local' || name === 'use-local') { patchMeta({ cloudEnabled: true }); await saveLocalOverRemote(localState(), row); return; }
      if (name === 'use-remote') { patchMeta({ cloudEnabled: true }); await useRemote(row); return; }
      if (name === 'merge') { patchMeta({ cloudEnabled: true }); await merge(row); }
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { if (session && meta().cloudEnabled && !decision) reconcile(); }, 550);
    }

    UI.init({ action });
    Store.ensureTime(Core.isMeaningfulState);
    render();
    const current = await client.auth.getSession();
    session = current.data?.session || null;
    userId = session?.user?.id || null;
    if (session) await firstCheck(); else render();

    client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession || null; userId = session?.user?.id || null; clearChoice();
      if (!session) { status = navigator.onLine ? 'Entre para sincronizar' : 'Offline'; render(); return; }
      setTimeout(firstCheck, 0);
    });
    window.addEventListener('online', () => { setStatus(session ? 'Salvando' : 'Entre para sincronizar'); if (session) schedule(); });
    window.addEventListener('offline', () => setStatus('Offline'));
    window.addEventListener('storage', event => { if (event.key === Store.STORAGE) { observed = event.newValue; Store.touch(); schedule(); } });
    setInterval(() => { const raw = Store.raw(); if (raw === observed) return; observed = raw; Store.touch(); schedule(); }, 1200);
  }

  window.MotoFinanceSyncEngine = { start };
})();
