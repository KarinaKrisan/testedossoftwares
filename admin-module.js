// admin-module.js
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY } from './config.js';
import { showNotification, updateCalendar } from './ui.js';
import { doc, getDoc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let allLoadedLogs = [];
let dailyUpdateInterval = null;
let activeTool = null; 

// --- EXPORTAÇÕES GLOBAIS ---
window.openPromoteModal = openPromoteModal;
window.confirmPromotion = confirmPromotion;
window.selectRole = selectRole;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.setEditTool = setEditTool;
window.renderInviteWidget = renderInviteWidget;

// --- INICIALIZAÇÃO E NAVEGAÇÃO ---
export function switchAdminView(view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    ['Daily', 'Edit', 'Approvals', 'Logs'].forEach(s => {
        const screen = document.getElementById(`screen${s}`);
        if(screen) screen.classList.toggle('hidden', s.toLowerCase() !== view.toLowerCase());
        const btn = document.getElementById(`btnNav${s}`);
        if(btn) { 
            // Reset visual dos botões
            btn.classList.remove('bg-white/10', 'text-white');
            btn.classList.add('text-gray-400');
            
            if(s.toLowerCase() === view.toLowerCase()) {
                btn.classList.add('bg-white/10', 'text-white');
                btn.classList.remove('text-gray-400');
            } 
        }
    });
    
    if (view === 'daily') renderDailyDashboard();
    if (view === 'logs') internalApplyLogFilter();
    
    const tb = document.getElementById('editToolbar');
    if (view === 'edit') { 
        if(tb) tb.classList.remove('hidden'); else renderEditToolbar(); 
    } else { 
        if(tb) tb.classList.add('hidden'); 
    }
}

export function initAdminUI() {
    ['adminTabNav', 'adminControls'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    const btnSave = document.getElementById('btnSaveConfirm');
    if(btnSave) btnSave.onclick = confirmSaveToCloud;
    
    // --- CONTROLE DE ACESSO: GERIR CARGOS ---
    const btnRoles = document.getElementById('btnManageRoles');
    if (btnRoles) {
        const myLevel = state.profile?.level || 0;
        if (myLevel >= 60) {
            btnRoles.classList.remove('hidden'); 
        } else {
            btnRoles.classList.add('hidden');
        }
    }

    populateEmployeeSelect();
    renderEditToolbar(); 
    initApprovalsTab(); 
    renderInviteWidget(); 
    // MIGRATION TOOL REMOVIDA
    internalApplyLogFilter();
    switchAdminView('daily');
    
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    dailyUpdateInterval = setInterval(() => { 
        const screen = document.getElementById('screenDaily');
        if (screen && !screen.classList.contains('hidden')) renderDailyDashboard(); 
    }, 60000);
}

// --- DASHBOARD: LÓGICA DE TURNOS E VISUAL NOVO ---
export function renderDailyDashboard() {
    const now = new Date();
    const currentHour = now.getHours();
    const todayIndex = now.getDate() - 1; 

    const groups = { Ativo: [], Encerrado: [], Folga: [], Ferias: [], Afastado: [], Licenca: [] };

    if(state.scheduleData) {
        Object.values(state.scheduleData).forEach(emp => {
            const sToday = emp.schedule[todayIndex] || 'F';
            const sYesterday = (todayIndex > 0) ? (emp.schedule[todayIndex - 1] || 'F') : 'F';

            let g = 'Encerrado'; 

            // Identificação Noturno (19h - 07h)
            const h = emp.horario ? emp.horario.toLowerCase() : "";
            const isNightShift = h.includes("19:00 às 07:00") || h.includes("noite") || h.includes("noturno") || h.startsWith("19");

            if (isNightShift) {
                if (sToday === 'T') {
                    g = (currentHour >= 19) ? 'Ativo' : 'Encerrado';
                } 
                else if (sToday === 'F' && sYesterday === 'T' && currentHour < 7) {
                    g = 'Ativo';
                }
                else if (['F','FS','FD'].includes(sToday)) g = 'Folga';
                else if (sToday === 'FE') g = 'Ferias';
                else if (sToday === 'A') g = 'Afastado';
                else if (sToday === 'LM') g = 'Licenca';

            } else {
                // Diurno (07h - 19h)
                if (sToday === 'T') {
                    g = (currentHour >= 19) ? 'Encerrado' : 'Ativo';
                } 
                else if (['F','FS','FD'].includes(sToday)) g = 'Folga';
                else if (sToday === 'FE') g = 'Ferias';
                else if (sToday === 'A') g = 'Afastado';
                else if (sToday === 'LM') g = 'Licenca';
            }

            if (groups[g]) groups[g].push({ ...emp, status: sToday });
        });
    }

    // Configuração Visual dos Cards
    const meta = {
        Ativo: { label: 'Em Turno', color: 'emerald', icon: 'fa-bolt' },
        Encerrado: { label: 'Off / Descanso', color: 'zinc', icon: 'fa-bed' }, // Zinc usa classes gray no Tailwind padrão se zinc não existir, ajustado abaixo
        Folga: { label: 'Folga', color: 'yellow', icon: 'fa-coffee' },
        Ferias: { label: 'Férias', color: 'red', icon: 'fa-plane' },
        Afastado: { label: 'Afastado', color: 'orange', icon: 'fa-user-injured' },
        Licenca: { label: 'Licença', color: 'pink', icon: 'fa-baby' }
    };

    Object.keys(groups).forEach(k => {
        const container = document.getElementById(`card${k}`);
        if (!container) return; // Se o HTML novo não tiver ID cardAtivo, isso previne erro

        const info = meta[k];
        const count = groups[k].length;
        
        // Ajuste de cor para "zinc" -> "gray" se necessário
        const colorName = info.color === 'zinc' ? 'gray' : info.color;

        let html = `
            <div class="flex justify-between items-center mb-3 pb-2 border-b border-white/5">
                <div class="flex items-center gap-2 text-${colorName}-400">
                    <div class="w-6 h-6 rounded-md bg-${colorName}-500/10 flex items-center justify-center border border-${colorName}-500/20">
                        <i class="fas ${info.icon} text-[10px]"></i>
                    </div>
                    <span class="text-[10px] font-bold uppercase tracking-widest">${info.label}</span>
                </div>
                <span class="text-xs font-mono font-bold text-white bg-white/10 px-2 py-0.5 rounded-md">${count}</span>
            </div>
            <div class="flex-1 overflow-y-auto custom-scrollbar space-y-1 pr-1">
        `;

        if (count === 0) {
            html += `<div class="h-full flex flex-col items-center justify-center text-white/20">
                <i class="fas fa-ghost text-2xl mb-2 opacity-50"></i>
                <span class="text-[9px] uppercase tracking-wider font-medium">Vazio</span>
            </div>`;
        } else {
            html += groups[k].map(u => `
                <div class="group flex items-center justify-between p-2 rounded-xl hover:bg-white/5 transition-all border border-transparent hover:border-white/5">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center text-[10px] font-bold text-gray-300 border border-white/10 shadow-sm group-hover:scale-110 transition-transform shrink-0">
                            ${u.name.charAt(0)}
                        </div>
                        <div class="flex flex-col min-w-0">
                            <span class="text-[11px] font-medium text-gray-200 leading-tight truncate max-w-[100px]">${u.name.split(' ')[0]} ${u.name.split(' ')[1]?u.name.split(' ')[1][0]+'.':''}</span>
                            <span class="text-[9px] text-gray-500 font-mono truncate">${u.cargo || 'Colaborador'}</span>
                        </div>
                    </div>
                    <div class="text-[9px] font-mono text-${colorName}-400 bg-${colorName}-500/5 px-1.5 py-0.5 rounded border border-${colorName}-500/10 shrink-0">
                        ${u.horario ? u.horario.split(' ')[0] : '08:00'}
                    </div>
                </div>
            `).join('');
        }
        
        html += `</div>`;
        
        // Tenta injetar no novo ID (cardAtivo), se não existir tenta no antigo (listAtivo)
        if(container) container.innerHTML = html;
    });
    
    // Fallback para manter compatibilidade se o HTML não tiver sido atualizado completamente
    // Atualiza contadores antigos se existirem
    Object.keys(groups).forEach(k => {
        const c = document.getElementById(`count${k}`);
        if(c) c.innerText = groups[k].length;
    });
}

// --- WIDGET DE CONVITES (VISUAL NOVO) ---
async function renderInviteWidget() {
    const container = document.getElementById('inviteWidgetContainer');
    if (!container) return; 
    
    container.innerHTML = `<div class="p-4 rounded-xl border border-white/5 bg-white/5 animate-pulse flex justify-center"><i class="fas fa-circle-notch fa-spin text-gray-500"></i></div>`;

    try {
        const q = query(getCompanyCollection("convites"), where("active", "==", true));
        const snap = await getDocs(q);

        if (!snap.empty) {
            const code = snap.docs[0].id;
            const link = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${code}&company=${state.companyId}`;
            
            container.innerHTML = `
                <div class="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 relative overflow-hidden group">
                    <div class="absolute -right-4 -top-4 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl group-hover:bg-emerald-500/20 transition-all"></div>
                    <div class="flex justify-between items-center mb-3 relative z-10">
                        <h3 class="text-[10px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Link Ativo
                        </h3>
                    </div>
                    <div class="flex gap-2 mb-2 relative z-10">
                        <input type="text" value="${link}" id="inviteLinkInput" class="w-full bg-black/50 border border-emerald-500/20 text-emerald-100 font-mono text-[9px] p-2.5 rounded-lg outline-none" readonly>
                        <button id="btnCopyInvite" class="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 px-3 rounded-lg transition-all"><i class="fas fa-copy"></i></button>
                    </div>
                    <button id="btnRevokeInvite" class="w-full py-1.5 text-[9px] text-red-400 hover:text-red-300 font-medium hover:underline text-left">Revogar este link</button>
                </div>`;
                
            document.getElementById('btnCopyInvite').onclick = () => { const input = document.getElementById("inviteLinkInput"); input.select(); input.setSelectionRange(0, 99999); navigator.clipboard.writeText(input.value); showNotification("Link copiado!", "success"); };
            document.getElementById('btnRevokeInvite').onclick = () => { askConfirmation("Revogar este convite?", async () => { await updateDoc(getCompanyDoc("convites", code), { active: false }); showNotification("Convite revogado.", "success"); renderInviteWidget(); }); };
        } else {
            container.innerHTML = `
                <div class="p-4 rounded-2xl border border-dashed border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-center group cursor-pointer" id="btnGenerateInvite">
                    <div class="w-10 h-10 mx-auto rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 mb-2 group-hover:scale-110 transition-transform">
                        <i class="fas fa-plus text-xs"></i>
                    </div>
                    <h3 class="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-1">Novo Membro</h3>
                    <p class="text-[9px] text-gray-500">Gerar link de convite</p>
                </div>`;
            document.getElementById('btnGenerateInvite').onclick = async () => {
                const btn = document.getElementById('btnGenerateInvite'); btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-blue-400"></i>'; btn.style.pointerEvents = 'none';
                try {
                    const companySnap = await getDoc(doc(db, "companies", state.companyId));
                    const companyName = companySnap.exists() ? (companySnap.data().name || companySnap.data().nome || "Sua Empresa") : "Sua Empresa";
                    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                    await setDoc(getCompanyDoc("convites", code), { createdBy: state.currentUser.uid, createdAt: serverTimestamp(), active: true, companyName: companyName, companyId: state.companyId });
                    showNotification("Link gerado!", "success"); renderInviteWidget();
                } catch (error) { showNotification("Erro ao gerar.", "error"); renderInviteWidget(); }
            };
        }
    } catch (e) { console.error("Erro no widget:", e); }
}

// --- GESTÃO DE CARGOS ---
function openPromoteModal() {
    const modal = document.getElementById('promoteModal');
    const userSelect = document.getElementById('promoteTargetUser');
    const roleContainer = document.getElementById('roleOptionsContainer');
    document.getElementById('selectedRoleKey').value = ""; userSelect.innerHTML = '<option value="">Selecione...</option>';
    if(state.scheduleData) { Object.values(state.scheduleData).sort((a,b)=>a.name.localeCompare(b.name)).forEach(user => { if (user.uid !== state.currentUser.uid) { userSelect.innerHTML += `<option value="${user.uid}">${user.name} (${user.cargo || 'S/ Cargo'})</option>`; } }); }
    roleContainer.innerHTML = '';
    Object.entries(HIERARCHY).forEach(([key, config]) => {
        if (config.level <= 100) { 
            const btn = document.createElement('div'); btn.className = `role-option cursor-pointer w-full p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex items-center justify-between group`;
            btn.onclick = (e) => window.selectRole(e, key);
            btn.innerHTML = `<div class="flex items-center gap-3"><div class="w-10 h-10 rounded-lg bg-black/40 flex items-center justify-center text-sm font-bold text-gray-400 group-hover:text-white border border-white/5 transition-colors">${config.level}</div><div><div class="text-[11px] font-bold text-gray-200 group-hover:text-white uppercase tracking-wider">${config.label}</div><div class="text-[9px] text-gray-500 group-hover:text-gray-400 font-mono">${config.role}</div></div></div><div class="w-4 h-4 rounded-full border-2 border-white/20 flex items-center justify-center role-check-circle transition-colors"><div class="w-2 h-2 rounded-full bg-transparent role-check-dot transition-colors"></div></div>`;
            roleContainer.appendChild(btn);
        }
    });
    modal.classList.remove('hidden');
}

function selectRole(e, key) {
    document.querySelectorAll('.role-option').forEach(el => { el.classList.remove('border-purple-500', 'bg-purple-500/10'); el.querySelector('.role-check-circle').classList.remove('border-purple-500'); el.querySelector('.role-check-dot').classList.remove('bg-purple-500'); });
    const selectedDiv = e.currentTarget; selectedDiv.classList.add('border-purple-500', 'bg-purple-500/10'); selectedDiv.querySelector('.role-check-circle').classList.add('border-purple-500'); selectedDiv.querySelector('.role-check-dot').classList.add('bg-purple-500');
    document.getElementById('selectedRoleKey').value = key;
}

async function confirmPromotion() {
    const targetUid = document.getElementById('promoteTargetUser').value; const roleKey = document.getElementById('selectedRoleKey').value;
    if (!targetUid || !roleKey) return showNotification("Selecione colaborador e cargo.", "error");
    const config = HIERARCHY[roleKey]; const targetUser = Object.values(state.scheduleData).find(u => u.uid === targetUid);
    askConfirmation(`Promover ${targetUser.name} para ${config.label}?`, async () => {
        try { await updateDoc(getCompanyDoc("users", targetUid), { cargo: config.label, role: config.role, level: config.level, updatedAt: serverTimestamp(), _claimsRefresh: Date.now(), promotedBy: state.currentUser.email });
        document.getElementById('promoteModal').classList.add('hidden'); showNotification("Cargo Atualizado"); await addAuditLog("Gestão de Equipe", `Alterou ${targetUser.name} para ${config.label}`); } catch (e) { showNotification("Erro: " + e.message, "error"); }
    });
}

// --- LOGS E AUDITORIA ---
async function internalApplyLogFilter() {
    const q = query(getCompanyCollection("logs_auditoria"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        allLoadedLogs = snap.docs.map(d => { const data = d.data(); return { id: d.id, date: data.timestamp?.toDate ? data.timestamp.toDate().toLocaleString('pt-BR') : "---", admin: data.adminEmail || 'Sistema', action: data.action || 'Ação', target: data.target || '-' }; });
        const logsScreen = document.getElementById('screenLogs'); if (logsScreen && !logsScreen.classList.contains('hidden')) renderAuditLogs();
    });
}
function renderAuditLogs() {
    const container = document.getElementById('screenLogs'); if(!container) return;
    if(allLoadedLogs.length === 0) { container.innerHTML = `<div class="glass-panel p-10 text-center rounded-3xl mt-4"><p class="text-gray-500 text-xs">Sem registros</p></div>`; return; }
    container.innerHTML = `<div class="glass-panel p-6 rounded-3xl h-[calc(100vh-140px)] flex flex-col mt-2"><div class="flex justify-between mb-4"><h3 class="text-xs font-bold text-white uppercase"><i class="fas fa-fingerprint text-blue-400"></i> Auditoria</h3></div><div class="overflow-y-auto custom-scrollbar flex-1 space-y-2">` + allLoadedLogs.map(log => `<div class="bg-white/5 p-3 rounded-xl border border-white/5"><div class="flex justify-between"><span class="text-[9px] font-bold text-blue-200">${log.action}</span><span class="text-[8px] text-gray-500">${log.date}</span></div><div class="text-[10px] text-gray-300 mt-1">${log.target}</div><div class="text-[8px] text-gray-500 mt-1"><i class="fas fa-user-shield"></i> ${log.admin}</div></div>`).join('') + `</div></div>`;
}
async function addAuditLog(action, target) { if(!state.currentUser) return; try { await addDoc(getCompanyCollection("logs_auditoria"), { adminEmail: state.currentUser.email, action, target, timestamp: serverTimestamp() }); } catch(e) {} }

// --- EDIÇÃO DE ESCALA ---
async function confirmSaveToCloud() {
    const emp = document.getElementById('employeeSelect').value; if (!emp) return showNotification("Selecione um colaborador", "error");
    askConfirmation(`Salvar escala de ${emp}?`, async () => {
        try { const user = state.scheduleData[emp]; const safeSchedule = user.schedule.map(v => (v===undefined||v===null||v==="")?"F":v); const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`; await setDoc(getCompanySubDoc("escalas", docId, "plantonistas", user.uid), { calculatedSchedule: safeSchedule }, { merge: true }); await addAuditLog("Edição de Escala", emp); showNotification("Salvo com sucesso"); user.schedule = safeSchedule; renderDailyDashboard(); } catch(e) { showNotification(e.message, "error"); }
    });
}

function initApprovalsTab() {
    const list = document.getElementById('adminRequestsListSide'); if(!list) return;
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader"));
    onSnapshot(q, (snap) => { const badge = document.getElementById('notificationBadge'); if(badge) badge.classList.toggle('hidden', snap.empty); list.innerHTML = snap.empty ? '<p class="text-center text-gray-500 text-[10px]">Nada pendente.</p>' : snap.docs.map(d => `<div class="bg-white/5 p-4 rounded-xl border-l-4 border-yellow-500 flex justify-between"><div><strong class="text-white text-[10px] block">${d.data().requester}</strong><span class="text-[9px] text-gray-400">${d.data().type}</span></div><div class="flex gap-2"><button onclick="window.approveRequest('${d.id}')" class="bg-emerald-500/20 text-emerald-400 p-2 rounded-lg hover:bg-emerald-500/30"><i class="fas fa-check"></i></button><button onclick="window.rejectRequest('${d.id}')" class="bg-red-500/20 text-red-400 p-2 rounded-lg hover:bg-red-500/30"><i class="fas fa-times"></i></button></div></div>`).join(''); });
}
async function approveRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'approved' }); showNotification("Aprovado"); }
async function rejectRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'rejected' }); showNotification("Recusado"); }

function askConfirmation(message, onConfirm) {
    const modal = document.getElementById('customConfirmModal'); document.getElementById('modalMessage').innerHTML = message; modal.classList.remove('hidden'); setTimeout(() => document.getElementById('modalContent').classList.remove('opacity-0', 'scale-95'), 10);
    document.getElementById('modalConfirm').onclick = () => { modal.classList.add('hidden'); onConfirm(); }; document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden');
}

export function populateEmployeeSelect() { const s = document.getElementById('employeeSelect'); if(s && state.scheduleData) { s.innerHTML = '<option value="">Selecionar...</option>' + Object.keys(state.scheduleData).sort().filter(n=>state.scheduleData[n].level < 100).map(n=>`<option value="${n}">${n}</option>`).join(''); } }

// --- TOOLBAR VISUAL NOVO ---
function renderEditToolbar() {
    const tb = document.getElementById('editToolbar');
    if (tb) return;
    const toolbar = document.createElement('div'); toolbar.id = 'editToolbar'; 
    toolbar.className = "flex flex-wrap justify-center gap-2 mb-6 p-2 bg-black/20 rounded-2xl border border-white/5 backdrop-blur-sm mx-auto max-w-fit";
    
    const tools = [ 
        { id: null, label: 'Auto', icon: 'fa-magic', color: 'text-gray-400', bg: 'hover:bg-gray-500/10' }, 
        { id: 'T', label: 'Turno', icon: 'fa-briefcase', color: 'text-emerald-400', bg: 'hover:bg-emerald-500/10' }, 
        { id: 'F', label: 'Folga', icon: 'fa-coffee', color: 'text-yellow-400', bg: 'hover:bg-yellow-500/10' }, 
        { id: 'FS', label: 'Sáb', icon: 'fa-sun', color: 'text-teal-400', bg: 'hover:bg-teal-500/10' }, 
        { id: 'FD', label: 'Dom', icon: 'fa-sun', color: 'text-blue-400', bg: 'hover:bg-blue-500/10' }, 
        { id: 'FE', label: 'Fér', icon: 'fa-plane', color: 'text-red-400', bg: 'hover:bg-red-500/10' }, 
        { id: 'A', label: 'Af', icon: 'fa-user-injured', color: 'text-orange-400', bg: 'hover:bg-orange-500/10' }, 
        { id: 'LM', label: 'LM', icon: 'fa-baby', color: 'text-pink-400', bg: 'hover:bg-pink-500/10' } 
    ];

    toolbar.innerHTML = tools.map(t => `
        <button onclick="window.setEditTool('${t.id}')" class="group relative px-4 py-2 rounded-xl border border-transparent ${t.bg} transition-all active:scale-95 flex flex-col items-center gap-1 min-w-[50px]">
            <i class="fas ${t.icon} ${t.color} text-sm mb-0.5 group-hover:-translate-y-0.5 transition-transform"></i>
            <span class="text-[9px] font-bold text-gray-500 group-hover:text-white uppercase tracking-wider">${t.label}</span>
        </button>
    `).join('');
    document.getElementById('calendarContainer').insertBefore(toolbar, document.getElementById('calendarGrid'));
}
function setEditTool(id) { activeTool = (id === 'null' || id === null) ? null : id; }
export function handleAdminCellClick(name, i) { const user = state.scheduleData[name]; if(!user) return; const seq = ['T', 'F', 'FS', 'FD', 'FE', 'A', 'LM']; const currentVal = user.schedule[i] || 'F'; user.schedule[i] = activeTool || seq[(seq.indexOf(currentVal) + 1) % seq.length]; updateCalendar(name, user.schedule); }
