// main.js
import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification, updateDynamicMenu } from './ui.js'; 
import { doc, getDoc, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Exportações para o HTML
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;
window.handleCellClick = (name, dayIndex) => { state.isAdmin ? Admin.handleAdminCellClick(name, dayIndex) : Collab.handleCollabCellClick(name, dayIndex); };

// Variável para controlar o "Dia Atual" e detectar mudanças
let lastKnownDay = new Date().getDate();
let lastKnownMonth = new Date().getMonth();

const performLogout = async () => { try { await signOut(auth); window.location.href = "start.html"; } catch (e) { console.error(e); } };
['btnLogout', 'btnLogoutMobile'].forEach(id => { const btn = document.getElementById(id); if(btn) btn.onclick = performLogout; });

onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;
        try {
            const idTokenResult = await user.getIdTokenResult(true);
            let rawCompanyId = idTokenResult.claims.companyId;
            if (!rawCompanyId) {
                const sysUserSnap = await getDoc(doc(db, "sys_users", user.uid));
                if (sysUserSnap.exists()) rawCompanyId = sysUserSnap.data().companyId;
            }
            if (!rawCompanyId) return performLogout();
            state.companyId = String(rawCompanyId).trim();

            const userDocRef = getCompanyDoc("users", user.uid);
            let isFirstLoad = true;

            onSnapshot(userDocRef, (docSnap) => {
                if (!docSnap.exists()) {
                    if(isFirstLoad) { state.profile = { level: 10, name: "Visitante" }; setInterfaceMode('collab'); loadData(); }
                    return;
                }
                const newData = docSnap.data();
                const oldLevel = state.profile?.level || 0;
                state.profile = newData;
                const myLevel = newData.level || 10;
                state.isDualRole = myLevel >= 40; 
                if (!isFirstLoad && myLevel > oldLevel) showNotification(`Permissões atualizadas: ${newData.cargo}`, "success");
                updateDynamicMenu();
                if (state.isDualRole) setInterfaceMode('admin'); else setInterfaceMode('collab');
                loadData(); 
                isFirstLoad = false;
                
                // Inicia o monitoramento de tempo após carregar o usuário
                startSystemHeartbeat();
            });
        } catch (e) { console.error(e); }
    } else { if (!window.location.href.includes("start.html")) window.location.href = "start.html"; }
});

async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    try {
        const [rosterSnap, usersSnap] = await Promise.all([
            getDocs(getCompanySubCollection("escalas", docId, "plantonistas")),
            getDocs(getCompanyCollection("users"))
        ]);
        const detailsMap = {};
        usersSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });
        await processScheduleData(rosterSnap, detailsMap);
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));
        
        // Renderização inicial baseada no modo
        refreshCurrentView();
        
    } catch (error) { console.error(error); } finally { hideLoader(); }
}

async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    querySnapshot.forEach((doc) => {
        const uid = doc.id;
        const u = detailsMap[uid];
        if (u && u.active !== false) processed[u.name||u.nome] = buildUserObj(uid, u, doc.data().calculatedSchedule);
    });
    Object.keys(detailsMap).forEach(uid => {
        const u = detailsMap[uid];
        if (u.active !== false && !Object.values(processed).some(p => p.uid === uid)) processed[u.name||u.nome] = buildUserObj(uid, u, []);
    });
    state.scheduleData = processed;
}

function buildUserObj(uid, profile, schedule) {
    let safeSchedule = [];
    const days = 32; 
    if (Array.isArray(schedule)) {
        for(let i=0; i<days; i++) safeSchedule.push((schedule[i]===undefined||schedule[i]===null||schedule[i]==="") ? "F" : schedule[i]);
    } else {
        safeSchedule = Array(days).fill("F");
    }
    const userObj = {
        uid: uid, name: profile.name || profile.nome || "Usuário", role: profile.role || 'collaborator', level: profile.level || 10,
        cargo: profile.cargo || '-', setorID: profile.setorID || 'NOC', email: profile.email || "", horario: profile.horario || "08:00 às 17:00",
        schedule: safeSchedule, ...profile 
    };
    Object.keys(userObj).forEach(key => { if (userObj[key] === undefined) userObj[key] = null; });
    return userObj;
}

function setInterfaceMode(mode) {
    state.currentViewMode = mode;
    const btnDual = document.getElementById('btnDualMode');
    const headerInd = document.getElementById('headerIndicator');
    const headerSuf = document.getElementById('headerSuffix');
    
    if (state.isDualRole && btnDual) {
        btnDual.classList.replace('hidden', 'flex');
        btnDual.onclick = () => setInterfaceMode(state.currentViewMode === 'admin' ? 'collab' : 'admin');
        document.getElementById('dualModeText').innerText = mode === 'admin' ? "Área Colaborador" : "Área Admin";
        document.getElementById('dualModeIcon').className = mode === 'admin' ? "fas fa-user-astronaut text-[9px] text-gray-400" : "fas fa-shield-alt text-[9px] text-gray-400";
    }
    
    if (mode === 'admin') {
        state.isAdmin = true; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea]";
        if(headerSuf) { headerSuf.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuf.innerText = "ADMIN"; }
        Collab.destroyCollabUI(); Admin.initAdminUI(); 
    } else {
        state.isAdmin = false; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb]";
        if(headerSuf) { headerSuf.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuf.innerText = "COLLAB"; }
        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar', 'adminControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.getElementById('screenEdit')?.classList.remove('hidden');
        document.getElementById('weekendDutyContainer')?.classList.remove('hidden');
        Collab.initCollabUI();
        updatePersonalView(state.profile?.name || "Usuário");
    }
}

// --- FUNÇÃO DE HEARTBEAT (ATUALIZAÇÃO AUTOMÁTICA) ---
function startSystemHeartbeat() {
    // Roda a cada 60 segundos
    setInterval(() => {
        const now = new Date();
        const currentDay = now.getDate();
        const currentMonth = now.getMonth();

        // 1. Verifica se houve mudança de dia ou mês
        if (currentDay !== lastKnownDay || currentMonth !== lastKnownMonth) {
            console.log("Sistema detectou virada de dia/mês. Atualizando interface...");
            lastKnownDay = currentDay;
            lastKnownMonth = currentMonth;
            
            // Se virou o mês, talvez precisemos mudar a seleção do mês (opcional), 
            // mas o mínimo é recarregar a visualização atual.
            refreshCurrentView();
            showNotification("Data atualizada.", "info");
        } else {
            // Mesmo se o dia não mudou, forçamos atualização do Dashboard Admin 
            // para garantir que os contadores estejam sincronizados
            if (state.currentViewMode === 'admin') {
                Admin.renderDailyDashboard();
            }
        }
    }, 60000); 
}

// Atualiza a tela dependendo de onde o usuário está (Admin ou Collab)
function refreshCurrentView() {
    renderWeekendDuty(); // Atualiza Widget de FDS

    if (state.currentViewMode === 'admin') {
        Admin.renderDailyDashboard(); 
        Admin.populateEmployeeSelect();
        
        // Se houver um funcionário selecionado na edição, redesenha o calendário dele
        // para atualizar a classe 'is-today'
        const selectedEmp = document.getElementById('employeeSelect')?.value;
        if(selectedEmp) updatePersonalView(selectedEmp);
        
    } else {
        // Modo Colaborador: Redesenha o calendário pessoal para mover o 'Hoje'
        updatePersonalView(state.profile?.name);
    }
}

async function handleMonthChange(direction) {
    const cur = availableMonths.findIndex(m => m.year === state.selectedMonthObj.year && m.month === state.selectedMonthObj.month);
    const next = cur + direction;
    if (next >= 0 && next < availableMonths.length) { state.selectedMonthObj = availableMonths[next]; await loadData(); }
}
