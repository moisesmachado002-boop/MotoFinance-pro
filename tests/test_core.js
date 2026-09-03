'use strict';

const assert = require('node:assert/strict');
const Core = require('../core.js');

let passed = 0;
function test(name, fn) {
    try { fn(); passed += 1; console.log('✓', name); }
    catch (error) { console.error('✗', name); throw error; }
}

const vehicle = Core.sanitizeVehicle({ id: 'moto', brand: 'Honda', model: 'CG 150', year: 2008, odometer: 12500 });
const transactions = [
    Core.sanitizeTransaction({ id: 'a', vehicleId: 'moto', type: 'gain', category: 'entrega', amount: 150, date: '2026-09-01', description: 'iFood' }, [vehicle]),
    Core.sanitizeTransaction({ id: 'b', vehicleId: 'moto', type: 'gain', category: 'corrida', amount: 80, date: '2026-09-02', description: '99' }, [vehicle]),
    Core.sanitizeTransaction({ id: 'c', vehicleId: 'moto', type: 'expense', category: 'combustivel', amount: 50, date: '2026-09-02' }, [vehicle]),
    Core.sanitizeTransaction({ id: 'd', vehicleId: 'moto', type: 'expense', category: 'manutencao', amount: 250, date: '2026-08-30' }, [vehicle])
];

test('valida datas reais', () => {
    assert.equal(Core.validDate('2026-09-03'), true);
    assert.equal(Core.validDate('2026-02-31'), false);
    assert.equal(Core.validDate('03/09/2026'), false);
});

test('formata moeda brasileira e preserva negativos', () => {
    assert.match(Core.money(-20), /-R\$\s20,00|−R\$\s20,00/);
    assert.match(Core.money(1234.5), /1\.234,50/);
});

test('sanitiza veículo e placa', () => {
    assert.equal(vehicle.plate, '');
    const item = Core.sanitizeVehicle({ brand: 'Yamaha', model: 'Factor', plate: 'abc-1d23', year: 2020 });
    assert.equal(item.plate, 'ABC1D23');
});

test('rejeita veículo sem marca ou modelo', () => {
    assert.equal(Core.sanitizeVehicle({ brand: '', model: 'CG' }), null);
    assert.equal(Core.sanitizeVehicle({ brand: 'Honda', model: '' }), null);
});

test('sanitiza ganho válido', () => {
    assert.equal(transactions[0].amount, 150);
    assert.equal(transactions[0].type, 'gain');
});

test('rejeita categoria incompatível', () => {
    assert.equal(Core.sanitizeTransaction({ vehicleId: 'moto', type: 'gain', category: 'combustivel', amount: 10, date: '2026-09-01' }, [vehicle]), null);
});

test('rejeita valor zero ou negativo', () => {
    assert.equal(Core.sanitizeTransaction({ vehicleId: 'moto', type: 'expense', category: 'combustivel', amount: 0, date: '2026-09-01' }, [vehicle]), null);
    assert.equal(Core.sanitizeTransaction({ vehicleId: 'moto', type: 'expense', category: 'combustivel', amount: -1, date: '2026-09-01' }, [vehicle]), null);
});

test('calcula ganhos, gastos e resultado', () => {
    const totals = Core.calculateTotals(transactions);
    assert.equal(totals.gains, 230);
    assert.equal(totals.expenses, 300);
    assert.equal(totals.balance, -70);
});

test('filtra por mês', () => {
    assert.equal(Core.filterTransactions(transactions, { month: '2026-09' }).length, 3);
    assert.equal(Core.filterTransactions(transactions, { month: '2026-08' }).length, 1);
});

test('filtra por tipo', () => {
    assert.equal(Core.filterTransactions(transactions, { type: 'gain' }).length, 2);
    assert.equal(Core.filterTransactions(transactions, { type: 'expense' }).length, 2);
});

test('pesquisa descrição e categoria sem diferenciar maiúsculas', () => {
    assert.equal(Core.filterTransactions(transactions, { query: 'IFOOD' }).length, 1);
    assert.equal(Core.filterTransactions(transactions, { query: 'combustível' }).length, 1);
});

test('soma valores por categoria', () => {
    const categories = Core.totalsByCategory(transactions, 'expense');
    assert.equal(categories.find(item => item.key === 'manutencao').value, 250);
    assert.equal(categories[0].key, 'manutencao');
});

test('calcula data futura sem depender de UTC', () => {
    assert.equal(Core.addDays('2026-09-03', 15), '2026-09-18');
    assert.equal(Core.daysBetween('2026-09-03', '2026-09-18'), 15);
});

test('classifica alarme em dia', () => {
    const reminder = Core.sanitizeReminder({ vehicleId: 'moto', title: 'Óleo', enabled: true, byKm: true, kmInterval: 1000, lastKm: 12500, advanceKm: 200, lastDate: '2026-09-03' }, [vehicle]);
    assert.equal(Core.reminderStatus(reminder, vehicle, '2026-09-03').key, 'ok');
});

test('classifica alarme próximo', () => {
    const reminder = Core.sanitizeReminder({ vehicleId: 'moto', title: 'Óleo', enabled: true, byKm: true, kmInterval: 1000, lastKm: 11600, advanceKm: 200, lastDate: '2026-09-03' }, [vehicle]);
    assert.equal(Core.reminderStatus(reminder, vehicle, '2026-09-03').key, 'upcoming');
});

test('não chama zero restante de atrasado', () => {
    const reminder = Core.sanitizeReminder({ vehicleId: 'moto', title: 'Óleo', enabled: true, byKm: true, kmInterval: 500, lastKm: 12000, advanceKm: 200, lastDate: '2026-09-03' }, [vehicle]);
    const status = Core.reminderStatus(reminder, vehicle, '2026-09-03');
    assert.equal(status.key, 'upcoming');
    assert.match(status.detail, /0 km restantes/);
});

test('classifica alarme atrasado', () => {
    const reminder = Core.sanitizeReminder({ vehicleId: 'moto', title: 'Óleo', enabled: true, byKm: true, kmInterval: 500, lastKm: 11000, advanceKm: 200, lastDate: '2026-09-03' }, [vehicle]);
    assert.equal(Core.reminderStatus(reminder, vehicle, '2026-09-03').key, 'overdue');
});

test('cria estado inicial completo', () => {
    const state = Core.createInitialState();
    assert.equal(state.version, 1);
    assert.equal(state.vehicles.length, 1);
    assert.equal(state.reminders.length, Core.REMINDER_TEMPLATES.length);
    assert.equal(state.profile.name, 'Moisés');
});

console.log('\n' + passed + ' testes concluídos com sucesso.');
