// main.js - Versão Final SaaS
import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification } from './ui.js'; 
import { doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Exportações Globais
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;
window.handleCellClick = (name, dayIndex) => {
    state.currentViewMode === 'admin' ? Admin.handleAdminCellClick(name, dayIndex) : Collab.handleCollabCellClick(name, dayIndex);
};

// Logout
const performLogout = async () => { try { await signOut(auth); window.location.href = "start.html"; } catch (e) { console.error(e); } };
if(document.getElementById('btnLogout')) document.getElementById('btnLogout').onclick = performLogout;
if(document.getElementById('btnLogoutMobile')) document.getElementById('btnLogoutMobile').onclick = performLogout;

// --- LÓGICA DE LOGIN SAAS ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;
        try {
            // 1. Descobrir a Empresa (Tenant) no mapa global
            const sysUserRef = doc(db, "sys_users", user.uid);
            const sysUserSnap = await getDoc(sysUserRef);

            if (!sysUserSnap.exists()) {
                console.error("⛔ Usuário sem vínculo empresarial.");
                await signOut(auth);
                window.location.href = "start.html";
                return;
            }

            // 2. Definir Tenant ID no Estado
            const sysData = sysUserSnap.data();
            state.companyId = sysData.companyId;
            console.log(`🏢 Conectado à empresa: ${state.companyId}`);

            // 3. Carregar Perfil DENTRO da Empresa
            const [adminSnap, collabSnap] = await Promise.all([
                getDoc(getCompanyDoc("administradores", user.uid)),
                getDoc(getCompanyDoc("colaboradores", user.uid))
            ]);

            const isAdmin = adminSnap.exists();
            const isCollab = collabSnap.exists();
            state.isDualRole = (isAdmin && isCollab);

            // Prioridade de Visão
            if (state.isDualRole) {
                state.profile = { ...collabSnap.data(), ...adminSnap.data() };
                setInterfaceMode('admin');
            } else if (isAdmin) {
                state.profile = adminSnap.data();
                setInterfaceMode('admin');
            } else if (isCollab) {
                state.profile = collabSnap.data();
                setInterfaceMode('collab');
            } else {
                throw new Error("Perfil não encontrado nesta empresa.");
            }

            await loadData();

        } catch (e) {
            console.error("Erro Login:", e);
            // Em produção, descomente: window.location.href = "start.html";
        }
    } else {
        window.location.href = "start.html";
    }
});

// --- CARREGAMENTO DE DADOS (Scoped by Tenant) ---
async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    try {
        // Busca escala da empresa atual
        const rosterRef = getCompanySubCollection("escalas", docId, "plantonistas");
        const rosterSnap = await getDocs(rosterRef);

        const detailsRef = getCompanyCollection("colaboradores");
        const detailsSnap = await getDocs(detailsRef);
        
        const detailsMap = {};
        detailsSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });

        await processScheduleData(rosterSnap, detailsMap);
        
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));
        setInterfaceMode(state.currentViewMode);
        renderWeekendDuty();

    } catch (error) { console.error("Load Data Error:", error); } 
    finally { hideLoader(); }
}

async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    querySnapshot.forEach((doc) => {
        const emp = doc.data();
        const uid = doc.id;
        const cleanName = (emp.nome || "").trim();
        const extra = detailsMap[uid] || {};

        if (cleanName) {
            processed[cleanName] = {
                uid: uid,
                name: cleanName,
                role: extra.role || emp.role || 'Operador',
                cargo: extra.cargo || emp.cargo || 'Operador', 
                setorID: extra.celula || emp.setorID || 'NOC', 
                horario: extra.horario || "08:00 às 17:00", 
                schedule: Array.isArray(emp.calculatedSchedule) ? [...emp.calculatedSchedule] : [],
                email: emp.email || ""
            };
        }
    });
    state.scheduleData = processed;
}

function setInterfaceMode(mode) {
    state.currentViewMode = mode;
    const btnDual = document.getElementById('btnDualMode');
    const headerInd = document.getElementById('headerIndicator');
    const headerSuf = document.getElementById('headerSuffix');

    if (state.isDualRole && btnDual) {
        btnDual.classList.remove('hidden'); btnDual.classList.add('flex');
        btnDual.onclick = () => setInterfaceMode(state.currentViewMode === 'admin' ? 'collab' : 'admin');
        document.getElementById('dualModeText').innerText = mode === 'admin' ? "Colaborador" : "Admin";
    }

    if (mode === 'admin') {
        state.isAdmin = true; 
        Admin.initAdminUI();
        Collab.destroyCollabUI(); 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea] transition-colors";
        if(headerSuf) { headerSuf.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuf.innerText = "ADMIN"; }
    } else {
        state.isAdmin = false; 
        Collab.initCollabUI();
        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.getElementById('screenEdit').classList.remove('hidden');
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb] transition-colors";
        if(headerSuf) { headerSuf.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuf.innerText = "COLLAB"; }
        updatePersonalView(state.profile?.name || state.profile?.nome);
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
