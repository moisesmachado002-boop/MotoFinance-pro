'use strict';
(async function () {
  const config = window.MotoFinanceSyncConfig;
  if (!config || !window.MotoFinanceSyncEngine) return;
  function load(src) {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve();
      const tag = document.createElement('script');
      tag.src = src; tag.async = true; tag.onload = resolve; tag.onerror = reject;
      document.head.appendChild(tag);
    });
  }
  try {
    if (!window.supabase) await load(config.sdk);
    const client = window.supabase.createClient(config.url, config.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    await window.MotoFinanceSyncEngine.start(client);
  } catch (error) {
    console.error('Falha ao iniciar sincronização.', error);
  }
})();
