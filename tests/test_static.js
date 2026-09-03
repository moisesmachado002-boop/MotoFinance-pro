'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));

let passed = 0;
function test(name, fn) {
    try { fn(); passed += 1; console.log('✓', name); }
    catch (error) { console.error('✗', name); throw error; }
}

test('não há identificadores HTML duplicados', () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
});

test('todos os elementos acessados pelo script existem', () => {
    const referenced = [...new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]))];
    const missing = referenced.filter(id => !new RegExp('id=["\\\']' + id + '["\\\']').test(html));
    assert.deepEqual(missing, []);
});

test('todos os símbolos usados diretamente existem', () => {
    const symbols = new Set([...html.matchAll(/id="i-([^"]+)"/g)].map(match => match[1]));
    const iconMap = script.match(/const ICONS = \{([\s\S]*?)\n\};/)[1];
    const mapped = new Set([...iconMap.matchAll(/:\s*'([^']+)'/g)].map(match => match[1]));
    const direct = [...new Set([...script.matchAll(/icon\('([^']+)'/g)].map(match => match[1]))];
    assert.deepEqual(direct.filter(name => !symbols.has(name) && !mapped.has(name)), []);
});

test('exportação da análise usa o período filtrado', () => {
    assert.match(html, /data-action="export-csv" data-scope="filtered"/);
});

test('gravações usam confirmação atômica', () => {
    assert.match(script, /function commitChange/);
    assert.doesNotMatch(script, /function saveState/);
    assert.match(script, /Nada foi alterado/);
});

test('service worker limita fallback HTML à navegação', () => {
    assert.match(worker, /event\.request\.mode === 'navigate'/);
    assert.doesNotMatch(worker, /response \|\| caches\.match\('\.\/index\.html'\)/);
});

test('arquivos do cache existem', () => {
    const files = [...worker.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]).filter(Boolean);
    files.forEach(file => assert.equal(fs.existsSync(path.join(root, file)), true, file));
});

test('manifesto PWA tem escopo, início e ícones', () => {
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.icons.length >= 2, true);
});

console.log('\n' + passed + ' testes estáticos concluídos com sucesso.');
