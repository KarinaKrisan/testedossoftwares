// admin-module.js
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY } from './config.js';
import { showNotification, updateCalendar, renderWeekendDuty } from './ui.js';
import { doc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc, collection } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let allLoadedLogs = [];
let dailyUpdateInterval = null;
let activeTool = null; 

// --- EXPORTAR FUNÇÕES GLOBAIS (ESSENCIAL PARA OS BOTÕES FUNCIONAREM) ---
window.openPromoteModal = openPromoteModal;
window.confirmPromotion = confirmPromotion;
window.selectRole = selectRole;
window.runLegacyMigration = runLegacyMigration;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.setEditTool = setEditTool;

export function switchAdminView(view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    ['Daily', 'Edit', 'Approvals', 'Logs'].forEach(s => {
        const screen = document.getElementById(`screen${s}`);
        if(screen) screen.classList.toggle('hidden', s.toLowerCase() !== view.toLowerCase());
        const btn = document.getElementById(`btnNav${s}`);
        if(btn) { btn.classList.remove('active'); if(s.toLowerCase() === view.toLowerCase()) btn.classList.add('active'); }
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
    renderMigrationTool(); // Botão de Migração
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
    btn.onclick = () => { askConfirmation("Copiar dados de 'colaboradores' para 'users'?", runLegacyMigration); };
    container.appendChild(btn);
}

async function runLegacyMigration() {
    try {
        showNotification("Iniciando...", "info");
        const oldCollabsSnap = await getDocs(getCompanyCollection("colaboradores"));
        let count = 0;
        for (const d of oldCollabsSnap.docs) {
            const data = d.data();
            await setDoc(getCompanyDoc("users", d.id), {
                name: data.nome || data.name, email: data.email, role: 'collaborator', level: 10,
                cargo: data.cargo || 'Colaborador', setorID: data.setorID || 'NOC', horario: data.horario || '08:00 às 17:00',
                active: true, migratedAt: serverTimestamp()
            }, { merge: true });
            count++;
        }
        showSuccessAnim(`${count} Recuperados`);
        setTimeout(() => location.reload(), 2000);
    } catch(e) { showNotification(e.message, "error"); }
}

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
        const count = document.getElementById(`count${k}`); if(count) count.innerText = l.length;
        const list = document.getElementById(`list${k}`);
        if(list) {
            let color = 'bg-gray-600';
            if (k === 'Ativo') color = 'bg-emerald-500'; if (k === 'Folga') color = 'bg-yellow-500';
            if (k === 'Ferias') color = 'bg-red-500'; if (k === 'Afastado') color = 'bg-orange-500';
            if (k === 'Licenca') color = 'bg-pink-500'; if (k === 'Encerrado') color = 'bg-purple-500';
            list.innerHTML = l.map(u => `<div class="flex items-center justify-between bg-white/5 border border-white/5 rounded px-2 py-1 hover:bg-white/10 transition-colors group"><div class="flex items-center gap-2 overflow-hidden"><div class="w-1 h-3 rounded-full ${color}"></div><span class="text-[9px] font-medium text-gray-300 group-hover:text-white truncate">${u.name}</span></div><span class="text-[8px] font-mono text-white/30 ml-2">${u.status}</span></div>`).join('');
        }
    };
    Object.keys(groups).forEach(k => render(k, groups[k]));
}

function openPromoteModal() {
    const modal = document.getElementById('promoteModal');
    const userSelect = document.getElementById('promoteTargetUser');
    const roleContainer = document.getElementById('roleOptionsContainer');
    userSelect.innerHTML = '<option value="">Selecione...</option>';
    Object.values(state.scheduleData).sort((a,b)=>a.name.localeCompare(b.name)).forEach(user => {
        if (user.uid !== state.currentUser.uid && user.level < 100) {
            userSelect.innerHTML += `<option value="${user.uid}">${user.name} (${user.cargo || 'S/ Cargo'})</option>`;
        }
    });
    roleContainer.innerHTML = '';
    Object.entries(HIERARCHY).forEach(([key, config]) => {
        if (config.level < 100) {
            const btn = document.createElement('button');
            btn.className = `role-select-btn w-full text-left p-2.5 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 transition-all flex justify-between items-center group`;
            btn.onclick = (e) => selectRole(e, key);
            btn.innerHTML = `<div class="flex items-center gap-3"><div class="w-8 h-8 rounded-lg bg-black/30 flex items-center justify-center text-xs font-bold text-gray-400 group-hover:text-white border border-white/5">${config.level}</div><div><div class="text-[10px] font-bold text-gray-300 group-hover:text-white uppercase tracking-wider">${config.label}</div></div></div><div class="w-3 h-3 rounded-full border border-white/20 check-indicator"></div>`;
            roleContainer.appendChild(btn);
        }
    });
    modal.classList.remove('hidden');
}

function selectRole(e, key) {
    document.querySelectorAll('.role-select-btn').forEach(b => { b.classList.remove('border-purple-500', 'bg-purple-500/10'); b.querySelector('.check-indicator').classList.remove('bg-purple-500', 'border-purple-500'); });
    e.currentTarget.classList.add('border-purple-500', 'bg-purple-500/10');
    e.currentTarget.querySelector('.check-indicator').classList.add('bg-purple-500', 'border-purple-500');
    document.getElementById('selectedRoleKey').value = key;
}

async function confirmPromotion() {
    const targetUid = document.getElementById('promoteTargetUser').value;
    const roleKey = document.getElementById('selectedRoleKey').value;
    if (!targetUid || !roleKey) return showNotification("Preencha todos os campos.", "error");
    const config = HIERARCHY[roleKey];
    const targetUser = Object.values(state.scheduleData).find(u => u.uid === targetUid);
    askConfirmation(`Promover <strong class="text-white">${targetUser.name}</strong> para <strong class="text-purple-400">${config.label}</strong>?`, async () => {
        try {
            await updateDoc(getCompanyDoc("users", targetUid), {
                cargo: config.label, role: config.role, level: config.level,
                updatedAt: serverTimestamp(), promotedBy: state.currentUser.email
            });
            document.getElementById('promoteModal').classList.add('hidden');
            showSuccessAnim("Atualizado");
            addAuditLog("Promoção", `${targetUser.name} -> ${config.label}`);
        } catch (e) { showNotification(e.message, "error"); }
    });
}

function initApprovalsTab() {
    const list = document.getElementById('adminRequestsListSide');
    if(!list) return;
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader"));
    onSnapshot(q, (snap) => {
        if(snap.empty) { list.innerHTML = '<p class="text-center text-gray-500 text-[10px]">Nada pendente.</p>'; } else {
            list.innerHTML = snap.docs.map(d => {
                const r = d.data();
                return `<div class="bg-white/5 p-3 rounded-lg border-l-4 border-yellow-500 flex justify-between items-center"><div><strong class="text-white text-[10px] block">${r.requester}</strong><span class="text-[9px] text-gray-400">${r.type} • Dia ${r.dayIndex+1}</span></div><div class="flex gap-1"><button onclick="window.approveRequest('${d.id}')" class="bg-emerald-500/20 text-emerald-400 p-1.5 rounded"><i class="fas fa-check text-[10px]"></i></button><button onclick="window.rejectRequest('${d.id}')" class="bg-red-500/20 text-red-400 p-1.5 rounded"><i class="fas fa-times text-[10px]"></i></button></div></div>`;
            }).join('');
        }
    });
}

async function approveRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'approved' }); showNotification("Aprovado"); }
async function rejectRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'rejected' }); showNotification("Recusado"); }

// Utilitários de UI e Logs
async function internalApplyLogFilter() {
    const q = query(getCompanyCollection("logs_auditoria"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        allLoadedLogs = snap.docs.map(d => ({ date: d.data().timestamp?.toDate().toLocaleString()||'-', admin: d.data().adminEmail||'Sys', action: d.data().action||'-', target: d.data().target||'-' }));
        const logsScreen = document.getElementById('screenLogs');
        if (logsScreen && !logsScreen.classList.contains('hidden')) renderAuditLogs();
    });
}
function renderAuditLogs() { /* ... mesmo código renderHTML ... */ } 
async function addAuditLog(action, target) { if(!state.currentUser) return; try { await addDoc(getCompanyCollection("logs_auditoria"), { adminEmail: state.currentUser.email, action, target, timestamp: serverTimestamp() }); } catch(e) {} }
async function confirmSaveToCloud() { /* ... mesmo código ... */ }
function renderEditToolbar() { /* ... mesmo código ... */ }
function setEditTool(id) { activeTool = (id === 'null' || id === null) ? null : id; }
function handleAdminCellClick(name, i) { /* ... mesmo código ... */ }
export function populateEmployeeSelect() { /* ... mesmo código ... */ }
function askConfirmation(message, onConfirm) { /* ... mesmo código ... */ }
function showSuccessAnim(text) { /* ... mesmo código ... */ }
async function renderInviteWidget() { /* ... mesmo código ... */ }
