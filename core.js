(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.MotoFinanceCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DATA_VERSION = 2;
    const CATEGORIES = Object.freeze({
        gain: Object.freeze({ corrida: 'Corrida', entrega: 'Entrega', frete: 'Frete', diaria: 'Diária', gorjeta: 'Gorjeta', outro_ganho: 'Outro ganho' }),
        expense: Object.freeze({ combustivel: 'Combustível', manutencao: 'Manutenção', pedagio: 'Pedágio', estacionamento: 'Estacionamento', seguro: 'Seguro', multa: 'Multa', impostos: 'Impostos', documento: 'Documentos', outro_gasto: 'Outro gasto' })
    });

    const REMINDER_TEMPLATES = Object.freeze([
        { key: 'oleo', title: 'Troca de óleo', icon: 'drop', kmInterval: 1000, dayInterval: 180 },
        { key: 'revisao', title: 'Revisão preventiva', icon: 'tools', kmInterval: 5000, dayInterval: 365 },
        { key: 'calibragem', title: 'Calibragem dos pneus', icon: 'gauge', kmInterval: 500, dayInterval: 15 },
        { key: 'alinhamento', title: 'Alinhamento e balanceamento', icon: 'adjust', kmInterval: 5000, dayInterval: 180 },
        { key: 'bateria', title: 'Bateria', icon: 'battery', dayInterval: 730 },
        { key: 'freios', title: 'Pastilhas de freio', icon: 'alert', kmInterval: 10000 },
        { key: 'filtros', title: 'Troca de filtros', icon: 'filter', kmInterval: 5000, dayInterval: 180 },
        { key: 'pneus', title: 'Troca de pneus', icon: 'circle', kmInterval: 20000 },
        { key: 'licenciamento', title: 'Licenciamento anual', icon: 'document', dayInterval: 365 },
        { key: 'seguro', title: 'Seguro do veículo', icon: 'shield', dayInterval: 365 },
        { key: 'ipva', title: 'IPVA', icon: 'receipt', dayInterval: 365 }
    ]);

    function uid(prefix = 'id') { return globalThis.crypto?.randomUUID?.() || prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2); }
    function localISODate(date = new Date()) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
    function currentMonth(date = new Date()) { return localISODate(date).slice(0, 7); }

    function validDate(value) {
        const text = String(value || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
        const date = new Date(text + 'T12:00:00');
        return !Number.isNaN(date.getTime()) && localISODate(date) === text;
    }
    function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')); }

    function parseLocaleNumber(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
        let text = String(value ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
        if (!text) return NaN;
        const comma = text.lastIndexOf(',');
        const dot = text.lastIndexOf('.');
        if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
        else if (comma >= 0) text = text.replace(/\./g, '').replace(',', '.');
        else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
        if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return NaN;
        return Number(text);
    }
    function nonNegative(value) { const number = parseLocaleNumber(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
    function positive(value) { const number = parseLocaleNumber(value); return Number.isFinite(number) && number > 0 ? number : 0; }
    function money(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0); }
    function dateBR(value) { return validDate(value) ? new Intl.DateTimeFormat('pt-BR').format(new Date(value + 'T12:00:00')) : '—'; }
    function monthLabel(value) {
        if (!validMonth(value)) return 'Todos os períodos';
        const text = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(value + '-01T12:00:00'));
        return text.charAt(0).toUpperCase() + text.slice(1);
    }
    function validPlate(value) {
        const plate = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return plate === '' || /^[A-Z]{3}(\d{4}|\d[A-Z]\d{2})$/.test(plate);
    }
    function uniqueId(value, prefix) { return String(value || '').trim().slice(0, 100) || uid(prefix); }

    function sanitizeVehicle(input) {
        if (!input || typeof input !== 'object') return null;
        const brand = String(input.brand || '').trim().slice(0, 40);
        const model = String(input.model || '').trim().slice(0, 60);
        if (!brand || !model) return null;
        return {
            id: uniqueId(input.id, 'vehicle'), type: ['moto', 'carro', 'outro'].includes(input.type) ? input.type : 'moto',
            plate: String(input.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7), brand, model,
            year: Math.min(2100, Math.max(1900, Math.round(nonNegative(input.year) || new Date().getFullYear()))),
            fuel: String(input.fuel || 'Gasolina').trim().slice(0, 30), odometer: nonNegative(input.odometer),
            createdAt: String(input.createdAt || new Date().toISOString())
        };
    }

    function sanitizeTransaction(input, vehicles = []) {
        if (!input || typeof input !== 'object' || !validDate(input.date)) return null;
        const type = input.type === 'gain' ? 'gain' : input.type === 'expense' ? 'expense' : null;
        if (!type || !Object.hasOwn(CATEGORIES[type], input.category) || positive(input.amount) <= 0) return null;
        const vehicleId = String(input.vehicleId || '');
        if (vehicles.length && !vehicles.some(vehicle => vehicle.id === vehicleId)) return null;
        return {
            id: uniqueId(input.id, 'transaction'), vehicleId, type, category: input.category, amount: positive(input.amount), date: input.date,
            description: String(input.description || '').trim().slice(0, 160), odometer: nonNegative(input.odometer),
            createdAt: String(input.createdAt || new Date().toISOString())
        };
    }

    function templateFor(key) { return REMINDER_TEMPLATES.find(item => item.key === key); }
    function sanitizeOdometerLog(input) {
        if (!input || typeof input !== 'object' || !validDate(input.date)) return null;
        return {
            id: uniqueId(input.id, 'odometer'), vehicleId: String(input.vehicleId || ''), date: input.date,
            odometer: nonNegative(input.odometer ?? input.km), description: String(input.description || '').trim().slice(0, 120),
            createdAt: String(input.createdAt || new Date().toISOString())
        };
    }
    function sanitizeReminder(input, vehicles = []) {
        if (!input || typeof input !== 'object') return null;
        const vehicleId = String(input.vehicleId || '');
        const title = String(input.title || '').trim().slice(0, 80);
        if (!title || (vehicles.length && !vehicles.some(vehicle => vehicle.id === vehicleId))) return null;
        const template = templateFor(String(input.templateKey || ''));
        const recommendedKm = positive(input.recommendedKm ?? template?.kmInterval ?? input.kmInterval);
        const recommendedDays = positive(input.recommendedDays ?? template?.dayInterval ?? input.dayInterval);
        const byKm = Boolean(input.byKm) && positive(input.kmInterval) > 0;
        const byTime = Boolean(input.byTime) && positive(input.dayInterval) > 0;
        return {
            id: uniqueId(input.id, 'reminder'), vehicleId, templateKey: String(input.templateKey || 'custom').slice(0, 40), title,
            icon: String(input.icon || 'bell').slice(0, 30), enabled: input.enabled !== false, paused: Boolean(input.paused), byKm, byTime,
            kmInterval: byKm ? positive(input.kmInterval) : 0, dayInterval: byTime ? positive(input.dayInterval) : 0,
            recommendedKm, recommendedDays, lastKm: nonNegative(input.lastKm), lastDate: validDate(input.lastDate) ? input.lastDate : '',
            advanceKm: nonNegative(input.advanceKm ?? 200), advanceDays: nonNegative(input.advanceDays ?? 3),
            history: Array.isArray(input.history) ? input.history.map(sanitizeOdometerLog).filter(Boolean).slice(0, 30) : []
        };
    }

    function calculateTotals(transactions) {
        return transactions.reduce((totals, item) => {
            if (item.type === 'gain') totals.gains += nonNegative(item.amount);
            if (item.type === 'expense') {
                totals.expenses += nonNegative(item.amount);
                if (item.category === 'combustivel') totals.fuel += nonNegative(item.amount);
                if (item.category === 'manutencao') totals.maintenance += nonNegative(item.amount);
            }
            totals.operational = totals.gains - totals.fuel;
            totals.balance = totals.gains - totals.expenses;
            return totals;
        }, { gains: 0, expenses: 0, fuel: 0, maintenance: 0, operational: 0, balance: 0 });
    }
    function filterTransactions(transactions, filters = {}) {
        const query = String(filters.query || '').toLocaleLowerCase('pt-BR').trim();
        return transactions.filter(item => {
            if (filters.month && validMonth(filters.month) && !item.date.startsWith(filters.month)) return false;
            if (filters.vehicleId && filters.vehicleId !== 'all' && item.vehicleId !== filters.vehicleId) return false;
            if (filters.type && filters.type !== 'all' && item.type !== filters.type) return false;
            if (query) {
                const haystack = [item.description, CATEGORIES[item.type]?.[item.category], item.category].join(' ').toLocaleLowerCase('pt-BR');
                if (!haystack.includes(query)) return false;
            }
            return true;
        }).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    function totalsByCategory(transactions, type = 'expense') {
        const safeType = type === 'gain' ? 'gain' : 'expense';
        const values = Object.create(null);
        transactions.filter(item => item.type === safeType).forEach(item => { values[item.category] = (values[item.category] || 0) + nonNegative(item.amount); });
        return Object.entries(CATEGORIES[safeType]).map(([key, label]) => ({ key, label, value: values[key] || 0 })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    }
    function addDays(dateString, days) {
        if (!validDate(dateString)) return '';
        const date = new Date(dateString + 'T12:00:00'); date.setDate(date.getDate() + Number(days || 0)); return localISODate(date);
    }
    function daysBetween(start, end) {
        if (!validDate(start) || !validDate(end)) return Infinity;
        return Math.ceil((new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00')) / 86400000);
    }

    function reminderStatus(reminder, vehicle, today = localISODate()) {
        if (reminder.paused) return { key: 'paused', label: 'Pausado', detail: 'Lembrete temporariamente pausado', progress: 0, urgency: Infinity };
        if (!reminder.enabled || (!reminder.byKm && !reminder.byTime)) return { key: 'unconfigured', label: 'Sem configuração', detail: 'Configure por km ou por tempo', progress: 0, urgency: Infinity };
        const currentKm = nonNegative(vehicle?.odometer);
        const kmRemaining = reminder.byKm ? reminder.lastKm + reminder.kmInterval - currentKm : Infinity;
        const dueDate = reminder.byTime && validDate(reminder.lastDate) ? addDays(reminder.lastDate, reminder.dayInterval) : null;
        const daysRemaining = dueDate ? daysBetween(today, dueDate) : Infinity;
        if (reminder.byTime && !dueDate) return { key: 'unconfigured', label: 'Falta a última data', detail: 'Informe quando o serviço foi feito pela última vez', progress: 0, urgency: Infinity };
        const overdue = kmRemaining < 0 || daysRemaining < 0;
        const upcoming = !overdue && (kmRemaining <= reminder.advanceKm || daysRemaining <= reminder.advanceDays);
        const key = overdue ? 'overdue' : upcoming ? 'upcoming' : 'ok';
        const parts = [];
        if (reminder.byKm) parts.push(kmRemaining < 0 ? Math.abs(kmRemaining) + ' km atrasados' : kmRemaining + ' km restantes');
        if (reminder.byTime) parts.push(daysRemaining < 0 ? Math.abs(daysRemaining) + ' dias atrasados' : daysRemaining + ' dias restantes');
        const kmProgress = reminder.byKm ? (currentKm - reminder.lastKm) / reminder.kmInterval : 0;
        const dayProgress = reminder.byTime ? (reminder.dayInterval - daysRemaining) / reminder.dayInterval : 0;
        return {
            key, label: overdue ? 'Atrasado' : upcoming ? 'Próximo' : 'Em dia', kmRemaining, daysRemaining, dueDate,
            detail: parts.join(' • '), progress: Math.max(0, Math.min(100, Math.max(kmProgress, dayProgress) * 100)),
            urgency: Math.min(reminder.byKm ? kmRemaining / Math.max(1, reminder.kmInterval) : Infinity, reminder.byTime ? daysRemaining / Math.max(1, reminder.dayInterval) : Infinity)
        };
    }

    function createReminderSet(vehicle) {
        return REMINDER_TEMPLATES.map(template => sanitizeReminder({
            ...template, id: 'reminder-' + vehicle.id + '-' + template.key, vehicleId: vehicle.id,
            enabled: false, paused: false, byKm: false, byTime: false,
            recommendedKm: template.kmInterval, recommendedDays: template.dayInterval,
            lastKm: vehicle.odometer, lastDate: ''
        }, [vehicle]));
    }
    function createInitialState() {
        const vehicle = sanitizeVehicle({ id: 'vehicle-principal', type: 'moto', plate: '', brand: 'Honda', model: 'CG 150 Titan ES', year: 2008, fuel: 'Gasolina', odometer: 0 });
        return {
            version: DATA_VERSION, profile: { name: 'Moisés' }, vehicles: [vehicle], transactions: [], reminders: createReminderSet(vehicle), odometerLogs: [],
            preferences: { activeVehicleId: vehicle.id, month: currentMonth(), theme: 'light', weeklyGoal: 0, monthlyGoal: 0 },
            migratedFromV6: false, migrationSummary: null
        };
    }

    return {
        DATA_VERSION, CATEGORIES, REMINDER_TEMPLATES, uid, localISODate, currentMonth, validDate, validMonth, parseLocaleNumber,
        nonNegative, positive, money, dateBR, monthLabel, validPlate, sanitizeVehicle, sanitizeTransaction, sanitizeReminder,
        sanitizeOdometerLog, calculateTotals, filterTransactions, totalsByCategory, addDays, daysBetween, reminderStatus,
        createReminderSet, createInitialState
    };
}));
