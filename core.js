(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.MotoFinanceCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CATEGORIES = Object.freeze({
        gain: Object.freeze({
            corrida: 'Corrida', entrega: 'Entrega', frete: 'Frete', diaria: 'Diária', gorjeta: 'Gorjeta', outro_ganho: 'Outro ganho'
        }),
        expense: Object.freeze({
            combustivel: 'Combustível', manutencao: 'Manutenção', pedagio: 'Pedágio', estacionamento: 'Estacionamento',
            seguro: 'Seguro', multa: 'Multa', impostos: 'Impostos', documento: 'Documentos', outro_gasto: 'Outro gasto'
        })
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

    function uid(prefix = 'id') {
        return globalThis.crypto?.randomUUID?.() || prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }

    function localISODate(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function currentMonth(date = new Date()) {
        return localISODate(date).slice(0, 7);
    }

    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
        const date = new Date(value + 'T12:00:00');
        return !Number.isNaN(date.getTime()) && localISODate(date) === value;
    }

    function nonNegative(value) {
        const number = Number(String(value ?? '').replace(',', '.'));
        return Number.isFinite(number) && number >= 0 ? number : 0;
    }

    function positive(value) {
        const number = nonNegative(value);
        return number > 0 ? number : 0;
    }

    function money(value) {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
    }

    function dateBR(value) {
        if (!validDate(value)) return '—';
        return new Intl.DateTimeFormat('pt-BR').format(new Date(value + 'T12:00:00'));
    }

    function monthLabel(value) {
        if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return 'Todos os períodos';
        const date = new Date(value + '-01T12:00:00');
        const text = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function sanitizeVehicle(input) {
        if (!input || typeof input !== 'object') return null;
        const brand = String(input.brand || '').trim().slice(0, 40);
        const model = String(input.model || '').trim().slice(0, 60);
        if (!brand || !model) return null;
        return {
            id: String(input.id || uid('vehicle')),
            type: ['moto', 'carro', 'outro'].includes(input.type) ? input.type : 'moto',
            plate: String(input.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7),
            brand,
            model,
            year: Math.min(2100, Math.max(1900, Math.round(nonNegative(input.year) || new Date().getFullYear()))),
            fuel: String(input.fuel || 'Gasolina').slice(0, 30),
            odometer: nonNegative(input.odometer),
            createdAt: String(input.createdAt || new Date().toISOString())
        };
    }

    function sanitizeTransaction(input, vehicles = []) {
        if (!input || typeof input !== 'object' || !validDate(input.date)) return null;
        const type = input.type === 'gain' ? 'gain' : input.type === 'expense' ? 'expense' : null;
        if (!type || !CATEGORIES[type][input.category] || positive(input.amount) <= 0) return null;
        const vehicleId = String(input.vehicleId || '');
        if (vehicles.length && !vehicles.some(vehicle => vehicle.id === vehicleId)) return null;
        return {
            id: String(input.id || uid('transaction')),
            vehicleId,
            type,
            category: input.category,
            amount: positive(input.amount),
            date: input.date,
            description: String(input.description || '').trim().slice(0, 160),
            odometer: nonNegative(input.odometer),
            createdAt: String(input.createdAt || new Date().toISOString())
        };
    }

    function sanitizeReminder(input, vehicles = []) {
        if (!input || typeof input !== 'object') return null;
        const vehicleId = String(input.vehicleId || '');
        const title = String(input.title || '').trim().slice(0, 80);
        if (!title || (vehicles.length && !vehicles.some(vehicle => vehicle.id === vehicleId))) return null;
        const byKm = Boolean(input.byKm) && positive(input.kmInterval) > 0;
        const byTime = Boolean(input.byTime) && positive(input.dayInterval) > 0;
        return {
            id: String(input.id || uid('reminder')),
            vehicleId,
            templateKey: String(input.templateKey || 'custom'),
            title,
            icon: String(input.icon || 'bell'),
            enabled: input.enabled !== false,
            byKm,
            byTime,
            kmInterval: byKm ? positive(input.kmInterval) : 0,
            dayInterval: byTime ? positive(input.dayInterval) : 0,
            lastKm: nonNegative(input.lastKm),
            lastDate: validDate(input.lastDate) ? input.lastDate : localISODate(),
            advanceKm: nonNegative(input.advanceKm || 200),
            advanceDays: nonNegative(input.advanceDays || 3),
            history: Array.isArray(input.history) ? input.history.slice(0, 30) : []
        };
    }

    function calculateTotals(transactions) {
        return transactions.reduce((totals, item) => {
            if (item.type === 'gain') totals.gains += nonNegative(item.amount);
            if (item.type === 'expense') totals.expenses += nonNegative(item.amount);
            totals.balance = totals.gains - totals.expenses;
            return totals;
        }, { gains: 0, expenses: 0, balance: 0 });
    }

    function filterTransactions(transactions, filters = {}) {
        const query = String(filters.query || '').toLocaleLowerCase('pt-BR').trim();
        return transactions.filter(item => {
            if (filters.month && !item.date.startsWith(filters.month)) return false;
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
        const values = {};
        transactions.filter(item => item.type === type).forEach(item => {
            values[item.category] = (values[item.category] || 0) + nonNegative(item.amount);
        });
        return Object.entries(CATEGORIES[type]).map(([key, label]) => ({ key, label, value: values[key] || 0 }))
            .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    }

    function addDays(dateString, days) {
        const date = new Date(dateString + 'T12:00:00');
        date.setDate(date.getDate() + Number(days || 0));
        return localISODate(date);
    }

    function daysBetween(start, end) {
        const a = new Date(start + 'T12:00:00');
        const b = new Date(end + 'T12:00:00');
        return Math.ceil((b - a) / 86400000);
    }

    function reminderStatus(reminder, vehicle, today = localISODate()) {
        if (!reminder.enabled || (!reminder.byKm && !reminder.byTime)) return { key: 'unconfigured', label: 'Sem configuração', remaining: null, detail: 'Configure por km ou por tempo' };
        const currentKm = nonNegative(vehicle?.odometer);
        const kmRemaining = reminder.byKm ? reminder.lastKm + reminder.kmInterval - currentKm : Infinity;
        const dueDate = reminder.byTime ? addDays(reminder.lastDate, reminder.dayInterval) : null;
        const daysRemaining = dueDate ? daysBetween(today, dueDate) : Infinity;
        const overdue = kmRemaining < 0 || daysRemaining < 0;
        const upcoming = !overdue && (kmRemaining <= reminder.advanceKm || daysRemaining <= reminder.advanceDays);
        const key = overdue ? 'overdue' : upcoming ? 'upcoming' : 'ok';
        const label = overdue ? 'Atrasado' : upcoming ? 'Próximo' : 'Em dia';
        const parts = [];
        if (reminder.byKm) parts.push(kmRemaining < 0 ? Math.abs(kmRemaining) + ' km atrasados' : kmRemaining + ' km restantes');
        if (reminder.byTime) parts.push(daysRemaining < 0 ? Math.abs(daysRemaining) + ' dias atrasados' : daysRemaining + ' dias restantes');
        return { key, label, kmRemaining, daysRemaining, dueDate, detail: parts.join(' • ') };
    }

    function createInitialState() {
        const vehicle = sanitizeVehicle({
            id: 'vehicle-principal', type: 'moto', plate: '', brand: 'Honda', model: 'CG 150 Titan ES', year: 2008, fuel: 'Gasolina', odometer: 0
        });
        const configured = new Set(['oleo', 'revisao', 'calibragem']);
        const reminders = REMINDER_TEMPLATES.map(template => sanitizeReminder({
            ...template,
            id: 'reminder-' + template.key,
            vehicleId: vehicle.id,
            enabled: configured.has(template.key),
            byKm: configured.has(template.key) && Boolean(template.kmInterval),
            byTime: configured.has(template.key) && Boolean(template.dayInterval),
            lastKm: 0,
            lastDate: localISODate()
        }, [vehicle]));
        return {
            version: 1,
            profile: { name: 'Moisés' },
            vehicles: [vehicle],
            transactions: [],
            reminders,
            preferences: { activeVehicleId: vehicle.id, month: currentMonth(), theme: 'light' },
            migratedFromV6: false
        };
    }

    return {
        CATEGORIES, REMINDER_TEMPLATES, uid, localISODate, currentMonth, validDate, nonNegative, positive,
        money, dateBR, monthLabel, sanitizeVehicle, sanitizeTransaction, sanitizeReminder, calculateTotals,
        filterTransactions, totalsByCategory, addDays, daysBetween, reminderStatus, createInitialState
    };
}));
