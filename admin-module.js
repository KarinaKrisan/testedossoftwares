// admin-module.js
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY, availableMonths, monthNames } from './config.js';
import { showNotification, updateCalendar, renderWeekendDuty } from './ui.js';
import { doc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let dailyUpdateInterval = null;
let activeTool = null; 

// --- EXPORTAÇÕES GLOBAIS ---
window.openPromoteModal = openPromoteModal;
window.confirmPromotion = confirmPromotion;
window.selectRole = selectRole;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.setEditTool = setEditTool;
window.askConfirmation = askConfirmation;

// --- INICIALIZAÇÃO ---
export function initAdminUI() {
    ['adminTabNav', 'adminControls', 'editToolbar'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    ['collabControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

    const btnSave = document.getElementById('btnSaveConfirm');
    if(btnSave) btnSave.onclick = confirmSaveToCloud;
    
    populateEmployeeSelect();
    renderEditToolbar(); 
    initApprovalsTab(); 
    renderInviteWidget(); 
    initMonthSelector(); // <--- CORREÇÃO: Inicializa o dropdown de mês
    
    // Inicia Dashboard
    switchAdminView('Daily');
    
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    dailyUpdateInterval = setInterval(() => { 
        const screen = document.getElementById('screenDaily');
        if (screen && !screen.classList.contains('hidden')) renderDailyDashboard(); 
    }, 60000);
}

export function switchAdminView(view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    ['Daily', 'Edit', 'Approvals', 'Logs'].forEach(s => {
        const screen = document.getElementById(`screen${s}`);
        if(screen) screen.classList.toggle('hidden', s.toLowerCase() !== view.toLowerCase());
        const btn = document.getElementById(`btnNav${s}`);
        if(btn) { 
            btn.classList.remove('active', 'bg-purple-600/20', 'text-purple-400'); 
            if(s.toLowerCase() === view.toLowerCase()) {
                btn.classList.add('active', 'bg-purple-600/20', 'text-purple-400'); 
            }
        }
    });
    
    if (view === 'Daily' || view === 'daily') renderDailyDashboard();
    if (view === 'Logs' || view === 'logs') renderAuditLogs();
    
    const tb = document.getElementById('editToolbar');
    if (view === 'Edit' || view === 'edit') { 
        if(tb) tb.classList.remove('hidden'); else renderEditToolbar(); 
        updateCalendar();
    } else { 
        if(tb) tb.classList.add('hidden'); 
    }
}

// --- DASHBOARD (Correção do Erro TypeError) ---
export function renderDailyDashboard() {
    const todayIndex = new Date().getDate() - 1; 
    const groups = { Ativo: [], Encerrado: [], Folga: [], Ferias: [], Afastado: [], Licenca: [] };
    
    if(state.scheduleData) {
        Object.values(state.scheduleData).forEach(emp => {
            const s = emp.schedule[todayIndex] || 'F';
            let g = 'Encerrado';
            if (s === 'T' || s === 'P' || s === 'MT' || s === 'N') g = 'Ativo'; 
            if (['F','FS','FD'].includes(s)) g = 'Folga';
            if (s === 'FE') g = 'Ferias';
            if (s === 'A') g = 'Afastado';
            if (s === 'LM') g = 'Licenca';
            if (groups[g]) groups[g].push({ ...emp, status: s });
        });
    }

    const renderGroup = (k, l) => {
        const count = document.getElementById(`count${k}`); 
        if(count) count.innerText = l.length;
        
        const list = document.getElementById(`list${k}`);
        if(list) {
            let color = 'bg-gray-600';
            if (k === 'Ativo') color = 'bg-emerald-500'; if (k === 'Folga') color = 'bg-yellow-500';
            if (k === 'Ferias') color = 'bg-red-500'; if (k === 'Afastado') color = 'bg-orange-500';
            if (k === 'Licenca') color = 'bg-pink-500'; if (k === 'Encerrado') color = 'bg-purple-500';
            
            list.innerHTML = l.map(u => `
                <div class="flex items-center justify-between bg-white/5 border border-white/5 rounded px-2 py-1 hover:bg-white/10 transition-colors group">
                    <div class="flex items-center gap-2 overflow-hidden">
                        <div class="w-1 h-3 rounded-full ${color}"></div>
                        <span class="text-[9px] font-medium text-gray-300 group-hover:text-white truncate">${u.name}</span>
                    </div>
                    <span class="text-[8px] font-mono text-white/30 ml-2">${u.status}</span>
                </div>`
            ).join('');
        }
    };
    Object.keys(groups).forEach(k => renderGroup(k, groups[k]));
}

// --- CORREÇÃO DO MENU "MÊS DE REFERÊNCIA" ---
function initMonthSelector() {
    const sel = document.getElementById('monthSelect');
    if (!sel) return;
    
    // Popula o select com os meses disponíveis no config.js
    sel.innerHTML = availableMonths.map(m => {
        const isSelected = m.year === state.selectedMonthObj.year && m.month === state.selectedMonthObj.month;
        return `<option value="${m.year}-${m.month}" ${isSelected ? 'selected' : ''}>
            ${monthNames[m.month]} ${m.year}
        </option>`;
    }).join('');

    // Ao mudar, atualiza o estado e recarrega os dados
    sel.onchange = (e) => {
        const [y, m] = e.target.value.split('-');
        state.selectedMonthObj = { year: parseInt(y), month: parseInt(m) };
        
        // Se a função loadData estiver exposta no window (pelo main.js), usa ela. Senão, recarrega a página.
        if (window.loadData) {
            window.loadData();
        } else {
            window.location.reload();
        }
    };
}

// --- CONVITES (SaaS) ---
export async function renderInviteWidget() {
    const container = document.getElementById('inviteWidgetContainer');
    if (!container) return;
    container.innerHTML = '<div class="text-[9px] text-gray-500 animate-pulse p-4">Carregando convites...</div>';

    try {
        const q = query(getCompanyCollection("convites"), where("active", "==", true));
        onSnapshot(q, (snap) => {
            const div = document.createElement('div');
            div.className = "premium-glass p-3 border-l-4 border-emerald-500 mb-4 animate-fade-in";

            if (!snap.empty) {
                const inviteCode = snap.docs[0].id;
                const inviteLink = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${inviteCode}&company=${state.companyId}`;
                div.innerHTML = `<h3 class="text-[10px] font-bold text-white uppercase mb-2 flex justify-between"><span><i class="fas fa-link text-emerald-400 mr-1"></i> Convite Ativo</span></h3><div class="flex gap-1 mb-2"><input type="text" value="${inviteLink}" id="inviteLinkInput" class="bg-black/30 border border-white/10 text-emerald-400 font-mono text-[9px] p-2 rounded w-full outline-none truncate" readonly><button id="btnCopyInvite" class="bg-white/10 hover:bg-white/20 text-white px-3 rounded text-[10px]"><i class="fas fa-copy"></i></button></div><button id="btnRevokeInvite" class="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-1.5 rounded text-[9px] font-bold uppercase transition-colors">Revogar Link</button>`;
                container.innerHTML = ''; container.appendChild(div);
                document.getElementById('btnCopyInvite').onclick = () => { navigator.clipboard.writeText(document.getElementById("inviteLinkInput").value); showNotification("Link copiado!", "success"); };
                document.getElementById('btnRevokeInvite').onclick = () => { askConfirmation("Revogar convite?", async () => { await updateDoc(getCompanyDoc("convites", inviteCode), { active: false }); showNotification("Revogado"); }); };
            } else {
                div.innerHTML = `<h3 class="text-[10px] font-bold text-white uppercase mb-1">Novo Colaborador</h3><button id="btnGenerateInvite" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded text-[9px] font-bold uppercase shadow-lg transition-all active:scale-95">Gerar Link</button>`;
                container.innerHTML = ''; container.appendChild(div);
                document.getElementById('btnGenerateInvite').onclick = async () => {
                    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                    try { await setDoc(getCompanyDoc("convites", code), { createdBy: state.currentUser.uid, createdAt: serverTimestamp(), active: true }); showNotification("Gerado!"); } catch (e) { showNotification("Erro", "error"); }
                };
            }
        });
    } catch(e) { container.innerHTML = ''; }
}

// --- EDIÇÃO E CARGOS ---
export function populateEmployeeSelect() {
    const s = document.getElementById('employeeSelect');
    if(s) { 
        s.innerHTML = '<option value="">Selecionar...</option>'; 
        Object.keys(state.scheduleData || {}).sort().forEach(n => {
            const user = state.scheduleData[n];
            if (user.level < 100) s.innerHTML += `<option value="${n}">${n}</option>`;
        }); 
    }
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
            showNotification("Salvo com sucesso");
            user.schedule = safeSchedule;
            renderDailyDashboard();
        } catch(e) { showNotification(e.message, "error"); }
    });
}

function renderEditToolbar() {
    const toolbar = document.getElementById('editToolbar');
    if(!toolbar) return;
    const tools = [
        { id: null, label: 'Auto', icon: 'fa-sync', color: 'text-gray-400', border: 'border-white/10' },
        { id: 'T', label: 'T', icon: 'fa-briefcase', color: 'text-emerald-400', border: 'border-emerald-500/50' },
        { id: 'F', label: 'F', icon: 'fa-coffee', color: 'text-amber-400', border: 'border-amber-500/50' },
        { id: 'FS', label: 'Sab', icon: 'fa-sun', color: 'text-[#40E0D0]', border: 'border-[#40E0D0]' },
        { id: 'FD', label: 'Dom', icon: 'fa-sun', color: 'text-[#4169E1]', border: 'border-[#4169E1]' },
        { id: 'FE', label: 'Fér', icon: 'fa-plane', color: 'text-red-400', border: 'border-red-500/50' }
    ];
    toolbar.innerHTML = tools.map(t => `<button onclick="window.setEditTool('${t.id}')" class="px-2.5 py-1.5 rounded-lg bg-white/5 border ${t.border} flex items-center gap-1.5 hover:bg-white/10 transition-all"><i class="fas ${t.icon} ${t.color} text-[9px]"></i><span class="text-[8px] font-bold text-white uppercase">${t.label}</span></button>`).join('');
}

function setEditTool(id) { activeTool = (id === 'null' || id === null) ? null : id; showNotification(activeTool ? `Ferramenta: ${activeTool}` : "Modo Automático"); }

export function handleAdminCellClick(name, i) {
    const user = state.scheduleData[name];
    if(!user) return;
    const seq = ['T', 'F', 'FS', 'FD', 'FE', 'A', 'LM'];
    const currentVal = user.schedule[i] || 'F';
    user.schedule[i] = activeTool !== null ? activeTool : seq[(seq.indexOf(currentVal) + 1) % seq.length];
    updateCalendar(name, user.schedule);
}

// --- HELPERS ---
function openPromoteModal() {
    const modal = document.getElementById('promoteModal');
    const userSelect = document.getElementById('promoteTargetUser');
    const roleContainer = document.getElementById('roleOptionsContainer');
    if(!userSelect || !modal) return;
    document.getElementById('selectedRoleKey').value = "";
    userSelect.innerHTML = '<option value="">Selecione...</option>';
    Object.values(state.scheduleData).sort((a,b)=>a.name.localeCompare(b.name)).forEach(user => {
        if (user.uid !== state.currentUser.uid) userSelect.innerHTML += `<option value="${user.uid}">${user.name} (${user.cargo || '-'})</option>`;
    });
    roleContainer.innerHTML = '';
    Object.entries(HIERARCHY).forEach(([key, config]) => {
        if (config.level <= 100) { 
            const btn = document.createElement('div');
            btn.className = `role-option cursor-pointer w-full p-2 mb-2 rounded border border-white/10 bg-white/5 flex items-center justify-between`;
            btn.onclick = (e) => window.selectRole(e, key);
            btn.innerHTML = `<span class="text-[10px] text-white font-bold">${config.label}</span><span class="text-[9px] text-gray-500">${config.level}</span>`;
            roleContainer.appendChild(btn);
        }
    });
    modal.classList.remove('hidden');
}

function selectRole(e, key) {
    document.querySelectorAll('.role-option').forEach(el => el.classList.remove('border-purple-500', 'bg-purple-500/10'));
    e.currentTarget.classList.add('border-purple-500', 'bg-purple-500/10');
    document.getElementById('selectedRoleKey').value = key;
}

async function confirmPromotion() {
    const targetUid = document.getElementById('promoteTargetUser').value;
    const roleKey = document.getElementById('selectedRoleKey').value;
    if (!targetUid || !roleKey) return showNotification("Preencha todos os campos", "error");
    const config = HIERARCHY[roleKey];
    const targetUser = Object.values(state.scheduleData).find(u => u.uid === targetUid);
    askConfirmation(`Promover ${targetUser.name} para ${config.label}?`, async () => {
        try {
            await updateDoc(getCompanyDoc("users", targetUid), { cargo: config.label, role: config.role, level: config.level, promotedBy: state.currentUser.email });
            document.getElementById('promoteModal').classList.add('hidden');
            showNotification("Cargo Atualizado");
            addAuditLog("Promoção", `${targetUser.name} -> ${config.label}`);
        } catch (e) { showNotification("Erro", "error"); }
    });
}

function renderAuditLogs() {
    const container = document.getElementById('screenLogs');
    const q = query(getCompanyCollection("logs_auditoria"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        if(!container) return;
        if(snap.empty) { container.innerHTML = '<p class="text-white/30 text-center text-xs mt-4">Sem logs.</p>'; return; }
        container.innerHTML = `<div class="premium-glass p-4 rounded-xl border border-white/5 h-[calc(100vh-140px)] flex flex-col mt-2"><h3 class="text-xs font-bold text-white mb-4">Auditoria</h3><div class="overflow-y-auto custom-scrollbar flex-1 space-y-2">${snap.docs.map(d => { const l = d.data(); const time = l.timestamp?.toDate().toLocaleString() || '--'; return `<div class="bg-white/5 p-2 rounded border border-white/5"><div class="flex justify-between"><span class="text-[9px] text-blue-300 font-bold">${l.action}</span><span class="text-[8px] text-gray-500">${time}</span></div><p class="text-[9px] text-gray-300">${l.target}</p><p class="text-[8px] text-gray-500">Por: ${l.adminEmail}</p></div>`; }).join('')}</div></div>`;
    });
}

async function addAuditLog(action, target) { try { await addDoc(getCompanyCollection("logs_auditoria"), { adminEmail: state.currentUser.email, action, target, timestamp: serverTimestamp() }); } catch(e){} }

function initApprovalsTab() {
    const list = document.getElementById('adminRequestsListSide');
    if(!list && !document.getElementById('approvalsList')) return;
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader"));
    onSnapshot(q, (snap) => {
        const targetDiv = document.getElementById('approvalsList') || list;
        if(!targetDiv) return;
        if(snap.empty) { targetDiv.innerHTML = '<p class="text-center text-gray-500 text-[10px]">Nada pendente.</p>'; } else {
            targetDiv.innerHTML = snap.docs.map(d => { const r = d.data(); return `<div class="bg-white/5 p-3 rounded-lg border-l-4 border-yellow-500 flex justify-between items-center mb-2"><div><strong class="text-white text-[10px] block">${r.requester}</strong><span class="text-[9px] text-gray-400">${r.type} • Dia ${r.dayIndex+1}</span></div><div class="flex gap-1"><button onclick="window.approveRequest('${d.id}')" class="bg-emerald-500/20 text-emerald-400 p-1.5 rounded"><i class="fas fa-check text-[10px]"></i></button><button onclick="window.rejectRequest('${d.id}')" class="bg-red-500/20 text-red-400 p-1.5 rounded"><i class="fas fa-times text-[10px]"></i></button></div></div>`; }).join('');
        }
    });
}

async function approveRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'approved' }); showNotification("Aprovado"); }
async function rejectRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'rejected' }); showNotification("Recusado"); }

function askConfirmation(msg, onConfirm) {
    const modal = document.getElementById('confirmModal') || document.getElementById('customConfirmModal');
    if(!modal) { if(confirm(msg)) onConfirm(); return; }
    document.getElementById('modalMessage').innerHTML = msg;
    modal.classList.remove('hidden');
    const btnConfirm = document.getElementById('modalConfirm');
    const newBtn = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);
    newBtn.onclick = () => { modal.classList.add('hidden'); onConfirm(); };
    document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden');
}
