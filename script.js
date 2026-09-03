'use strict';

const Core = window.MotoFinanceCore;
const STORAGE_KEY = 'motofinance_pro_v1';
const LEGACY_RECORDS_KEY = 'motofinance_v6_records';
const PAGES = new Set(['home', 'charts', 'vehicles', 'alarms', 'transactions', 'more']);

const ICONS = {
    corrida: 'vehicle', entrega: 'wallet', frete: 'tag', diaria: 'calendar', gorjeta: 'plus', outro_ganho: 'more',
    combustivel: 'fuel', manutencao: 'tools', pedagio: 'arrow', estacionamento: 'tag', seguro: 'shield',
    multa: 'bell', impostos: 'receipt', documento: 'receipt', outro_gasto: 'more',
    drop: 'fuel', tools: 'tools', gauge: 'gauge', adjust: 'tools', battery: 'bell', alert: 'bell', filter: 'tag',
    circle: 'gauge', document: 'receipt', shield: 'shield', receipt: 'receipt', bell: 'bell'
};

const COLORS = {
    corrida: 'blue', entrega: 'mint', frete: 'violet', diaria: 'yellow', gorjeta: 'orange', outro_ganho: 'neutral',
    combustivel: 'blue', manutencao: 'orange', pedagio: 'yellow', estacionamento: 'neutral', seguro: 'mint',
    multa: 'red', impostos: 'mint', documento: 'violet', outro_gasto: 'neutral'
};

let state = loadState();
let quickType = 'expense';
let chartType = 'expense';
let pendingConfirm = null;

function $(id) { return document.getElementById(id); }
function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function icon(name, className = '') { return '<svg class="' + esc(className) + '"><use href="#i-' + esc(ICONS[name] || name || 'more') + '"></use></svg>'; }
function vehicleName(vehicle) { return vehicle ? vehicle.brand + ' ' + vehicle.model : 'Veículo'; }
function activeVehicle() { return state.vehicles.find(item => item.id === state.preferences.activeVehicleId) || state.vehicles[0]; }

function safeRead(key) {
    try { return localStorage.getItem(key); } catch (error) { console.warn(error); return null; }
}

function saveState(showError = true) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
    } catch (error) {
        console.error(error);
        if (showError) toast('Não foi possível salvar neste navegador.', 'error');
        return false;
    }
}

function normalizeState(raw) {
    const base = Core.createInitialState();
    if (!raw || typeof raw !== 'object') return base;
    const vehicles = (Array.isArray(raw.vehicles) ? raw.vehicles : []).map(Core.sanitizeVehicle).filter(Boolean);
    if (!vehicles.length) return base;
    const transactions = (Array.isArray(raw.transactions) ? raw.transactions : []).map(item => Core.sanitizeTransaction(item, vehicles)).filter(Boolean);
    const reminders = (Array.isArray(raw.reminders) ? raw.reminders : []).map(item => Core.sanitizeReminder(item, vehicles)).filter(Boolean);
    return {
        version: 1,
        profile: { name: String(raw.profile?.name || 'Moisés').slice(0, 40) },
        vehicles,
        transactions,
        reminders,
        preferences: {
            activeVehicleId: vehicles.some(item => item.id === raw.preferences?.activeVehicleId) ? raw.preferences.activeVehicleId : vehicles[0].id,
            month: /^\d{4}-\d{2}$/.test(raw.preferences?.month || '') ? raw.preferences.month : Core.currentMonth(),
            theme: 'light'
        },
        migratedFromV6: Boolean(raw.migratedFromV6)
    };
}

function migrateLegacy(current) {
    if (current.migratedFromV6) return current;
    current.migratedFromV6 = true;
    const legacyText = safeRead(LEGACY_RECORDS_KEY);
    if (!legacyText) return current;
    try {
        const legacy = JSON.parse(legacyText);
        if (!Array.isArray(legacy)) return current;
        const vehicleId = current.vehicles[0].id;
        legacy.forEach(record => {
            let type = null;
            let category = null;
            if (record.type === 'RECEITA') {
                type = 'gain';
                category = record.source === '99' ? 'corrida' : record.source === 'IFOOD' ? 'entrega' : 'frete';
            } else if (record.type === 'COMBUSTIVEL') {
                type = 'expense'; category = 'combustivel';
            } else if (record.type === 'MANUTENCAO') {
                type = 'expense'; category = 'manutencao';
            }
            if (!type) return;
            const item = Core.sanitizeTransaction({
                id: 'legacy-' + record.id,
                vehicleId, type, category, amount: record.amount, date: record.date,
                description: record.description || 'Importado da versão anterior', createdAt: record.createdAt
            }, current.vehicles);
            if (item && !current.transactions.some(existing => existing.id === item.id)) current.transactions.push(item);
        });
    } catch (error) { console.warn('Dados antigos não puderam ser importados.', error); }
    return current;
}

function loadState() {
    let parsed = null;
    try { parsed = JSON.parse(safeRead(STORAGE_KEY) || 'null'); } catch (error) { console.warn(error); }
    const result = migrateLegacy(normalizeState(parsed));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch (error) { console.warn(error); }
    return result;
}

function toast(message, type = 'success') {
    const item = document.createElement('div');
    item.className = 'toast ' + type;
    item.textContent = message;
    $('toastRegion').appendChild(item);
    setTimeout(() => item.remove(), 3200);
}

function monthValues(includeAll = false) {
    const values = new Set([Core.currentMonth(), state.preferences.month]);
    const cursor = new Date();
    for (let index = 0; index < 12; index += 1) {
        values.add(cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0'));
        cursor.setMonth(cursor.getMonth() - 1);
    }
    state.transactions.forEach(item => values.add(item.date.slice(0, 7)));
    const options = [...values].filter(Boolean).sort().reverse().map(value => '<option value="' + value + '">' + esc(Core.monthLabel(value)) + '</option>').join('');
    return (includeAll ? '<option value="">Todos os períodos</option>' : '') + options;
}

function vehicleOptions(includeAll = false) {
    return (includeAll ? '<option value="all">Todos os veículos</option>' : '') + state.vehicles.map(vehicle => '<option value="' + esc(vehicle.id) + '">' + esc(vehicleName(vehicle)) + '</option>').join('');
}

function refreshSelectors() {
    ['homeMonth', 'chartMonth'].forEach(id => { $(id).innerHTML = monthValues(); $(id).value = state.preferences.month; });
    $('transactionMonth').innerHTML = monthValues(true);
    $('transactionMonth').value = state.preferences.month;
    ['homeVehicle', 'alarmVehicle', 'transactionVehicleId', 'reminderVehicleId'].forEach(id => { $(id).innerHTML = vehicleOptions(); $(id).value = state.preferences.activeVehicleId; });
    ['chartVehicle', 'transactionVehicle'].forEach(id => { $(id).innerHTML = vehicleOptions(true); $(id).value = id === 'chartVehicle' ? state.preferences.activeVehicleId : 'all'; });
}

function selectedTransactions(month = state.preferences.month, vehicleId = state.preferences.activeVehicleId) {
    return Core.filterTransactions(state.transactions, { month, vehicleId });
}

function renderHome() {
    const vehicle = activeVehicle();
    const list = selectedTransactions();
    const totals = Core.calculateTotals(list);
    $('welcomeName').textContent = state.profile.name;
    $('profileName').textContent = state.profile.name;
    $('homeBalance').textContent = Core.money(totals.balance);
    $('homeBalance').style.color = totals.balance < 0 ? '#ff747c' : 'white';
    $('homeGains').textContent = Core.money(totals.gains);
    $('homeExpenses').textContent = Core.money(totals.expenses);
    $('homeBalanceLabel').textContent = vehicleName(vehicle) + ' • ' + Core.monthLabel(state.preferences.month);
    $('balanceSignal').textContent = totals.balance > 0 ? '+' : totals.balance < 0 ? '−' : '—';
    $('transactionCountText').textContent = list.length ? list.length + (list.length === 1 ? ' lançamento' : ' lançamentos') : 'Nenhum lançamento';

    const daily = new Set(list.filter(item => item.type === 'gain').map(item => item.date)).size;
    const average = daily ? totals.gains / daily : 0;
    const insight = totals.gains || totals.expenses
        ? { icon: totals.balance >= 0 ? 'chart' : 'bell', color: totals.balance >= 0 ? 'mint' : 'red', title: totals.balance >= 0 ? 'O período está positivo' : 'Os gastos superaram os ganhos', text: 'Média de ganhos: ' + Core.money(average) + ' por dia trabalhado.' }
        : { icon: 'plus', color: 'yellow', title: 'Comece pelo primeiro lançamento', text: 'Registre um ganho ou gasto para acompanhar o resultado do mês.' };
    $('insightCard').innerHTML = '<span class="insight-icon ' + insight.color + '">' + icon(insight.icon) + '</span><div><strong>' + esc(insight.title) + '</strong><span>' + esc(insight.text) + '</span></div>';

    const statuses = state.reminders.filter(item => item.vehicleId === vehicle.id).map(item => ({ item, status: Core.reminderStatus(item, vehicle) })).filter(row => row.status.key !== 'unconfigured');
    const order = { overdue: 0, upcoming: 1, ok: 2 };
    statuses.sort((a, b) => order[a.status.key] - order[b.status.key]);
    const next = statuses[0];
    $('nextReminderCard').innerHTML = next
        ? '<span class="mini-icon ' + (next.status.key === 'overdue' ? 'red' : next.status.key === 'upcoming' ? 'yellow' : 'mint') + '">' + icon(next.item.icon) + '</span><span><strong>' + esc(next.item.title) + '</strong><small>' + esc(next.status.detail) + '</small></span>' + icon('arrow', 'chevron')
        : '<span class="mini-icon neutral">' + icon('bell') + '</span><span><strong>Alarmes</strong><small>Nenhum configurado</small></span>' + icon('arrow', 'chevron');
    renderQuickCategories();
}

function renderQuickCategories() {
    const keys = Object.keys(Core.CATEGORIES[quickType]);
    $('quickCategories').innerHTML = keys.map(key => '<button class="quick-item" data-quick-category="' + key + '"><span class="' + (COLORS[key] || 'neutral') + '">' + icon(key) + '</span><small>' + esc(Core.CATEGORIES[quickType][key]) + '</small></button>').join('');
    document.querySelectorAll('[data-quick-type]').forEach(button => button.classList.toggle('active', button.dataset.quickType === quickType));
}

function renderCharts() {
    const month = $('chartMonth').value || state.preferences.month;
    const vehicleId = $('chartVehicle').value || state.preferences.activeVehicleId;
    const list = Core.filterTransactions(state.transactions, { month, vehicleId });
    const totals = Core.calculateTotals(list);
    const categories = Core.totalsByCategory(list, chartType);
    const largest = categories.find(item => item.value > 0);
    const workDays = new Set(list.filter(item => item.type === 'gain').map(item => item.date)).size;
    $('chartExpenses').textContent = Core.money(totals.expenses);
    $('chartGains').textContent = Core.money(totals.gains);
    $('chartBalance').textContent = Core.money(totals.balance);
    $('chartLargest').textContent = 'Maior categoria: ' + (Core.totalsByCategory(list, 'expense').find(item => item.value > 0)?.label || '—');
    $('chartAverage').textContent = 'Média por dia: ' + Core.money(workDays ? totals.gains / workDays : 0);
    $('chartMargin').textContent = totals.gains ? 'Margem: ' + ((totals.balance / totals.gains) * 100).toFixed(1).replace('.', ',') + '%' : 'Sem margem';
    $('categoryTitle').textContent = chartType === 'expense' ? 'Gastos por categoria' : 'Ganhos por categoria';
    document.querySelectorAll('[data-chart-type]').forEach(button => button.classList.toggle('active', button.dataset.chartType === chartType));
    const maximum = Math.max(1, ...categories.map(item => item.value));
    $('categoryChart').innerHTML = categories.map(item => {
        const percentage = totals[chartType === 'expense' ? 'expenses' : 'gains'] ? item.value / totals[chartType === 'expense' ? 'expenses' : 'gains'] * 100 : 0;
        return '<div class="category-row"><span class="category-icon ' + (COLORS[item.key] || 'neutral') + '">' + icon(item.key) + '</span><div><strong>' + esc(item.label) + '</strong><small>' + percentage.toFixed(1).replace('.', ',') + '% do total</small><div class="bar-track"><div class="bar-fill" style="width:' + (item.value / maximum * 100) + '%"></div></div></div><strong class="category-value">' + esc(Core.money(item.value)) + '</strong></div>';
    }).join('');
}

function renderVehicles() {
    $('vehicleList').innerHTML = state.vehicles.map(vehicle => {
        const count = state.transactions.filter(item => item.vehicleId === vehicle.id).length;
        const active = vehicle.id === state.preferences.activeVehicleId;
        return '<article class="vehicle-card"><div class="vehicle-top"><div class="vehicle-title"><span class="vehicle-icon">' + icon('vehicle') + '</span><div><strong>' + esc(vehicleName(vehicle)) + '</strong><span>' + esc(vehicle.plate || 'Sem placa cadastrada') + '</span></div></div><div class="icon-actions"><button class="mini-action" data-edit-vehicle="' + esc(vehicle.id) + '" aria-label="Editar">' + icon('edit') + '</button><button class="mini-action danger" data-delete-vehicle="' + esc(vehicle.id) + '" aria-label="Excluir">' + icon('trash') + '</button></div></div><div class="vehicle-stats"><div><small>Ano</small><strong>' + vehicle.year + '</strong></div><div><small>Combustível</small><strong>' + esc(vehicle.fuel) + '</strong></div><div><small>Odômetro</small><strong>' + vehicle.odometer.toLocaleString('pt-BR') + ' km</strong></div></div>' + (active ? '<span class="active-badge">Veículo selecionado</span>' : '<button class="active-badge" data-select-vehicle="' + esc(vehicle.id) + '">Selecionar veículo</button>') + '</article>';
    }).join('');
}

function renderAlarms() {
    const vehicleId = $('alarmVehicle').value || state.preferences.activeVehicleId;
    const vehicle = state.vehicles.find(item => item.id === vehicleId) || activeVehicle();
    const rows = state.reminders.filter(item => item.vehicleId === vehicle.id).map(item => ({ item, status: Core.reminderStatus(item, vehicle) }));
    const definitions = [
        { key: 'overdue', title: 'Atrasados' }, { key: 'upcoming', title: 'Próximos' }, { key: 'ok', title: 'Em dia' }, { key: 'unconfigured', title: 'Sem configuração' }
    ];
    $('alarmGroups').innerHTML = definitions.map(group => {
        const entries = rows.filter(row => row.status.key === group.key);
        if (!entries.length && group.key !== 'unconfigured') return '';
        const cards = entries.length ? entries.map(row => alarmCard(row.item, row.status)).join('') : '<div class="empty-panel">Todos os lembretes deste veículo estão configurados.</div>';
        return '<section class="alarm-group"><header><h2>' + group.title + '</h2><span>' + entries.length + '</span></header><div class="alarm-list">' + cards + '</div></section>';
    }).join('');
}

function alarmCard(item, status) {
    const badge = '<span class="status-badge ' + status.key + '">' + esc(status.label) + '</span>';
    const actions = status.key === 'unconfigured'
        ? '<button data-edit-reminder="' + esc(item.id) + '">Configurar</button>'
        : '<button class="done" data-done-reminder="' + esc(item.id) + '">' + icon('check') + ' Marcar como feito</button><button data-edit-reminder="' + esc(item.id) + '">Editar</button>';
    return '<article class="alarm-card"><div class="alarm-main"><span class="mini-icon ' + (status.key === 'overdue' ? 'red' : status.key === 'upcoming' ? 'yellow' : status.key === 'ok' ? 'mint' : 'neutral') + '">' + icon(item.icon) + '</span><div><strong>' + esc(item.title) + '</strong><small>' + esc(status.detail) + '</small></div>' + badge + '</div><div class="alarm-progress"><span></span></div><div class="alarm-actions">' + actions + '</div></article>';
}

function renderTransactions() {
    const list = Core.filterTransactions(state.transactions, {
        month: $('transactionMonth').value,
        vehicleId: $('transactionVehicle').value,
        type: $('transactionType').value,
        query: $('transactionSearch').value
    });
    if (!list.length) {
        $('transactionList').innerHTML = '<div class="empty-panel"><h2>Nenhuma movimentação</h2><p>Use “Nova” para registrar um ganho ou gasto.</p></div>';
        return;
    }
    $('transactionList').innerHTML = list.map(item => {
        const vehicle = state.vehicles.find(vehicleItem => vehicleItem.id === item.vehicleId);
        const label = Core.CATEGORIES[item.type][item.category];
        return '<article class="transaction-card"><span class="category-icon ' + (COLORS[item.category] || 'neutral') + '">' + icon(item.category) + '</span><div><strong>' + esc(item.description || label) + '</strong><small>' + esc(label) + ' • ' + esc(vehicleName(vehicle)) + ' • ' + Core.dateBR(item.date) + '</small></div><div class="transaction-value"><b class="' + item.type + '">' + (item.type === 'gain' ? '+' : '−') + ' ' + esc(Core.money(item.amount)) + '</b><div class="transaction-menu"><button class="mini-action" data-edit-transaction="' + esc(item.id) + '">' + icon('edit') + '</button><button class="mini-action danger" data-delete-transaction="' + esc(item.id) + '">' + icon('trash') + '</button></div></div></article>';
    }).join('');
}

function renderAlarmCount() {
    const vehicle = activeVehicle();
    const count = state.reminders.filter(item => item.vehicleId === vehicle.id).filter(item => ['overdue', 'upcoming'].includes(Core.reminderStatus(item, vehicle).key)).length;
    $('desktopAlarmCount').textContent = count || '';
    $('desktopAlarmCount').dataset.count = String(count);
    $('alarmDot').classList.toggle('hidden', count === 0);
}

function renderAll() {
    refreshSelectors();
    renderHome();
    renderCharts();
    renderVehicles();
    renderAlarms();
    renderTransactions();
    renderAlarmCount();
}

function navigate(page) {
    if (!PAGES.has(page)) page = 'home';
    document.querySelectorAll('[data-page]').forEach(section => section.classList.toggle('active', section.dataset.page === page));
    document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === page));
    history.replaceState(null, '', '#' + page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'charts') renderCharts();
    if (page === 'alarms') renderAlarms();
    if (page === 'transactions') renderTransactions();
    $('pageRoot').focus({ preventScroll: true });
}

function setFormType(type) {
    $('transactionFormType').value = type;
    document.querySelectorAll('[data-form-type]').forEach(button => button.classList.toggle('active', button.dataset.formType === type));
    $('transactionCategory').innerHTML = Object.entries(Core.CATEGORIES[type]).map(([key, label]) => '<option value="' + key + '">' + esc(label) + '</option>').join('');
}

function openTransaction(type = 'expense', category = '', item = null) {
    $('transactionForm').reset();
    $('transactionId').value = item?.id || '';
    $('transactionDialogTitle').textContent = item ? 'Editar lançamento' : 'Novo lançamento';
    setFormType(item?.type || type);
    if (item?.category || category) $('transactionCategory').value = item?.category || category;
    $('transactionAmount').value = item ? String(item.amount).replace('.', ',') : '';
    $('transactionDate').value = item?.date || Core.localISODate();
    $('transactionVehicleId').value = item?.vehicleId || state.preferences.activeVehicleId;
    $('transactionDescription').value = item?.description || '';
    $('transactionOdometer').value = item?.odometer || '';
    $('transactionDialog').showModal();
}

function openVehicle(item = null) {
    $('vehicleForm').reset();
    $('vehicleDialogTitle').textContent = item ? 'Editar veículo' : 'Adicionar veículo';
    $('vehicleId').value = item?.id || '';
    $('vehicleType').value = item?.type || 'moto';
    $('vehiclePlate').value = item?.plate || '';
    $('vehicleBrand').value = item?.brand || '';
    $('vehicleModel').value = item?.model || '';
    $('vehicleYear').value = item?.year || new Date().getFullYear();
    $('vehicleFuel').value = item?.fuel || 'Gasolina';
    $('vehicleOdometer').value = item?.odometer || 0;
    $('vehicleDialog').showModal();
}

function openReminder(item = null) {
    $('reminderForm').reset();
    $('reminderDialogTitle').textContent = item ? 'Configurar alarme' : 'Criar alarme';
    $('reminderId').value = item?.id || '';
    $('reminderTitle').value = item?.title || '';
    $('reminderVehicleId').value = item?.vehicleId || state.preferences.activeVehicleId;
    $('reminderByKm').checked = Boolean(item?.byKm);
    $('reminderKmInterval').value = item?.kmInterval || 1000;
    $('reminderLastKm').value = item?.lastKm ?? activeVehicle().odometer;
    $('reminderAdvanceKm').value = item?.advanceKm ?? 200;
    $('reminderByTime').checked = Boolean(item?.byTime);
    $('reminderDayInterval').value = item?.dayInterval || 180;
    $('reminderLastDate').value = item?.lastDate || Core.localISODate();
    $('reminderAdvanceDays').value = item?.advanceDays ?? 3;
    $('reminderDialog').showModal();
}

function confirmAction(title, text, button = 'Confirmar') {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmAccept').textContent = button;
    $('confirmDialog').showModal();
    return new Promise(resolve => { pendingConfirm = resolve; });
}

function closeConfirm(value) {
    if ($('confirmDialog').open) $('confirmDialog').close();
    if (pendingConfirm) pendingConfirm(value);
    pendingConfirm = null;
}

function submitTransaction(event) {
    event.preventDefault();
    const input = {
        id: $('transactionId').value || undefined,
        vehicleId: $('transactionVehicleId').value,
        type: $('transactionFormType').value,
        category: $('transactionCategory').value,
        amount: $('transactionAmount').value,
        date: $('transactionDate').value,
        description: $('transactionDescription').value,
        odometer: $('transactionOdometer').value
    };
    const item = Core.sanitizeTransaction(input, state.vehicles);
    if (!item) { toast('Confira os campos obrigatórios.', 'error'); return; }
    const index = state.transactions.findIndex(existing => existing.id === item.id);
    if (index >= 0) item.createdAt = state.transactions[index].createdAt;
    if (index >= 0) state.transactions[index] = item; else state.transactions.push(item);
    const vehicle = state.vehicles.find(vehicleItem => vehicleItem.id === item.vehicleId);
    if (vehicle && item.odometer > vehicle.odometer) vehicle.odometer = item.odometer;
    saveState();
    $('transactionDialog').close();
    renderAll();
    toast(index >= 0 ? 'Lançamento atualizado.' : 'Lançamento salvo.');
}

function submitVehicle(event) {
    event.preventDefault();
    const input = {
        id: $('vehicleId').value || undefined, type: $('vehicleType').value, plate: $('vehiclePlate').value,
        brand: $('vehicleBrand').value, model: $('vehicleModel').value, year: $('vehicleYear').value,
        fuel: $('vehicleFuel').value, odometer: $('vehicleOdometer').value
    };
    const vehicle = Core.sanitizeVehicle(input);
    if (!vehicle) { toast('Informe marca e modelo.', 'error'); return; }
    const index = state.vehicles.findIndex(item => item.id === vehicle.id);
    if (index >= 0) vehicle.createdAt = state.vehicles[index].createdAt;
    if (index >= 0) state.vehicles[index] = vehicle;
    else {
        state.vehicles.push(vehicle);
        state.reminders.push(...Core.REMINDER_TEMPLATES.map(template => Core.sanitizeReminder({ ...template, id: Core.uid('reminder'), vehicleId: vehicle.id, enabled: false, byKm: false, byTime: false }, state.vehicles)));
        state.preferences.activeVehicleId = vehicle.id;
    }
    saveState();
    $('vehicleDialog').close();
    renderAll();
    toast(index >= 0 ? 'Veículo atualizado.' : 'Veículo adicionado.');
}

function submitReminder(event) {
    event.preventDefault();
    if (!$('reminderByKm').checked && !$('reminderByTime').checked) { toast('Ative quilometragem, tempo ou os dois.', 'error'); return; }
    const previous = state.reminders.find(item => item.id === $('reminderId').value);
    const reminder = Core.sanitizeReminder({
        id: $('reminderId').value || undefined, vehicleId: $('reminderVehicleId').value, title: $('reminderTitle').value,
        templateKey: previous?.templateKey || 'custom', icon: previous?.icon || 'bell', enabled: true,
        byKm: $('reminderByKm').checked, kmInterval: $('reminderKmInterval').value, lastKm: $('reminderLastKm').value, advanceKm: $('reminderAdvanceKm').value,
        byTime: $('reminderByTime').checked, dayInterval: $('reminderDayInterval').value, lastDate: $('reminderLastDate').value, advanceDays: $('reminderAdvanceDays').value,
        history: previous?.history || []
    }, state.vehicles);
    if (!reminder) { toast('Confira os dados do alarme.', 'error'); return; }
    const index = state.reminders.findIndex(item => item.id === reminder.id);
    if (index >= 0) state.reminders[index] = reminder; else state.reminders.push(reminder);
    saveState();
    $('reminderDialog').close();
    renderAll();
    toast('Alarme salvo.');
}

async function deleteTransaction(id) {
    if (!await confirmAction('Excluir lançamento?', 'O valor será removido dos relatórios.', 'Excluir')) return;
    state.transactions = state.transactions.filter(item => item.id !== id);
    saveState(); renderAll(); toast('Lançamento excluído.');
}

async function deleteVehicle(id) {
    if (state.vehicles.length === 1) { toast('Cadastre outro veículo antes de excluir este.', 'error'); return; }
    const vehicle = state.vehicles.find(item => item.id === id);
    if (!await confirmAction('Excluir veículo?', 'Também serão apagados os lançamentos e alarmes de ' + vehicleName(vehicle) + '.', 'Excluir tudo')) return;
    state.vehicles = state.vehicles.filter(item => item.id !== id);
    state.transactions = state.transactions.filter(item => item.vehicleId !== id);
    state.reminders = state.reminders.filter(item => item.vehicleId !== id);
    if (state.preferences.activeVehicleId === id) state.preferences.activeVehicleId = state.vehicles[0].id;
    saveState(); renderAll(); toast('Veículo excluído.');
}

function markReminderDone(id) {
    const reminder = state.reminders.find(item => item.id === id);
    const vehicle = state.vehicles.find(item => item.id === reminder?.vehicleId);
    if (!reminder || !vehicle) return;
    reminder.history.unshift({ date: Core.localISODate(), odometer: vehicle.odometer });
    reminder.history = reminder.history.slice(0, 30);
    if (reminder.byKm) reminder.lastKm = vehicle.odometer;
    if (reminder.byTime) reminder.lastDate = Core.localISODate();
    saveState(); renderAll(); toast('Manutenção marcada como feita.');
}

function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function backup() {
    download('motofinance-backup-' + Core.localISODate() + '.json', JSON.stringify(state, null, 2), 'application/json');
    toast('Backup baixado.');
}

function exportCSV() {
    const rows = [['Data', 'Tipo', 'Categoria', 'Valor', 'Veículo', 'Descrição', 'Odômetro']];
    state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(item => {
        const vehicle = state.vehicles.find(vehicleItem => vehicleItem.id === item.vehicleId);
        rows.push([item.date, item.type === 'gain' ? 'Ganho' : 'Gasto', Core.CATEGORIES[item.type][item.category], item.amount.toFixed(2).replace('.', ','), vehicleName(vehicle), item.description, item.odometer || '']);
    });
    const csv = '\ufeff' + rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(';')).join('\n');
    download('motofinance-movimentacoes-' + Core.localISODate() + '.csv', csv, 'text/csv;charset=utf-8');
    toast('Planilha CSV baixada.');
}

async function restore(file) {
    try {
        const parsed = JSON.parse(await file.text());
        const normalized = normalizeState(parsed);
        if (!parsed || !Array.isArray(parsed.vehicles) || !parsed.vehicles.length) throw new Error('Arquivo inválido');
        if (!await confirmAction('Restaurar backup?', 'Os dados atuais deste aparelho serão substituídos.', 'Restaurar')) return;
        state = normalized;
        saveState(); renderAll(); navigate('home'); toast('Backup restaurado.');
    } catch (error) { toast('Não foi possível ler este backup.', 'error'); }
    $('restoreInput').value = '';
}

async function clearData() {
    if (!await confirmAction('Apagar todos os dados?', 'Veículos, movimentações e alarmes deste aparelho serão removidos.', 'Apagar dados')) return;
    state = Core.createInitialState();
    state.migratedFromV6 = true;
    saveState(); renderAll(); navigate('home'); toast('Dados apagados.');
}

document.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) { event.preventDefault(); navigate(nav.dataset.nav); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'quick-add') openTransaction(quickType);
    if (action === 'add-vehicle') openVehicle();
    if (action === 'add-reminder') openReminder();
    if (action === 'update-odometer') openVehicle(activeVehicle());
    if (action === 'backup') backup();
    if (action === 'export-csv') exportCSV();
    if (action === 'clear-data') clearData();
    const close = event.target.closest('[data-close]');
    if (close) $(close.dataset.close).close();
    const quickButton = event.target.closest('[data-quick-type]');
    if (quickButton) { quickType = quickButton.dataset.quickType; renderQuickCategories(); }
    const category = event.target.closest('[data-quick-category]');
    if (category) openTransaction(quickType, category.dataset.quickCategory);
    const chartButton = event.target.closest('[data-chart-type]');
    if (chartButton) { chartType = chartButton.dataset.chartType; renderCharts(); }
    const formType = event.target.closest('[data-form-type]');
    if (formType) setFormType(formType.dataset.formType);
    const editTransaction = event.target.closest('[data-edit-transaction]');
    if (editTransaction) openTransaction('expense', '', state.transactions.find(item => item.id === editTransaction.dataset.editTransaction));
    const deleteTransactionButton = event.target.closest('[data-delete-transaction]');
    if (deleteTransactionButton) deleteTransaction(deleteTransactionButton.dataset.deleteTransaction);
    const editVehicle = event.target.closest('[data-edit-vehicle]');
    if (editVehicle) openVehicle(state.vehicles.find(item => item.id === editVehicle.dataset.editVehicle));
    const deleteVehicleButton = event.target.closest('[data-delete-vehicle]');
    if (deleteVehicleButton) deleteVehicle(deleteVehicleButton.dataset.deleteVehicle);
    const selectVehicle = event.target.closest('[data-select-vehicle]');
    if (selectVehicle) { state.preferences.activeVehicleId = selectVehicle.dataset.selectVehicle; saveState(); renderAll(); toast('Veículo selecionado.'); }
    const editReminder = event.target.closest('[data-edit-reminder]');
    if (editReminder) openReminder(state.reminders.find(item => item.id === editReminder.dataset.editReminder));
    const doneReminder = event.target.closest('[data-done-reminder]');
    if (doneReminder) markReminderDone(doneReminder.dataset.doneReminder);
});

$('transactionForm').addEventListener('submit', submitTransaction);
$('vehicleForm').addEventListener('submit', submitVehicle);
$('reminderForm').addEventListener('submit', submitReminder);
$('confirmCancel').addEventListener('click', () => closeConfirm(false));
$('confirmAccept').addEventListener('click', () => closeConfirm(true));
$('confirmDialog').addEventListener('cancel', event => { event.preventDefault(); closeConfirm(false); });
$('restoreInput').addEventListener('change', event => { if (event.target.files[0]) restore(event.target.files[0]); });

['homeMonth', 'chartMonth'].forEach(id => $(id).addEventListener('change', event => {
    state.preferences.month = event.target.value; saveState(false); renderAll();
}));
['homeVehicle', 'alarmVehicle'].forEach(id => $(id).addEventListener('change', event => {
    state.preferences.activeVehicleId = event.target.value; saveState(false); renderAll();
}));
['chartVehicle'].forEach(id => $(id).addEventListener('change', renderCharts));
['transactionMonth', 'transactionVehicle', 'transactionType'].forEach(id => $(id).addEventListener('change', renderTransactions));
$('transactionSearch').addEventListener('input', renderTransactions);

document.querySelectorAll('.app-dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
        if (event.target === dialog && dialog.id !== 'confirmDialog') dialog.close();
    });
});

window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.warn));

refreshSelectors();
renderAll();
navigate(location.hash.slice(1) || 'home');
