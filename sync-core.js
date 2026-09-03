'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MotoFinanceSyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const TABLE = 'motofinance_state';
  function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function stable(value){
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+stable(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function hashState(value){
    const text = stable(value); let hash = 2166136261;
    for (let i=0;i<text.length;i+=1){ hash ^= text.charCodeAt(i); hash = Math.imul(hash,16777619); }
    return (hash>>>0).toString(16).padStart(8,'0');
  }
  function isMeaningfulState(state){
    if (!state || typeof state !== 'object') return false;
    if ((state.transactions||[]).length || (state.odometerLogs||[]).length) return true;
    if ((state.vehicles||[]).some(v => Number(v?.odometer||0)>0 || String(v?.plate||'').trim())) return true;
    return Number(state.preferences?.weeklyGoal||0)>0 || Number(state.preferences?.monthlyGoal||0)>0;
  }
  function itemTime(item){
    const time = Date.parse(item?.updatedAt || item?.createdAt || item?.date || '');
    return Number.isFinite(time) ? time : 0;
  }
  function mergeById(remoteItems, localItems){
    const map = new Map();
    (remoteItems||[]).forEach(item => { if (item?.id != null) map.set(String(item.id), clone(item)); });
    (localItems||[]).forEach(item => {
      if (item?.id == null) return; const key=String(item.id); const old=map.get(key);
      if (!old || itemTime(item)>=itemTime(old)) map.set(key,clone(item));
    });
    return [...map.values()];
  }
  function mergeStates(localState,remoteState){
    if (!remoteState) return clone(localState); if (!localState) return clone(remoteState);
    const merged=clone(remoteState);
    merged.version=Math.max(Number(localState.version||0),Number(remoteState.version||0));
    merged.profile={...(remoteState.profile||{}),...(localState.profile||{})};
    merged.preferences={...(remoteState.preferences||{}),...(localState.preferences||{})};
    merged.vehicles=mergeById(remoteState.vehicles,localState.vehicles);
    merged.transactions=mergeById(remoteState.transactions,localState.transactions);
    merged.reminders=mergeById(remoteState.reminders,localState.reminders);
    merged.odometerLogs=mergeById(remoteState.odometerLogs,localState.odometerLogs);
    merged.migratedFromV6=Boolean(localState.migratedFromV6||remoteState.migratedFromV6);
    merged.migrationSummary=localState.migrationSummary||remoteState.migrationSummary||null;
    return merged;
  }
  function classifyCopies(localState,remoteRow){
    const localMeaningful=isMeaningfulState(localState); const remoteState=remoteRow?.data||null; const remoteMeaningful=isMeaningfulState(remoteState);
    if(!localMeaningful&&!remoteMeaningful) return 'empty';
    if(localMeaningful&&!remoteMeaningful) return 'local-only';
    if(!localMeaningful&&remoteMeaningful) return 'remote-only';
    if(hashState(localState)===hashState(remoteState)) return 'same';
    return 'both';
  }
  function createAuthService(client,redirectUrl){
    return {
      signUp:(email,password)=>client.auth.signUp({email,password,options:redirectUrl?{emailRedirectTo:redirectUrl}:undefined}),
      signIn:(email,password)=>client.auth.signInWithPassword({email,password}),
      resetPassword:email=>client.auth.resetPasswordForEmail(email,redirectUrl?{redirectTo:redirectUrl}:undefined),
      updatePassword:password=>client.auth.updateUser({password}),
      signOut:()=>client.auth.signOut()
    };
  }
  function createRemoteStore(client,getUserId,table=TABLE){
    function uid(){ const value=getUserId(); if(!value) throw new Error('Usuário não autenticado.'); return value; }
    return {
      async read(){ const userId=uid(); const {data,error}=await client.from(table).select('user_id,data,updated_at,version').eq('user_id',userId).maybeSingle(); if(error) throw error; return data||null; },
      async insert(state){ const userId=uid(); const {data,error}=await client.from(table).insert({user_id:userId,data:state}).select('user_id,data,updated_at,version').single(); if(error) throw error; return data; },
      async update(state,expectedVersion){ const userId=uid(); const {data,error}=await client.from(table).update({data:state,version:Number(expectedVersion)+1}).eq('user_id',userId).eq('version',Number(expectedVersion)).select('user_id,data,updated_at,version').maybeSingle(); if(error) throw error; return data||null; },
      async remove(){ const userId=uid(); const {error}=await client.from(table).delete().eq('user_id',userId); if(error) throw error; return true; }
    };
  }
  return {TABLE,stable,hashState,isMeaningfulState,mergeById,mergeStates,classifyCopies,createAuthService,createRemoteStore};
});
