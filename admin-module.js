// admin-module.js
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY } from './config.js';
import { showNotification, updateCalendar } from './ui.js';
import { doc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let allLoadedLogs = [];
let dailyUpdateInterval = null;
let activeTool = null; 

// --- EXPORTAÇÕES GLOBAIS (ESSENCIAIS PARA O HTML FUNCIONAR) ---
// Vincula funções ao objeto window para serem acessíveis via onclick="" no HTML
window.openPromoteModal = openPromoteModal;
window.confirmPromotion = confirmPromotion;
window.selectRole = selectRole;
window.runLegacyMigration = runLegacyMigration;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.setEditTool = setEditTool;
window.renderInviteWidget = renderInviteWidget; // Adicionado para permitir recarregar em caso de erro

// --- INICIALIZAÇÃO E NAVEGAÇÃO ---
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
    
    // Renderiza a view específica
    if (view === 'daily') renderDailyDashboard();
    if (view === 'logs') {
        // Força recarregamento dos logs ao entrar na tela
        internalApplyLogFilter();
    }
    
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
    
    populateEmployeeSelect();
    renderEditToolbar(); 
    initApprovalsTab(); 
    renderInviteWidget(); // <--- AQUI CHAMA A VERSÃO CORRIGIDA
    renderMigrationTool();
    
    // Inicia ouvintes de logs imediatamente
    internalApplyLogFilter();
    
    switchAdminView('daily');
    
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    dailyUpdateInterval = setInterval(() => { 
        const screen = document.getElementById('screenDaily');
        if (screen && !screen.classList.contains('hidden')) renderDailyDashboard(); 
    }, 60000);
}

// --- WIDGET DE CONVITES (CORRIGIDO E OTIMIZADO) ---
async function renderInviteWidget() {
    // 1. Busca o container correto definido no index.html
    const container = document.getElementById('inviteWidgetContainer');
    if (!container) return; 

    // 2. Define um estado de carregamento visual para evitar a "barra vazia"
    container.innerHTML = `
        <div class="premium-glass p-4 rounded-xl border border-white/10 animate-pulse flex justify-center">
            <span class="text-[10px] text-gray-500 uppercase tracking-widest"><i class="fas fa-circle-notch fa-spin mr-2"></i> Verificando Convites...</span>
        </div>
    `;

    try {
        // 3. Busca convites ativos no Firebase
        const q = query(getCompanyCollection("convites"), where("active", "==", true));
        const snap = await getDocs(q);

        if (!snap.empty) {
            // === CENÁRIO A: EXISTE UM CONVITE ATIVO ===
            const inviteCode = snap.docs[0].id;
            // Monta o link completo
            const inviteLink = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${inviteCode}&company=${state.companyId}`;

            container.innerHTML = `
                <div class="premium-glass p-4 rounded-xl border-l-4 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                            <i class="fas fa-ticket-alt mr-1"></i> Convite Ativo
                        </h3>
                        <span class="text-[8px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20 animate-pulse">
                            Aguardando cadastro
                        </span>
                    </div>
                    
                    <div class="flex gap-2 mb-3">
                        <div class="relative w-full">
                            <input type="text" value="${inviteLink}" id="inviteLinkInput" class="w-full bg-black/40 border border-white/10 text-gray-300 font-mono text-[9px] p-3 rounded-lg outline-none focus:border-emerald-500/50 transition-all pr-10" readonly>
                            <div class="absolute right-3 top-3 text-gray-600">
                                <i class="fas fa-link text-xs"></i>
                            </div>
                        </div>
                        <button id="btnCopyInvite" class="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 rounded-lg transition-all active:scale-95 group relative">
                            <i class="fas fa-copy text-gray-400 group-hover:text-white transition-colors"></i>
                        </button>
                    </div>

                    <button id="btnRevokeInvite" class="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all">
                        <i class="fas fa-ban mr-1"></i> Revogar / Cancelar Link
                    </button>
                </div>
            `;

            // Adiciona os eventos
            document.getElementById('btnCopyInvite').onclick = () => {
                const input = document.getElementById("inviteLinkInput");
                input.select();
                input.setSelectionRange(0, 99999); // Para mobile
                navigator.clipboard.writeText(input.value);
                showNotification("Link copiado para a área de transferência!", "success");
            };

            document.getElementById('btnRevokeInvite').onclick = () => {
                askConfirmation("Tem certeza? O link deixará de funcionar imediatamente.", async () => {
                    await updateDoc(getCompanyDoc("convites", inviteCode), { active: false });
                    showNotification("Convite revogado.", "success");
                    renderInviteWidget(); // Recarrega o widget
                });
            };

        } else {
            // === CENÁRIO B: NENHUM CONVITE (BOTÃO GERAR) ===
            container.innerHTML = `
                <div class="premium-glass p-4 rounded-xl border border-white/5 border-dashed hover:border-white/10 transition-all group">
                    <div class="flex items-center justify-between mb-3">
                        <h3 class="text-[10px] font-bold text-gray-400 uppercase tracking-widest group-hover:text-white transition-colors">
                            <i class="fas fa-user-plus mr-1"></i> Novo Colaborador
                        </h3>
                    </div>
                    <p class="text-[9px] text-gray-500 mb-3 leading-relaxed">
                        Gere um link único para permitir que um funcionário crie sua conta vinculada a esta empresa.
                    </p>
                    <button id="btnGenerateInvite" class="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-blue-900/20 active:scale-95 transition-all">
                        <i class="fas fa-magic mr-2"></i> Gerar Link de Convite
                    </button>
                </div>
            `;

            // Adiciona o evento de gerar
            document.getElementById('btnGenerateInvite').onclick = async () => {
                const btn = document.getElementById('btnGenerateInvite');
                btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Gerando...';
                btn.disabled = true;

                try {
                    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                    
                    // Salva o convite no banco
                    await setDoc(getCompanyDoc("convites", code), { 
                        createdBy: state.currentUser.uid, 
                        createdAt: serverTimestamp(), 
                        active: true,
                        companyName: state.profile?.companyName || "Cronos System"
                    });

                    showNotification("Link gerado com sucesso!", "success");
                    renderInviteWidget(); // Atualiza a tela
                } catch (error) {
                    console.error(error);
                    showNotification("Erro ao gerar convite.", "error");
                    btn.innerHTML = 'Tentar Novamente';
                    btn.disabled = false;
                }
            };
        }

    } catch (e) {
        console.error("Erro no widget de convite:", e);
        container.innerHTML = `
            <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
                <p class="text-[9px] text-red-400">Erro ao carregar sistema de convites.</p>
                <button onclick="renderInviteWidget()" class="mt-2 text-[9px] text-white underline">Tentar novamente</button>
            </div>
        `;
    }
}

// --- GESTÃO DE CARGOS (Modal) ---
function openPromoteModal() {
    const modal = document.getElementById('promoteModal');
    const userSelect = document.getElementById('promoteTargetUser');
    const roleContainer = document.getElementById('roleOptionsContainer');
    
    // Limpa seleção anterior
    document.getElementById('selectedRoleKey').value = "";
    
    // Popula usuários
    userSelect.innerHTML = '<option value="">Selecione um colaborador...</option>';
    if(state.scheduleData) {
        Object.values(state.scheduleData).sort((a,b)=>a.name.localeCompare(b.name)).forEach(user => {
            // Exibe todos, exceto o próprio usuário logado
            if (user.uid !== state.currentUser.uid) {
                userSelect.innerHTML += `<option value="${user.uid}">${user.name} (${user.cargo || 'S/ Cargo'})</option>`;
            }
        });
    }

    // Popula cargos (Botões visuais)
    roleContainer.innerHTML = '';
    Object.entries(HIERARCHY).forEach(([key, config]) => {
        // Só mostra cargos abaixo de CEO
        if (config.level <= 100) { 
            const btn = document.createElement('div');
            // Estilo do botão de opção
            btn.className = `role-option cursor-pointer w-full p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex items-center justify-between group`;
            btn.onclick = (e) => window.selectRole(e, key);
            
            btn.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-black/40 flex items-center justify-center text-sm font-bold text-gray-400 group-hover:text-white border border-white/5 transition-colors">
                        ${config.level}
                    </div>
                    <div>
                        <div class="text-[11px] font-bold text-gray-200 group-hover:text-white uppercase tracking-wider">${config.label}</div>
                        <div class="text-[9px] text-gray-500 group-hover:text-gray-400 font-mono">${config.role}</div>
                    </div>
                </div>
                <div class="w-4 h-4 rounded-full border-2 border-white/20 flex items-center justify-center role-check-circle transition-colors">
                    <div class="w-2 h-2 rounded-full bg-transparent role-check-dot transition-colors"></div>
                </div>
            `;
            roleContainer.appendChild(btn);
        }
    });

    modal.classList.remove('hidden');
}

function selectRole(e, key) {
    // 1. Remove seleção visual de todos
    document.querySelectorAll('.role-option').forEach(el => {
        el.classList.remove('border-purple-500', 'bg-purple-500/10');
        const circle = el.querySelector('.role-check-circle');
        const dot = el.querySelector('.role-check-dot');
        circle.classList.remove('border-purple-500');
        dot.classList.remove('bg-purple-500');
    });

    // 2. Adiciona seleção ao clicado
    const selectedDiv = e.currentTarget;
    selectedDiv.classList.add('border-purple-500', 'bg-purple-500/10');
    
    const circle = selectedDiv.querySelector('.role-check-circle');
    const dot = selectedDiv.querySelector('.role-check-dot');
    circle.classList.add('border-purple-500');
    dot.classList.add('bg-purple-500');

    // 3. Atualiza valor oculto
    document.getElementById('selectedRoleKey').value = key;
}

async function confirmPromotion() {
    const targetUid = document.getElementById('promoteTargetUser').value;
    const roleKey = document.getElementById('selectedRoleKey').value;

    if (!targetUid) return showNotification("Selecione um colaborador da lista.", "error");
    if (!roleKey) return showNotification("Selecione um novo cargo.", "error");

    const config = HIERARCHY[roleKey];
    const targetUser = Object.values(state.scheduleData).find(u => u.uid === targetUid);

    // Modal de Confirmação
    askConfirmation(
        `Alterar cargo de <strong class="text-white">${targetUser.name}</strong> para <strong class="text-purple-400">${config.label}</strong>?`, 
        async () => {
            try {
                // Atualiza o documento do usuário
                await updateDoc(getCompanyDoc("users", targetUid), {
                    cargo: config.label,
                    role: config.role,
                    level: config.level,
                    updatedAt: serverTimestamp(),
                    _claimsRefresh: Date.now(), // Força refresh de token
                    promotedBy: state.currentUser.email
                });

                document.getElementById('promoteModal').classList.add('hidden');
                showNotification("Cargo Atualizado", "success");
                
                // Gera Log de Auditoria
                await addAuditLog("Gestão de Equipe", `Alterou ${targetUser.name} para ${config.label}`);
                
            } catch (e) {
                console.error("Erro ao promover:", e);
                showNotification("Erro: " + e.message, "error");
            }
        }
    );
}

// --- AUDIT LOGS ---
async function internalApplyLogFilter() {
    // Escuta em tempo real a coleção logs_auditoria
    const q = query(getCompanyCollection("logs_auditoria"), orderBy("timestamp", "desc"));
    
    onSnapshot(q, (snap) => {
        allLoadedLogs = snap.docs.map(d => {
            const data = d.data();
            // Tratamento de data seguro
            let dateStr = "---";
            if (data.timestamp && data.timestamp.toDate) {
                dateStr = data.timestamp.toDate().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            }
            
            return {
                id: d.id,
                date: dateStr,
                admin: data.adminEmail || 'Sistema',
                action: data.action || 'Ação',
                target: data.target || '-'
            };
        });
        
        // Se a tela de logs estiver aberta, atualiza
        const logsScreen = document.getElementById('screenLogs');
        if (logsScreen && !logsScreen.classList.contains('hidden')) {
            renderAuditLogs();
        }
    });
}

function renderAuditLogs() {
    const container = document.getElementById('screenLogs');
    if(!container) return;

    if(allLoadedLogs.length === 0) {
        container.innerHTML = `
            <div class="premium-glass p-10 text-center rounded-xl border border-white/5 mt-4">
                <div class="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fas fa-history text-3xl text-white/20"></i>
                </div>
                <p class="text-gray-500 text-xs uppercase tracking-widest font-bold">Nenhum registro de auditoria</p>
                <p class="text-[10px] text-gray-600 mt-1">As ações administrativas aparecerão aqui.</p>
            </div>`;
        return;
    }

    let html = `
    <div class="premium-glass p-4 rounded-xl border border-white/5 h-[calc(100vh-140px)] flex flex-col mt-2">
        <div class="flex justify-between items-center mb-4 px-2">
            <h3 class="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <i class="fas fa-fingerprint text-blue-400"></i> Auditoria
            </h3>
            <span class="text-[9px] text-gray-400 font-mono bg-white/5 px-2 py-1 rounded border border-white/5">
                ${allLoadedLogs.length} EVENTOS
            </span>
        </div>
        <div class="overflow-y-auto custom-scrollbar flex-1 space-y-2 pr-2">`;

    html += allLoadedLogs.map(log => `
        <div class="bg-white/5 p-3 rounded-lg border border-white/5 hover:bg-white/10 transition-all group">
            <div class="flex justify-between items-start mb-1">
                <div class="flex items-center gap-2">
                    <div class="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_#3b82f6]"></div>
                    <span class="text-[9px] font-bold text-blue-200 uppercase tracking-wide">${log.action}</span>
                </div>
                <span class="text-[8px] text-gray-500 font-mono">${log.date}</span>
            </div>
            <div class="pl-3.5 border-l border-white/10 ml-0.5 space-y-1">
                <div class="text-[10px] text-gray-300">
                    <span class="text-gray-600 text-[8px] uppercase mr-1">Alvo:</span> ${log.target}
                </div>
                <div class="text-[8px] text-gray-500 font-mono flex items-center gap-1">
                    <i class="fas fa-user-shield text-[8px]"></i> ${log.admin}
                </div>
            </div>
        </div>
    `).join('');

    html += `</div></div>`;
    container.innerHTML = html;
}

async function addAuditLog(action, target) {
    if(!state.currentUser) return;
    try {
        await addDoc(getCompanyCollection("logs_auditoria"), {
            adminEmail: state.currentUser.email,
            action: action,
            target: target,
            timestamp: serverTimestamp()
        });
    } catch(e) {
        console.error("Erro ao gravar log:", e);
    }
}

// --- FERRAMENTAS ---

function renderMigrationTool() {
    const container = document.getElementById('adminControls');
    if (document.getElementById('migrationBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'migrationBtn';
    btn.className = "w-full mt-4 bg-orange-600/20 border border-orange-500/50 text-orange-400 font-bold py-2.5 rounded-lg text-[10px] uppercase tracking-widest hover:bg-orange-600 hover:text-white transition-all";
    btn.innerHTML = '<i class="fas fa-database mr-2"></i> Reparar/Migrar Dados Antigos';
    btn.onclick = () => { askConfirmation("Isso copiará os dados de 'colaboradores' para 'users'. Continuar?", runLegacyMigration); };
    container.appendChild(btn);
}

async function runLegacyMigration() {
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
        showNotification(`${count} Perfis Recuperados`, "success");
        setTimeout(() => location.reload(), 2000);
    } catch(e) { console.error(e); showNotification("Erro: " + e.message, "error"); }
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
            showNotification("Salvo com sucesso", "success");
            user.schedule = safeSchedule;
            renderDailyDashboard();
        } catch(e) { showNotification(e.message, "error"); }
    });
}

function initApprovalsTab() {
    const list = document.getElementById('adminRequestsListSide');
    if(!list) return;
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader"));
    onSnapshot(q, (snap) => {
        const badge = document.getElementById('notificationBadge');
        if(badge) {
             if(snap.empty) badge.classList.add('hidden');
             else badge.classList.remove('hidden');
        }

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

// --- HELPERS GERAIS ---
function askConfirmation(message, onConfirm) {
    const modal = document.getElementById('customConfirmModal');
    const msgEl = document.getElementById('modalMessage');
    msgEl.innerHTML = message;
    modal.classList.remove('hidden');
    setTimeout(() => { document.getElementById('modalContent').classList.replace('opacity-0', 'opacity-100'); document.getElementById('modalContent').classList.replace('scale-95', 'scale-100'); }, 10);
    document.getElementById('modalConfirm').onclick = () => { modal.classList.add('hidden'); onConfirm(); };
    document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden');
}

export function populateEmployeeSelect() {
    const s = document.getElementById('employeeSelect');
    if(s) { 
        s.innerHTML = '<option value="">Selecionar...</option>'; 
        if(state.scheduleData) {
            Object.keys(state.scheduleData).sort().forEach(n => {
                const user = state.scheduleData[n];
                if (user.level < 100) s.innerHTML += `<option value="${n}">${n}</option>`;
            }); 
        }
    }
}

function renderEditToolbar() {
    if (document.getElementById('editToolbar')) return;
    const toolbar = document.createElement('div'); toolbar.id = 'editToolbar'; toolbar.className = "flex flex-wrap justify-center gap-1.5 mb-4";
    const tools = [ { id: null, label: 'Auto', icon: 'fa-sync', color: 'text-gray-400', border: 'border-white/10' }, { id: 'T', label: 'T', icon: 'fa-briefcase', color: 'text-emerald-400', border: 'border-emerald-500/50' }, { id: 'F', label: 'F', icon: 'fa-coffee', color: 'text-amber-400', border: 'border-amber-500/50' }, { id: 'FS', label: 'Sab', icon: 'fa-sun', color: 'text-[#40E0D0]', border: 'border-[#40E0D0]' }, { id: 'FD', label: 'Dom', icon: 'fa-sun', color: 'text-[#4169E1]', border: 'border-[#4169E1]' }, { id: 'FE', label: 'Fér', icon: 'fa-plane', color: 'text-red-400', border: 'border-red-500/50' }, { id: 'A', label: 'Af', icon: 'fa-user-injured', color: 'text-orange-400', border: 'border-orange-500/50' }, { id: 'LM', label: 'LM', icon: 'fa-baby', color: 'text-pink-400', border: 'border-pink-500/50' } ];
    toolbar.innerHTML = tools.map(t => `<button onclick="window.setEditTool('${t.id}')" class="px-2.5 py-1.5 rounded-lg bg-white/5 border ${t.border} flex items-center gap-1.5"><i class="fas ${t.icon} ${t.color} text-[9px]"></i><span class="text-[8px] font-bold text-white uppercase">${t.label}</span></button>`).join('');
    document.getElementById('calendarContainer')?.insertBefore(toolbar, document.getElementById('calendarGrid'));
}

function setEditTool(id) { activeTool = (id === 'null' || id === null) ? null : id; }

export function handleAdminCellClick(name, i) {
    const user = state.scheduleData[name];
    if(!user) return;
    const seq = ['T', 'F', 'FS', 'FD', 'FE', 'A', 'LM'];
    const currentVal = user.schedule[i] || 'F';
    user.schedule[i] = activeTool || seq[(seq.indexOf(currentVal) + 1) % seq.length];
    updateCalendar(name, user.schedule);
}
