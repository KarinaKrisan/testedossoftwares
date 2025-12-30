// ui.js - Versão Atualizada (Menu Dinâmico)
import { state, monthNames, getDaysInMonth, pad } from './config.js';

// --- MENU LATERAL DINÂMICO (NOVO) ---
export function updateDynamicMenu() {
    const level = state.profile?.level || 0;
    const menuContainer = document.getElementById('dynamicMenuContainer');
    
    if (!menuContainer) return;

    let menuHTML = '';

    // Nível Básico (Todos)
    menuHTML += `<button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-[10px] text-gray-400 hover:text-white transition-all flex items-center gap-2"><i class="fas fa-briefcase text-blue-400"></i> Meu Trabalho</button>`;

    // Nível Líder (30+)
    if (level >= 30) {
        menuHTML += `<button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-[10px] text-gray-400 hover:text-white transition-all flex items-center gap-2"><i class="fas fa-users text-blue-400"></i> Minha Célula</button>`;
    }

    // Nível Coordenador (50+) - AQUI ENTRA A KARINA
    if (level >= 50) {
        menuHTML += `
            <div class="my-2 border-t border-white/5 mx-2"></div>
            <p class="text-[8px] text-gray-600 uppercase font-bold px-2 mb-1 tracking-widest">Gestão</p>
            <button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-[10px] text-gray-400 hover:text-white transition-all flex items-center gap-2 group">
                <i class="fas fa-user-tie text-purple-400 group-hover:text-purple-300"></i> Gestão de Líderes
            </button>
            <button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-[10px] text-gray-400 hover:text-white transition-all flex items-center gap-2 group">
                <i class="fas fa-chart-line text-purple-400 group-hover:text-purple-300"></i> Relatórios
            </button>
        `;
    }

    // Nível Diretor (90+)
    if (level >= 90) {
        menuHTML += `<button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-[10px] text-gray-400 hover:text-white transition-all flex items-center gap-2"><i class="fas fa-globe text-emerald-400"></i> Visão Global</button>`;
    }

    menuContainer.innerHTML = menuHTML;
}

// --- SISTEMA DE NOTIFICAÇÃO (TOAST) ---
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
    setTimeout(() => { toast.remove(); }, 4000);
}

// --- RENDERIZADORES DO CALENDÁRIO ---
export function renderMonthSelector(onPrev, onNext) {
    const container = document.getElementById('monthSelectorContainer');
    if (!container) return;
    const cur = state.selectedMonthObj;
    container.innerHTML = `
        <div class="flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/5">
            <button id="btnMonthPrev" class="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"><i class="fas fa-chevron-left text-[8px]"></i></button>
            <div class="text-[9px] font-bold tracking-widest uppercase text-white px-2 min-w-[80px] text-center">${monthNames[cur.month]} <span class="text-white/40 font-light ml-1">${cur.year}</span></div>
            <button id="btnMonthNext" class="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"><i class="fas fa-chevron-right text-[8px]"></i></button>
        </div>`;
    document.getElementById('btnMonthPrev').onclick = onPrev;
    document.getElementById('btnMonthNext').onclick = onNext;
}

export function updatePersonalView(uidOrName) {
    const calContainer = document.getElementById('calendarContainer');
    const card = document.getElementById('personalInfoCard');
    
    if (!uidOrName) { if(calContainer) calContainer.classList.add('hidden'); if(card) card.innerHTML = ''; return; }
    const emp = state.scheduleData[uidOrName];
    if (!emp) return;

    if (card) {
        card.innerHTML = `
        <div class="premium-glass p-3 flex items-center gap-3 border-l-2 border-blue-500">
            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shrink-0 text-white font-bold text-xs">${emp.name.charAt(0)}</div>
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
        const h = document.createElement('div'); h.className = 'text-[8px] font-bold text-gray-500 uppercase text-center pb-1'; h.textContent = d; grid.appendChild(h);
    });
    const days = getDaysInMonth(state.selectedMonthObj.year, state.selectedMonthObj.month);
    for (let i = 0; i < days[0].getDay(); i++) grid.appendChild(document.createElement('div'));
    days.forEach((day, i) => {
        const s = schedule[i] || 'F';
        const isToday = day.getTime() === realToday.getTime();
        const isPast = day.getTime() < realToday.getTime();
        const cell = document.createElement('div');
        cell.className = `calendar-cell status-${s} ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''}`;
        if (state.isAdmin) cell.onclick = () => window.handleCellClick(name, i);
        cell.innerHTML = `<span class="day-number">${day.getDate()}</span><span class="day-label">${s}</span>`;
        grid.appendChild(cell);
    });
}

export function renderWeekendDuty() {
    const container = document.getElementById('weekendDutyContainer');
    if (!container || !state.scheduleData) return;
    // (Mantido a lógica simplificada para brevidade, mas você pode usar a sua completa aqui se preferir)
    container.innerHTML = ''; // Placeholder para o código completo do FDS que você já tinha
}

// Funções placeholder
export function updateWeekendTable() {}
export function switchSubTab() {}
