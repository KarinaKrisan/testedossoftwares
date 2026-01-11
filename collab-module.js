// collab-module.js
import { db, state, getCompanyCollection, getCompanyDoc, pad, monthNames } from './config.js';
import { addDoc, serverTimestamp, query, where, onSnapshot, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { updatePersonalView, showNotification } from './ui.js';

const shifts = ["07:00 às 19:00", "07:30 às 17:18", "08:00 às 17:48", "08:30 às 18:18", "12:12 às 22:00", "19:00 às 07:00", "22:00 às 07:48"];

// Estado local do Mini Calendário (Inicia com a data de HOJE)
let mini = { 
    y: new Date().getFullYear(), 
    m: new Date().getMonth(), 
    sel: null 
};

export function initCollabUI() {
    ['adminControls', 'adminTabNav', 'editToolbar'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    ['collabHeader', 'collabControls'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    
    const name = state.profile?.name || state.profile?.nome;
    if(name) {
        document.getElementById('welcomeUser').textContent = `Olá, ${name.split(' ')[0]}`;
        const sel = document.getElementById('employeeSelect');
        if(sel) { 
            sel.innerHTML = `<option>${name}</option>`; 
            sel.value = name; 
            sel.disabled = true; 
        }
        updatePersonalView(name);
        initRequestsTab(); 
        initInboxTab();    
    }
    
    setupEvents(); 
    // Pré-renderiza para garantir que esteja pronto
    renderMiniCal(); 
}

export function destroyCollabUI() {
    ['collabHeader', 'collabControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    const sel = document.getElementById('employeeSelect'); if(sel) sel.disabled = false; 
}

function setupEvents() {
    const bNew = document.getElementById('btnNewRequestDynamic'); if(bNew) bNew.onclick = openModal;
    const bSend = document.getElementById('btnSendRequest'); if(bSend) bSend.onclick = sendReq;
    const tSel = document.getElementById('reqType'); if(tSel) tSel.onchange = handleType;
    
    // --- LÓGICA DO DATE PICKER (MINI CALENDÁRIO) ---
    const trigger = document.getElementById('datePickerTrigger');
    const dropdown = document.getElementById('miniCalendarDropdown');
    const btnPrev = document.getElementById('miniPrev');
    const btnNext = document.getElementById('miniNext');

    if (trigger && dropdown) {
        // Toggle do Dropdown
        trigger.onclick = (e) => {
            e.stopPropagation(); // Evita fechar imediatamente
            dropdown.classList.toggle('hidden');
            renderMiniCal(); // Renderiza ao abrir para garantir atualização
        };

        // Fecha ao clicar fora
        document.addEventListener('click', (e) => {
            if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        });
    }

    // Navegação Mês Anterior
    if (btnPrev) {
        btnPrev.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            mini.m--;
            if (mini.m < 0) {
                mini.m = 11;
                mini.y--;
            }
            renderMiniCal();
        };
    }

    // Navegação Próximo Mês
    if (btnNext) {
        btnNext.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            mini.m++;
            if (mini.m > 11) {
                mini.m = 0;
                mini.y++;
            }
            renderMiniCal();
        };
    }
}

function renderMiniCal() {
    const grid = document.getElementById('miniCalendarGrid');
    const label = document.getElementById('miniMonthLabel');
    if (!grid || !label) return;

    label.textContent = `${monthNames[mini.m]} ${mini.y}`;
    grid.innerHTML = '';

    // Cabeçalho Dias da Semana (D S T Q Q S S)
    const weekDays = ['D','S','T','Q','Q','S','S'];
    weekDays.forEach(d => {
        const el = document.createElement('div');
        el.className = 'text-[9px] font-bold text-gray-500 py-1';
        el.textContent = d;
        grid.appendChild(el);
    });

    const firstDay = new Date(mini.y, mini.m, 1);
    const daysInMonth = new Date(mini.y, mini.m + 1, 0).getDate();
    const startingDay = firstDay.getDay(); // 0 = Domingo

    // Espaços vazios antes do dia 1
    for (let i = 0; i < startingDay; i++) {
        grid.appendChild(document.createElement('div'));
    }

    // Dias do mês
    for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${mini.y}-${pad(mini.m + 1)}-${pad(d)}`;
        const cell = document.createElement('div');
        
        // Estilo base da célula
        let cellClass = "cursor-pointer rounded p-1 hover:bg-white/10 text-center transition-colors ";
        
        // Destaque se for o dia selecionado
        if (mini.sel === dStr) {
            cellClass += "bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/30";
        } else if (dStr === new Date().toISOString().split('T')[0]) {
            // Destaque se for Hoje (mas não selecionado)
            cellClass += "text-blue-400 font-bold border border-blue-500/30";
        } else {
            cellClass += "text-gray-300";
        }

        cell.className = cellClass;
        cell.textContent = d;
        
        cell.onclick = (e) => {
            e.stopPropagation(); // Não fecha o dropdown ao clicar
            mini.sel = dStr;
            document.getElementById('reqDateManual').value = dStr;
            document.getElementById('datePickerText').textContent = `${pad(d)}/${pad(mini.m + 1)}/${mini.y}`;
            document.getElementById('datePickerText').classList.add('text-white', 'font-bold');
            document.getElementById('miniCalendarDropdown').classList.add('hidden');
            renderMiniCal(); // Re-renderiza para atualizar a seleção visual
        };
        
        grid.appendChild(cell);
    }
}

export function handleCollabCellClick() { 
    showNotification("Use o botão 'Nova Solicitação' para pedir trocas.", "info"); 
}

function openModal() {
    document.getElementById('requestModal').classList.remove('hidden');
    
    // Reseta o formulário
    document.getElementById('reqReason').value = '';
    document.getElementById('reqDateManual').value = '';
    document.getElementById('datePickerText').textContent = 'Toque para selecionar';
    document.getElementById('datePickerText').classList.remove('text-white', 'font-bold');
    mini.sel = null; // Limpa seleção anterior

    const sel = document.getElementById('reqTargetEmployee');
    sel.innerHTML = '<option value="">Selecione...</option>';
    
    if (state.scheduleData) {
        Object.keys(state.scheduleData).forEach(n => { 
            // Não mostra o próprio usuário na lista de troca
            if(n !== (state.profile.name || state.profile.nome)) {
                sel.innerHTML += `<option value="${n}">${n}</option>`;
            }
        });
    }
    
    document.getElementById('reqNewShift').innerHTML = shifts.map(s=>`<option value="${s}">${s}</option>`).join('');
    handleType(); // Ajusta visibilidade dos campos
}

function handleType() {
    const t = document.getElementById('reqType').value;
    const isShiftChange = (t === 'novo_turno');
    document.getElementById('divReqTarget').classList.toggle('hidden', isShiftChange);
    document.getElementById('divReqShift').classList.toggle('hidden', !isShiftChange);
}

async function sendReq() {
    const type = document.getElementById('reqType').value;
    const date = document.getElementById('reqDateManual').value;
    const reason = document.getElementById('reqReason').value;
    
    let target = null, tUid = null, shift = null;

    try {
        if(!date) throw new Error("Por favor, selecione uma data no calendário.");
        
        if (type === 'novo_turno') { 
            shift = document.getElementById('reqNewShift').value; 
            target = 'LÍDER'; 
            tUid = 'ADMIN'; 
        } else { 
            target = document.getElementById('reqTargetEmployee').value; 
            if(!target) throw new Error("Selecione um colega para a troca."); 
            
            const targetData = Object.values(state.scheduleData).find(u=>u.name===target); 
            if(targetData) tUid = targetData.uid; 
            else throw new Error("Dados do colega não encontrados."); 
        }

        const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
        
        // Cria a solicitação
        await addDoc(getCompanyCollection("solicitacoes"), { 
            monthId: docId, 
            requester: (state.profile.name||state.profile.nome), 
            requesterUid: state.currentUser.uid, 
            dayIndex: parseInt(date.split('-')[2])-1, // Salva o índice do dia (0-30)
            targetDate: date, // Salva a data completa para referência
            type, 
            target, 
            targetUid: tUid, 
            desiredShift: shift, 
            reason, 
            status: type === 'novo_turno' ? 'pending_leader' : 'pending_peer', 
            createdAt: serverTimestamp() 
        });

        document.getElementById('requestModal').classList.add('hidden');
        showNotification("Solicitação enviada com sucesso!", "success");
        
    } catch(e) { 
        showNotification(e.message, "error"); 
    }
}

function initRequestsTab() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("requester", "==", (state.profile.name||state.profile.nome)));
    
    onSnapshot(q, (snap) => {
        const list = document.getElementById('sentRequestsList');
        if(list) {
            list.innerHTML = snap.docs.map(d => {
                const data = d.data();
                const statusColor = data.status === 'approved' ? 'text-emerald-400 border-emerald-500/30' : (data.status === 'rejected' ? 'text-red-400 border-red-500/30' : 'text-yellow-400 border-yellow-500/30');
                const statusLabel = data.status === 'approved' ? 'Aprovado' : (data.status === 'rejected' ? 'Recusado' : 'Pendente');
                
                return `
                <div class="glass-card p-3 rounded-xl border ${statusColor} relative group">
                    <button onclick="window.deleteRequest('${d.id}')" class="absolute top-2 right-2 text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                        <i class="fas fa-trash text-xs"></i>
                    </button>
                    <div class="flex justify-between items-start mb-1">
                        <span class="text-[9px] font-bold uppercase tracking-widest text-white/60">${data.type.replace('_', ' ')}</span>
                        <span class="text-[9px] font-bold ${statusColor.split(' ')[0]}">${statusLabel}</span>
                    </div>
                    <div class="text-xs text-white font-medium">
                        Dia ${data.dayIndex + 1} <span class="text-white/40 mx-1">•</span> ${data.target || 'Líder'}
                    </div>
                </div>`;
            }).join('') || '<div class="text-center py-4 text-gray-500 text-[10px]">Nenhuma solicitação enviada.</div>';
        }
    });
}

function initInboxTab() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("targetUid", "==", state.currentUser.uid), where("status", "==", "pending_peer"));
    
    onSnapshot(q, (snap) => {
        const c = document.getElementById('inboxContainer');
        const l = document.getElementById('inboxRequestsList');
        
        if(snap.empty) { 
            c?.classList.add('hidden'); 
        } else {
            c?.classList.remove('hidden');
            if(l) {
                l.innerHTML = snap.docs.map(d => `
                    <div class="glass-card p-3 rounded-xl border-l-2 border-blue-500 animate-fade-in">
                        <div class="mb-2">
                            <strong class="text-white text-xs block">${d.data().requester}</strong>
                            <p class="text-[10px] text-gray-400">Deseja trocar o dia <strong>${d.data().dayIndex+1}</strong> com você.</p>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="window.handlePeerResponse('${d.id}','approve')" class="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-colors">Aceitar</button>
                            <button onclick="window.handlePeerResponse('${d.id}','reject')" class="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-colors">Recusar</button>
                        </div>
                    </div>
                `).join('');
            }
        }
    });
}

window.deleteRequest = async (id) => { 
    if(confirm("Deseja realmente cancelar esta solicitação?")) {
        await deleteDoc(getCompanyDoc("solicitacoes", id)); 
    }
};

window.handlePeerResponse = async (id, act) => { 
    // Se o colega aceitar ('approve'), o status muda para 'pending_leader' (vai para o gestor)
    // Se recusar, vai para 'rejected' e morre ali.
    await updateDoc(getCompanyDoc("solicitacoes", id), { 
        status: act === 'approve' ? 'pending_leader' : 'rejected' 
    }); 
};
