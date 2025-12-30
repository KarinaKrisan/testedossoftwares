// admin-module.js
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY } from './config.js';
import { showNotification, updateCalendar, renderWeekendDuty } from './ui.js';
import { doc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc, collection } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let allLoadedLogs = [];
let dailyUpdateInterval = null;
let activeTool = null; 

export function switchAdminView(view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    ['Daily', 'Edit', 'Approvals', 'Logs'].forEach(s => {
        const screen = document.getElementById(`screen${s}`);
        if(screen) screen.classList.toggle('hidden', s.toLowerCase() !== view.toLowerCase());
        const btn = document.getElementById(`btnNav${s}`);
        if(btn) { 
            btn.classList.remove('active'); 
            if(s.toLowerCase() === view.toLowerCase()) btn.classList.add('active'); 
        }
    });
    if (view === 'daily') renderDailyDashboard();
    if (view === 'logs') renderAuditLogs();
    const tb = document.getElementById('editToolbar');
    if (view === 'edit') { if(tb) tb.classList.remove('hidden'); else renderEditToolbar(); } else { if(tb) tb.classList.add('hidden'); }
}

export function initAdminUI() {
    ['adminTabNav', 'adminControls'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    const btnSave = document.getElementById('btnSaveConfirm');
    if(btnSave) btnSave.onclick = confirmSaveToCloud;
    populateEmployeeSelect();
    internalApplyLogFilter(); 
    renderEditToolbar(); 
    initApprovalsTab(); 
    renderInviteWidget(); 
    renderMigrationTool(); 
    switchAdminView('daily');
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    dailyUpdateInterval = setInterval(() => { 
        const screen = document.getElementById('screenDaily');
        if (screen && !screen.classList.contains('hidden')) renderDailyDashboard(); 
    }, 60000);
}

function renderMigrationTool() {
    const container = document.getElementById('adminControls');
    if (document.getElementById('migrationBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'migrationBtn';
    btn.className = "w-full mt-4 bg-orange-600/20 border border-orange-500/50 text-orange-400 font-bold py-2.5 rounded-lg text-[10px] uppercase tracking-widest hover:bg-orange-600 hover:text-white transition-all";
    btn.innerHTML = '<i class="fas fa-database mr-2"></i> Reparar/Migrar Dados Antigos';
    btn.onclick = () => { askConfirmation("Isso copiará os dados de 'colaboradores' para 'users'. Continuar?", window.runLegacyMigration); };
    container.appendChild(btn);
}

window.runLegacyMigration = async () => {
    try {
        showNotification("Iniciando migração...", "info");
        const oldCollabsSnap = await getDocs(getCompanyCollection("colaboradores"));
        let count = 0;
        for (const d of oldCollabsSnap.docs) {
            const data = d.data();
            await setDoc(getCompanyDoc("users", d.id), {
                name: data.nome || data.name, email: data.email, role: 'collaborator', level: 10,
                cargo: data.cargo || 'Colaborador', setorID: data.setorID || 'NOC',
                horario: data.horario || '08:00 às 17:00', active: true, migratedAt: serverTimestamp()
            }, { merge: true });
            count++;
        }
        showSuccessAnim(`${count} Perfis Recuperados`);
        setTimeout(() => location.reload(), 2000);
    } catch(e) { console.error(e); showNotification("Erro: " + e.message, "error"); }
};

export function renderDailyDashboard() {
    const todayIndex = new Date().getDate() - 1; 
    const groups = { Ativo: [], Encerrado: [], Folga: [], Ferias: [], Afastado: [], Licenca: [] };
    
    if(state.scheduleData) {
        Object.values(state.scheduleData).forEach(emp => {
            const s = emp.schedule[todayIndex] || 'F';
            let g = 'Encerrado';
            if (s === 'T') g = 'Ativo'; 
            if (['F','FS','FD'].includes(s)) g = 'Folga';
            if (s === 'FE') g = 'Ferias';
            if (s === 'A') g = 'Afastado';
            if (s === 'LM') g = 'Licenca';
            if (groups[g]) groups[g].push({ ...emp, status: s });
        });
    }

    const render = (k, l) => {
        const count = document.getElementById(`count${k}`); 
        if(count) count.innerText = l.length;
        const list = document.getElementById(`list${k}`);
        if(list) {
            let color = 'bg-gray-600';
            if (k === 'Ativo') color = 'bg-emerald-500';
            if (k === 'Folga') color = 'bg-yellow-500';
            if (k === 'Ferias') color = 'bg-red-500';
            if (k === 'Afastado') color = 'bg-orange-500';
            if (k === 'Licenca') color = 'bg-pink-500';
            if (k === 'Encerrado') color = 'bg-purple-500';

            list.innerHTML = l.map(u => `<div class="flex items-center justify-between bg-white/5 border border-white/5 rounded px-2 py-1 hover:bg-white/10 transition-colors group"><div class="flex items-center gap-2 overflow-hidden"><div class="w-1 h-3 rounded-full ${color}"></div><span class="text-[9px] font-medium text-gray-300 group-hover:text-white truncate">${u.name}</span></div><span class="text-[8px] font-mono text-white/30 ml-2">${u.status}</span></div>`).join('');
        }
    };
    Object.keys(groups).forEach(k => render(k, groups[k]));
}

async function confirmSaveToCloud() {
    const emp = document.getElementById('employeeSelect').value;
    if (!emp) return showNotification("Selecione um colaborador", "error");
    askConfirmation(`Salvar escala de ${emp}?`, async () => {
        try {
            const user = state.scheduleData[emp];
            const safeSchedule = user.schedule.map(v => (v===undefined||v===null||v==="")?"F":v);
            const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
            await setDoc(getCompanySubDoc("escalas", docId, "plantonistas", user.uid), { calculatedSchedule: safeSchedule }, { merge: true });
            await addAuditLog("Edição de Escala", emp);
            showSuccessAnim("Salvo");
            user.schedule = safeSchedule;
            renderDailyDashboard();
        } catch(e) { showNotification(e.message, "error"); }
    });
}

// --- FUNÇÃO DE LOGS (Reforçada) ---
function renderAuditLogs() {
    const container = document.getElementById('screenLogs');
    if(!container) return;
    if(allLoadedLogs.length === 0) {
        container.innerHTML = `<div class="premium-glass p-8 text-center rounded-xl border border-white/5"><i class="fas fa-history text-4xl text-white/20 mb-3"></i><p class="text-gray-500 text-xs uppercase tracking-widest">Nenhum registro</p></div>`;
        return;
    }
    let html = `<div class="premium-glass p-4 rounded-xl border border-white/5 h-[calc(100vh-140px)] flex flex-col"><div class="flex justify-between items-center mb-4"><h3 class="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2"><i class="fas fa-fingerprint text-blue-400"></i> Auditoria</h3><span class="text-[9px] text-gray-500 bg-white/5 px-2 py-1 rounded">${allLoadedLogs.length}</span></div><div class="overflow-y-auto custom-scrollbar flex-1 space-y-2">`;
    html += allLoadedLogs.map(log => `
        <div class="bg-white/5 p-3 rounded-lg border border-white/5 hover:bg-white/10 transition-all">
            <div class="flex justify-between items-start"><div class="flex items-center gap-2 mb-1"><span class="text-[8px] font-bold text-blue-300 bg-blue-500/10 px-1.5 rounded uppercase">${log.action}</span><span class="text-[8px] text-gray-500 font-mono">${log.date}</span></div><div class="text-right"><span class="text-[8px] text-emerald-400 font-mono">${log.admin.split('@')[0]}</span></div></div>
            <div class="mt-1 pl-1 border-l-2 border-white/10 ml-0.5"><div class="text-[9px] text-gray-300 pl-2"><strong class="text-white">${log.target}</strong></div></div>
        </div>`).join('');
    html += `</div></div>`;
    container.innerHTML = html;
}

// --- FUNÇÃO DE APROVAÇÕES (TROCAS) ---
function initApprovalsTab() {
    // CORREÇÃO: Garante que estamos pegando a lista correta
    const list = document.getElementById('adminRequestsListSide');
    if(!list) return;
    
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    // Query para status 'pending_leader'
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader"));
    
    onSnapshot(q, (snap) => {
        if(snap.empty) {
            list.innerHTML = '<p class="text-center text-gray-500 text-[10px] italic py-4">Nenhuma solicitação pendente.</p>';
        } else {
            list.innerHTML = snap.docs.map(d => {
                const r = d.data();
                return `
                <div class="bg-white/5 p-3 rounded-lg border-l-4 border-yellow-500 flex justify-between items-center">
                    <div>
                        <strong class="text-white text-[10px] block">${r.requester}</strong>
                        <span class="text-[9px] text-gray-400">${r.type.replace('_',' ')} • Dia ${r.dayIndex+1}</span>
                    </div>
                    <div class="flex gap-1">
                         <button onclick="window.approveRequest('${d.id}')" class="bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 p-1.5 rounded"><i class="fas fa-check text-[10px]"></i></button>
                         <button onclick="window.rejectRequest('${d.id}')" class="bg-red-500/20 hover:bg-red-500/40 text-red-400 p-1.5 rounded"><i class="fas fa-times text-[10px]"></i></button>
                    </div>
                </div>`;
            }).join('');
        }
    });
}

window.approveRequest = async (id) => {
    // Implementar lógica de aprovação (atualizar status e mudar escala)
    try {
        await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'approved' });
        showNotification("Solicitação Aprovada", "success");
        // Aqui você adicionaria a lógica para alterar a escala real do funcionário
    } catch(e) { showNotification("Erro ao aprovar", "error"); }
};

window.rejectRequest = async (id) => {
    try {
        await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'rejected' });
        showNotification("Solicitação Recusada", "success");
    } catch(e) { showNotification("Erro ao recusar", "error"); }
};

// ... Resto das funções auxiliares ...
function askConfirmation(message, onConfirm) { /* ... */ }
function showSuccessAnim(text) { /* ... */ }
async function renderInviteWidget() { /* ... */ }
async function internalApplyLogFilter() {
    const q = query(getCompanyCollection("logs_auditoria"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        allLoadedLogs = snap.docs.map(d => ({ date: d.data().timestamp?.toDate().toLocaleString()||'-', admin: d.data().adminEmail||'Sys', action: d.data().action||'-', target: d.data().target||'-' }));
        const logsScreen = document.getElementById('screenLogs');
        if (logsScreen && !logsScreen.classList.contains('hidden')) renderAuditLogs();
    });
}
async function addAuditLog(action, target) { /* ... */ }

// Exportações
window.openPromoteModal = () => { /* ... */ };
window.selectRole = (e, key) => { /* ... */ };
window.confirmPromotion = async () => { /* ... */ };
window.setEditTool = (id) => { activeTool = (id === 'null' || id === null) ? null : id; };

export function populateEmployeeSelect() { /* ... */ }
function renderEditToolbar() { /* ... */ }
export function handleAdminCellClick(name, i) { /* ... */ }
