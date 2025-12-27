// ui.js
import { state, monthNames, getDaysInMonth, pad } from './config.js';

export function showNotification(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    const colorClass = type === 'success' ? 'border-l-emerald-500 bg-[#064e3b]/90' : 'border-l-red-500 bg-[#7f1d1d]/90';
    const icon = type === 'success' ? 'fa-check text-emerald-400' : 'fa-times text-red-400';
    
    toast.className = `p-4 rounded-r-lg border-l-4 ${colorClass} backdrop-blur-md shadow-2xl flex items-center gap-3 min-w-[280px] animate-bounce-in pointer-events-auto border border-white/5`;
    
    toast.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-black/20 flex items-center justify-center shrink-0">
             <i class="fas ${icon} text-xs"></i>
        </div>
        <div>
            <h3 class="text-[10px] font-bold text-white uppercase tracking-widest leading-none mb-1">${type === 'success' ? 'Sucesso' : 'Erro'}</h3>
            <p class="text-[11px] text-gray-200 font-medium leading-tight">${msg}</p>
        </div>
        <button onclick="this.parentElement.remove()" class="ml-auto text-white/40 hover:text-white"><i class="fas fa-times text-xs"></i></button>
    `;
    
    container.appendChild(toast);
    setTimeout(() => { 
        toast.style.opacity = '0'; 
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300); 
    }, 4000);
}

export function renderMonthSelector(onPrev, onNext) {
    const container = document.getElementById('monthSelectorContainer');
    if (!container) return;
    const cur = state.selectedMonthObj;
    const label = `${monthNames[cur.month]} <span class="text-white/40 font-light ml-1">${cur.year}</span>`;
    container.innerHTML = `
        <div class="flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/5">
            <button id="btnMonthPrev" class="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"><i class="fas fa-chevron-left text-[8px]"></i></button>
            <div class="text-[9px] font-bold tracking-widest uppercase text-white px-2 min-w-[80px] text-center">${label}</div>
            <button id="btnMonthNext" class="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"><i class="fas fa-chevron-right text-[8px]"></i></button>
        </div>`;
    document.getElementById('btnMonthPrev').onclick = onPrev;
    document.getElementById('btnMonthNext').onclick = onNext;
}

export function updatePersonalView(uidOrName) {
    const calContainer = document.getElementById('calendarContainer');
    const card = document.getElementById('personalInfoCard');
    
    if (!uidOrName) {
        if(calContainer) calContainer.classList.add('hidden');
        if(card) card.innerHTML = '';
        return;
    }

    const emp = state.scheduleData[uidOrName];
    if (!emp) return;

    if (card) {
        card.innerHTML = `
        <div class="premium-glass p-3 flex items-center gap-3 border-l-2 border-blue-500">
            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shrink-0 text-white font-bold text-xs">
                ${emp.name.charAt(0)}
            </div>
            <div class="min-w-0">
                <h2 class="text-xs font-bold text-white truncate">${emp.name}</h2>
                <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[9px] text-gray-400 uppercase tracking-wider">${emp.cargo || emp.role}</span>
                    <span class="w-1 h-1 rounded-full bg-gray-600"></span>
                    <span class="text-[9px] text-blue-400 font-bold uppercase tracking-wider">${emp.setorID || 'NOC'}</span>
                </div>
            </div>
        </div>`;
    }
    
    if(calContainer) calContainer.classList.remove('hidden');
    updateCalendar(emp.name, emp.schedule);
    renderWeekendDuty(); 
}

export function updateCalendar(name, schedule) {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const realToday = new Date(); realToday.setHours(0,0,0,0);
    ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach(d => {
        const h = document.createElement('div');
        h.className = 'text-[8px] font-bold text-gray-500 uppercase text-center pb-1';
        h.textContent = d;
        grid.appendChild(h);
    });
    const days = getDaysInMonth(state.selectedMonthObj.year, state.selectedMonthObj.month);
    for (let i = 0; i < days[0].getDay(); i++) grid.appendChild(document.createElement('div'));
    
    days.forEach((day, i) => {
        const s = schedule[i] || 'F';
        const isToday = day.getTime() === realToday.getTime();
        const isPast = day.getTime() < realToday.getTime();
        const labels = { 'T':'T', 'F':'F', 'FE':'FE', 'FS':'FS', 'FD':'FD', 'A':'A', 'LM':'LM' };
        
        const cell = document.createElement('div');
        cell.className = `calendar-cell status-${s} ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''}`;
        
        if (state.isAdmin) cell.onclick = () => window.handleCellClick(name, i);
        
        cell.innerHTML = `<span class="day-number">${day.getDate()}</span><span class="day-label">${labels[s] || s}</span>`;
        grid.appendChild(cell);
    });
}

// --- ATUALIZADO: RENDERIZAÇÃO COMPACTA DE FIM DE SEMANA ---
export function renderWeekendDuty() {
    const container = document.getElementById('weekendDutyContainer');
    if (!container) return;

    if (!state.scheduleData || Object.keys(state.scheduleData).length === 0) {
        container.innerHTML = '';
        return;
    }

    const days = getDaysInMonth(state.selectedMonthObj.year, state.selectedMonthObj.month);
    
    // Adicionei max-h (altura máxima) e overflow-y-auto para rolar DENTRO do card, não na página toda
    let html = `
        <div class="premium-glass p-3 border border-white/5 flex flex-col max-h-[220px] overflow-hidden">
            <h3 class="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2 shrink-0">
                <i class="fas fa-calendar-week text-blue-400"></i> Escala FDS
            </h3>
            <div class="space-y-2 overflow-y-auto custom-scrollbar pr-1 pb-2">`; 

    const weekends = [];
    let currentWeekend = { sat: null, sun: null };

    days.forEach((day, idx) => {
        if (day.getDay() === 6) { 
            currentWeekend.sat = { date: day, idx: idx };
        } else if (day.getDay() === 0) { 
            currentWeekend.sun = { date: day, idx: idx };
            if (currentWeekend.sat) { 
                weekends.push({ ...currentWeekend });
                currentWeekend = { sat: null, sun: null };
            }
        }
    });

    let hasDuty = false;

    weekends.forEach(wk => {
        const satWorkers = getWorkersForDay(wk.sat.idx);
        const sunWorkers = getWorkersForDay(wk.sun.idx);

        // Só mostra o card se houver alguém trabalhando no sábado OU no domingo
        if (satWorkers.length > 0 || sunWorkers.length > 0) {
            hasDuty = true;
            const satDate = `${pad(wk.sat.date.getDate())}/${pad(state.selectedMonthObj.month + 1)}`;
            const sunDate = `${pad(wk.sun.date.getDate())}/${pad(state.selectedMonthObj.month + 1)}`;

            html += `
            <div class="bg-white/5 rounded-lg p-2 border border-white/5">
                <div class="flex justify-between items-center mb-1.5 pb-1 border-b border-white/5">
                    <span class="text-[8px] font-bold text-white/50 uppercase tracking-wide">FDS</span>
                    <span class="text-[8px] font-mono text-blue-300 bg-blue-500/10 px-1 rounded">${satDate} - ${sunDate}</span>
                </div>
                <div class="space-y-1">`;
                
                // SÓ MOSTRA A LINHA DE SÁBADO SE TIVER GENTE
                if (satWorkers.length > 0) {
                    html += `
                    <div class="flex items-start gap-1.5">
                        <span class="text-[8px] text-[#40E0D0] font-bold uppercase w-5 mt-0.5">Sáb</span>
                        <div class="flex flex-wrap gap-1 flex-1">
                            ${satWorkers.map(n => renderPill(n, 'bg-[#40E0D0]')).join('')}
                        </div>
                    </div>`;
                }

                // SÓ MOSTRA A LINHA DE DOMINGO SE TIVER GENTE
                if (sunWorkers.length > 0) {
                    html += `
                    <div class="flex items-start gap-1.5">
                        <span class="text-[8px] text-[#4169E1] font-bold uppercase w-5 mt-0.5">Dom</span>
                        <div class="flex flex-wrap gap-1 flex-1">
                            ${sunWorkers.map(n => renderPill(n, 'bg-[#4169E1]')).join('')}
                        </div>
                    </div>`;
                }

            html += `</div></div>`;
        }
    });

    if (!hasDuty) html += `<div class="text-[9px] text-gray-600 italic text-center py-2">Sem escalas definidas.</div>`;
    html += `</div></div>`;
    container.innerHTML = html;
}

function getWorkersForDay(idx) {
    const workers = [];
    Object.values(state.scheduleData).forEach(emp => {
        const s = emp.schedule[idx];
        if (s === 'FS' || s === 'FD' || s === 'T') workers.push(emp.name);
    });
    return workers;
}

function renderPill(name, colorClass) {
    // Apenas o primeiro nome para economizar espaço no mobile
    const firstName = name.split(' ')[0]; 
    return `<span class="px-1.5 py-px rounded bg-white/5 border border-white/5 text-[8px] text-gray-300 flex items-center gap-1 whitespace-nowrap">
        <div class="w-1 h-1 rounded-full ${colorClass}"></div>${firstName}
    </span>`;
}

export function updateWeekendTable() {}
export function switchSubTab() {}
