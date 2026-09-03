'use strict';

const Core = window.MotoFinanceCore;
const STORAGE_KEY = 'motofinance_pro_v1';
const RECOVERY_KEY = 'motofinance_pro_recovery';
const LEGACY_RECORDS_KEY = 'motofinance_v6_records';
const LEGACY_GOALS_KEY = 'motofinance_v6_goals';
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const PAGES = new Set(['home', 'charts', 'vehicles', 'alarms', 'transactions', 'more']);

const ICONS = {
    corrida: 'vehicle', entrega: 'wallet', frete: 'box', diaria: 'calendar', gorjeta: 'plus', outro_ganho: 'more',
    combustivel: 'fuel', manutencao: 'tools', pedagio: 'route', estacionamento: 'tag', seguro: 'shield',
    multa: 'alert', impostos: 'receipt', documento: 'document', outro_gasto: 'more', drop: 'drop', tools: 'tools',
    gauge: 'gauge', adjust: 'adjust', battery: 'battery', alert: 'alert', filter: 'filter', circle: 'circle',
    document: 'document', shield: 'shield', receipt: 'receipt', bell: 'bell'
};
const COLORS = {
    corrida: 'blue', entrega: 'mint', frete: 'violet', diaria: 'yellow', gorjeta: 'orange', outro_ganho: 'neutral',
    combustivel: 'blue', manutencao: 'orange', pedagio: 'yellow', estacionamento: 'neutral', seguro: 'mint',
    multa: 'red', impostos: 'mint', documento: 'violet', outro_gasto: 'neutral'
};

let startupNotice = null;
let state = loadState();
let quickType = 'expense';
let chartType = 'expense';
let pendingConfirm = null;
const filterState = { transactionMonth: state.preferences.month, transactionVehicle: 'all', transactionType: 'all', transactionSearch: '', chartMonth: state.preferences.month, chartVehicle: state.preferences.activeVehicleId, alarmVehicle: state.preferences.activeVehicleId };

function $(id) { return document.getElementById(id); }
function esc(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function icon(name, className = '') { return '<svg class="' + esc(className) + '" aria-hidden="true"><use href="#i-' + esc(ICONS[name] || name || 'more') + '"></use></svg>'; }
function vehicleName(vehicle) { return vehicle ? vehicle.brand + ' ' + vehicle.model : 'Veículo removido'; }
function activeVehicle() { return state.vehicles.find(item => item.id === state.preferences.activeVehicleId) || state.vehicles[0]; }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }

function safeRead(key) {
    try { return { ok: true, value: localStorage.getItem(key) }; }
    catch (error) { console.error(error); return { ok: false, value: null }; }
}

function persist(candidate, showError = true) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
        return true;
    } catch (error) {
        console.error(error);
        if (showError && $('toastRegion')) toast('Não foi possível salvar. Nada foi alterado.', 'error');
        return false;
    }
}

function commitChange(change, successMessage, options = {}) {
    const draft = clone(state);
    try { change(draft); }
    catch (error) { console.error(error); toast('A alteração não pôde ser preparada.', 'error'); return false; }
    if (!persist(draft, options.showError !== false)) return false;
    state = draft;
    if (options.close) $(options.close).close();
    renderAll();
    if (options.page) navigate(options.page);
    if (successMessage) toast(successMessage);
    return true;
}

function deduplicate(items, kind, errors) {
    const seen = new Set();
    return items.filter(item => {
        if (seen.has(item.id)) { errors.push('Há identificadores repetidos em ' + kind + '.'); return false; }
        seen.add(item.id); return true;
    });
}

function looksLikeFakeDefaults(raw) {
    if (Number(raw?.version) !== 1 || (raw.transactions?.length || 0) || Number(raw.vehicles?.[0]?.odometer || 0) !== 0) return false;
    if (!Array.isArray(raw.reminders) || raw.reminders.length !== Core.REMINDER_TEMPLATES.length) return false;
    const configuredItems = raw.reminders.filter(item => item.enabled && (item.byKm || item.byTime));
    const configured = configuredItems.map(item => item.templateKey).sort().join(',');
    return configured === 'calibragem,oleo,revisao'
        && configuredItems.every(item => String(item.id || '') === 'reminder-' + item.templateKey && Number(item.lastKm || 0) === 0 && Core.validDate(item.lastDate));
}

function normalizeState(raw, strict = false) {
    const errors = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { state: Core.createInitialState(), errors: ['Estrutura principal inválida.'] };
    const rawVehicles = Array.isArray(raw.vehicles) ? raw.vehicles : [];
    let vehicles = rawVehicles.map(Core.sanitizeVehicle).filter(Boolean);
    if (vehicles.length !== rawVehicles.length) errors.push('Um ou mais veículos são inválidos.');
    if (strict && rawVehicles.some(item => !Core.validPlate(item?.plate))) errors.push('Uma ou mais placas são inválidas.');
    vehicles = deduplicate(vehicles, 'veículos', errors);
    const plates = vehicles.map(item => item.plate).filter(Boolean);
    if (new Set(plates).size !== plates.length) errors.push('Há placas de veículo repetidas.');
    if (!vehicles.length) errors.push('O backup não contém veículo válido.');
    if (strict && errors.length) return { state: null, errors };
    if (!vehicles.length) return { state: Core.createInitialState(), errors };

    if (strict && !Array.isArray(raw.transactions)) errors.push('A lista de movimentações está ausente.');
    const rawTransactions = Array.isArray(raw.transactions) ? raw.transactions : [];
    let transactions = rawTransactions.map(item => Core.sanitizeTransaction(item, vehicles)).filter(Boolean);
    if (transactions.length !== rawTransactions.length) errors.push('Uma ou mais movimentações são inválidas.');
    transactions = deduplicate(transactions, 'movimentações', errors);

    if (strict && !Array.isArray(raw.reminders)) errors.push('A lista de lembretes está ausente.');
    const rawReminders = Array.isArray(raw.reminders) ? raw.reminders : [];
    if (strict && rawReminders.some(item => (item?.byKm && Core.positive(item.kmInterval) <= 0) || (item?.byTime && (Core.positive(item.dayInterval) <= 0 || !Core.validDate(item.lastDate))))) errors.push('Um ou mais intervalos de lembrete são inválidos.');
    let reminders = rawReminders.map(item => Core.sanitizeReminder(item, vehicles)).filter(Boolean);
    if (reminders.length !== rawReminders.length) errors.push('Um ou mais lembretes são inválidos.');
    reminders = deduplicate(reminders, 'lembretes', errors);

    if (strict && !Array.isArray(raw.odometerLogs) && Number(raw.version) >= 2) errors.push('O histórico de odômetro está ausente.');
    const rawLogs = Array.isArray(raw.odometerLogs) ? raw.odometerLogs : [];
    let odometerLogs = rawLogs.map(Core.sanitizeOdometerLog).filter(item => item && vehicles.some(vehicle => vehicle.id === item.vehicleId));
    if (odometerLogs.length !== rawLogs.length) errors.push('Um ou mais registros de odômetro são inválidos.');
    odometerLogs = deduplicate(odometerLogs, 'registros de odômetro', errors);
    if (strict && errors.length) return { state: null, errors: [...new Set(errors)] };

    if (looksLikeFakeDefaults(raw)) reminders = Core.createReminderSet(vehicles[0]);
    vehicles.forEach(vehicle => {
        const existingKeys = new Set(reminders.filter(item => item.vehicleId === vehicle.id).map(item => item.templateKey));
        Core.createReminderSet(vehicle).forEach(item => { if (!existingKeys.has(item.templateKey)) reminders.push(item); });
    });
    const activeId = vehicles.some(item => item.id === raw.preferences?.activeVehicleId) ? raw.preferences.activeVehicleId : vehicles[0].id;
    return {
        state: {
            version: Core.DATA_VERSION,
            profile: { name: String(raw.profile?.name || 'Moisés').trim().slice(0, 40) || 'Moisés' },
            vehicles, transactions, reminders, odometerLogs,
            preferences: {
                activeVehicleId: activeId,
                month: Core.validMonth(raw.preferences?.month) ? raw.preferences.month : Core.currentMonth(),
                theme: 'light', weeklyGoal: Core.nonNegative(raw.preferences?.weeklyGoal), monthlyGoal: Core.nonNegative(raw.preferences?.monthlyGoal)
            },
            migratedFromV6: Boolean(raw.migratedFromV6), migrationSummary: raw.migrationSummary || null
        },
        errors: [...new Set(errors)]
    };
}

function legacyGainCategory(record) {
    const extra = String(record.extraCategory || '').toUpperCase();
    const source = String(record.source || '').toUpperCase();
    if (extra.includes('ENTREGA')) return 'entrega';
    if (extra.includes('FRETE')) return 'frete';
    if (extra.includes('DIARIA') || extra.includes('DIÁRIA')) return 'diaria';
    if (extra.includes('GORJETA')) return 'gorjeta';
    if (extra.includes('CORRIDA') || source === '99' || source === 'UBER') return 'corrida';
    if (source.includes('IFOOD') || source.includes('RAPPI')) return 'entrega';
    return 'outro_ganho';
}

function migrateLegacy(current) {
    if (current.migratedFromV6) return current;
    const recordsRead = safeRead(LEGACY_RECORDS_KEY);
    const goalsRead = safeRead(LEGACY_GOALS_KEY);
    const summary = { transactions: 0, distances: 0, goals: 0, skipped: 0 };
    try {
        const legacy = recordsRead.value ? JSON.parse(recordsRead.value) : [];
        if (Array.isArray(legacy)) {
            const vehicleId = current.vehicles[0].id;
            legacy.forEach((record, index) => {
                const legacyId = String(record.id ?? index);
                if (String(record.type || '').toUpperCase() === 'KM') {
                    const log = Core.sanitizeOdometerLog({ id: 'legacy-km-' + legacyId, vehicleId, date: record.date, odometer: record.km ?? record.distance ?? record.amount, description: record.description || 'Quilometragem importada', createdAt: record.createdAt });
                    if (log && !current.odometerLogs.some(item => item.id === log.id)) { current.odometerLogs.push(log); summary.distances += 1; } else summary.skipped += 1;
                    return;
                }
                let type; let category;
                const kind = String(record.type || '').toUpperCase();
                if (kind === 'RECEITA') { type = 'gain'; category = legacyGainCategory(record); }
                if (kind === 'COMBUSTIVEL') { type = 'expense'; category = 'combustivel'; }
                if (kind === 'MANUTENCAO') { type = 'expense'; category = 'manutencao'; }
                if (!type) { summary.skipped += 1; return; }
                const item = Core.sanitizeTransaction({ id: 'legacy-' + legacyId, vehicleId, type, category, amount: record.amount, date: record.date, description: record.description || 'Importado da versão anterior', createdAt: record.createdAt }, current.vehicles);
                if (item && !current.transactions.some(existing => existing.id === item.id)) { current.transactions.push(item); summary.transactions += 1; } else summary.skipped += 1;
            });
        }
        const goals = goalsRead.value ? JSON.parse(goalsRead.value) : null;
        if (goals && typeof goals === 'object') {
            const weekly = Core.nonNegative(goals.weekly ?? goals.weeklyGoal ?? goals.metaSemanal);
            const monthly = Core.nonNegative(goals.monthly ?? goals.monthlyGoal ?? goals.metaMensal);
            if (weekly) { current.preferences.weeklyGoal = weekly; summary.goals += 1; }
            if (monthly) { current.preferences.monthlyGoal = monthly; summary.goals += 1; }
        }
    } catch (error) { console.warn('Falha na importação da versão anterior.', error); summary.skipped += 1; }
    current.migratedFromV6 = true;
    current.migrationSummary = summary.transactions || summary.distances || summary.goals ? summary : null;
    return current;
}

function loadState() {
    const read = safeRead(STORAGE_KEY);
    if (!read.ok) { startupNotice = { type: 'error', text: 'O navegador bloqueou o acesso aos dados locais.' }; return Core.createInitialState(); }
    if (!read.value) {
        const initial = migrateLegacy(Core.createInitialState());
        persist(initial, false);
        return initial;
    }
    try {
        const normalized = normalizeState(JSON.parse(read.value));
        const migrated = migrateLegacy(normalized.state);
        if (normalized.errors.length) startupNotice = { type: 'warning', text: 'Alguns dados antigos precisaram ser reparados: ' + normalized.errors.join(' ') };
        persist(migrated, false);
        return migrated;
    } catch (error) {
        try { localStorage.setItem(RECOVERY_KEY, read.value); } catch (recoveryError) { console.error(recoveryError); }
        startupNotice = { type: 'recovery', text: 'Os dados salvos estão corrompidos. A cópia original foi preservada para recuperação.' };
        return Core.createInitialState();
    }
}

function toast(message, type = 'success') {
    const item = document.createElement('div'); item.className = 'toast ' + type; item.textContent = message;
    $('toastRegion').appendChild(item); setTimeout(() => item.remove(), 4500);
}
function monthValues(includeAll = false) {
    const values = new Set([Core.currentMonth(), state.preferences.month]); const cursor = new Date();
    for (let index = 0; index < 12; index += 1) { values.add(cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0')); cursor.setMonth(cursor.getMonth() - 1); }
    state.transactions.forEach(item => values.add(item.date.slice(0, 7)));
    const options = [...values].filter(Core.validMonth).sort().reverse().map(value => '<option value="' + value + '">' + esc(Core.monthLabel(value)) + '</option>').join('');
    return (includeAll ? '<option value="">Todos os períodos</option>' : '') + options;
}
function vehicleOptions(includeAll = false) { return (includeAll ? '<option value="all">Todos os veículos</option>' : '') + state.vehicles.map(vehicle => '<option value="' + esc(vehicle.id) + '">' + esc(vehicleName(vehicle)) + '</option>').join(''); }
function setOptions(id, html, value) { const node = $(id); node.innerHTML = html; if ([...node.options].some(option => option.value === value)) node.value = value; }
function refreshSelectors() {
    setOptions('homeMonth', monthValues(), state.preferences.month); setOptions('chartMonth', monthValues(), filterState.chartMonth);
    setOptions('transactionMonth', monthValues(true), filterState.transactionMonth);
    setOptions('homeVehicle', vehicleOptions(), state.preferences.activeVehicleId); setOptions('alarmVehicle', vehicleOptions(), filterState.alarmVehicle);
    setOptions('transactionVehicleId', vehicleOptions(), state.preferences.activeVehicleId); setOptions('reminderVehicleId', vehicleOptions(), state.preferences.activeVehicleId);
    setOptions('chartVehicle', vehicleOptions(true), filterState.chartVehicle); setOptions('transactionVehicle', vehicleOptions(true), filterState.transactionVehicle);
}
function selectedTransactions(month = state.preferences.month, vehicleId = state.preferences.activeVehicleId) { return Core.filterTransactions(state.transactions, { month, vehicleId }); }

function reminderPriority(row) {
    const order = { overdue: 0, upcoming: 1, ok: 2, paused: 3, unconfigured: 4 };
    return [order[row.status.key] ?? 5, row.status.urgency ?? Infinity];
}
function renderHome() {
    const vehicle = activeVehicle(); const list = selectedTransactions(); const totals = Core.calculateTotals(list);
    $('welcomeName').textContent = state.profile.name; $('profileName').textContent = state.profile.name;
    $('homeBalance').textContent = Core.money(totals.balance); $('homeBalance').style.color = totals.balance < 0 ? '#ff9197' : 'white';
    $('homeGains').textContent = Core.money(totals.gains); $('homeExpenses').textContent = Core.money(totals.expenses);
    $('homeBalanceLabel').textContent = vehicleName(vehicle) + ' • ' + Core.monthLabel(state.preferences.month);
    $('balanceSignal').textContent = totals.balance > 0 ? '+' : totals.balance < 0 ? '−' : '—';
    $('transactionCountText').textContent = list.length ? list.length + (list.length === 1 ? ' movimentação' : ' movimentações') : 'Nenhuma movimentação';
    const workDays = new Set(list.filter(item => item.type === 'gain').map(item => item.date)).size;
    const average = workDays ? totals.gains / workDays : 0; const goal = state.preferences.monthlyGoal;
    const goalText = goal ? ' Meta mensal: ' + Math.min(100, totals.gains / goal * 100).toFixed(0) + '% atingida.' : '';
    const insight = totals.gains || totals.expenses
        ? { icon: totals.balance >= 0 ? 'chart' : 'alert', color: totals.balance >= 0 ? 'mint' : 'red', title: totals.balance >= 0 ? 'O período está positivo' : 'Os gastos superaram os ganhos', text: 'Média de ganhos por dia trabalhado: ' + Core.money(average) + '.' + goalText }
        : { icon: 'plus', color: 'yellow', title: 'Comece pela primeira movimentação', text: 'Registre um ganho ou gasto para acompanhar o resultado do mês.' };
    $('insightCard').innerHTML = '<span class="insight-icon ' + insight.color + '">' + icon(insight.icon) + '</span><div><strong>' + esc(insight.title) + '</strong><span>' + esc(insight.text) + '</span></div>';
    const statuses = state.reminders.filter(item => item.vehicleId === vehicle.id).map(item => ({ item, status: Core.reminderStatus(item, vehicle) })).filter(row => !['unconfigured', 'paused'].includes(row.status.key));
    statuses.sort((a, b) => reminderPriority(a)[0] - reminderPriority(b)[0] || reminderPriority(a)[1] - reminderPriority(b)[1]);
    const next = statuses[0];
    $('nextReminderCard').innerHTML = next
        ? '<span class="mini-icon ' + (next.status.key === 'overdue' ? 'red' : next.status.key === 'upcoming' ? 'yellow' : 'mint') + '">' + icon(next.item.icon) + '</span><span><strong>' + esc(next.item.title) + '</strong><small>' + esc(next.status.detail) + '</small></span>' + icon('arrow', 'chevron')
        : '<span class="mini-icon neutral">' + icon('bell') + '</span><span><strong>Lembretes</strong><small>Nenhum configurado</small></span>' + icon('arrow', 'chevron');
    renderQuickCategories();
}
function updatePressed(selector, value, key) { document.querySelectorAll(selector).forEach(button => { const active = button.dataset[key] === value; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); }
function renderQuickCategories() {
    $('quickCategories').innerHTML = Object.keys(Core.CATEGORIES[quickType]).map(key => '<button class="quick-item" data-quick-category="' + key + '" aria-label="Registrar ' + esc(Core.CATEGORIES[quickType][key]) + '"><span class="' + (COLORS[key] || 'neutral') + '">' + icon(key) + '</span><small>' + esc(Core.CATEGORIES[quickType][key]) + '</small></button>').join('');
    updatePressed('[data-quick-type]', quickType, 'quickType');
}
function renderCharts() {
    const month = $('chartMonth').value || state.preferences.month; const vehicleId = $('chartVehicle').value || state.preferences.activeVehicleId;
    const list = Core.filterTransactions(state.transactions, { month, vehicleId }); const totals = Core.calculateTotals(list); const categories = Core.totalsByCategory(list, chartType);
    const workDays = new Set(list.filter(item => item.type === 'gain').map(item => item.date)).size;
    $('chartExpenses').textContent = Core.money(totals.expenses); $('chartGains').textContent = Core.money(totals.gains); $('chartBalance').textContent = Core.money(totals.balance);
    $('chartLargest').textContent = 'Maior categoria: ' + (Core.totalsByCategory(list, 'expense').find(item => item.value > 0)?.label || '—');
    $('chartAverage').textContent = 'Média de ganhos por dia trabalhado: ' + Core.money(workDays ? totals.gains / workDays : 0);
    $('chartMargin').textContent = 'Operacional (ganhos − combustível): ' + Core.money(totals.operational) + (totals.gains ? ' • margem líquida ' + ((totals.balance / totals.gains) * 100).toFixed(1).replace('.', ',') + '%' : '');
    $('categoryTitle').textContent = chartType === 'expense' ? 'Gastos por categoria' : 'Ganhos por categoria'; updatePressed('[data-chart-type]', chartType, 'chartType');
    const maximum = Math.max(1, ...categories.map(item => item.value)); const total = chartType === 'expense' ? totals.expenses : totals.gains;
    $('categoryChart').innerHTML = categories.map(item => '<div class="category-row"><span class="category-icon ' + (COLORS[item.key] || 'neutral') + '">' + icon(item.key) + '</span><div><strong>' + esc(item.label) + '</strong><small>' + (total ? item.value / total * 100 : 0).toFixed(1).replace('.', ',') + '% do total</small><div class="bar-track"><div class="bar-fill" style="width:' + item.value / maximum * 100 + '%"></div></div></div><strong class="category-value">' + esc(Core.money(item.value)) + '</strong></div>').join('');
}
function renderVehicles() {
    $('vehicleList').innerHTML = state.vehicles.map(vehicle => {
        const active = vehicle.id === state.preferences.activeVehicleId;
        return '<article class="vehicle-card"><div class="vehicle-top"><div class="vehicle-title"><span class="vehicle-icon">' + icon('vehicle') + '</span><div><strong>' + esc(vehicleName(vehicle)) + '</strong><span>' + esc(vehicle.plate || 'Sem placa cadastrada') + '</span></div></div><div class="icon-actions"><button class="mini-action" data-odometer-vehicle="' + esc(vehicle.id) + '" aria-label="Registrar odômetro de ' + esc(vehicleName(vehicle)) + '">' + icon('gauge') + '</button><button class="mini-action" data-edit-vehicle="' + esc(vehicle.id) + '" aria-label="Editar ' + esc(vehicleName(vehicle)) + '">' + icon('edit') + '</button><button class="mini-action danger" data-delete-vehicle="' + esc(vehicle.id) + '" aria-label="Excluir ' + esc(vehicleName(vehicle)) + '">' + icon('trash') + '</button></div></div><div class="vehicle-stats"><div><small>Ano</small><strong>' + vehicle.year + '</strong></div><div><small>Combustível</small><strong>' + esc(vehicle.fuel) + '</strong></div><div><small>Odômetro</small><strong>' + vehicle.odometer.toLocaleString('pt-BR') + ' km</strong></div></div>' + (active ? '<span class="active-badge">Veículo selecionado</span>' : '<button class="active-badge" data-select-vehicle="' + esc(vehicle.id) + '">Selecionar veículo</button>') + '</article>';
    }).join('');
}
function alarmCard(item, status) {
    const custom = item.templateKey === 'custom';
    const actions = status.key === 'unconfigured'
        ? '<button data-edit-reminder="' + esc(item.id) + '">Configurar</button>'
        : '<button class="done" data-done-reminder="' + esc(item.id) + '">' + icon('check') + ' Marcar como feito</button><button data-edit-reminder="' + esc(item.id) + '">Editar</button><button data-pause-reminder="' + esc(item.id) + '">' + (item.paused ? 'Retomar' : 'Pausar') + '</button>';
    const history = item.history.length ? '<details class="reminder-history"><summary>Histórico (' + item.history.length + ')</summary>' + item.history.map(entry => '<small>' + Core.dateBR(entry.date) + ' • ' + Number(entry.odometer || 0).toLocaleString('pt-BR') + ' km</small>').join('') + '</details>' : '';
    return '<article class="alarm-card"><div class="alarm-main"><span class="mini-icon ' + (status.key === 'overdue' ? 'red' : status.key === 'upcoming' ? 'yellow' : status.key === 'ok' ? 'mint' : 'neutral') + '">' + icon(item.icon) + '</span><div><strong>' + esc(item.title) + '</strong><small>' + esc(status.detail) + '</small></div><span class="status-badge ' + status.key + '">' + esc(status.label) + '</span></div>' + (['ok', 'upcoming', 'overdue'].includes(status.key) ? '<div class="alarm-progress" aria-label="Progresso ' + Math.round(status.progress) + '%"><span style="width:' + status.progress + '%"></span></div>' : '') + '<div class="alarm-actions">' + actions + (custom ? '<button class="danger-text" data-delete-reminder="' + esc(item.id) + '">Excluir</button>' : '') + '</div>' + history + '</article>';
}
function renderAlarms() {
    const vehicle = state.vehicles.find(item => item.id === ($('alarmVehicle').value || state.preferences.activeVehicleId)) || activeVehicle();
    const rows = state.reminders.filter(item => item.vehicleId === vehicle.id).map(item => ({ item, status: Core.reminderStatus(item, vehicle) })).sort((a, b) => reminderPriority(a)[0] - reminderPriority(b)[0] || reminderPriority(a)[1] - reminderPriority(b)[1]);
    const definitions = [{ key: 'overdue', title: 'Atrasados' }, { key: 'upcoming', title: 'Próximos' }, { key: 'ok', title: 'Em dia' }, { key: 'paused', title: 'Pausados' }, { key: 'unconfigured', title: 'Sem configuração' }];
    $('alarmGroups').innerHTML = definitions.map(group => { const entries = rows.filter(row => row.status.key === group.key); if (!entries.length && group.key !== 'unconfigured') return ''; const cards = entries.length ? entries.map(row => alarmCard(row.item, row.status)).join('') : '<div class="empty-panel">Todos os lembretes deste veículo estão configurados.</div>'; return '<section class="alarm-group"><header><h2>' + group.title + '</h2><span>' + entries.length + '</span></header><div class="alarm-list">' + cards + '</div></section>'; }).join('');
}
function currentTransactionFilters() { return { month: $('transactionMonth').value, vehicleId: $('transactionVehicle').value, type: $('transactionType').value, query: $('transactionSearch').value }; }
function renderTransactions() {
    const list = Core.filterTransactions(state.transactions, currentTransactionFilters());
    if (!list.length) { $('transactionList').innerHTML = '<div class="empty-panel"><h2>Nenhuma movimentação</h2><p>Use “Nova” para registrar um ganho ou gasto.</p></div>'; return; }
    $('transactionList').innerHTML = list.map(item => { const vehicle = state.vehicles.find(vehicleItem => vehicleItem.id === item.vehicleId); const label = Core.CATEGORIES[item.type][item.category]; return '<article class="transaction-card"><span class="category-icon ' + (COLORS[item.category] || 'neutral') + '">' + icon(item.category) + '</span><div><strong>' + esc(item.description || label) + '</strong><small>' + esc(label) + ' • ' + esc(vehicleName(vehicle)) + ' • ' + Core.dateBR(item.date) + '</small></div><div class="transaction-value"><b class="' + item.type + '">' + (item.type === 'gain' ? '+' : '−') + ' ' + esc(Core.money(item.amount)) + '</b><div class="transaction-menu"><button class="mini-action" data-edit-transaction="' + esc(item.id) + '" aria-label="Editar movimentação">' + icon('edit') + '</button><button class="mini-action danger" data-delete-transaction="' + esc(item.id) + '" aria-label="Excluir movimentação">' + icon('trash') + '</button></div></div></article>'; }).join('');
}
function renderAlarmCount() { const vehicle = activeVehicle(); const count = state.reminders.filter(item => item.vehicleId === vehicle.id).filter(item => ['overdue', 'upcoming'].includes(Core.reminderStatus(item, vehicle).key)).length; $('desktopAlarmCount').textContent = count || ''; $('desktopAlarmCount').dataset.count = String(count); $('alarmDot').classList.toggle('hidden', count === 0); }
function renderGoals() { if (!$('weeklyGoal')) return; $('weeklyGoal').value = state.preferences.weeklyGoal || ''; $('monthlyGoal').value = state.preferences.monthlyGoal || ''; }
function renderAll() { refreshSelectors(); renderHome(); renderCharts(); renderVehicles(); renderAlarms(); renderTransactions(); renderAlarmCount(); renderGoals(); }

function navigate(page, historyMode = 'push') {
    if (!PAGES.has(page)) page = 'home';
    document.querySelectorAll('[data-page]').forEach(section => section.classList.toggle('active', section.dataset.page === page));
    document.querySelectorAll('[data-nav]').forEach(button => { const active = button.dataset.nav === page; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    const hash = '#' + page; if (historyMode === 'push' && location.hash !== hash) history.pushState({ page }, '', hash); else if (historyMode === 'replace') history.replaceState({ page }, '', hash);
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (page === 'charts') renderCharts(); if (page === 'alarms') renderAlarms(); if (page === 'transactions') renderTransactions(); $('pageRoot').focus({ preventScroll: true });
}
function setFormType(type) { $('transactionFormType').value = type; updatePressed('[data-form-type]', type, 'formType'); $('transactionCategory').innerHTML = Object.entries(Core.CATEGORIES[type]).map(([key, label]) => '<option value="' + key + '">' + esc(label) + '</option>').join(''); }
function openTransaction(type = 'expense', category = '', item = null) { $('transactionForm').reset(); $('transactionId').value = item?.id || ''; $('transactionDialogTitle').textContent = item ? 'Editar movimentação' : 'Nova movimentação'; setFormType(item?.type || type); if (item?.category || category) $('transactionCategory').value = item?.category || category; $('transactionAmount').value = item ? item.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''; $('transactionDate').value = item?.date || Core.localISODate(); $('transactionVehicleId').value = item?.vehicleId || state.preferences.activeVehicleId; $('transactionDescription').value = item?.description || ''; $('transactionOdometer').value = item?.odometer || ''; $('transactionDialog').showModal(); }
function openVehicle(item = null) { $('vehicleForm').reset(); $('vehicleDialogTitle').textContent = item ? 'Editar veículo' : 'Adicionar veículo'; $('vehicleId').value = item?.id || ''; $('vehicleType').value = item?.type || 'moto'; $('vehiclePlate').value = item?.plate || ''; $('vehicleBrand').value = item?.brand || ''; $('vehicleModel').value = item?.model || ''; $('vehicleYear').value = item?.year || new Date().getFullYear(); $('vehicleFuel').value = item?.fuel || 'Gasolina'; $('vehicleOdometer').value = item?.odometer || 0; $('vehicleDialog').showModal(); }
function openOdometer(vehicle = activeVehicle()) { $('odometerForm').reset(); $('odometerVehicleId').value = vehicle.id; $('odometerVehicleName').textContent = vehicleName(vehicle); $('odometerCurrent').textContent = vehicle.odometer.toLocaleString('pt-BR') + ' km'; $('odometerValue').value = vehicle.odometer; $('odometerDate').value = Core.localISODate(); $('odometerDialog').showModal(); }
function openReminder(item = null) { const template = Core.REMINDER_TEMPLATES.find(templateItem => templateItem.key === item?.templateKey); const vehicle = state.vehicles.find(value => value.id === (item?.vehicleId || state.preferences.activeVehicleId)) || activeVehicle(); $('reminderForm').reset(); $('reminderDialogTitle').textContent = item ? 'Configurar lembrete' : 'Criar lembrete'; $('reminderId').value = item?.id || ''; $('reminderTitle').value = item?.title || ''; $('reminderVehicleId').value = item?.vehicleId || state.preferences.activeVehicleId; $('reminderByKm').checked = Boolean(item?.byKm); $('reminderKmInterval').value = item?.kmInterval || item?.recommendedKm || template?.kmInterval || 1000; $('reminderLastKm').value = item?.lastKm ?? vehicle.odometer; $('reminderAdvanceKm').value = item?.advanceKm ?? 200; $('reminderByTime').checked = Boolean(item?.byTime); $('reminderDayInterval').value = item?.dayInterval || item?.recommendedDays || template?.dayInterval || 180; $('reminderLastDate').value = item?.lastDate || ''; $('reminderAdvanceDays').value = item?.advanceDays ?? 3; $('reminderDialog').showModal(); }
function confirmAction(title, text, button = 'Confirmar') { $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmAccept').textContent = button; $('confirmDialog').showModal(); return new Promise(resolve => { pendingConfirm = resolve; }); }
function closeConfirm(value) { if ($('confirmDialog').open) $('confirmDialog').close(); if (pendingConfirm) pendingConfirm(value); pendingConfirm = null; }

async function submitTransaction(event) {
    event.preventDefault(); const input = { id: $('transactionId').value || undefined, vehicleId: $('transactionVehicleId').value, type: $('transactionFormType').value, category: $('transactionCategory').value, amount: $('transactionAmount').value, date: $('transactionDate').value, description: $('transactionDescription').value, odometer: $('transactionOdometer').value };
    const item = Core.sanitizeTransaction(input, state.vehicles); if (!item) { toast('Confira data, categoria e valor.', 'error'); return; }
    const currentVehicle = state.vehicles.find(vehicle => vehicle.id === item.vehicleId); if (item.odometer && item.odometer < currentVehicle.odometer && !await confirmAction('Odômetro menor?', 'O valor informado é menor que o odômetro atual. Salvar somente na movimentação, sem reduzir o veículo?', 'Salvar assim')) return;
    const existingIndex = state.transactions.findIndex(value => value.id === item.id); if (existingIndex >= 0) item.createdAt = state.transactions[existingIndex].createdAt;
    commitChange(draft => { const index = draft.transactions.findIndex(value => value.id === item.id); if (index >= 0) draft.transactions[index] = item; else draft.transactions.push(item); const vehicle = draft.vehicles.find(value => value.id === item.vehicleId); if (vehicle && item.odometer > vehicle.odometer) { vehicle.odometer = item.odometer; draft.odometerLogs.unshift({ id: Core.uid('odometer'), vehicleId: vehicle.id, date: item.date, odometer: item.odometer, description: 'Atualizado por movimentação', createdAt: new Date().toISOString() }); } }, existingIndex >= 0 ? 'Movimentação atualizada.' : 'Movimentação salva.', { close: 'transactionDialog' });
}
async function submitVehicle(event) {
    event.preventDefault(); const plate = $('vehiclePlate').value; if (!Core.validPlate(plate)) { toast('Placa inválida. Use ABC1234 ou ABC1D23.', 'error'); return; }
    const input = { id: $('vehicleId').value || undefined, type: $('vehicleType').value, plate, brand: $('vehicleBrand').value, model: $('vehicleModel').value, year: $('vehicleYear').value, fuel: $('vehicleFuel').value, odometer: $('vehicleOdometer').value };
    const vehicle = Core.sanitizeVehicle(input); if (!vehicle) { toast('Informe marca e modelo.', 'error'); return; }
    if (vehicle.plate && state.vehicles.some(item => item.id !== vehicle.id && item.plate === vehicle.plate)) { toast('Essa placa já está cadastrada.', 'error'); return; }
    const old = state.vehicles.find(item => item.id === vehicle.id); if (old && vehicle.odometer < old.odometer && !await confirmAction('Corrigir odômetro?', 'O novo valor é menor que o atual. Isso pode alterar os lembretes por quilometragem.', 'Corrigir')) return;
    commitChange(draft => { const index = draft.vehicles.findIndex(item => item.id === vehicle.id); if (index >= 0) { vehicle.createdAt = draft.vehicles[index].createdAt; draft.vehicles[index] = vehicle; } else { draft.vehicles.push(vehicle); draft.reminders.push(...Core.createReminderSet(vehicle)); draft.preferences.activeVehicleId = vehicle.id; } if (!old || old.odometer !== vehicle.odometer) draft.odometerLogs.unshift({ id: Core.uid('odometer'), vehicleId: vehicle.id, date: Core.localISODate(), odometer: vehicle.odometer, description: old ? 'Correção no cadastro' : 'Odômetro inicial', createdAt: new Date().toISOString() }); }, old ? 'Veículo atualizado.' : 'Veículo adicionado.', { close: 'vehicleDialog' });
}
async function submitOdometer(event) {
    event.preventDefault(); const vehicle = state.vehicles.find(item => item.id === $('odometerVehicleId').value); const value = Core.nonNegative($('odometerValue').value); const date = $('odometerDate').value;
    if (!vehicle || !Core.validDate(date)) { toast('Confira o veículo e a data.', 'error'); return; }
    if (value < vehicle.odometer && !await confirmAction('Registrar correção?', 'O valor é menor que o odômetro atual e pode alterar os lembretes.', 'Corrigir')) return;
    commitChange(draft => { const target = draft.vehicles.find(item => item.id === vehicle.id); target.odometer = value; draft.odometerLogs.unshift({ id: Core.uid('odometer'), vehicleId: target.id, date, odometer: value, description: $('odometerNote').value, createdAt: new Date().toISOString() }); draft.odometerLogs = draft.odometerLogs.slice(0, 500); }, 'Odômetro atualizado.', { close: 'odometerDialog' });
}
function submitReminder(event) {
    event.preventDefault(); if (!$('reminderByKm').checked && !$('reminderByTime').checked) { toast('Ative quilometragem, tempo ou os dois.', 'error'); return; } if ($('reminderByTime').checked && !Core.validDate($('reminderLastDate').value)) { toast('Informe a data da última execução.', 'error'); return; }
    const previous = state.reminders.find(item => item.id === $('reminderId').value);
    const reminder = Core.sanitizeReminder({ id: $('reminderId').value || undefined, vehicleId: $('reminderVehicleId').value, title: $('reminderTitle').value, templateKey: previous?.templateKey || 'custom', icon: previous?.icon || 'bell', enabled: true, paused: false, recommendedKm: previous?.recommendedKm, recommendedDays: previous?.recommendedDays, byKm: $('reminderByKm').checked, kmInterval: $('reminderKmInterval').value, lastKm: $('reminderLastKm').value, advanceKm: $('reminderAdvanceKm').value, byTime: $('reminderByTime').checked, dayInterval: $('reminderDayInterval').value, lastDate: $('reminderLastDate').value, advanceDays: $('reminderAdvanceDays').value, history: previous?.history || [] }, state.vehicles);
    if (!reminder) { toast('Confira os dados do lembrete.', 'error'); return; }
    commitChange(draft => { const index = draft.reminders.findIndex(item => item.id === reminder.id); if (index >= 0) draft.reminders[index] = reminder; else draft.reminders.push(reminder); }, 'Lembrete salvo.', { close: 'reminderDialog' });
}

async function deleteTransaction(id) { if (!await confirmAction('Excluir movimentação?', 'O valor será removido das análises.', 'Excluir')) return; commitChange(draft => { draft.transactions = draft.transactions.filter(item => item.id !== id); }, 'Movimentação excluída.'); }
async function deleteVehicle(id) { if (state.vehicles.length === 1) { toast('Cadastre outro veículo antes de excluir este.', 'error'); return; } const vehicle = state.vehicles.find(item => item.id === id); if (!vehicle || !await confirmAction('Excluir veículo?', 'Também serão apagadas movimentações, leituras e lembretes de ' + vehicleName(vehicle) + '.', 'Excluir tudo')) return; commitChange(draft => { draft.vehicles = draft.vehicles.filter(item => item.id !== id); draft.transactions = draft.transactions.filter(item => item.vehicleId !== id); draft.reminders = draft.reminders.filter(item => item.vehicleId !== id); draft.odometerLogs = draft.odometerLogs.filter(item => item.vehicleId !== id); if (draft.preferences.activeVehicleId === id) draft.preferences.activeVehicleId = draft.vehicles[0].id; }, 'Veículo excluído.'); }
async function deleteReminder(id) { if (!await confirmAction('Excluir lembrete?', 'O histórico desse lembrete personalizado também será apagado.', 'Excluir')) return; commitChange(draft => { draft.reminders = draft.reminders.filter(item => item.id !== id); }, 'Lembrete excluído.'); }
function markReminderDone(id) { commitChange(draft => { const reminder = draft.reminders.find(item => item.id === id); const vehicle = draft.vehicles.find(item => item.id === reminder?.vehicleId); if (!reminder || !vehicle) throw new Error('Lembrete não encontrado'); reminder.history.unshift({ id: Core.uid('history'), vehicleId: vehicle.id, date: Core.localISODate(), odometer: vehicle.odometer, description: 'Serviço concluído', createdAt: new Date().toISOString() }); reminder.history = reminder.history.slice(0, 30); if (reminder.byKm) reminder.lastKm = vehicle.odometer; if (reminder.byTime) reminder.lastDate = Core.localISODate(); }, 'Manutenção marcada como feita.'); }
function toggleReminder(id) { const item = state.reminders.find(value => value.id === id); if (!item) return; commitChange(draft => { const reminder = draft.reminders.find(value => value.id === id); reminder.paused = !reminder.paused; }, item.paused ? 'Lembrete retomado.' : 'Lembrete pausado.'); }
function saveGoals(event) { event.preventDefault(); commitChange(draft => { draft.preferences.weeklyGoal = Core.nonNegative($('weeklyGoal').value); draft.preferences.monthlyGoal = Core.nonNegative($('monthlyGoal').value); }, 'Metas salvas.'); }

function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function backup() { const data = { ...state, exportedAt: new Date().toISOString(), app: 'MotoFinance PRO' }; download('motofinance-backup-' + Core.localISODate() + '.json', JSON.stringify(data, null, 2), 'application/json'); toast('Backup baixado. Guarde o arquivo em local seguro.'); }
function csvSafe(value) { const text = String(value ?? ''); return /^[=+\-@]/.test(text) ? "'" + text : text; }
function exportCSV(scope = 'all') {
    const list = scope === 'filtered' ? Core.filterTransactions(state.transactions, { month: $('chartMonth').value, vehicleId: $('chartVehicle').value }) : state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date));
    const rows = [['Data', 'Tipo', 'Categoria', 'Valor', 'Veículo', 'Descrição', 'Odômetro']];
    list.forEach(item => { const vehicle = state.vehicles.find(value => value.id === item.vehicleId); rows.push([item.date, item.type === 'gain' ? 'Ganho' : 'Gasto', Core.CATEGORIES[item.type][item.category], item.amount.toFixed(2).replace('.', ','), vehicleName(vehicle), csvSafe(item.description), item.odometer || '']); });
    const csv = '\ufeff' + rows.map(row => row.map(value => '"' + csvSafe(value).replace(/"/g, '""') + '"').join(';')).join('\n');
    download('motofinance-' + (scope === 'filtered' ? 'periodo-' : 'todas-') + Core.localISODate() + '.csv', csv, 'text/csv;charset=utf-8'); toast((scope === 'filtered' ? 'Período selecionado' : 'Todas as movimentações') + ' exportado em CSV.');
}
async function restore(file) {
    try {
        if (file.size > MAX_BACKUP_BYTES) throw new Error('Arquivo maior que 5 MB.');
        const parsed = JSON.parse(await file.text()); if (![1, 2].includes(Number(parsed.version))) throw new Error('Versão de backup não compatível.');
        const result = normalizeState(parsed, true); if (!result.state) throw new Error(result.errors.join(' '));
        const summary = result.state.vehicles.length + ' veículo(s), ' + result.state.transactions.length + ' movimentação(ões), ' + result.state.reminders.length + ' lembrete(s) e ' + result.state.odometerLogs.length + ' leitura(s) de odômetro.';
        if (!await confirmAction('Restaurar backup?', summary + ' Os dados atuais deste aparelho serão substituídos.', 'Restaurar')) return;
        if (!persist(result.state)) return; state = result.state; filterState.transactionMonth = state.preferences.month; filterState.chartMonth = state.preferences.month; filterState.chartVehicle = state.preferences.activeVehicleId; filterState.alarmVehicle = state.preferences.activeVehicleId; renderAll(); navigate('home'); toast('Backup restaurado com sucesso.');
    } catch (error) { console.error(error); toast('Backup recusado: ' + (error.message || 'arquivo inválido'), 'error'); }
    finally { $('restoreInput').value = ''; }
}
async function clearData() { if (!await confirmAction('Apagar todos os dados?', 'Veículos, movimentações, leituras e lembretes deste aparelho serão removidos.', 'Apagar dados')) return; const clean = Core.createInitialState(); clean.migratedFromV6 = true; if (!persist(clean)) return; state = clean; renderAll(); navigate('home'); toast('Dados apagados.'); }
function downloadRecovery() { const read = safeRead(RECOVERY_KEY); if (!read.value) { toast('Não há cópia de recuperação disponível.', 'error'); return; } download('motofinance-recuperacao-' + Core.localISODate() + '.json.txt', read.value, 'text/plain'); toast('Cópia original baixada.'); }

document.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]'); if (nav) { event.preventDefault(); navigate(nav.dataset.nav); return; }
    const actionNode = event.target.closest('[data-action]'); const action = actionNode?.dataset.action;
    if (action === 'quick-add') openTransaction(quickType); if (action === 'add-vehicle') openVehicle(); if (action === 'add-reminder') openReminder(); if (action === 'update-odometer') openOdometer(); if (action === 'backup') backup(); if (action === 'export-csv') exportCSV(actionNode.dataset.scope || 'all'); if (action === 'clear-data') clearData(); if (action === 'download-recovery') downloadRecovery();
    const close = event.target.closest('[data-close]'); if (close) $(close.dataset.close).close();
    const quickButton = event.target.closest('[data-quick-type]'); if (quickButton) { quickType = quickButton.dataset.quickType; renderQuickCategories(); }
    const category = event.target.closest('[data-quick-category]'); if (category) openTransaction(quickType, category.dataset.quickCategory);
    const chartButton = event.target.closest('[data-chart-type]'); if (chartButton) { chartType = chartButton.dataset.chartType; renderCharts(); }
    const formType = event.target.closest('[data-form-type]'); if (formType) setFormType(formType.dataset.formType);
    const editTransaction = event.target.closest('[data-edit-transaction]'); if (editTransaction) openTransaction('expense', '', state.transactions.find(item => item.id === editTransaction.dataset.editTransaction));
    const deleteTransactionButton = event.target.closest('[data-delete-transaction]'); if (deleteTransactionButton) deleteTransaction(deleteTransactionButton.dataset.deleteTransaction);
    const editVehicle = event.target.closest('[data-edit-vehicle]'); if (editVehicle) openVehicle(state.vehicles.find(item => item.id === editVehicle.dataset.editVehicle));
    const odometerVehicle = event.target.closest('[data-odometer-vehicle]'); if (odometerVehicle) openOdometer(state.vehicles.find(item => item.id === odometerVehicle.dataset.odometerVehicle));
    const deleteVehicleButton = event.target.closest('[data-delete-vehicle]'); if (deleteVehicleButton) deleteVehicle(deleteVehicleButton.dataset.deleteVehicle);
    const selectVehicle = event.target.closest('[data-select-vehicle]'); if (selectVehicle) commitChange(draft => { draft.preferences.activeVehicleId = selectVehicle.dataset.selectVehicle; }, 'Veículo selecionado.');
    const editReminder = event.target.closest('[data-edit-reminder]'); if (editReminder) openReminder(state.reminders.find(item => item.id === editReminder.dataset.editReminder));
    const doneReminder = event.target.closest('[data-done-reminder]'); if (doneReminder) markReminderDone(doneReminder.dataset.doneReminder);
    const pauseReminder = event.target.closest('[data-pause-reminder]'); if (pauseReminder) toggleReminder(pauseReminder.dataset.pauseReminder);
    const removeReminder = event.target.closest('[data-delete-reminder]'); if (removeReminder) deleteReminder(removeReminder.dataset.deleteReminder);
});

$('transactionForm').addEventListener('submit', submitTransaction); $('vehicleForm').addEventListener('submit', submitVehicle); $('odometerForm').addEventListener('submit', submitOdometer); $('reminderForm').addEventListener('submit', submitReminder); $('goalsForm').addEventListener('submit', saveGoals);
$('confirmCancel').addEventListener('click', () => closeConfirm(false)); $('confirmAccept').addEventListener('click', () => closeConfirm(true)); $('confirmDialog').addEventListener('cancel', event => { event.preventDefault(); closeConfirm(false); });
$('restoreInput').addEventListener('change', event => { if (event.target.files[0]) restore(event.target.files[0]); });
$('homeMonth').addEventListener('change', event => { const value = event.target.value; if (!Core.validMonth(value)) return; commitChange(draft => { draft.preferences.month = value; }, null, { showError: true }); });
$('homeVehicle').addEventListener('change', event => commitChange(draft => { draft.preferences.activeVehicleId = event.target.value; }, null));
$('alarmVehicle').addEventListener('change', event => { filterState.alarmVehicle = event.target.value; renderAlarms(); });
$('chartMonth').addEventListener('change', event => { filterState.chartMonth = event.target.value; renderCharts(); }); $('chartVehicle').addEventListener('change', event => { filterState.chartVehicle = event.target.value; renderCharts(); });
['transactionMonth', 'transactionVehicle', 'transactionType'].forEach(id => $(id).addEventListener('change', event => { filterState[id] = event.target.value; renderTransactions(); }));
$('transactionSearch').addEventListener('input', event => { filterState.transactionSearch = event.target.value; renderTransactions(); });
document.querySelectorAll('.app-dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog && dialog.id !== 'confirmDialog') dialog.close(); }));
document.querySelectorAll('[data-close]').forEach(button => { if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'Fechar janela'); });
$('reminderDialog').querySelector('button[type="submit"]').textContent = 'Salvar lembrete';
window.addEventListener('popstate', () => navigate(location.hash.slice(1), 'none'));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.warn));

renderAll(); navigate(location.hash.slice(1) || 'home', 'replace');
if (startupNotice) {
    toast(startupNotice.text, startupNotice.type === 'recovery' || startupNotice.type === 'error' ? 'error' : 'warning');
    if (startupNotice.type === 'recovery') { const button = document.createElement('button'); button.className = 'recovery-banner'; button.dataset.action = 'download-recovery'; button.textContent = 'Baixar cópia dos dados corrompidos'; $('morePageIntro').after(button); }
}
if (state.migrationSummary) { const sum = state.migrationSummary; toast('Importação concluída: ' + sum.transactions + ' movimentações, ' + sum.distances + ' registros de km e ' + sum.goals + ' metas.'); commitChange(draft => { draft.migrationSummary = null; }, null, { showError: false }); }
