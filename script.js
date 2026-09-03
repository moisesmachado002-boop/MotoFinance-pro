'use strict';

const STORAGE_RECORDS = 'motofinance_v6_records';
const STORAGE_GOALS = 'motofinance_v6_goals';

const RECORD_TYPES = Object.freeze(['RECEITA', 'COMBUSTIVEL', 'MANUTENCAO', 'KM']);
const REVENUE_SOURCES = Object.freeze(['IFOOD', '99', 'OUTRAS_CORRIDAS']);
const EXTRA_CATEGORIES = Object.freeze([
    'ENTREGA_PARTICULAR',
    'FRETE_SERVICO',
    'CORRIDA_PARTICULAR',
    'DIARIA_PARCERIA',
    'GORJETA',
    'REEMBOLSO',
    'OUTROS'
]);

const TYPE_LABELS = Object.freeze({
    RECEITA: 'Receita',
    COMBUSTIVEL: 'Combustível',
    MANUTENCAO: 'Manutenção',
    KM: 'Quilometragem'
});

const SOURCE_LABELS = Object.freeze({
    IFOOD: 'iFood',
    '99': '99',
    OUTRAS_CORRIDAS: 'Outras correrias'
});

const EXTRA_LABELS = Object.freeze({
    ENTREGA_PARTICULAR: 'Entrega particular',
    FRETE_SERVICO: 'Frete / serviço',
    CORRIDA_PARTICULAR: 'Corrida particular',
    DIARIA_PARCERIA: 'Diária / parceria',
    GORJETA: 'Gorjeta',
    REEMBOLSO: 'Reembolso',
    OUTROS: 'Outros'
});

function numberValue(value) {
    if (typeof value === 'string') value = value.replace(',', '.').trim();
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function isValidISODate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const date = new Date(`${value}T12:00:00`);
    return !Number.isNaN(date.getTime()) && localISODate(date) === value;
}

function isValidMonthValue(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    if (!match) return false;
    const month = Number(match[2]);
    return month >= 1 && month <= 12;
}

function generateId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeRecord(input) {
    if (!input || typeof input !== 'object' || !isValidISODate(input.date)) return null;

    const type = RECORD_TYPES.includes(input.type) ? input.type : null;
    if (!type) return null;

    const source = type === 'RECEITA' && REVENUE_SOURCES.includes(input.source) ? input.source : '';
    const extraCategory = source === 'OUTRAS_CORRIDAS' && EXTRA_CATEGORIES.includes(input.extraCategory)
        ? input.extraCategory
        : '';
    const amount = type === 'KM' ? 0 : numberValue(input.amount);
    const km = type === 'KM' ? numberValue(input.km) : 0;

    if (type === 'RECEITA' && !source) return null;
    if (type === 'RECEITA' && source === 'OUTRAS_CORRIDAS' && !extraCategory) return null;
    if (type === 'KM' ? km <= 0 : amount <= 0) return null;

    return {
        id: String(input.id || generateId()),
        date: input.date,
        type,
        source,
        extraCategory,
        amount,
        km,
        description: String(input.description || '').slice(0, 180),
        createdAt: String(input.createdAt || new Date().toISOString())
    };
}

function recordRevenue(record) {
    return record.type === 'RECEITA' ? numberValue(record.amount) : 0;
}

function calculateTotals(records) {
    const totals = {
        revenue: 0,
        ifood: 0,
        ninetyNine: 0,
        extraRuns: 0,
        fuel: 0,
        maintenance: 0,
        km: 0,
        operationalProfit: 0,
        monthlyNetProfit: 0,
        workedDays: 0,
        averagePerDay: 0,
        revenuePerKm: 0
    };
    const workedDays = new Set();

    records.forEach(record => {
        const revenue = recordRevenue(record);
        totals.revenue += revenue;

        if (record.type === 'RECEITA') {
            if (record.source === 'IFOOD') totals.ifood += revenue;
            else if (record.source === '99') totals.ninetyNine += revenue;
            else if (record.source === 'OUTRAS_CORRIDAS') totals.extraRuns += revenue;
            workedDays.add(record.date);
        } else if (record.type === 'COMBUSTIVEL') {
            totals.fuel += numberValue(record.amount);
        } else if (record.type === 'MANUTENCAO') {
            totals.maintenance += numberValue(record.amount);
        } else if (record.type === 'KM') {
            totals.km += numberValue(record.km);
            workedDays.add(record.date);
        }
    });

    // Regra solicitada:
    // diário/semanal = receitas - combustível
    // mensal = receitas - combustível - manutenção
    totals.operationalProfit = totals.revenue - totals.fuel;
    totals.monthlyNetProfit = totals.operationalProfit - totals.maintenance;
    totals.workedDays = workedDays.size;
    totals.averagePerDay = totals.workedDays > 0 ? totals.revenue / totals.workedDays : 0;
    totals.revenuePerKm = totals.km > 0 ? totals.revenue / totals.km : 0;
    return totals;
}

function aggregateByDay(records) {
    const days = new Map();
    records.forEach(record => {
        if (!days.has(record.date)) {
            days.set(record.date, { date: record.date, revenue: 0, fuel: 0, maintenance: 0, km: 0, dailyProfit: 0 });
        }
        const day = days.get(record.date);
        if (record.type === 'RECEITA') day.revenue += numberValue(record.amount);
        if (record.type === 'COMBUSTIVEL') day.fuel += numberValue(record.amount);
        if (record.type === 'MANUTENCAO') day.maintenance += numberValue(record.amount);
        if (record.type === 'KM') day.km += numberValue(record.km);
        day.dailyProfit = day.revenue - day.fuel;
    });
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function localISODate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function currentMonthValue(date = new Date()) {
    return localISODate(date).slice(0, 7);
}

function dateToISOWeek(dateInput = new Date()) {
    const local = typeof dateInput === 'string' ? new Date(`${dateInput}T12:00:00`) : new Date(dateInput);
    const utc = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
    const weekday = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function isoWeekRange(weekValue) {
    const match = /^(\d{4})-W(\d{2})$/.exec(String(weekValue || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (week < 1 || week > 53) return null;

    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Weekday = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - (jan4Weekday - 1) + ((week - 1) * 7));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const utcISO = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    const normalizedWeek = `${year}-W${String(week).padStart(2, '0')}`;
    if (dateToISOWeek(utcISO(monday)) !== normalizedWeek) return null;
    return { start: utcISO(monday), end: utcISO(sunday) };
}

function filterRecords(records, filters) {
    const mode = filters.mode || 'MES';
    let start = '';
    let end = '';

    if (mode === 'MES') {
        if (!isValidMonthValue(filters.month)) return [];
        start = `${filters.month}-01`;
        const [year, month] = filters.month.split('-').map(Number);
        end = localISODate(new Date(year, month, 0));
    } else if (mode === 'SEMANA') {
        const range = isoWeekRange(filters.week);
        if (!range) return [];
        ({ start, end } = range);
    } else if (mode === 'PERSONALIZADO') {
        if ((filters.start && !isValidISODate(filters.start)) || (filters.end && !isValidISODate(filters.end))) return [];
        start = isValidISODate(filters.start) ? filters.start : '';
        end = isValidISODate(filters.end) ? filters.end : '';
        if (start && end && start > end) return [];
    }

    const search = String(filters.search || '').trim().toLocaleLowerCase('pt-BR');

    return records.filter(record => {
        if (start && record.date < start) return false;
        if (end && record.date > end) return false;
        if (filters.type && filters.type !== 'TODOS' && record.type !== filters.type) return false;
        if (filters.source && filters.source !== 'TODOS') {
            if (record.type !== 'RECEITA' || record.source !== filters.source) return false;
        }
        if (search) {
            const haystack = [
                record.date,
                TYPE_LABELS[record.type],
                SOURCE_LABELS[record.source],
                EXTRA_LABELS[record.extraCategory],
                record.description
            ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
            if (!haystack.includes(search)) return false;
        }
        return true;
    });
}

function monthRecords(records, monthValue) {
    if (!isValidMonthValue(monthValue)) return [];
    return records.filter(record => record.date.startsWith(monthValue));
}

function weekRecords(records, weekValue) {
    const range = isoWeekRange(weekValue);
    if (!range) return [];
    return records.filter(record => record.date >= range.start && record.date <= range.end);
}

function goalProgress(realized, goal) {
    const target = numberValue(goal);
    const value = numberValue(realized);
    return target > 0 ? Math.max(0, (value / target) * 100) : 0;
}

function formatMoney(value) {
    const number = Number(value);
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(number) ? number : 0);
}

function formatDateBR(value) {
    if (!isValidISODate(value)) return '—';
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
}

function monthLabel(monthValue) {
    if (!isValidMonthValue(monthValue)) return 'Mês inválido';
    const [year, month] = monthValue.split('-').map(Number);
    const label = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function periodLabel(filters) {
    if (filters.mode === 'MES') return monthLabel(filters.month);
    if (filters.mode === 'SEMANA') {
        const range = isoWeekRange(filters.week);
        return range ? `Semana de ${formatDateBR(range.start)} a ${formatDateBR(range.end)}` : 'Semana inválida';
    }
    if (filters.mode === 'PERSONALIZADO') {
        if (filters.start && filters.end) return `${formatDateBR(filters.start)} a ${formatDateBR(filters.end)}`;
        if (filters.start) return `A partir de ${formatDateBR(filters.start)}`;
        if (filters.end) return `Até ${formatDateBR(filters.end)}`;
        return 'Período personalizado';
    }
    return 'Todos os lançamentos';
}

let records = [];
let pendingRecord = null;
let redrawTimer = null;
let storageWarningShown = false;
const memoryStorage = new Map();

function byId(id) {
    return document.getElementById(id);
}

function escapeHTML(value = '') {
    const element = document.createElement('div');
    element.textContent = String(value);
    return element.innerHTML;
}

function safeStorageGet(key, fallback = '') {
    try {
        const stored = localStorage.getItem(key);
        if (stored !== null) {
            memoryStorage.set(key, stored);
            return stored;
        }
    } catch (error) {
        console.warn('Armazenamento local indisponível.', error);
    }
    return memoryStorage.get(key) ?? fallback;
}

function safeStorageSet(key, value) {
    memoryStorage.set(key, value);
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn('Não foi possível salvar no armazenamento local.', error);
        return false;
    }
}

function loadRecords() {
    try {
        const parsed = JSON.parse(safeStorageGet(STORAGE_RECORDS, '[]'));
        records = Array.isArray(parsed) ? parsed.map(sanitizeRecord).filter(Boolean) : [];
    } catch (error) {
        console.warn('Backup local inválido ignorado.', error);
        records = [];
    }
}

function saveRecords() {
    return safeStorageSet(STORAGE_RECORDS, JSON.stringify(records));
}

function loadGoals() {
    try {
        const parsed = JSON.parse(safeStorageGet(STORAGE_GOALS, '{}'));
        return { weekly: numberValue(parsed.weekly), monthly: numberValue(parsed.monthly) };
    } catch (_) {
        return { weekly: 0, monthly: 0 };
    }
}

function saveGoals(goals) {
    return safeStorageSet(STORAGE_GOALS, JSON.stringify({ weekly: numberValue(goals.weekly), monthly: numberValue(goals.monthly) }));
}

function getFilters() {
    return {
        mode: byId('filtroPeriodo').value,
        month: byId('filtroMes').value,
        week: byId('filtroSemana').value,
        start: byId('filtroInicio').value,
        end: byId('filtroFim').value,
        type: byId('filtroTipo').value,
        source: byId('filtroOrigem').value,
        search: byId('filtroPesquisa').value
    };
}

function updateFilterVisibility() {
    const mode = byId('filtroPeriodo').value;
    byId('grupoFiltroMes').classList.toggle('hidden', mode !== 'MES');
    byId('grupoFiltroSemana').classList.toggle('hidden', mode !== 'SEMANA');
    byId('grupoFiltroPersonalizado').classList.toggle('hidden', mode !== 'PERSONALIZADO');
}

function normalizeFilterReferences() {
    const filters = getFilters();
    if (filters.mode === 'SEMANA') {
        const range = isoWeekRange(filters.week);
        if (range) byId('filtroMes').value = range.start.slice(0, 7);
    } else if (filters.mode === 'PERSONALIZADO' && filters.start) {
        byId('filtroMes').value = filters.start.slice(0, 7);
    }
}

function renderAll() {
    normalizeFilterReferences();
    const filters = getFilters();
    const filtered = filterRecords(records, filters).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const periodTotals = calculateTotals(filtered);
    const monthly = monthRecords(records, filters.month);
    const monthlyTotals = calculateTotals(monthly);

    renderHeader(filters);
    renderCards(periodTotals, monthlyTotals, filters.month, filtered.length);
    renderGoals(filters);
    renderOrigins(periodTotals);
    renderTable(filtered);
    renderMonthlyReport(monthlyTotals, filters.month);
    renderDailyChart(filtered);
}

function renderHeader(filters) {
    byId('textoPeriodoAtivo').textContent = periodLabel(filters);
}

function renderCards(periodTotals, monthlyTotals, monthValue, itemCount) {
    byId('cardReceitaPeriodo').textContent = formatMoney(periodTotals.revenue);
    byId('cardReceitaDetalhe').textContent = itemCount ? `${itemCount} lançamento(s) no filtro` : 'Sem lançamentos';
    byId('cardLucroOperacional').textContent = formatMoney(periodTotals.operationalProfit);
    byId('cardLucroOperacional').classList.toggle('is-negative', periodTotals.operationalProfit < 0);
    byId('cardCombustivel').textContent = formatMoney(periodTotals.fuel);
    byId('cardManutencao').textContent = formatMoney(periodTotals.maintenance);
    byId('cardKm').textContent = `${formatNumber(periodTotals.km)} km`;
    byId('cardReceitaKm').textContent = `${formatMoney(periodTotals.revenuePerKm)} por km`;
    byId('cardLucroMensal').textContent = formatMoney(monthlyTotals.monthlyNetProfit);
    byId('cardLucroMensal').classList.toggle('is-negative', monthlyTotals.monthlyNetProfit < 0);
    byId('cardMesReferencia').textContent = monthLabel(monthValue);
}

function renderGoals(filters) {
    const goals = loadGoals();
    const weekList = weekRecords(records, filters.week);
    const monthList = monthRecords(records, filters.month);
    const weeklyRevenue = calculateTotals(weekList).revenue;
    const monthlyRevenue = calculateTotals(monthList).revenue;
    const weeklyPercent = goalProgress(weeklyRevenue, goals.weekly);
    const monthlyPercent = goalProgress(monthlyRevenue, goals.monthly);
    const weekRange = isoWeekRange(filters.week);

    byId('metaSemanalPeriodo').textContent = weekRange
        ? `${formatDateBR(weekRange.start)} a ${formatDateBR(weekRange.end)}`
        : 'Semana inválida';
    byId('metaMensalPeriodo').textContent = monthLabel(filters.month);
    byId('metaSemanalPercentual').textContent = goals.weekly > 0 ? `${weeklyPercent.toFixed(0)}%` : 'Sem meta';
    byId('metaMensalPercentual').textContent = goals.monthly > 0 ? `${monthlyPercent.toFixed(0)}%` : 'Sem meta';
    byId('barraMetaSemanal').style.width = `${Math.min(100, weeklyPercent)}%`;
    byId('barraMetaMensal').style.width = `${Math.min(100, monthlyPercent)}%`;
    byId('metaSemanalRealizado').textContent = `${formatMoney(weeklyRevenue)} realizado`;
    byId('metaMensalRealizado').textContent = `${formatMoney(monthlyRevenue)} realizado`;
    byId('metaSemanalObjetivo').textContent = `Meta: ${formatMoney(goals.weekly)}`;
    byId('metaMensalObjetivo').textContent = `Meta: ${formatMoney(goals.monthly)}`;
}

function renderOrigins(totals) {
    byId('origemIfood').textContent = formatMoney(totals.ifood);
    byId('origem99').textContent = formatMoney(totals.ninetyNine);
    byId('origemExtras').textContent = formatMoney(totals.extraRuns);
    byId('donutTotal').textContent = formatCompactMoney(totals.revenue);

    if (totals.revenue <= 0) {
        byId('graficoOrigens').style.background = 'conic-gradient(#334155 0 100%)';
        return;
    }
    const ifoodEnd = (totals.ifood / totals.revenue) * 100;
    const ninetyNineEnd = ifoodEnd + ((totals.ninetyNine / totals.revenue) * 100);
    byId('graficoOrigens').style.background = `conic-gradient(
        #3b82f6 0 ${ifoodEnd}%,
        #f59e0b ${ifoodEnd}% ${ninetyNineEnd}%,
        #a855f7 ${ninetyNineEnd}% 100%
    )`;
}

function renderTable(list) {
    const body = byId('corpoTabela');
    const empty = byId('estadoVazioTabela');
    byId('contadorLancamentos').textContent = `${list.length} ${list.length === 1 ? 'item' : 'itens'}`;

    if (!list.length) {
        body.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    body.innerHTML = list.map(record => {
        const typeClass = `type-${record.type.toLowerCase()}`;
        const origin = record.type === 'RECEITA'
            ? SOURCE_LABELS[record.source]
            : '—';
        const category = record.source === 'OUTRAS_CORRIDAS' ? EXTRA_LABELS[record.extraCategory] : '';
        const value = record.type === 'KM' ? `${formatNumber(record.km)} km` : formatMoney(record.amount);
        const dailyEffect = getDailyEffect(record);
        const monthlyEffect = getMonthlyEffect(record);

        return `
            <tr>
                <td data-label="Data"><strong>${formatDateBR(record.date)}</strong></td>
                <td data-label="Tipo"><span class="type-badge ${typeClass}">${TYPE_LABELS[record.type]}</span></td>
                <td data-label="Origem / categoria">${escapeHTML(origin)}${category ? `<br><small>${escapeHTML(category)}</small>` : ''}</td>
                <td data-label="Descrição">${record.description ? escapeHTML(record.description) : '<span class="value-neutral">Sem observação</span>'}</td>
                <td data-label="Valor"><strong>${value}</strong></td>
                <td data-label="Efeito diário" class="${dailyEffect.className}">${dailyEffect.text}</td>
                <td data-label="Efeito mensal" class="${monthlyEffect.className}">${monthlyEffect.text}</td>
                <td data-label="Ações" class="actions-column">
                    <div class="row-actions">
                        <button class="table-button" type="button" data-action="edit" data-id="${escapeHTML(record.id)}" title="Editar">Editar</button>
                        <button class="table-button" type="button" data-action="duplicate" data-id="${escapeHTML(record.id)}" title="Duplicar">Duplicar</button>
                        <button class="table-button danger" type="button" data-action="delete" data-id="${escapeHTML(record.id)}" title="Excluir">Excluir</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

function getDailyEffect(record) {
    if (record.type === 'RECEITA') return { text: `+ ${formatMoney(record.amount)}`, className: 'value-positive' };
    if (record.type === 'COMBUSTIVEL') return { text: `− ${formatMoney(record.amount)}`, className: 'value-negative' };
    if (record.type === 'MANUTENCAO') return { text: 'Somente mensal', className: 'value-neutral' };
    return { text: '—', className: 'value-neutral' };
}

function getMonthlyEffect(record) {
    if (record.type === 'RECEITA') return { text: `+ ${formatMoney(record.amount)}`, className: 'value-positive' };
    if (record.type === 'COMBUSTIVEL' || record.type === 'MANUTENCAO') {
        return { text: `− ${formatMoney(record.amount)}`, className: 'value-negative' };
    }
    return { text: '—', className: 'value-neutral' };
}

function renderMonthlyReport(totals, monthValue) {
    byId('tituloFechamentoMensal').textContent = monthLabel(monthValue);
    byId('relatorioIfood').textContent = formatMoney(totals.ifood);
    byId('relatorio99').textContent = formatMoney(totals.ninetyNine);
    byId('relatorioExtras').textContent = formatMoney(totals.extraRuns);
    byId('relatorioReceita').textContent = formatMoney(totals.revenue);
    byId('relatorioCombustivel').textContent = formatMoney(totals.fuel);
    byId('relatorioManutencao').textContent = formatMoney(totals.maintenance);
    byId('relatorioOperacional').textContent = formatMoney(totals.operationalProfit);
    byId('relatorioLiquido').textContent = formatMoney(totals.monthlyNetProfit);
    byId('relatorioLiquido').closest('.report-highlight').classList.toggle('is-negative', totals.monthlyNetProfit < 0);
    byId('relatorioDias').textContent = String(totals.workedDays);
    byId('relatorioKm').textContent = `${formatNumber(totals.km)} km`;
    byId('relatorioPorKm').textContent = formatMoney(totals.revenuePerKm);
    byId('relatorioMedia').textContent = formatMoney(totals.averagePerDay);
}

function renderDailyChart(list) {
    const canvas = byId('graficoDiario');
    const empty = byId('graficoVazio');
    const daily = aggregateByDay(list);
    if (!daily.length) {
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    drawDailyChart(canvas, daily);
}

function drawDailyChart(canvas, daily) {
    const width = Math.max(260, Math.floor(canvas.parentElement.clientWidth - 30));
    const height = 290;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const padding = { top: 18, right: 18, bottom: 42, left: 58 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const values = daily.flatMap(day => [day.revenue, day.dailyProfit]);
    const maxValue = Math.max(1, ...values, 0);
    const minValue = Math.min(0, ...values);
    const span = Math.max(1, maxValue - minValue);
    const y = value => padding.top + ((maxValue - value) / span) * chartHeight;
    const zeroY = y(0);

    context.font = '10px system-ui';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (let step = 0; step <= 5; step += 1) {
        const value = maxValue - ((span / 5) * step);
        const lineY = y(value);
        context.strokeStyle = 'rgba(143,161,184,.16)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(padding.left, lineY);
        context.lineTo(width - padding.right, lineY);
        context.stroke();
        context.fillStyle = '#8fa1b8';
        context.fillText(formatCompactMoney(value), padding.left - 8, lineY);
    }

    context.strokeStyle = 'rgba(243,247,251,.30)';
    context.beginPath();
    context.moveTo(padding.left, zeroY);
    context.lineTo(width - padding.right, zeroY);
    context.stroke();

    const slot = chartWidth / daily.length;
    const barWidth = Math.max(4, Math.min(24, slot * .46));

    daily.forEach((day, index) => {
        const centerX = padding.left + (slot * index) + (slot / 2);
        const revenueY = y(day.revenue);
        context.fillStyle = 'rgba(59,130,246,.55)';
        context.fillRect(centerX - (barWidth / 2), revenueY, barWidth, Math.max(1, zeroY - revenueY));
    });

    context.lineWidth = 2.2;
    context.strokeStyle = '#22c55e';
    context.beginPath();
    daily.forEach((day, index) => {
        const pointX = padding.left + (slot * index) + (slot / 2);
        const pointY = y(day.dailyProfit);
        if (index === 0) context.moveTo(pointX, pointY);
        else context.lineTo(pointX, pointY);
    });
    context.stroke();

    daily.forEach((day, index) => {
        const pointX = padding.left + (slot * index) + (slot / 2);
        const pointY = y(day.dailyProfit);
        context.fillStyle = day.dailyProfit >= 0 ? '#22c55e' : '#ef4444';
        context.beginPath();
        context.arc(pointX, pointY, 3.5, 0, Math.PI * 2);
        context.fill();
    });

    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = '#8fa1b8';
    const labelEvery = Math.max(1, Math.ceil(daily.length / 12));
    daily.forEach((day, index) => {
        if (index % labelEvery !== 0 && index !== daily.length - 1) return;
        const pointX = padding.left + (slot * index) + (slot / 2);
        context.fillText(formatDateBR(day.date).slice(0, 5), pointX, height - padding.bottom + 10);
    });

    context.textAlign = 'left';
    context.fillStyle = '#7faeff';
    context.fillText('■ Receita', padding.left, 2);
    context.fillStyle = '#70e49a';
    context.fillText('● Lucro diário', padding.left + 78, 2);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(numberValue(value));
}

function formatCompactMoney(value) {
    const parsed = Number(value);
    const number = Number.isFinite(parsed) ? parsed : 0;
    const absolute = Math.abs(number);
    const sign = number < 0 ? '−' : '';
    if (absolute >= 1_000_000) return `${sign}R$ ${(absolute / 1_000_000).toFixed(1).replace('.', ',')} mi`;
    if (absolute >= 1_000) return `${sign}R$ ${(absolute / 1_000).toFixed(1).replace('.', ',')} mil`;
    return `${sign}R$ ${absolute.toFixed(0)}`;
}

function updateLaunchFields() {
    const type = byId('inputTipo').value;
    const source = byId('inputOrigem').value;
    byId('grupoReceita').classList.toggle('hidden', type !== 'RECEITA');
    byId('grupoCategoriaExtra').classList.toggle('hidden', type !== 'RECEITA' || source !== 'OUTRAS_CORRIDAS');
    byId('grupoValor').classList.toggle('hidden', type === 'KM');
    byId('grupoKm').classList.toggle('hidden', type !== 'KM');

    const labels = {
        RECEITA: 'Valor da receita (R$) *',
        COMBUSTIVEL: 'Valor do combustível (R$) *',
        MANUTENCAO: 'Valor da manutenção (R$) *'
    };
    byId('labelValor').textContent = labels[type] || 'Valor (R$) *';
    updateLaunchPreview();
}

function readLaunchForm() {
    const type = byId('inputTipo').value;
    return {
        id: byId('registroId').value,
        date: byId('inputData').value,
        type,
        source: type === 'RECEITA' ? byId('inputOrigem').value : '',
        extraCategory: type === 'RECEITA' && byId('inputOrigem').value === 'OUTRAS_CORRIDAS'
            ? byId('inputCategoriaExtra').value
            : '',
        amount: type === 'KM' ? 0 : numberValue(byId('inputValor').value),
        km: type === 'KM' ? numberValue(byId('inputKm').value) : 0,
        description: byId('inputDescricao').value.trim()
    };
}

function validateLaunch(data) {
    if (!isValidISODate(data.date)) return 'Informe uma data válida.';
    if (!RECORD_TYPES.includes(data.type)) return 'Selecione um tipo válido.';
    if (data.type === 'RECEITA' && !REVENUE_SOURCES.includes(data.source)) return 'Selecione a origem da receita.';
    if (data.type === 'RECEITA' && data.source === 'OUTRAS_CORRIDAS' && !EXTRA_CATEGORIES.includes(data.extraCategory)) {
        return 'Selecione a categoria da correria.';
    }
    if (data.type === 'KM' && data.km <= 0) return 'Informe uma quilometragem maior que zero.';
    if (data.type !== 'KM' && data.amount <= 0) return 'Informe um valor maior que zero.';
    return '';
}

function updateLaunchPreview() {
    const data = readLaunchForm();
    const source = data.type === 'RECEITA' ? ` • ${SOURCE_LABELS[data.source] || 'Origem não informada'}` : '';
    const category = data.extraCategory ? ` • ${EXTRA_LABELS[data.extraCategory]}` : '';
    const value = data.type === 'KM' ? `${formatNumber(data.km)} km` : formatMoney(data.amount);
    byId('previewLancamento').innerHTML = `
        <strong>${TYPE_LABELS[data.type] || 'Tipo'}${escapeHTML(source)}${escapeHTML(category)}</strong><br>
        Data: ${data.date ? formatDateBR(data.date) : 'não informada'}<br>
        Valor: ${value}${data.description ? `<br>Observação: ${escapeHTML(data.description)}` : ''}`;
}

function openLaunchModal(recordId = '', duplicate = false) {
    byId('formLancamento').reset();
    byId('registroId').value = '';
    byId('inputData').value = localISODate();
    byId('inputTipo').value = 'RECEITA';
    byId('inputOrigem').value = 'IFOOD';
    byId('inputCategoriaExtra').value = 'ENTREGA_PARTICULAR';
    byId('inputValor').value = '';
    byId('inputKm').value = '';
    byId('inputDescricao').value = '';
    byId('tituloModalLancamento').textContent = 'Novo lançamento';

    if (recordId) {
        const record = records.find(item => item.id === recordId);
        if (!record) {
            showToast('Lançamento não encontrado.', 'error');
            return;
        }
        byId('registroId').value = duplicate ? '' : record.id;
        byId('inputData').value = duplicate ? localISODate() : record.date;
        byId('inputTipo').value = record.type;
        byId('inputOrigem').value = record.source || 'IFOOD';
        byId('inputCategoriaExtra').value = record.extraCategory || 'ENTREGA_PARTICULAR';
        byId('inputValor').value = record.type === 'KM' ? '' : record.amount;
        byId('inputKm').value = record.type === 'KM' ? record.km : '';
        byId('inputDescricao').value = record.description;
        byId('tituloModalLancamento').textContent = duplicate ? 'Duplicar lançamento' : 'Editar lançamento';
    }

    updateLaunchFields();
    byId('modalLancamento').classList.remove('hidden');
    setTimeout(() => byId('inputData').focus(), 0);
}

function closeLaunchModal() {
    byId('modalLancamento').classList.add('hidden');
    pendingRecord = null;
}

function reviewLaunch() {
    const data = readLaunchForm();
    const error = validateLaunch(data);
    if (error) {
        showToast(error, 'error');
        return;
    }
    pendingRecord = data;
    renderConfirmation(data);
    byId('modalConfirmacao').classList.remove('hidden');
}

function renderConfirmation(data) {
    const rows = [
        ['Data', formatDateBR(data.date)],
        ['Tipo', TYPE_LABELS[data.type]],
        ['Origem', data.type === 'RECEITA' ? SOURCE_LABELS[data.source] : 'Não se aplica'],
        ['Categoria', data.extraCategory ? EXTRA_LABELS[data.extraCategory] : 'Não se aplica'],
        [data.type === 'KM' ? 'Quilômetros' : 'Valor', data.type === 'KM' ? `${formatNumber(data.km)} km` : formatMoney(data.amount)],
        ['Observação', data.description || 'Sem observação']
    ];
    byId('resumoConfirmacao').innerHTML = rows.map(([label, value]) => `
        <div class="confirmation-row"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>
    `).join('');
}

function closeConfirmation() {
    byId('modalConfirmacao').classList.add('hidden');
}

function confirmAndSave() {
    if (!pendingRecord) {
        showToast('Nenhum lançamento aguardando confirmação.', 'error');
        return;
    }

    const existing = pendingRecord.id ? records.find(item => item.id === pendingRecord.id) : null;
    const record = sanitizeRecord({
        ...pendingRecord,
        id: existing?.id || generateId(),
        createdAt: existing?.createdAt || new Date().toISOString()
    });
    if (!record) {
        showToast('O lançamento não passou na validação final.', 'error');
        return;
    }

    if (existing) {
        records = records.map(item => item.id === existing.id ? record : item);
        showToast('Lançamento atualizado com sucesso.');
    } else {
        records.push(record);
        showToast('Lançamento salvo com sucesso.');
    }
    const persisted = saveRecords();
    closeConfirmation();
    closeLaunchModal();
    renderAll();
    if (!persisted && !storageWarningShown) {
        storageWarningShown = true;
        showToast('O navegador bloqueou o armazenamento local. Os dados ficarão somente nesta sessão; exporte um backup JSON.', 'error');
    }
}

function deleteRecord(id) {
    const record = records.find(item => item.id === id);
    if (!record) return;
    if (!window.confirm(`Excluir ${TYPE_LABELS[record.type].toLowerCase()} de ${record.type === 'KM' ? `${formatNumber(record.km)} km` : formatMoney(record.amount)}?`)) return;
    records = records.filter(item => item.id !== id);
    const persisted = saveRecords();
    renderAll();
    showToast('Lançamento excluído.');
    if (!persisted && !storageWarningShown) {
        storageWarningShown = true;
        showToast('Alteração mantida somente nesta sessão. Exporte um backup JSON.', 'error');
    }
}

function openGoalsModal() {
    const goals = loadGoals();
    byId('inputMetaSemanal').value = goals.weekly || '';
    byId('inputMetaMensal').value = goals.monthly || '';
    byId('modalMetas').classList.remove('hidden');
}

function closeGoalsModal() {
    byId('modalMetas').classList.add('hidden');
}

function storeGoals() {
    const weekly = numberValue(byId('inputMetaSemanal').value);
    const monthly = numberValue(byId('inputMetaMensal').value);
    const persisted = saveGoals({ weekly, monthly });
    closeGoalsModal();
    renderGoals(getFilters());
    showToast('Metas atualizadas.');
    if (!persisted && !storageWarningShown) {
        storageWarningShown = true;
        showToast('As metas ficaram somente nesta sessão. Exporte um backup JSON.', 'error');
    }
}

function exportJSON() {
    const backup = {
        version: 6,
        exportedAt: new Date().toISOString(),
        records,
        goals: loadGoals()
    };
    downloadFile(JSON.stringify(backup, null, 2), `backup_motofinance_${localISODate()}.json`, 'application/json');
    showToast('Backup JSON criado.');
}

function importJSON(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const content = JSON.parse(String(reader.result || ''));
            const list = Array.isArray(content) ? content : content.records;
            if (!Array.isArray(list)) throw new Error('Lista ausente');
            const sanitized = list.map(sanitizeRecord).filter(Boolean);
            if (sanitized.length !== list.length) throw new Error('Existem registros inválidos');
            const uniqueIds = new Set(sanitized.map(record => record.id));
            if (uniqueIds.size !== sanitized.length) throw new Error('Existem identificadores duplicados');
            if (!window.confirm(`Restaurar ${sanitized.length} lançamento(s)? Os dados atuais serão substituídos.`)) return;
            records = sanitized;
            const goalsPersisted = content.goals ? saveGoals(content.goals) : true;
            const recordsPersisted = saveRecords();
            renderAll();
            if (recordsPersisted && goalsPersisted) {
                showToast('Backup restaurado com sucesso.');
            } else {
                storageWarningShown = true;
                showToast('Backup aberto somente nesta sessão. O navegador não permitiu salvar os dados.', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('O arquivo de backup é inválido.', 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

function exportCSV() {
    const filtered = filterRecords(records, getFilters()).sort((a, b) => a.date.localeCompare(b.date));
    const header = ['Data', 'Tipo', 'Origem', 'Categoria extra', 'Descrição', 'Valor', 'Km', 'Efeito diário', 'Efeito mensal'];
    const rows = filtered.map(record => [
        formatDateBR(record.date),
        TYPE_LABELS[record.type],
        SOURCE_LABELS[record.source] || '',
        EXTRA_LABELS[record.extraCategory] || '',
        record.description,
        record.type === 'KM' ? '' : record.amount.toFixed(2).replace('.', ','),
        record.type === 'KM' ? String(record.km).replace('.', ',') : '',
        getDailyEffect(record).text,
        getMonthlyEffect(record).text
    ]);
    const csv = '\uFEFF' + [header, ...rows].map(row => row.map(csvValue).join(';')).join('\n');
    downloadFile(csv, `relatorio_motofinance_${localISODate()}.csv`, 'text/csv;charset=utf-8');
    showToast('Relatório CSV exportado.');
}

function csvValue(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadFile(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    byId('toastContainer').appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
}

function toggleMobileMenu(forceClose = false) {
    const sidebar = byId('sidebar');
    const overlay = byId('mobileOverlay');
    const open = forceClose ? false : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    overlay.classList.toggle('hidden', !open);
}

function advanceOnEnter(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const form = byId('formLancamento');
    const visible = [...form.querySelectorAll('input:not([type="hidden"]), select, button')]
        .filter(element => !element.disabled && !element.closest('.hidden'));
    const index = visible.indexOf(event.target);
    const next = visible[index + 1];
    if (next && next.id !== 'btnRevisarLancamento') next.focus();
    else showToast('Clique em “Revisar lançamento” para continuar.');
}

function bindEvents() {
    byId('filtroPeriodo').addEventListener('change', updateFilterVisibility);
    byId('btnAplicarFiltro').addEventListener('click', renderAll);
    byId('btnLimparFiltro').addEventListener('click', () => {
        byId('filtroPeriodo').value = 'MES';
        byId('filtroMes').value = currentMonthValue();
        byId('filtroSemana').value = dateToISOWeek();
        byId('filtroInicio').value = '';
        byId('filtroFim').value = '';
        byId('filtroTipo').value = 'TODOS';
        byId('filtroOrigem').value = 'TODOS';
        byId('filtroPesquisa').value = '';
        updateFilterVisibility();
        renderAll();
    });

    ['filtroMes', 'filtroSemana', 'filtroTipo', 'filtroOrigem'].forEach(id => {
        byId(id).addEventListener('change', renderAll);
    });
    byId('filtroPesquisa').addEventListener('input', renderAll);

    byId('btnNovoLancamento').addEventListener('click', () => openLaunchModal());
    byId('btnFecharLancamento').addEventListener('click', closeLaunchModal);
    byId('btnCancelarLancamento').addEventListener('click', closeLaunchModal);
    byId('btnRevisarLancamento').addEventListener('click', reviewLaunch);
    byId('formLancamento').addEventListener('submit', event => event.preventDefault());
    byId('formLancamento').addEventListener('keydown', advanceOnEnter);
    ['inputData', 'inputTipo', 'inputOrigem', 'inputCategoriaExtra', 'inputValor', 'inputKm', 'inputDescricao'].forEach(id => {
        byId(id).addEventListener('input', updateLaunchFields);
        byId(id).addEventListener('change', updateLaunchFields);
    });

    byId('btnFecharConfirmacao').addEventListener('click', closeConfirmation);
    byId('btnVoltarEdicao').addEventListener('click', closeConfirmation);
    byId('btnSalvarConfirmado').addEventListener('click', confirmAndSave);
    byId('modalConfirmacao').addEventListener('keydown', event => {
        if (event.key === 'Enter') event.preventDefault();
    });

    byId('corpoTabela').addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const { action, id } = button.dataset;
        if (action === 'edit') openLaunchModal(id, false);
        if (action === 'duplicate') openLaunchModal(id, true);
        if (action === 'delete') deleteRecord(id);
    });

    byId('btnAbrirMetas').addEventListener('click', openGoalsModal);
    byId('btnFecharMetas').addEventListener('click', closeGoalsModal);
    byId('btnCancelarMetas').addEventListener('click', closeGoalsModal);
    byId('btnSalvarMetas').addEventListener('click', storeGoals);
    byId('btnExportarJSON').addEventListener('click', exportJSON);
    byId('inputImportarJSON').addEventListener('change', importJSON);
    byId('btnExportarCSV').addEventListener('click', exportCSV);
    byId('btnImprimir').addEventListener('click', () => window.print());

    byId('btnMenuMobile').addEventListener('click', () => toggleMobileMenu(false));
    byId('mobileOverlay').addEventListener('click', () => toggleMobileMenu(true));

    window.addEventListener('keydown', event => {
        if (event.altKey && event.key.toLowerCase() === 'n') {
            event.preventDefault();
            openLaunchModal();
        }
        if (event.key === 'Escape') {
            if (!byId('modalConfirmacao').classList.contains('hidden')) {
                closeConfirmation();
                return;
            }
            if (!byId('modalMetas').classList.contains('hidden')) {
                closeGoalsModal();
                return;
            }
            if (!byId('modalLancamento').classList.contains('hidden')) {
                closeLaunchModal();
                return;
            }
            toggleMobileMenu(true);
        }
    });

    window.addEventListener('resize', () => {
        clearTimeout(redrawTimer);
        redrawTimer = setTimeout(() => renderDailyChart(filterRecords(records, getFilters())), 120);
    });
}

function initialize() {
    loadRecords();
    byId('filtroMes').value = currentMonthValue();
    byId('filtroSemana').value = dateToISOWeek();
    updateFilterVisibility();
    bindEvents();
    updateLaunchFields();
    renderAll();
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initialize);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        numberValue,
        isValidISODate,
        isValidMonthValue,
        sanitizeRecord,
        recordRevenue,
        calculateTotals,
        aggregateByDay,
        localISODate,
        currentMonthValue,
        dateToISOWeek,
        isoWeekRange,
        filterRecords,
        monthRecords,
        weekRecords,
        goalProgress,
        formatMoney,
        formatCompactMoney,
        periodLabel,
        getDailyEffect,
        getMonthlyEffect
    };
}
