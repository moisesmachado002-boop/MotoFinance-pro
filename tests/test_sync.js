'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../sync-core.js');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const config = read('sync-config.js');
const storage = read('sync-storage.js');
const ui = read('sync-ui.js');
const engine = read('sync-engine.js');
const sync = read('sync.js');
const auth = read('auth.js');
const authHtml = read('auth.html');
const index = read('index.html');
const worker = read('service-worker.js');
const migration1 = read('supabase/migrations/20260903215530_create_motofinance_state.sql');
const migration2 = read('supabase/migrations/20260903215702_harden_motofinance_state_grants.sql');
const migration3 = read('supabase/migrations/20260903233000_harden_motofinance_sync_metadata.sql');
let passed = 0;
function test(name, fn){ try{ fn(); passed++; console.log('✓',name); }catch(error){ console.error('✗',name); throw error; } }
function state(transactions=[]){ return {version:2,profile:{name:'Moisés'},vehicles:[{id:'v1',plate:'ABC1D23',odometer:100,createdAt:'2026-01-01T00:00:00Z'}],transactions,reminders:[],odometerLogs:[],preferences:{activeVehicleId:'v1',month:'2026-09',weeklyGoal:0,monthlyGoal:0}}; }

test('hash estável',()=>assert.equal(Core.hashState({a:1,b:{c:2}}),Core.hashState({b:{c:2},a:1})));
test('estado significativo',()=>{assert.equal(Core.isMeaningfulState(state()),true);assert.equal(Core.isMeaningfulState({vehicles:[{plate:'',odometer:0}],transactions:[],reminders:[],odometerLogs:[],preferences:{}}),false);});
test('edição mais recente vence por metadado',()=>{
  const base=state([{id:'t1',amount:10,createdAt:'2026-01-01T00:00:00Z'}]); const local=state([{id:'t1',amount:20,createdAt:'2026-01-01T00:00:00Z'}]); const remote=state([{id:'t1',amount:30,createdAt:'2026-01-01T00:00:00Z'}]);
  let lm=Core.normalizeSyncMeta(null,base,'2026-09-01T00:00:00Z'); lm=Core.diffSyncMeta(base,local,lm,'2026-09-03T10:00:00Z');
  let rm=Core.normalizeSyncMeta(null,base,'2026-09-01T00:00:00Z'); rm=Core.diffSyncMeta(base,remote,rm,'2026-09-03T11:00:00Z');
  const result=Core.mergeStates(local,remote,lm,rm,'2026-09-03T10:00:00Z','2026-09-03T11:00:00Z'); assert.equal(result.conflicts.length,0); assert.equal(result.state.transactions[0].amount,30);
});
test('tombstone impede ressurreição de item excluído',()=>{
  const base=state([{id:'t1',amount:10,createdAt:'2026-01-01T00:00:00Z'}]); const removed=state([]); const remote=state([{id:'t1',amount:10,createdAt:'2026-01-01T00:00:00Z'}]);
  let dm=Core.normalizeSyncMeta(null,base,'2026-09-01T00:00:00Z'); dm=Core.diffSyncMeta(base,removed,dm,'2026-09-03T12:00:00Z');
  const rm=Core.normalizeSyncMeta(null,remote,'2026-09-03T11:00:00Z'); const result=Core.mergeStates(removed,remote,dm,rm,'2026-09-03T12:00:00Z','2026-09-03T11:00:00Z'); assert.equal(result.state.transactions.length,0);
});
test('empate divergente vira conflito em vez de escolher silenciosamente',()=>{
  const local=state([{id:'t1',amount:20,createdAt:'2026-01-01T00:00:00Z'}]); const remote=state([{id:'t1',amount:30,createdAt:'2026-01-01T00:00:00Z'}]);
  const lm=Core.normalizeSyncMeta(null,local,'2026-09-03T10:00:00Z'); const rm=Core.normalizeSyncMeta(null,remote,'2026-09-03T10:00:00Z'); const result=Core.mergeStates(local,remote,lm,rm,'2026-09-03T10:00:00Z','2026-09-03T10:00:00Z'); assert.ok(result.conflicts.some(x=>x.id==='t1'));
});
test('auth oficial por e-mail e senha',()=>{const source=Core.createAuthService.toString();for(const name of ['signUp','signInWithPassword','resetPasswordForEmail','updateUser','signOut']) assert.match(source,new RegExp(name));});
test('remote store isola user_id, versão e sync_meta',()=>{const source=Core.createRemoteStore.toString();assert.match(source,/eq\('user_id',\s*userId\)/);assert.match(source,/eq\('version',\s*Number\(expectedVersion\)\)/);assert.match(source,/sync_meta/);});
test('storage mantém backups rotativos e isolamento por conta',()=>{for(const text of ['motofinance_sync_backup_history_v2','motofinance_user_state_v1:','motofinance_local_owner_v1','saveUserSnapshot','readUserSnapshot']) assert.match(storage,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));});
test('apagar/restaurar local desativa envio automático',()=>{assert.match(engine,/localOnlyIntent/);assert.match(engine,/\[data-action="clear-data"\]/);assert.match(engine,/restoreInput/);assert.match(engine,/cloudEnabled:\s*false/);});
test('troca de conta salva snapshot e recarrega estado isolado',()=>{assert.match(engine,/isolateAccount/);assert.match(engine,/saveUserSnapshot\(currentOwner\)/);assert.match(engine,/readUserSnapshot\(userId\)/);assert.match(engine,/location\.reload/);});
test('mesclagem recarrega app após persistir',()=>{const body=engine.match(/async function merge\(row\)[\s\S]*?\n    }/)[0];assert.match(body,/location\.reload\(\)/);});
test('UI bloqueia merge quando há conflito irresolvível',()=>{assert.match(ui,/canMerge === false/);assert.match(ui,/conflictCount/);});
test('SDK fixado e configuração única',()=>{for(const source of [config,worker,authHtml]) assert.match(source,/@supabase\/supabase-js@2\.112\.4/);assert.doesNotMatch(auth,/SUPABASE_URL|SUPABASE_KEY/);assert.match(auth,/MotoFinanceSyncConfig/);});
test('somente chave publicável no frontend',()=>{const all=config+sync+auth+authHtml;assert.match(all,/publishable/);assert.doesNotMatch(all,/service[_-]?role/i);assert.doesNotMatch(all,/sb_secret_/i);});
test('index carrega sincronização explicitamente',()=>{for(const file of ['preflight.js','sync-config.js','app-enhancements.js','sync-core.js','sync-storage.js','sync-ui.js','sync-engine.js','sync.js']) assert.match(index,new RegExp('<script src="'+file.replace('.','\\.')+'"></script>'));});
test('service worker não injeta código nem apaga caches alheios',()=>{assert.doesNotMatch(worker,/injectSync|SYNC_BOOTSTRAP|client\.navigate/);assert.match(worker,/key\.startsWith\(CACHE_PREFIX\)/);});
test('migrações mantêm RLS e grants mínimos',()=>{assert.match(migration1,/enable row level security/);assert.match(migration2,/grant select, insert, update, delete/);assert.doesNotMatch(migration1+migration2+migration3,/alter table public\.(finance_state|family_finance_state)/);});
test('nova migração limita e valida o snapshot',()=>{assert.match(migration3,/add column sync_meta jsonb/);assert.match(migration3,/octet_length\(data::text\) <= 2097152/);assert.match(migration3,/data \?& array\['version','profile','vehicles','transactions','reminders','odometerLogs','preferences'\]/);assert.match(migration3,/octet_length\(sync_meta::text\) <= 524288/);});
console.log('\n'+passed+' testes de sincronização/hardening concluídos com sucesso.');
