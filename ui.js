// ui.js
import { state, monthNames, getDaysInMonth, pad } from './config.js';

export function updateDynamicMenu() {
    const menuContainer = document.getElementById('dynamicMenuContainer');
    if (!menuContainer) return;
    menuContainer.innerHTML = '';
    menuContainer.classList.add('hidden');
}

export function showNotification(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    const colorClass = type === 'success' ? 'border-emerald-500/30 bg-emerald-950/80 text-emerald-100' : 'border-red-500/30 bg-red-950/80 text-red-100';
    const icon = type === 'success' ? 'fa-check text-emerald-400' : 'fa-times text-red-400';
    toast.className = `p-4 rounded-xl border backdrop-blur-md shadow-2xl flex items-center gap-3 min-w-[280px] animate-bounce-in pointer-events-auto ${colorClass}`;
    toast.innerHTML = `<div class="w-8 h-8 rounded-full bg-black/20 flex items-center justify-center shrink-0"><i class="fas ${icon} text-xs"></i></div><div><h3 class="text-[10px] font-bold uppercase tracking-widest leading-none mb-1">${type === 'success' ? 'Sucesso' : 'Erro'}</h3><p class="text-[11px] font-medium leading-tight">${msg}</p></div>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

export function renderMonthSelector(onPrev, onNext) {
    const container = document.getElementById('monthSelectorContainer');
    if (!container) return;
    const cur = state.selectedMonthObj;
    
    container.innerHTML = `
        <div class="flex items-center bg-black/40 rounded-full p-1 border border-white/10 shadow-lg backdrop-blur-md">
            <button id="btnMonthPrev" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-all active:scale-90">
                <i class="fas fa-chevron-left text-[10px]"></i>
            </button>
            <div class="px-4 flex flex-col items-center justify-center min-w-[100px] cursor-default group">
                <span class="text-[11px] font-bold tracking-[0.2em] uppercase text-white group-hover:text-blue-400 transition-colors">${monthNames[cur.month]}</span>
                <span class="text-[9px] font-mono text-white/30 tracking-widest">${cur.year}</span>
            </div>
            <button id="btnMonthNext" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-all active:scale-90">
                <i class="fas fa-chevron-right text-[10px]"></i>
            </button>
        </div>
    `;
    document.getElementById('btnMonthPrev').onclick = onPrev;
    document.getElementById('btnMonthNext').onclick = onNext;
}

export function updatePersonalView(uidOrName) {
    const calContainer = document.getElementById('calendarContainer');
    const card = document.getElementById('personalInfoCard');
    
    // Atualiza o widget de FDS sempre que a visão pessoal atualizar
    renderWeekendDuty();
    
    if (!uidOrName) {
        if(calContainer) calContainer.classList.add('hidden');
        if(card) card.innerHTML = '';
        return;
    }
    const emp = state.scheduleData[uidOrName];
    if (!emp) return;

    if (card) {
        card.innerHTML = `
            <div class="glass-panel p-5 rounded-2xl relative overflow-hidden group">
                <div class="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div class="relative flex items-center gap-4">
                    <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-lg font-bold shadow-lg shadow-blue-900/30">
                        ${emp.name.charAt(0)}
                    </div>
                    <div>
                        <h2 class="text-sm font-bold text-white tracking-wide">${emp.name}</h2>
                        <div class="flex flex-wrap gap-2 mt-1.5">
                            <span class="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[9px] text-gray-300 font-mono uppercase">${emp.role || 'User'}</span>
                            <span class="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-[9px] text-blue-300 font-mono uppercase">${emp.setorID || 'NOC'}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    if(calContainer) calContainer.classList.remove('hidden');
    updateCalendar(emp.name, emp.schedule);
}

export function updateCalendar(name, schedule) {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const realToday = new Date(); realToday.setHours(0,0,0,0);
    ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach(d => {
        const h = document.createElement('div'); h.className = 'text-[9px] font-bold text-gray-500 uppercase text-center pb-2 tracking-wider'; h.textContent = d; grid.appendChild(h);
    });
    const days = getDaysInMonth(state.selectedMonthObj.year, state.selectedMonthObj.month);
    for (let i = 0; i < days[0].getDay(); i++) grid.appendChild(document.createElement('div'));
    days.forEach((day, i) => {
        const raw = schedule[i];
        const s = (raw===undefined||raw===null||raw==="") ? 'F' : raw;
        const isToday = day.getTime() === realToday.getTime();
        const cell = document.createElement('div');
        cell.className = `calendar-cell status-${s} ${isToday ? 'is-today' : ''}`;
        if (state.isAdmin) cell.onclick = () => window.handleCellClick(name, i);
        cell.innerHTML = `<span class="text-xs font-bold mb-0.5">${day.getDate()}</span><span class="text-[8px] uppercase opacity-70">${s}</span>`;
        grid.appendChild(cell);
    });
}

// --- WIDGET DE FINS DE SEMANA (ATUALIZADO) ---
export function renderWeekendDuty() {
    const container = document.getElementById('weekendDutyContainer');
    if (!container || !state.scheduleData) return;

    const days = getDaysInMonth(state.selectedMonthObj.year, state.selectedMonthObj.month);
    const weekends = [];
    let currentWeekend = { sat: null, sun: null };

    days.forEach((day, idx) => {
        if (day.getDay() === 6) currentWeekend.sat = { date: day, idx: idx };
        else if (day.getDay() === 0) {
            currentWeekend.sun = { date: day, idx: idx };
            if (currentWeekend.sat) { weekends.push({ ...currentWeekend }); currentWeekend = { sat: null, sun: null }; }
        }
    });

    // Título atualizado para "Fins de semana"
    let html = `<div class="glass-panel p-4 rounded-2xl flex flex-col max-h-[220px] overflow-hidden"><h3 class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2 shrink-0"><i class="fas fa-calendar-week text-blue-400"></i> Fins de semana</h3><div class="space-y-2 overflow-y-auto custom-scrollbar pr-1 pb-2">`;
    let hasDuty = false;

    // Verificação de modo e usuário
    const isCollabMode = state.currentViewMode === 'collab';
    const myName = state.profile?.name;

    weekends.forEach(wk => {
        const getW = (idx) => Object.values(state.scheduleData).filter(e => ['FS','FD','T'].includes(e.schedule[idx])).map(e => e.name);
        const satWorkers = getW(wk.sat.idx);
        const sunWorkers = getW(wk.sun.idx);

        // --- FILTRO DE VISUALIZAÇÃO ---
        // Se estiver no modo Colaborador, só mostra o card se o usuário estiver escalado no Sábado ou Domingo
        if (isCollabMode && myName) {
            const amIWorking = satWorkers.includes(myName) || sunWorkers.includes(myName);
            if (!amIWorking) return; // Pula este fim de semana
        }

        if (satWorkers.length > 0 || sunWorkers.length > 0) {
            hasDuty = true;
            const satDate = `${pad(wk.sat.date.getDate())}/${pad(state.selectedMonthObj.month + 1)}`;
            const sunDate = `${pad(wk.sun.date.getDate())}/${pad(state.selectedMonthObj.month + 1)}`;
            html += `<div class="bg-white/5 rounded-xl p-3 border border-white/5 hover:bg-white/10 transition-colors"><div class="flex justify-between items-center mb-2 pb-2 border-b border-white/5"><span class="text-[9px] font-bold text-white/50 uppercase tracking-wide">Fim de Semana</span><span class="text-[9px] font-mono text-blue-300 bg-blue-500/10 px-1.5 py-0.5 rounded">${satDate} - ${sunDate}</span></div><div class="space-y-1.5">`;
            
            // Renderização com Nome e Sobrenome (.split .slice .join)
            if (satWorkers.length) {
                html += `<div class="flex items-start gap-2"><span class="text-[9px] text-teal-400 font-bold uppercase w-6 mt-0.5">Sáb</span><div class="flex flex-wrap gap-1.5 flex-1">${satWorkers.map(n => {
                    const shortName = n.split(' ').slice(0, 2).join(' '); // Nome + Sobrenome
                    return `<span class="px-2 py-0.5 rounded-md bg-teal-500/10 border border-teal-500/20 text-[9px] text-teal-200 flex items-center gap-1.5"><div class="w-1 h-1 rounded-full bg-teal-400"></div>${shortName}</span>`;
                }).join('')}</div></div>`;
            }
            
            if (sunWorkers.length) {
                html += `<div class="flex items-start gap-2"><span class="text-[9px] text-blue-400 font-bold uppercase w-6 mt-0.5">Dom</span><div class="flex flex-wrap gap-1.5 flex-1">${sunWorkers.map(n => {
                    const shortName = n.split(' ').slice(0, 2).join(' '); // Nome + Sobrenome
                    return `<span class="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-[9px] text-blue-200 flex items-center gap-1.5"><div class="w-1 h-1 rounded-full bg-blue-400"></div>${shortName}</span>`;
                }).join('')}</div></div>`;
            }
            html += `</div></div>`;
        }
    });

    if (!hasDuty) html += `<div class="text-[10px] text-gray-600 italic text-center py-4">Nenhum plantão agendado.</div>`;
    html += `</div></div>`;
    container.innerHTML = html;
}

export function switchSubTab() {}
