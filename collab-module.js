// collab-module.js - Versão Final SaaS
import { db, state, getCompanyCollection, getCompanyDoc, pad, monthNames, isValidShiftStartDate } from './config.js';
import { addDoc, serverTimestamp, query, where, onSnapshot, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { updatePersonalView, updateWeekendTable, showNotification } from './ui.js';

const shifts = ["07:00 às 19:00", "07:30 às 18:18", "08:00 às 17:48", "08:30 às 18:18", "12:12 às 22:00", "19:00 às 07:00", "22:00 às 07:48"];
let mini = { y: new Date().getFullYear(), m: new Date().getMonth(), sel: null };

export function initCollabUI() {
    ['adminControls', 'adminTabNav', 'editToolbar'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    ['collabHeader', 'collabControls'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    
    const name = state.profile?.name || state.profile?.nome;
    if(name) {
        document.getElementById('welcomeUser').textContent = `Olá, ${name.split(' ')[0]}`;
        const sel = document.getElementById('employeeSelect');
        if(sel) { sel.innerHTML = `<option>${name}</option>`; sel.value = name; sel.disabled = true; }
        updatePersonalView(name);
        initRequestsTab(); 
        initInboxTab();    
    }
    setupEvents();
    renderMiniCal();
}

export function destroyCollabUI() {
    ['collabHeader', 'collabControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    const sel = document.getElementById('employeeSelect');
    if(sel) sel.disabled = false;
}

function setupEvents() {
    const bNew = document.getElementById('btnNewRequestDynamic'); if(bNew) bNew.onclick = openModal;
    const bSend = document.getElementById('btnSendRequest'); if(bSend) bSend.onclick = sendReq;
    const tSel = document.getElementById('reqType'); if(tSel) tSel.onchange = handleType;
    // Mini Calendar
    document.getElementById('datePickerTrigger').onclick = () => { document.getElementById('miniCalendarDropdown').classList.toggle('hidden'); renderMiniCal(); };
    document.getElementById('miniPrev').onclick = () => { mini.m--; if(mini.m<0){mini.m=11;mini.y--}; renderMiniCal(); };
    document.getElementById('miniNext').onclick = () => { mini.m++; if(mini.m>11){mini.m=0;mini.y++}; renderMiniCal(); };
}

function renderMiniCal() {
    const grid = document.getElementById('miniCalendarGrid');
    document.getElementById('miniMonthLabel').textContent = `${monthNames[mini.m]} ${mini.y}`;
    grid.innerHTML = '';
    const date = new Date(mini.y, mini.m, 1);
    while (date.getMonth() === mini.m) {
        const dStr = `${mini.y}-${pad(mini.m+1)}-${pad(date.getDate())}`;
        const cell = document.createElement('div');
        cell.className = `mini-day ${mini.sel===dStr?'is-selected':''} ${dStr===new Date().toISOString().split('T')[0]?'is-today':''}`;
        cell.textContent = date.getDate();
        cell.onclick = () => { mini.sel = dStr; document.getElementById('reqDateManual').value=dStr; document.getElementById('datePickerText').textContent=`${date.getDate()}/${mini.m+1}`; document.getElementById('miniCalendarDropdown').classList.add('hidden'); };
        grid.appendChild(cell);
        date.setDate(date.getDate()+1);
    }
}

export function handleCollabCellClick() { showNotification("Use a Central de Trocas.", "error"); }

function openModal() {
    document.getElementById('requestModal').classList.remove('hidden');
    const sel = document.getElementById('reqTargetEmployee');
    sel.innerHTML = '<option value="">Selecione...</option>';
    Object.keys(state.scheduleData).forEach(n => { if(n !== (state.profile.name||state.profile.nome)) sel.innerHTML += `<option value="${n}">${n}</option>`; });
    document.getElementById('reqNewShift').innerHTML = shifts.map(s=>`<option value="${s}">${s}</option>`).join('');
    handleType();
}

function handleType() {
    const t = document.getElementById('reqType').value;
    document.getElementById('divReqTarget').classList.toggle('hidden', t === 'troca_turno');
    document.getElementById('divReqShift').classList.toggle('hidden', t !== 'troca_turno');
}

async function sendReq() {
    const type = document.getElementById('reqType').value;
    const date = document.getElementById('reqDateManual').value;
    const reason = document.getElementById('reqReason').value;
    let target = null, tUid = null, shift = null;

    try {
        if(!date) throw new Error("Data inválida.");
        if (type === 'troca_turno') {
            if(!isValidShiftStartDate(date)) throw new Error("Apenas após dia 25.");
            shift = document.getElementById('reqNewShift').value;
            target = 'LÍDER'; tUid = 'ADMIN';
        } else {
            target = document.getElementById('reqTargetEmployee').value;
            tUid = Object.values(state.scheduleData).find(u=>u.name===target)?.uid;
        }

        const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
        // SAAS: Grava na coleção da empresa
        await addDoc(getCompanyCollection("solicitacoes"), {
            monthId: docId, requester: (state.profile.name||state.profile.nome), requesterUid: state.currentUser.uid,
            dayIndex: parseInt(date.split('-')[2])-1, type, target, targetUid: tUid, desiredShift: shift, reason,
            status: type==='troca_turno'?'pending_leader':'pending_peer', createdAt: serverTimestamp()
        });
        document.getElementById('requestModal').classList.add('hidden');
        showNotification("Enviado!");
    } catch(e) { showNotification(e.message, "error"); }
}

function initRequestsTab() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("requester", "==", (state.profile.name||state.profile.nome)));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('sentRequestsList');
        if(list) list.innerHTML = snap.docs.map(d => { const r = d.data(); return `<div class="apple-glass p-2 mb-2 text-[9px] relative"><button onclick="window.deleteRequest('${d.id}')" class="absolute top-2 right-2 text-red-400"><i class="fas fa-trash"></i></button><strong>${r.type.replace(/_/g,' ')} • DIA ${r.dayIndex+1}</strong><br><span class="text-gray-400">${r.status}</span></div>` }).join('') || '<p class="text-center text-gray-500 text-[8px]">Vazio</p>';
    });
}

function initInboxTab() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("targetUid", "==", state.currentUser.uid), where("status", "==", "pending_peer"));
    onSnapshot(q, (snap) => {
        const c = document.getElementById('inboxContainer');
        const l = document.getElementById('inboxRequestsList');
        if(snap.empty) { c?.classList.add('hidden'); } else {
            c?.classList.remove('hidden');
            if(l) l.innerHTML = snap.docs.map(d => `<div class="apple-glass p-2 mb-2 border-blue-500/30"><strong>${d.data().requester}</strong> quer trocar dia ${d.data().dayIndex+1}<div class="flex gap-1 mt-1"><button onclick="window.handlePeerResponse('${d.id}','approve')" class="flex-1 bg-emerald-500/20 text-emerald-400 py-1 rounded">Aceitar</button><button onclick="window.handlePeerResponse('${d.id}','reject')" class="flex-1 bg-red-500/20 text-red-400 py-1 rounded">Recusar</button></div></div>`).join('');
        }
    });
}

window.deleteRequest = async (id) => { if(confirm("Excluir?")) await deleteDoc(getCompanyDoc("solicitacoes", id)); };
window.handlePeerResponse = async (id, act) => { await updateDoc(getCompanyDoc("solicitacoes", id), { status: act==='approve'?'pending_leader':'rejected' }); }; 
