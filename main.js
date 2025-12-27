// main.js - Versão Final SaaS (Estrutura Unificada)
import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification } from './ui.js'; 
import { doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Exportações Globais
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;
window.handleCellClick = (name, dayIndex) => {
    state.isAdmin ? Admin.handleAdminCellClick(name, dayIndex) : Collab.handleCollabCellClick(name, dayIndex);
};

// Logout
const performLogout = async () => { try { await signOut(auth); window.location.href = "start.html"; } catch (e) { console.error(e); } };
if(document.getElementById('btnLogout')) document.getElementById('btnLogout').onclick = performLogout;
if(document.getElementById('btnLogoutMobile')) document.getElementById('btnLogoutMobile').onclick = performLogout;

// --- LÓGICA DE LOGIN SAAS (ATUALIZADA) ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;
        try {
            // 1. Descobrir a Empresa (Tenant)
            const sysUserRef = doc(db, "sys_users", user.uid);
            const sysUserSnap = await getDoc(sysUserRef);

            if (!sysUserSnap.exists()) {
                console.error("⛔ Usuário sem vínculo empresarial.");
                await signOut(auth);
                window.location.href = "start.html";
                return;
            }

            // 2. Definir Tenant ID
            const sysData = sysUserSnap.data();
            state.companyId = sysData.companyId;
            console.log(`🏢 Conectado à empresa: ${state.companyId}`);

            // 3. Carregar Perfil Unificado (Nova Estrutura)
            // Agora buscamos apenas em 'users', pois todos estão lá
            const userDocRef = getCompanyDoc("users", user.uid);
            const userSnap = await getDoc(userDocRef);

            if (!userSnap.exists()) {
                throw new Error("Perfil não encontrado nesta empresa.");
            }

            state.profile = userSnap.data();
            const role = state.profile.role;

            // Define se é Admin/Líder ou Colaborador baseado no campo 'role'
            // Consideramos Admin quem tem cargo de gestão ou liderança
            const isPrivileged = (role === 'admin' || role === 'Lider' || role === 'Gestor Técnico');

            // Configura modo dual se for privilegiado (permitindo ver como collab)
            state.isDualRole = isPrivileged; 

            if (isPrivileged) {
                setInterfaceMode('admin');
            } else {
                setInterfaceMode('collab');
            }

            await loadData();

        } catch (e) {
            console.error("Erro Login:", e);
            // window.location.href = "start.html"; 
        }
    } else {
        window.location.href = "start.html";
    }
});

// --- CARREGAMENTO DE DADOS (ATUALIZADO) ---
async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    try {
        // 1. Busca Escala (Plantões)
        const rosterRef = getCompanySubCollection("escalas", docId, "plantonistas");
        const rosterSnap = await getDocs(rosterRef);

        // 2. Busca Detalhes dos Usuários (Agora na coleção 'users')
        // Filtramos apenas ativos se desejar, ou pegamos todos
        const usersRef = getCompanyCollection("users");
        const usersSnap = await getDocs(usersRef);
        
        const detailsMap = {};
        usersSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });

        await processScheduleData(rosterSnap, detailsMap);
        
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));
        
        // Reaplica interface
        setInterfaceMode(state.currentViewMode);
        renderWeekendDuty();

    } catch (error) { console.error("Load Data Error:", error); } 
    finally { hideLoader(); }
}

async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    
    // Processa quem tem escala salva
    querySnapshot.forEach((doc) => {
        const uid = doc.id;
        const scaleData = doc.data();
        const userProfile = detailsMap[uid];

        if (userProfile) { // Só processa se o usuário existir no cadastro
            processed[userProfile.nome] = {
                uid: uid,
                name: userProfile.nome,
                role: userProfile.role || 'colaborador',
                cargo: userProfile.cargo || '-',
                setorID: userProfile.setorID || 'NOC',
                horario: userProfile.horario || "08:00 às 17:00",
                schedule: Array.isArray(scaleData.calculatedSchedule) ? [...scaleData.calculatedSchedule] : [],
                email: userProfile.email || ""
            };
        }
    });

    // Opcional: Adicionar usuários que estão no cadastro mas ainda não têm escala salva
    // Isso garante que novos funcionários apareçam no seletor do Admin
    Object.keys(detailsMap).forEach(uid => {
        const u = detailsMap[uid];
        if (!Object.values(processed).some(p => p.uid === uid)) {
             processed[u.nome] = {
                uid: uid,
                name: u.nome,
                role: u.role || 'colaborador',
                cargo: u.cargo || '-',
                setorID: u.setorID || 'NOC',
                horario: u.horario || "08:00 às 17:00",
                schedule: [], // Sem escala ainda
                email: u.email || ""
            };
        }
    });

    state.scheduleData = processed;
}

// --- CONTROLE DE MODO ---
function setInterfaceMode(mode) {
    state.currentViewMode = mode;
    const btnDual = document.getElementById('btnDualMode');
    const headerInd = document.getElementById('headerIndicator');
    const headerSuf = document.getElementById('headerSuffix');

    if (state.isDualRole && btnDual) {
        btnDual.classList.remove('hidden'); btnDual.classList.add('flex');
        btnDual.onclick = () => setInterfaceMode(state.currentViewMode === 'admin' ? 'collab' : 'admin');
        
        document.getElementById('dualModeText').innerText = mode === 'admin' ? "Área Colaborador" : "Área Admin";
        document.getElementById('dualModeIcon').className = mode === 'admin' ? "fas fa-user-astronaut text-[9px] text-gray-400 group-hover:text-blue-400" : "fas fa-shield-alt text-[9px] text-gray-400 group-hover:text-purple-400";
    }

    if (mode === 'admin') {
        state.isAdmin = true; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea] transition-colors";
        if(headerSuf) { headerSuf.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuf.innerText = "ADMIN"; }
        
        Collab.destroyCollabUI(); 
        Admin.initAdminUI(); 

    } else {
        state.isAdmin = false; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb] transition-colors";
        if(headerSuf) { headerSuf.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuf.innerText = "COLLAB"; }

        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar', 'adminControls'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });
        document.getElementById('screenEdit').classList.remove('hidden');
        document.getElementById('weekendDutyContainer').classList.remove('hidden');

        Collab.initCollabUI();
        
        const myName = state.profile?.name || state.profile?.nome;
        updatePersonalView(myName);
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
