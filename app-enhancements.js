'use strict';
(function () {
  const STORAGE = window.MotoFinanceSyncConfig?.storageKey || 'motofinance_pro_v1';
  function readState() { try { return JSON.parse(localStorage.getItem(STORAGE) || 'null'); } catch { return null; } }
  function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
  function localISO(date) { return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'); }
  function renderWeeklyGoal() {
    const host = document.querySelector('.goals-group .goal-form'); if (!host) return;
    let box = document.getElementById('mfWeeklyGoalProgress'); const state = readState(); const goal = Number(state?.preferences?.weeklyGoal || 0);
    if (!goal) { if (box) box.remove(); return; }
    const today = new Date(); const offset = (today.getDay()+6)%7; const monday = new Date(today); monday.setHours(12,0,0,0); monday.setDate(today.getDate()-offset); const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
    const start = localISO(monday); const end = localISO(sunday);
    const gains = (state?.transactions || []).filter(item => item.type === 'gain' && item.date >= start && item.date <= end).reduce((sum,item)=>sum+Number(item.amount||0),0);
    const percent = Math.min(100, gains / goal * 100).toFixed(0);
    if (!box) { box = document.createElement('div'); box.id = 'mfWeeklyGoalProgress'; box.style.cssText = 'margin-top:10px;padding:12px 14px;border:1px solid #e3e8ef;border-radius:14px;background:#fff;color:#566274;font-size:13px;'; host.insertAdjacentElement('afterend', box); }
    box.textContent = `Meta semanal: ${money(gains)} de ${money(goal)} • ${percent}%`;
  }
  function lockReminderVehicle() {
    const dialog = document.getElementById('reminderDialog'); const id = document.getElementById('reminderId'); const select = document.getElementById('reminderVehicleId');
    if (!dialog || !id || !select) return;
    const sync = () => {
      const editing = dialog.open && Boolean(id.value);
      select.disabled = editing;
      select.title = editing ? 'Para preservar o histórico, o veículo de um lembrete existente não pode ser alterado. Crie outro lembrete para outro veículo.' : '';
    };
    new MutationObserver(sync).observe(dialog, { attributes:true, attributeFilter:['open'] });
    dialog.addEventListener('close', () => { select.disabled = false; select.title = ''; });
  }
  renderWeeklyGoal(); lockReminderVehicle();
  setInterval(renderWeeklyGoal, 1500);
})();
