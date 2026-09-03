'use strict';
const assert = require('assert');
const core = require('../script.js');

function record(overrides) {
  return {
    id: Math.random().toString(16),
    date: '2026-08-05',
    type: 'RECEITA',
    source: 'IFOOD',
    extraCategory: '',
    amount: 100,
    km: 0,
    description: '',
    createdAt: '2026-08-05T12:00:00.000Z',
    ...overrides
  };
}

// 1. Regra diária: manutenção não é abatida; combustível é.
{
  const list = [
    record({ amount: 200 }),
    record({ type: 'COMBUSTIVEL', source: '', amount: 40 }),
    record({ type: 'MANUTENCAO', source: '', amount: 70 })
  ];
  const totals = core.calculateTotals(list);
  assert.strictEqual(totals.revenue, 200);
  assert.strictEqual(totals.operationalProfit, 160);
  assert.strictEqual(totals.monthlyNetProfit, 90);
  const daily = core.aggregateByDay(list)[0];
  assert.strictEqual(daily.dailyProfit, 160);
  assert.strictEqual(daily.maintenance, 70);
}

// 2. Outras correrias entram na receita e no fechamento mensal.
{
  const list = [
    record({ source: 'OUTRAS_CORRIDAS', extraCategory: 'ENTREGA_PARTICULAR', amount: 150 })
  ];
  const totals = core.calculateTotals(list);
  assert.strictEqual(totals.extraRuns, 150);
  assert.strictEqual(totals.revenue, 150);
  assert.strictEqual(totals.monthlyNetProfit, 150);
}

// 3. Separação por origem.
{
  const list = [
    record({ source: 'IFOOD', amount: 100 }),
    record({ source: '99', amount: 80 }),
    record({ source: 'OUTRAS_CORRIDAS', extraCategory: 'GORJETA', amount: 20 })
  ];
  const totals = core.calculateTotals(list);
  assert.deepStrictEqual([totals.ifood, totals.ninetyNine, totals.extraRuns, totals.revenue], [100, 80, 20, 200]);
}

// 4. Semana ISO conhecida: 2026-W32 = 03/08 a 09/08.
{
  const range = core.isoWeekRange('2026-W32');
  assert.deepStrictEqual(range, { start: '2026-08-03', end: '2026-08-09' });
  const list = [
    record({ date: '2026-08-02', amount: 1 }),
    record({ date: '2026-08-03', amount: 2 }),
    record({ date: '2026-08-09', amount: 3 }),
    record({ date: '2026-08-10', amount: 4 })
  ];
  assert.deepStrictEqual(core.weekRecords(list, '2026-W32').map(r => r.amount), [2, 3]);
}

// 5. Filtro mensal.
{
  const list = [
    record({ date: '2026-07-31', amount: 1 }),
    record({ date: '2026-08-01', amount: 2 }),
    record({ date: '2026-08-31', amount: 3 }),
    record({ date: '2026-09-01', amount: 4 })
  ];
  const filtered = core.filterRecords(list, { mode: 'MES', month: '2026-08', type: 'TODOS', source: 'TODOS' });
  assert.deepStrictEqual(filtered.map(r => r.amount), [2, 3]);
}

// 6. Filtro semanal.
{
  const list = [
    record({ date: '2026-08-02', amount: 1 }),
    record({ date: '2026-08-03', amount: 2 }),
    record({ date: '2026-08-09', amount: 3 }),
    record({ date: '2026-08-10', amount: 4 })
  ];
  const filtered = core.filterRecords(list, { mode: 'SEMANA', week: '2026-W32', type: 'TODOS', source: 'TODOS' });
  assert.deepStrictEqual(filtered.map(r => r.amount), [2, 3]);
}

// 7. Filtro personalizado e limites inclusivos.
{
  const list = [
    record({ date: '2026-08-04', amount: 1 }),
    record({ date: '2026-08-05', amount: 2 }),
    record({ date: '2026-08-06', amount: 3 })
  ];
  const filtered = core.filterRecords(list, { mode: 'PERSONALIZADO', start: '2026-08-05', end: '2026-08-06', type: 'TODOS', source: 'TODOS' });
  assert.deepStrictEqual(filtered.map(r => r.amount), [2, 3]);
}

// 8. Filtro por tipo e origem.
{
  const list = [
    record({ source: 'IFOOD', amount: 100 }),
    record({ source: '99', amount: 80 }),
    record({ type: 'COMBUSTIVEL', source: '', amount: 20 })
  ];
  assert.strictEqual(core.filterRecords(list, { mode: 'TODOS', type: 'RECEITA', source: '99' }).length, 1);
  assert.strictEqual(core.filterRecords(list, { mode: 'TODOS', type: 'COMBUSTIVEL', source: 'TODOS' }).length, 1);
}

// 9. Pesquisa por descrição e categoria.
{
  const list = [
    record({ description: 'Entrega para farmácia', source: 'OUTRAS_CORRIDAS', extraCategory: 'ENTREGA_PARTICULAR' }),
    record({ description: 'Turno normal', source: 'IFOOD' })
  ];
  assert.strictEqual(core.filterRecords(list, { mode: 'TODOS', type: 'TODOS', source: 'TODOS', search: 'farmácia' }).length, 1);
  assert.strictEqual(core.filterRecords(list, { mode: 'TODOS', type: 'TODOS', source: 'TODOS', search: 'particular' }).length, 1);
}

// 10. Sanitização rejeita registros inválidos.
{
  assert.strictEqual(core.sanitizeRecord({}), null);
  assert.strictEqual(core.sanitizeRecord(record({ amount: 0 })), null);
  assert.strictEqual(core.sanitizeRecord(record({ source: 'OUTRAS_CORRIDAS', extraCategory: '' })), null);
  assert.ok(core.sanitizeRecord(record({ source: 'OUTRAS_CORRIDAS', extraCategory: 'FRETE_SERVICO', amount: 50 })));
}

// 11. Quilometragem e receita por km.
{
  const list = [
    record({ amount: 200 }),
    record({ type: 'KM', source: '', amount: 0, km: 100 })
  ];
  const totals = core.calculateTotals(list);
  assert.strictEqual(totals.km, 100);
  assert.strictEqual(totals.revenuePerKm, 2);
  assert.strictEqual(totals.workedDays, 1);
}

// 12. Metas podem ultrapassar 100% sem erro matemático.
{
  assert.strictEqual(core.goalProgress(500, 1000), 50);
  assert.strictEqual(core.goalProgress(1200, 1000), 120);
  assert.strictEqual(core.goalProgress(100, 0), 0);
}

// 13. Efeito financeiro de cada tipo.
{
  assert.ok(core.getDailyEffect(record({ type: 'MANUTENCAO', source: '', amount: 50 })).text.includes('Somente mensal'));
  assert.ok(core.getDailyEffect(record({ type: 'COMBUSTIVEL', source: '', amount: 50 })).text.includes('−'));
  assert.ok(core.getMonthlyEffect(record({ type: 'MANUTENCAO', source: '', amount: 50 })).text.includes('−'));
}

// 14. Validação de datas reais.
{
  assert.strictEqual(core.isValidISODate('2026-02-29'), false);
  assert.strictEqual(core.isValidISODate('2028-02-29'), true);
  assert.strictEqual(core.isValidISODate('2026-08-05'), true);
}

// 15. Prejuízos continuam negativos na apresentação.
{
  const list = [
    record({ amount: 50 }),
    record({ type: 'COMBUSTIVEL', source: '', amount: 100 }),
    record({ type: 'MANUTENCAO', source: '', amount: 20 })
  ];
  const totals = core.calculateTotals(list);
  assert.strictEqual(totals.operationalProfit, -50);
  assert.strictEqual(totals.monthlyNetProfit, -70);
  assert.ok(core.formatMoney(totals.monthlyNetProfit).includes('-'));
  assert.ok(core.formatMoney(totals.monthlyNetProfit).includes('70,00'));
  assert.strictEqual(core.formatCompactMoney(-1500), '−R$ 1,5 mil');
}

// 16. Meses inexistentes não podem abrir períodos de outro ano.
{
  assert.strictEqual(core.isValidMonthValue('2026-12'), true);
  assert.strictEqual(core.isValidMonthValue('2026-00'), false);
  assert.strictEqual(core.isValidMonthValue('2026-13'), false);
  const list = [record({ date: '2027-01-15' })];
  assert.strictEqual(core.filterRecords(list, { mode: 'MES', month: '2026-13', type: 'TODOS', source: 'TODOS' }).length, 0);
}

// 17. A semana 53 só existe nos anos corretos do calendário ISO.
{
  assert.strictEqual(core.isoWeekRange('2025-W53'), null);
  assert.deepStrictEqual(core.isoWeekRange('2026-W53'), { start: '2026-12-28', end: '2027-01-03' });
}

// 18. Período personalizado invertido ou inválido retorna vazio.
{
  const list = [record({ date: '2026-08-05' })];
  assert.strictEqual(core.filterRecords(list, { mode: 'PERSONALIZADO', start: '2026-08-06', end: '2026-08-05', type: 'TODOS', source: 'TODOS' }).length, 0);
  assert.strictEqual(core.filterRecords(list, { mode: 'PERSONALIZADO', start: '2026-02-30', end: '', type: 'TODOS', source: 'TODOS' }).length, 0);
}

console.log('18 grupos de testes concluídos com sucesso.');
