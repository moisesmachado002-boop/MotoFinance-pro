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
const worker = read('service-worker.js');
const migration1 = read('supabase/migrations/20260903215530_create_motofinance_state.sql');
const migration2 = read('supabase/migrations/20260903215702_harden_motofinance_state_grants.sql');
let passed = 0;
function test(name, fn){ try{ fn(); passed++; console.log('✓',name); }catch(error){ console.error('✗',name); throw error; } }
function sample(extra={}){ return {version:2,profile:{name:'Moisés'},vehicles:[{id:'v1',plate:'ABC1D23',odometer:100}],transactions:[],reminders:[],odometerLogs:[],preferences:{activeVehicleId:'v1',month:'2026-09',weeklyGoal:0,monthlyGoal:0},...extra}; }

test('hash estável',()=>assert.equal(Core.hashState({a:1,b:{c:2}}),Core.hashState({b:{c:2},a:1})));
test('estado significativo',()=>{assert.equal(Core.isMeaningfulState(sample()),true);assert.equal(Core.isMeaningfulState({vehicles:[{plate:'',odometer:0}],transactions:[],odometerLogs:[],preferences:{}}),false);});
test('classificação de cópias',()=>{const local=sample();assert.equal(Core.classifyCopies(local,{data:JSON.parse(JSON.stringify(local))}),'same');assert.equal(Core.classifyCopies(local,{data:sample({transactions:[{id:'t1'}]})}),'both');});
test('mesclagem por id',()=>{const merged=Core.mergeStates(sample({transactions:[{id:'l'}]}),sample({transactions:[{id:'r'}]}));assert.deepEqual(merged.transactions.map(x=>x.id).sort(),['l','r']);});
test('auth oficial por e-mail e senha',()=>{const source=Core.createAuthService.toString();assert.match(source,/signUp/);assert.match(source,/signInWithPassword/);assert.match(source,/resetPasswordForEmail/);assert.match(source,/updateUser/);assert.match(source,/signOut/);});
test('remote store filtra user_id e versão',()=>{const source=Core.createRemoteStore.toString();assert.match(source,/eq\('user_id',\s*userId\)/);assert.match(source,/user_id:\s*userId/);assert.match(source,/eq\('version',\s*Number\(expectedVersion\)\)/);});
test('backup local antes de substituição',()=>{assert.match(storage,/motofinance_sync_last_local_backup/);assert.match(storage,/replaceState/);assert.match(storage,/if\(!set\(BACKUP,\s*backup\)\)return false/);});
test('retorno da rede e conflito',()=>{assert.match(engine,/addEventListener\('online'/);assert.match(engine,/Conflito encontrado/);assert.match(engine,/remote\.update/);});
test('UI exibe status e escolhas',()=>{for(const label of ['Sincronizado','Salvando','Offline','Conflito encontrado','Erro de sincronização']) assert.match(ui+engine,new RegExp(label));for(const action of ['use-local','use-remote','merge','upload-local']) assert.match(ui,new RegExp(action));});
test('SDK fixado em 2.112.4',()=>{for(const source of [config,worker,authHtml]) assert.match(source,/@supabase\/supabase-js@2\.112\.4/);});
test('somente chave publicável no frontend',()=>{const all=config+sync+auth+authHtml;assert.match(all,/publishable/);assert.doesNotMatch(all,/service[_-]?role/i);assert.doesNotMatch(all,/sb_secret_/i);});
test('service worker carrega todos módulos',()=>{for(const file of ['./sync-config.js','./sync-core.js','./sync-storage.js','./sync-ui.js','./sync-engine.js','./sync.js','./auth.html','./auth.js']) assert.equal(worker.includes("'"+file+"'"),true,file);assert.match(worker,/injectSync/);});
test('migração cria tabela versionada com RLS',()=>{assert.match(migration1,/create table public\.motofinance_state/);assert.match(migration1,/user_id uuid primary key references auth\.users\(id\)/);assert.match(migration1,/version bigint not null default 1/);assert.match(migration1,/enable row level security/);assert.doesNotMatch(migration1+migration2,/alter table public\.(finance_state|family_finance_state)/);});
test('CRUD protegido e grants mínimos',()=>{for(const op of ['select','insert','update','delete']) assert.match(migration1,new RegExp('for '+op));assert.match(migration2,/revoke all on table public\.motofinance_state from anon, authenticated/);assert.match(migration2,/grant select, insert, update, delete on table public\.motofinance_state to authenticated/);});
console.log('\n'+passed+' testes de sincronização concluídos com sucesso.');
