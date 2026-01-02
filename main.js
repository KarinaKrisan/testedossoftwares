// main.js
import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, renderWeekendDuty, showNotification, updateDynamicMenu } from './ui.js'; 
import { doc, getDoc, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// --- GLOBAL EXPORTS ---
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;
window.handleCellClick = (name, dayIndex) => { state.isAdmin ? Admin.handleAdminCellClick(name, dayIndex) : Collab.handleCollabCellClick(name, dayIndex); };
window.loadData = loadData; 

// Logout Handler
const performLogout = async () => { try { await signOut(auth); window.location.href = "start.html"; } catch (e) { console.error(e); } };
['btnLogout', 'btnLogoutMobile'].forEach(id => { const btn = document.getElementById(id); if(btn) btn.onclick = performLogout; });

// Auth Observer
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
                state.profile = newData;
                const myLevel = newData.level || 10;
                state.isDualRole = myLevel >= 40; 
                
                updateDynamicMenu();
                if (state.isDualRole) setInterfaceMode('admin'); else setInterfaceMode('collab');
                
                loadData(); 
                isFirstLoad = false;
            });
        } catch (e) { console.error(e); }
    } else { if (!window.location.href.includes("start.html")) window.location.href = "start.html"; }
});

// Load Data Function
async function loadData() {
    const sel = document.getElementById('monthSelect');
    if(sel && state.selectedMonthObj) {
        sel.value = `${state.selectedMonthObj.year}-${state.selectedMonthObj.month}`;
    }

    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    try {
        const [rosterSnap, usersSnap] = await Promise.all([
            getDocs(getCompanySubCollection("escalas", docId, "plantonistas")),
            getDocs(getCompanyCollection("users"))
        ]);
        const detailsMap = {};
        usersSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });
        await processScheduleData(rosterSnap, detailsMap);
        
        if (state.currentViewMode === 'admin') { 
            Admin.renderDailyDashboard(); 
            Admin.populateEmployeeSelect(); 
        } else { 
            updatePersonalView(state.profile?.name); 
        }
        renderWeekendDuty();
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
    const headerInd = document.getElementById('headerIndicator');
    const headerSuf = document.getElementById('headerSuffix');
    
    // Configuração Visual Admin vs Collab
    if (mode === 'admin') {
        state.isAdmin = true; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea]";
        if(headerSuf) { headerSuf.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuf.innerText = "ADMIN"; }
        
        // --- ALTERAÇÃO AQUI: OCULTA O WIDGET DE FDS NO MODO ADMIN ---
        document.getElementById('weekendDutyContainer')?.classList.add('hidden');

        Collab.destroyCollabUI(); 
        Admin.initAdminUI(); 
    } else {
        state.isAdmin = false; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb]";
        if(headerSuf) { headerSuf.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuf.innerText = "COLLAB"; }
        
        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar', 'adminControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.getElementById('screenEdit')?.classList.remove('hidden');
        
        // Exibe no modo Colaborador
        document.getElementById('weekendDutyContainer')?.classList.remove('hidden');
        
        Collab.initCollabUI();
        updatePersonalView(state.profile?.name || "Usuário");
    }
}
