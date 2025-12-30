/**
 * main.js - Versão Final (Padronizado para coleção 'users')
 * Sistema: Cronosys SaaS
 */

import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification } from './ui.js'; 
import { doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// --- EXPORTAÇÕES GLOBAIS ---
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;

// Manipulador de clique na célula
window.handleCellClick = (name, dayIndex) => {
    state.isAdmin ? Admin.handleAdminCellClick(name, dayIndex) : Collab.handleCollabCellClick(name, dayIndex);
};

// --- SISTEMA DE LOGOUT ---
const performLogout = async () => { 
    try { 
        await signOut(auth); 
        window.location.href = "start.html"; 
    } catch (e) { 
        console.error("Erro ao sair:", e); 
    } 
};

['btnLogout', 'btnLogoutMobile'].forEach(id => {
    const btn = document.getElementById(id);
    if(btn) btn.onclick = performLogout;
});

// --- NÚCLEO DE AUTENTICAÇÃO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;
        try {
            // 1. Refresh de Claims e ID da Empresa
            const idTokenResult = await user.getIdTokenResult(true);
            const userClaims = idTokenResult.claims;
            let rawCompanyId = userClaims.companyId;

            // Fallback: busca no sys_users se o claim não estiver pronto
            if (!rawCompanyId) {
                const sysUserSnap = await getDoc(doc(db, "sys_users", user.uid));
                if (sysUserSnap.exists()) {
                    rawCompanyId = sysUserSnap.data().companyId;
                }
            }

            if (!rawCompanyId) {
                console.error("Erro Crítico: Usuário sem empresa vinculada.");
                return performLogout();
            }

            state.companyId = String(rawCompanyId).trim();

            // 2. Carregamento de Perfil (Padronizado para 'users')
            // getCompanyDoc("users", uid) resolve para -> companies/{id}/users/{uid}
            const userDocRef = getCompanyDoc("users", user.uid);
            const userSnap = await getDoc(userDocRef);

            if (!userSnap.exists()) {
                console.warn(`Perfil não encontrado em: companies/${state.companyId}/users/${user.uid}`);
                // Não faz logout imediato para permitir debug, mas mostra erro
                showNotification("Perfil de usuário não encontrado.", "error");
                throw new Error("Perfil de usuário incompleto.");
            }

            state.profile = userSnap.data();
            
            // 3. Definição de Nível (Admin vs Collab)
            const myLevel = userClaims.level || state.profile.level || 10;
            state.isDualRole = myLevel >= 40; 

            if (state.isDualRole) {
                setInterfaceMode('admin');
            } else {
                setInterfaceMode('collab');
            }

            await loadData();

        } catch (e) {
            console.error("Erro no fluxo de entrada:", e);
            showNotification(e.message, "error");
        }
    } else {
        if (!window.location.href.includes("start.html")) {
            window.location.href = "start.html";
        }
    }
});

// --- MOTOR DE DADOS ---
async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    
    try {
        // Busca escalas e TODOS os usuários da empresa para montar a lista
        const [rosterSnap, usersSnap] = await Promise.all([
            getDocs(getCompanySubCollection("escalas", docId, "plantonistas")),
            getDocs(getCompanyCollection("users")) // Busca na coleção 'users' unificada
        ]);

        const detailsMap = {};
        usersSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });

        await processScheduleData(rosterSnap, detailsMap);
        
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));
        
        // Renderiza interface
        setInterfaceMode(state.currentViewMode);
        renderWeekendDuty();

    } catch (error) { 
        console.error("Erro no carregamento de dados:", error); 
        showNotification("Erro de conexão.", "error");
    } finally { 
        hideLoader(); 
    }
}

// Cruzamento de dados: Escala vs Perfil
async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    
    // 1. Quem tem escala
    querySnapshot.forEach((doc) => {
        const uid = doc.id;
        const scaleData = doc.data();
        const userProfile = detailsMap[uid];

        if (userProfile && userProfile.active !== false) { 
            const safeName = userProfile.name || userProfile.nome || "Sem Nome";
            processed[safeName] = buildUserObj(uid, userProfile, scaleData.calculatedSchedule);
        }
    });

    // 2. Quem não tem escala ainda (aparece vazio)
    Object.keys(detailsMap).forEach(uid => {
        const u = detailsMap[uid];
        const safeName = u.name || u.nome || "Sem Nome";

        // Adiciona se estiver ativo e ainda não foi processado
        if (u.active !== false && !Object.values(processed).some(p => p.uid === uid)) {
             processed[safeName] = buildUserObj(uid, u, []);
        }
    });

    state.scheduleData = processed;
}

// Sanitização de Objeto de Usuário
function buildUserObj(uid, profile, schedule) {
    const safeName = profile.name || profile.nome || "Usuário Sem Nome";

    let safeSchedule = Array.isArray(schedule) 
        ? schedule.map(day => (day === undefined || day === null) ? "" : day)
        : [];

    const userObj = {
        uid: uid,
        name: safeName, 
        role: profile.role || 'collaborator',
        level: profile.level || 10,
        cargo: profile.cargo || '-',
        setorID: profile.setorID || 'NOC',
        email: profile.email || "",
        horario: profile.horario || "08:00 às 17:00",
        schedule: safeSchedule,
        ...profile 
    };

    // Remove undefined
    Object.keys(userObj).forEach(key => {
        if (userObj[key] === undefined) userObj[key] = null;
    });

    return userObj;
}

// --- CONTROLE DE INTERFACE ---
function setInterfaceMode(mode) {
    state.currentViewMode = mode;
    const btnDual = document.getElementById('btnDualMode');
    const headerInd = document.getElementById('headerIndicator');
    const headerSuf = document.getElementById('headerSuffix');

    if (state.isDualRole && btnDual) {
        btnDual.classList.replace('hidden', 'flex');
        btnDual.onclick = () => setInterfaceMode(state.currentViewMode === 'admin' ? 'collab' : 'admin');
        
        document.getElementById('dualModeText').innerText = mode === 'admin' ? "Área Colaborador" : "Área Admin";
        document.getElementById('dualModeIcon').className = mode === 'admin' 
            ? "fas fa-user-astronaut text-[9px] text-gray-400" 
            : "fas fa-shield-alt text-[9px] text-gray-400";
    }

    if (mode === 'admin') {
        state.isAdmin = true; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea]";
        if(headerSuf) { headerSuf.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuf.innerText = "ADMIN"; }
        
        Collab.destroyCollabUI(); 
        Admin.initAdminUI(); 
    } else {
        state.isAdmin = false; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb]";
        if(headerSuf) { headerSuf.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuf.innerText = "COLLAB"; }

        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar', 'adminControls'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });

        document.getElementById('screenEdit')?.classList.remove('hidden');
        document.getElementById('weekendDutyContainer')?.classList.remove('hidden');

        Collab.initCollabUI();
        updatePersonalView(state.profile?.name || "Usuário");
    }
}

async function handleMonthChange(direction) {
    const cur = availableMonths.findIndex(m => m.year === state.selectedMonthObj.year && m.month === state.selectedMonthObj.month);
    const next = cur + direction;
    if (next >= 0 && next < availableMonths.length) {
        state.selectedMonthObj = availableMonths[next];
        await loadData();
    }
}
