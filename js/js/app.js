/* =========================================================
   LOGIKA APLIKASI - Capai Harapan Juwara
   Bagian: 1 Storage | 2 State | 3 UI helper | 4 Auth | 5 Alokasi |
           6 Transaksi | 7 Simulasi | 8 STMJ+ | 9 Ekspor | 10 Grafik | 11 PWA
   ========================================================= */

/* ---------- 1. STORAGE LOKAL (IndexedDB) ---------- */
const DB_NAME = 'JuwaraAppDB', DB_VERSION = 2, STORE_NAME = 'userState';
let localDB;
function initLocalDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'username' });
        };
        request.onsuccess = (e) => { localDB = e.target.result; resolve(); };
        request.onerror = () => reject();
    });
}
function saveToLocal(username, data) {
    if (!localDB || !username) return;
    localDB.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ username, state: data });
}
function getFromLocal(username) {
    return new Promise((resolve) => {
        if (!localDB || !username) { resolve(null); return; }
        const req = localDB.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(username);
        req.onsuccess = () => resolve(req.result ? req.result.state : null);
        req.onerror = () => resolve(null);
    });
}

/* ---------- 2. STATE ---------- */
function defaultState() {
    return {
        juraganName: "", warungName: "", kapasitasBulanSimulasi: 0,
        harapans: [], transactions: [], activeHarapanId: null,
        alokasi: { ...APP_CONFIG.defaultAlokasi }
    };
}
let State = defaultState();
let myChart = null, deferredPrompt = null, currentUsername = "", firestoreUnsubscribe = null;
let trxActiveTab = 'fisik', editingHarapanId = null, confirmActionCallback = null;

/* ---------- 3. UI HELPER ---------- */
const $ = (id) => document.getElementById(id);
function formatRp(num) { return 'Rp ' + Math.round(num || 0).toLocaleString('id-ID'); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function pad2(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; } // tanggal lokal (YYYY-MM-DD)
function todayStr() { return dateStr(new Date()); }
function sumTracker(h) { return (h.trackerData || []).reduce((s, i) => s + (i.nominal || 0), 0); }

function openModal(id) { const m = $(id); m.classList.remove('hidden'); void m.offsetWidth; m.classList.add('show'); }
function closeModal(id) { const m = $(id); m.classList.remove('show'); setTimeout(() => m.classList.add('hidden'), 300); }
function tampilkanModal(judul, pesan) { $('modal-title').innerText = judul; $('modal-desc').innerText = pesan; openModal('custom-modal'); }
function tutupModal() { closeModal('custom-modal'); }
function tampilkanConfirm(judul, pesan, cb) { $('confirm-title').innerText = judul; $('confirm-desc').innerText = pesan; confirmActionCallback = cb; openModal('confirm-modal'); }
function tutupConfirmModal() { closeModal('confirm-modal'); }
$('btn-confirm-action').onclick = () => { if (confirmActionCallback) confirmActionCallback(); tutupConfirmModal(); };

function navigasiKe(pageId) {
    ['page-edukasi', 'page-transaksi', 'page-keuangan', 'page-stmj', 'page-pantau'].forEach(id => $(id).classList.add('hidden'));
    $(pageId).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const btn = $('nav-' + pageId.split('-')[1]);
    if (btn && pageId !== 'page-stmj') btn.classList.add('active');
    if (pageId === 'page-pantau') renderChart();
}

/* ---------- 4. AUTH & SYNC ---------- */
async function prosesLogin() {
    const u = $('login-username').value.trim().toLowerCase();
    if (!u) { tampilkanModal("Perhatian", "Username tidak boleh kosong!"); return; }
    if (!APP_CONFIG.allowedUsers.includes(u)) { tampilkanModal("Akses Ditolak", "Maaf, username Anda tidak terdaftar. Hubungi admin untuk akses."); return; }

    const btn = $('btn-login');
    btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> Memuat...'; btn.disabled = true;
    currentUsername = u;
    localStorage.setItem('juwara_last_user', u);

    await initLocalDB();
    let dataDitemukan = false;
    const localData = await getFromLocal(currentUsername);
    if (localData) { applyState(localData); dataDitemukan = true; }

    if (window.fbAuth && window.fbDb) {
        try {
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await window.fbSignInWithCustomToken(window.fbAuth, __initial_auth_token);
            else await window.fbSignInAnonymously(window.fbAuth);

            const docRef = window.fbDoc(window.fbDb, 'artifacts', window.appId, 'public', 'data', 'stmj_users', currentUsername);
            const snap = await window.fbGetDoc(docRef);
            if (snap.exists() && snap.data().state) { applyState(snap.data().state); dataDitemukan = true; saveToLocal(currentUsername, State); }

            if (firestoreUnsubscribe) firestoreUnsubscribe();
            firestoreUnsubscribe = window.fbOnSnapshot(docRef, (d) => {
                if (d.exists() && d.data().state && !d.metadata.hasPendingWrites) {
                    applyState(d.data().state); saveToLocal(currentUsername, State);
                    if (!$('main-app').classList.contains('hidden')) renderUI();
                }
            });
        } catch (e) { console.log("Offline mode or cloud error, relying on local cache."); }
    }

    masukKeAplikasi(dataDitemukan && State.juraganName !== "");
    btn.innerHTML = 'Masuk <i class="ph-bold ph-arrow-right"></i>'; btn.disabled = false;
}

window.addEventListener('DOMContentLoaded', async () => {
    const lastUser = localStorage.getItem('juwara_last_user');
    if (lastUser) { $('login-username').value = lastUser; await prosesLogin(); }
});

function applyState(s) {
    if (!s.harapans && s.isHarapanLocked) {
        s.harapans = [{ id: Date.now(), name: s.harapanName, target: s.targetRp, deadline: s.deadline, trackerData: s.trackerData || [] }];
        s.activeHarapanId = s.harapans[0].id;
    }
    if (!s.harapans) s.harapans = [];
    s.harapans.forEach(h => { if (!h.trackerData) h.trackerData = []; });
    if (!s.transactions) s.transactions = [];
    if (!s.alokasi) s.alokasi = { ...APP_CONFIG.defaultAlokasi };
    State = s;
}

async function syncKeCloud() {
    if (!currentUsername) return;
    saveToLocal(currentUsername, State);
    if (!window.fbDb || !window.fbAuth?.currentUser) return;
    try {
        const docRef = window.fbDoc(window.fbDb, 'artifacts', window.appId, 'public', 'data', 'stmj_users', currentUsername);
        await window.fbSetDoc(docRef, { state: State, lastUpdated: new Date().toISOString() }, { merge: true });
    } catch (e) {}
}

function masukKeAplikasi(hasData) {
    $('login-screen').classList.add('hidden');
    if (hasData) {
        $('main-app').classList.remove('hidden');
        $('onboarding-screen').classList.add('hidden');
        $('inp-trx-tgl').value = todayStr();
        renderUI(); navigasiKe('page-edukasi');
    } else { $('onboarding-screen').classList.remove('hidden'); }
}

function prosesLogout() {
    if (firestoreUnsubscribe) firestoreUnsubscribe();
    currentUsername = "";
    localStorage.removeItem('juwara_last_user');
    State = defaultState();
    $('main-app').classList.add('hidden');
    $('onboarding-screen').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
    $('login-username').value = "";
}

function mulaiBuku() {
    const nama = $('setup-nama').value.trim();
    if (!nama) { tampilkanModal("Perhatian", "Nama Juragan wajib diisi!"); return; }
    State.juraganName = nama; State.warungName = $('setup-warung').value.trim();
    syncKeCloud(); masukKeAplikasi(true);
}

function renderUI() {
    $('header-juragan-name').innerText = State.juraganName;
    const a = State.alokasi;
    ['modalBerjalan', 'modalTetap', 'pokok', 'tabungan', 'gayaHidup'].forEach(k => { $('inp-alo-' + k).value = parseInt(a[k]) || 0; });
    renderAlokasiUI(); renderTransaksi(); hitungCepat(); renderHarapanUI(); updatePantauFilters(); hitungTotalGlobal();
}

/* ---------- 5. ALOKASI ---------- */
function updateAlokasi(key, val) {
    let num = parseInt(val) || 0;
    num = Math.min(100, Math.max(0, num));
    State.alokasi[key] = num; $('inp-alo-' + key).value = num;
    renderAlokasiUI(); renderTransaksi(); hitungCepat(); syncKeCloud();
}

function setAlert(type, icon, title, msgHtml) {
    $('alo-alert-box').className = 'alert alert-' + type;
    const colors = { success: 'emerald', warning: 'amber', danger: 'red' }[type];
    $('alo-alert-icon').className = `ph-fill ${icon} text-${colors}-500 text-3xl shrink-0`;
    $('alo-alert-title').className = `font-bold text-sm text-${colors}-800`; $('alo-alert-title').innerText = title;
    $('alo-alert-msg').className = `text-[11px] text-${colors}-700 mt-0.5 leading-relaxed font-medium`; $('alo-alert-msg').innerHTML = msgHtml;
}

function renderAlokasiUI() {
    if (!State.alokasi) State.alokasi = { ...APP_CONFIG.defaultAlokasi };
    const a = State.alokasi;
    const totBisnis = a.modalBerjalan + a.modalTetap, totKeluarga = a.pokok + a.tabungan + a.gayaHidup, totalAll = totBisnis + totKeluarga;
    $('alo-total-bisnis').innerText = totBisnis + '%'; $('alo-total-keluarga').innerText = totKeluarga + '%';
    $('lbl-sim-pct').innerText = a.tabungan + '%';

    if (totalAll !== 100) setAlert('danger', 'ph-warning-circle', 'Total Harus 100%!', `Saat ini total alokasi Anda adalah <strong>${totalAll}%</strong>. Kurangi atau tambahkan angka di bawah agar pas 100%.`);
    else if (totBisnis < APP_CONFIG.bisnisMin) setAlert('warning', 'ph-warning', 'Bahaya! Modal Warung Menipis', `Porsi bisnis cuma <strong>${totBisnis}%</strong>. Hati-hati, uang modal untuk kulakan bisa terpakai untuk dapur dan warung bisa bangkrut.`);
    else if (a.tabungan < APP_CONFIG.idealTabunganMin) setAlert('warning', 'ph-warning', 'Kurang Ideal untuk STMJ+', `Tabungan hanya <strong>${a.tabungan}%</strong> (Idealnya minimal ${APP_CONFIG.idealTabunganMin}%). Harapan STMJ+ Anda akan jauh lebih lambat terwujud.`);
    else setAlert('success', 'ph-check-circle', 'Alokasi Sangat Ideal!', `Keren! <strong>${totBisnis}% Bisnis</strong> dan <strong>${a.tabungan}% Tabungan</strong> memastikan warung aman & harapan STMJ+ cepat terwujud.`);
}

/* ---------- 6. TRANSAKSI ---------- */
function switchTrxTab(tab) {
    trxActiveTab = tab;
    ['fisik', 'virtual', 'lain'].forEach(t => $('tab-trx-' + t).classList.toggle('active', t === tab));
    const lblN = $('lbl-trx-nama'), inpN = $('inp-trx-nama');
    $('trx-virtual-sel').classList.toggle('hidden', tab !== 'virtual');
    $('trx-lain-sel').classList.toggle('hidden', tab !== 'lain');
    $('trx-wrap-harga').classList.toggle('hidden', tab === 'lain');
    $('trx-wrap-qty').classList.toggle('hidden', tab === 'lain');
    $('col-untung').classList.toggle('col-span-2', tab === 'lain');
    $('lbl-trx-untung').innerText = tab === 'lain' ? "Nominal Pemasukan (Rp)" : "Untung Bersih (Rp)";
    if (tab === 'fisik') { lblN.innerText = "Nama Produk Fisik"; inpN.placeholder = "Contoh: Beras 5Kg"; }
    else if (tab === 'virtual') { lblN.innerText = "Detail / Nomor (Opsional)"; inpN.placeholder = "Contoh: 0812xxxx (No HP)"; }
    else { lblN.innerText = "Keterangan Pemasukan"; inpN.placeholder = "Opsional: Tambahan info"; }
    inpN.value = "";
}

function toggleLainnya() {
    const sel = trxActiveTab === 'virtual' ? $('inp-trx-v-kategori') : $('inp-trx-l-kategori');
    const lblN = $('lbl-trx-nama'), inpN = $('inp-trx-nama');
    if (sel.value === 'Lainnya') {
        lblN.innerText = trxActiveTab === 'virtual' ? "Tulis Nama Produk Virtual" : "Tulis Jenis Pemasukan"; inpN.placeholder = "Ketik disini...";
    } else {
        lblN.innerText = trxActiveTab === 'virtual' ? "Detail / Nomor (Opsional)" : "Keterangan (Opsional)";
        inpN.placeholder = trxActiveTab === 'virtual' ? "Detail pesanan..." : "Info tambahan...";
    }
}

function updateQtyTrx(delta) {
    const el = $('inp-trx-qty');
    el.value = Math.min(10000, Math.max(1, (parseInt(el.value) || 1) + delta));
}

function simpanTransaksi() {
    const tglInp = $('inp-trx-tgl').value;
    if (!tglInp) { tampilkanModal("Perhatian", "Pilih tanggal transaksi terlebih dahulu!"); return; }
    const timestamp = new Date(tglInp + 'T12:00:00').toISOString();
    let name = $('inp-trx-nama').value.trim();
    const profit = parseInt($('inp-trx-untung').value.replace(/\D/g, '')) || 0;
    let price = 0, qty = 1;

    if (trxActiveTab !== 'lain') {
        price = parseInt($('inp-trx-harga').value.replace(/\D/g, '')) || 0;
        qty = parseInt($('inp-trx-qty').value) || 1;
        if (trxActiveTab === 'virtual') {
            const cat = $('inp-trx-v-kategori').value;
            if (cat === 'Lainnya' && !name) { tampilkanModal("Perhatian", "Tulis nama produk virtualnya!"); return; }
            name = cat === 'Lainnya' ? name : `${cat} ${name ? '(' + name + ')' : ''}`;
        } else if (!name) { tampilkanModal("Perhatian", "Isi Nama Produk!"); return; }
        if (price <= 0 || profit <= 0) { tampilkanModal("Perhatian", "Harga Jual dan Untung harus lebih besar dari 0!"); return; }
        if (profit > price) { tampilkanModal("Perhatian", "Untung tidak logis (lebih besar dari harga jual)!"); return; }
    } else {
        const cat = $('inp-trx-l-kategori').value;
        if (cat === 'Lainnya' && !name) { tampilkanModal("Perhatian", "Tulis jenis pemasukannya!"); return; }
        name = cat === 'Lainnya' ? name : `${cat} ${name ? '(' + name + ')' : ''}`;
        if (profit <= 0) { tampilkanModal("Perhatian", "Nominal pemasukan harus diisi dan lebih dari 0!"); return; }
        price = profit;
    }

    State.transactions.push({ id: Date.now(), type: trxActiveTab, name, price, profit, qty, timestamp });
    ['inp-trx-nama', 'inp-trx-harga', 'inp-trx-untung'].forEach(i => $(i).value = "");
    $('inp-trx-qty').value = "1";
    syncKeCloud(); renderTransaksi(); hitungTargetSTMJ();
}

function hapusTransaksi(id) {
    State.transactions = State.transactions.filter(t => t.id !== id);
    syncKeCloud(); renderTransaksi(); hitungTargetSTMJ();
}

function getRekapActuals() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = now.getDay() || 7;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let untungHari = 0, untungMinggu = 0, untungBulan = 0;
    (State.transactions || []).forEach(t => {
        const tt = new Date(t.timestamp).getTime(), tot = t.profit * t.qty;
        if (tt >= todayStart) untungHari += tot;
        if (tt >= weekStart) untungMinggu += tot;
        if (tt >= monthStart) untungBulan += tot;
    });
    return { untungHari, untungMinggu, untungBulan };
}

function renderTransaksi() {
    const list = $('trx-list'); list.innerHTML = '';
    const rekap = getRekapActuals();
    const sorted = [...State.transactions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const iconMap = { fisik: 'ph-package', virtual: 'ph-device-mobile', lain: 'ph-wallet text-green-500' };

    sorted.slice(0, 15).forEach(t => {
        const totU = t.profit * t.qty;
        const d = new Date(t.timestamp).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        const detail = t.type !== 'lain'
            ? `Terjual: <span class="font-bold text-slate-700">${t.qty}x</span> | Bati: <span class="text-slate-600">${formatRp(t.profit)}</span>/pcs`
            : `Kategori: <span class="font-bold text-green-600">Pemasukan Lain</span>`;
        list.innerHTML += `
            <div class="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-100 shadow-sm mb-2">
                <div class="w-2/3 pr-2">
                    <div class="text-[11px] font-extrabold text-slate-800 truncate flex items-center gap-1.5 mb-1"><i class="ph-fill ${iconMap[t.type] || 'ph-package'} text-slate-400"></i> ${esc(t.name)}</div>
                    <div class="text-[9px] text-slate-400 font-bold mb-0.5">${d}</div>
                    <div class="text-[10px] text-slate-500 font-medium">${detail}</div>
                </div>
                <div class="flex items-center gap-2 border-l border-slate-100 pl-3">
                    <strong class="text-xs text-emerald-600">+${formatRp(totU)}</strong>
                    <button onclick="hapusTransaksi(${t.id})" class="text-slate-300 hover:text-red-500 bg-slate-50 p-1.5 rounded-lg"><i class="ph-bold ph-trash text-base"></i></button>
                </div>
            </div>`;
    });
    if (State.transactions.length === 0) list.innerHTML = `<div class="text-center text-[11px] text-slate-400 py-4 font-medium">Belum ada transaksi dicatat.</div>`;

    $('rek-untung-hari').innerText = formatRp(rekap.untungHari);
    $('rek-untung-minggu').innerText = formatRp(rekap.untungMinggu);
    $('rek-untung-bulan').innerText = formatRp(rekap.untungBulan);
    updateBanner(); renderPrioList();
}

/* ---------- 7. SIMULASI ---------- */
function hitungCepat() {
    const omzet = parseFloat($('calc-omzet').value) || 0;
    const labaPulsa = parseFloat($('calc-pulsa').value) || 0;
    const beban = parseFloat($('calc-beban').value) || 0;
    const totalUntung = omzet * APP_CONFIG.marginSembako + labaPulsa - beban;
    State.kapasitasBulanSimulasi = Math.max(0, totalUntung * (State.alokasi.tabungan / 100));
    syncKeCloud();
    $('hasil-tabung-bulan').innerText = formatRp(State.kapasitasBulanSimulasi);
    $('hasil-tabung-hari').innerText = formatRp(State.kapasitasBulanSimulasi / APP_CONFIG.daysPerMonth) + ' / hari';
    hitungTargetSTMJ();
}

/* ---------- 8. STMJ+ ---------- */
function getActiveHarapan() { return State.harapans.find(h => h.id === State.activeHarapanId); }

function daysLeftOf(h) { return Math.max(1, Math.ceil((new Date(h.deadline) - new Date()) / 86400000)); }

// Target setoran per hari / per bulan sesuai pola nabung harapan
function kebutuhanSetoran(h) {
    const sisa = Math.max(0, h.target - sumTracker(h));
    const days = daysLeftOf(h);
    if (h.frekuensi === 'bulanan') return { nilai: sisa / Math.max(1, days / APP_CONFIG.daysPerMonth), suffix: '/ bulan' };
    return { nilai: sisa / days, suffix: '/ hari' };
}

// Urutan prioritas: deadline terdekat; bila sama, yang kebutuhannya paling dekat dengan kapasitas tabungan
function sortHarapans() {
    if (!State.harapans.length) return;
    const rekap = getRekapActuals();
    const jatahHari = (rekap.untungBulan * (State.alokasi.tabungan / 100)) / APP_CONFIG.daysPerMonth;
    const cap = jatahHari > 0 ? jatahHari : ((State.kapasitasBulanSimulasi || 0) / APP_CONFIG.daysPerMonth || 1);
    const needPerDay = (h) => Math.max(0, h.target - sumTracker(h)) / daysLeftOf(h);
    State.harapans.sort((a, b) => {
        const tA = new Date(a.deadline).getTime(), tB = new Date(b.deadline).getTime();
        if (tA !== tB) return tA - tB;
        return Math.abs(needPerDay(a) - cap) - Math.abs(needPerDay(b) - cap);
    });
}

// Total uang yang sudah berhasil ditabung (dari catatan setoran semua harapan)
function getTabunganAktual() {
    const today = todayStr(), month = today.substring(0, 7);
    let hari = 0, bulan = 0;
    State.harapans.forEach(h => (h.trackerData || []).forEach(i => {
        if (!i.tgl) return;
        if (i.tgl === today) hari += i.nominal || 0;
        if (i.tgl.substring(0, 7) === month) bulan += i.nominal || 0;
    }));
    return { hari, bulan };
}

function updateBanner() {
    const rekap = getRekapActuals(), saved = getTabunganAktual();
    $('stmj-income-month').innerText = formatRp(rekap.untungBulan);
    $('stmj-income-today').innerText = formatRp(rekap.untungHari);
    $('stmj-saved-month').innerText = formatRp(saved.bulan);
    $('stmj-saved-today').innerText = formatRp(saved.hari);
}

function renderPrioList() {
    const box = $('prio-list');
    if (!box) return;
    box.innerHTML = '';
    State.harapans.forEach((h, idx) => {
        const terkumpul = sumTracker(h), pct = h.target > 0 ? Math.min(100, Math.round(terkumpul / h.target * 100)) : 0;
        const need = kebutuhanSetoran(h);
        const isTop = idx === 0, isActive = h.id === State.activeHarapanId;
        const deadline = h.deadline ? new Date(h.deadline).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
        const btn = document.createElement('button');
        btn.className = `prio-card${isTop ? ' top' : ''}${isActive ? ' active' : ''}`;
        btn.onclick = () => { State.activeHarapanId = h.id; $('form-harapan').dataset.isOpen = "false"; renderHarapanUI(); };
        btn.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="prio-rank">${isTop ? '<i class="ph-fill ph-star"></i>' : idx + 1}</div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2"><span class="font-bold text-sm text-slate-800 truncate">${esc(h.name)}</span>${isTop ? '<span class="prio-badge">Prioritas</span>' : ''}</div>
                    <div class="text-[10px] text-slate-500 mt-0.5">Target ${formatRp(h.target)} &bull; Deadline ${deadline}</div>
                </div>
            </div>
            <div class="prio-need"><span class="label">Target setoran ${h.frekuensi === 'bulanan' ? 'bulanan' : 'harian'}</span><span class="value">${formatRp(need.nilai)} ${need.suffix}</span></div>
            <div class="flex items-center gap-2 mt-2"><div class="progress-track flex-1"><div class="progress-fill" style="width:${pct}%"></div></div><span class="text-[10px] font-bold text-slate-500">${pct}%</span></div>`;
        box.appendChild(btn);
    });
}

function renderHarapanUI() {
    sortHarapans();
    const form = $('form-harapan'), tracker = $('tracker-section'), btnBatal = $('btn-batal-harapan');
    if (State.harapans.length === 0) {
        form.classList.remove('hidden'); tracker.classList.add('hidden'); btnBatal.classList.add('hidden');
        $('form-harapan-title').innerText = "Buat Harapan Pertama"; $('btn-add-harapan').classList.add('hidden');
    } else {
        $('btn-add-harapan').classList.remove('hidden');
        if (!State.activeHarapanId || !State.harapans.find(h => h.id === State.activeHarapanId)) State.activeHarapanId = State.harapans[0].id;
        if (form.dataset.isOpen === "true") {
            form.classList.remove('hidden'); tracker.classList.add('hidden'); btnBatal.classList.remove('hidden');
            $('form-harapan-title').innerText = editingHarapanId ? "Edit Harapan" : "Tambah Harapan Baru";
        } else { form.classList.add('hidden'); tracker.classList.remove('hidden'); renderTracker(); }
    }
    renderPrioList(); updateBanner();
}

function bukaFormTambahHarapan() {
    editingHarapanId = null;
    $('form-harapan').dataset.isOpen = "true";
    $('stmj-harapan').value = ""; $('stmj-target-rp').value = ""; $('stmj-deadline').value = ""; $('stmj-frekuensi').value = "harian";
    $('stmj-alert').classList.add('hidden');
    renderHarapanUI();
}

function bukaEditHarapan() {
    const h = getActiveHarapan(); if (!h) return;
    editingHarapanId = h.id;
    $('stmj-harapan').value = h.name; $('stmj-target-rp').value = h.target;
    $('stmj-deadline').value = h.deadline; $('stmj-frekuensi').value = h.frekuensi || 'harian';
    $('form-harapan').dataset.isOpen = "true";
    renderHarapanUI(); hitungTargetSTMJ();
}

function batalTambahHarapan() { editingHarapanId = null; $('form-harapan').dataset.isOpen = "false"; renderHarapanUI(); }

function konfirmasiHapusHarapan() {
    const h = getActiveHarapan(); if (!h) return;
    tampilkanConfirm("Hapus Harapan?", `Harapan "${h.name}" beserta semua catatan setorannya akan dihapus permanen.`, () => {
        State.harapans = State.harapans.filter(x => x.id !== h.id);
        State.activeHarapanId = State.harapans.length ? State.harapans[0].id : null;
        syncKeCloud(); updatePantauFilters(); renderHarapanUI(); hitungTotalGlobal();
    });
}

function hitungTargetSTMJ() {
    const target = parseFloat($('stmj-target-rp').value) || 0;
    const deadline = $('stmj-deadline').value;
    const frekuensi = $('stmj-frekuensi').value || 'harian';
    const alertBox = $('stmj-alert');
    if (!(target > 0 && deadline)) { alertBox.classList.add('hidden'); return; }

    const diffDays = Math.max(1, Math.ceil((new Date(deadline) - new Date()) / 86400000));
    alertBox.classList.remove('hidden');
    const kapAktual = getRekapActuals().untungBulan * (State.alokasi.tabungan / 100);
    const budgetBulan = kapAktual > 0 ? kapAktual : State.kapasitasBulanSimulasi;
    const harian = frekuensi === 'harian';
    const butuh = harian ? target / diffDays : target / Math.max(1, diffDays / APP_CONFIG.daysPerMonth);
    const budget = harian ? budgetBulan / APP_CONFIG.daysPerMonth : budgetBulan;
    const unit = harian ? 'hari' : 'bulan';
    const ok = butuh <= budget;

    $('stmj-target-harian-wrap').innerHTML = `<span class="font-bold text-slate-700">Target Nabung:</span> <span class="text-mitra-600 font-extrabold text-sm">${formatRp(butuh)} / ${unit}</span>`;
    alertBox.className = `rounded-lg p-3 text-[11px] border mt-2 flex items-start gap-2 ${ok ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`;
    $('stmj-msg').innerHTML = ok
        ? `Mantap! Sesuai dengan kapasitas Anda (<strong class="text-emerald-700">${formatRp(budget)}/${unit}</strong>).`
        : `Agak berat. Kapasitas tabungan Anda saat ini cuma <strong class="text-amber-700">${formatRp(budget)}/${unit}</strong>.`;
}

function simpanHarapan() {
    const name = $('stmj-harapan').value.trim();
    const target = parseFloat($('stmj-target-rp').value) || 0;
    const deadline = $('stmj-deadline').value;
    const frekuensi = $('stmj-frekuensi').value;
    if (!name || target <= 0 || !deadline) { tampilkanModal("Perhatian", "Isi Harapan, Nominal, dan Waktu!"); return; }

    $('form-harapan').dataset.isOpen = "false";
    if (editingHarapanId) {
        const h = State.harapans.find(x => x.id === editingHarapanId);
        if (h) Object.assign(h, { name, target, deadline, frekuensi });
        editingHarapanId = null;
        syncKeCloud(); updatePantauFilters(); renderHarapanUI(); hitungTotalGlobal();
    } else {
        const newH = { id: Date.now(), name, target, deadline, frekuensi, trackerData: [] };
        State.harapans.push(newH); State.activeHarapanId = newH.id;
        syncKeCloud(); updatePantauFilters(); renderHarapanUI(); tambahBaris();
    }
}

function tambahBaris() {
    const h = getActiveHarapan(); if (!h) return;
    h.trackerData.unshift({ id: Date.now(), tgl: todayStr(), nominal: Math.round(kebutuhanSetoran(h).nilai), status: true, note: '' });
    syncKeCloud(); renderTracker(); updateBanner(); renderPrioList();
}

function hapusBaris(id) {
    const h = getActiveHarapan(); if (!h) return;
    h.trackerData = h.trackerData.filter(d => d.id !== id);
    syncKeCloud(); renderTracker(); updateBanner(); renderPrioList();
}

function updateBaris(id, key, el) {
    const h = getActiveHarapan(); if (!h) return;
    const item = h.trackerData.find(d => d.id === id); if (!item) return;
    if (key === 'nominal') item.nominal = parseFloat(el.value) || 0;
    else if (key === 'status') item.status = (el.value === 'true');
    else item[key] = el.value;
    hitungTotalTracker(); syncKeCloud();
}

function renderTracker() {
    const h = getActiveHarapan(); if (!h) return;
    $('tracker-harapan-name').innerText = h.name;
    const list = $('tracker-list'); list.innerHTML = '';
    if (h.trackerData.length === 0) {
        list.innerHTML = '<div class="text-center py-6 text-slate-400 text-xs font-medium">Belum ada catatan setoran.<br>Ketuk tombol Tambah di atas.</div>';
    } else {
        h.trackerData.forEach(item => {
            const div = document.createElement('div');
            div.className = `bg-white border rounded-2xl p-4 shadow-sm transition-colors ${item.status ? 'border-slate-200' : 'border-red-300 bg-red-50/30'}`;
            div.innerHTML = `
                <div class="flex justify-between items-center mb-3 border-b border-slate-100 pb-2">
                    <input type="date" value="${esc(item.tgl)}" onchange="updateBaris(${item.id}, 'tgl', this)" class="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1.5 rounded-lg outline-none cursor-pointer">
                    <button onclick="hapusBaris(${item.id})" class="text-slate-300 hover:text-red-500 bg-slate-50 p-1.5 rounded-lg"><i class="ph-bold ph-trash text-lg"></i></button>
                </div>
                <div class="flex gap-2 items-center mb-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-mitra-400 focus-within:bg-white transition-all">
                    <span class="text-slate-400 font-bold text-sm">Rp</span>
                    <input type="number" value="${item.nominal}" oninput="updateBaris(${item.id}, 'nominal', this)" class="w-full text-lg font-extrabold text-slate-800 bg-transparent outline-none">
                </div>
                <div class="flex gap-2">
                    <select onchange="updateBaris(${item.id}, 'status', this); this.parentElement.parentElement.className = 'bg-white border rounded-2xl p-4 shadow-sm transition-colors ' + (this.value==='true'?'border-slate-200':'border-red-300 bg-red-50/30')" class="w-1/3 text-[11px] font-bold border rounded-lg p-2 outline-none bg-slate-50 text-slate-700 cursor-pointer">
                        <option value="true" ${item.status ? 'selected' : ''}>✅ Cukup</option>
                        <option value="false" ${!item.status ? 'selected' : ''}>⚠️ Kurang</option>
                    </select>
                    <input type="text" value="${esc(item.note)}" placeholder="Tulis rencana perbaikan..." oninput="updateBaris(${item.id}, 'note', this)" class="w-2/3 text-[11px] font-medium border border-slate-200 rounded-lg px-3 outline-none bg-slate-50 focus:bg-white focus:ring-2 focus:ring-mitra-400">
                </div>`;
            list.appendChild(div);
        });
    }
    hitungTotalTracker();
}

function hitungTotalTracker() {
    const h = getActiveHarapan(); if (!h) return;
    $('lbl-sisa-target').innerText = formatRp(Math.max(0, h.target - sumTracker(h)));
    updateBanner(); renderPrioList(); hitungTotalGlobal();
}

function hitungTotalGlobal() {
    let totalTarget = 0, totalTerkumpul = 0;
    State.harapans.forEach(h => { totalTarget += h.target; totalTerkumpul += sumTracker(h); });
    if (totalTarget > 0) {
        $('global-progress-container').classList.remove('hidden');
        $('hdr-harapan-name').innerText = State.harapans.length + " Harapan Aktif";
        const pct = Math.min(100, Math.round(totalTerkumpul / totalTarget * 100));
        $('hdr-progress-pct').innerText = pct + '%'; $('hdr-progress-bar').style.width = pct + '%';
    } else $('global-progress-container').classList.add('hidden');
}

/* ---------- 9. EKSPOR EXCEL & GOOGLE DRIVE ---------- */
const kategoriTrx = (t) => t.type === 'fisik' ? 'Produk Fisik' : (t.type === 'virtual' ? 'Produk Virtual' : 'Pemasukan Lain');
const rowsTrx = (withRp) => State.transactions.map(t => ({
    'Tanggal': t.timestamp ? t.timestamp.substring(0, 10) : '-', 'Kategori': kategoriTrx(t), 'Nama / Keterangan': t.name,
    ['Harga Jual' + (withRp ? ' (Rp)' : '')]: t.type === 'lain' ? '-' : t.price,
    ['Untung Bersih' + (withRp ? ' (Rp)' : '')]: t.profit, 'Jumlah (Qty)': t.qty,
    ['Total Pemasukan' + (withRp ? ' (Rp)' : '')]: t.profit * t.qty
}));

function buildWorkbook() {
    const wb = XLSX.utils.book_new(); let any = false;
    if (State.transactions.length) { XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsTrx(true)), "Semua Transaksi"); any = true; }
    State.harapans.forEach(h => {
        const rows = h.trackerData.map(t => ({ 'Tanggal Setoran': t.tgl, 'Nominal (Rp)': t.nominal, 'Status Target': t.status ? 'Cukup' : 'Kurang', 'Catatan': t.note || '-' }));
        if (rows.length) {
            const safe = h.name.replace(/[\[\]\*\\\/\?:]/g, '').substring(0, 25);
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), `STMJ_${safe}`); any = true;
        }
    });
    return any ? wb : null;
}
const safeName = () => State.juraganName.replace(/\s+/g, '_');

function downloadTransaksiExcel() {
    if (!State.transactions.length) { tampilkanModal("Info", "Belum ada catatan transaksi."); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsTrx(false)), "Transaksi Harian");
    XLSX.writeFile(wb, `Transaksi_${safeName()}.xlsx`);
}

function downloadExcelHarapan() {
    const h = getActiveHarapan();
    if (!h || !h.trackerData.length) { tampilkanModal("Info", "Belum ada catatan setoran untuk didownload."); return; }
    const rows = h.trackerData.map(t => ({ 'Tanggal Setoran': t.tgl, 'Nominal (Rp)': t.nominal, 'Status Target': t.status ? 'Sesuai / Cukup' : 'Kurang', 'Catatan Perbaikan': t.note || '-' }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Riwayat Setoran");
    XLSX.writeFile(wb, `Setoran_${h.name.replace(/\s+/g, '_')}.xlsx`);
}

function downloadSemuaLaporan() {
    const wb = buildWorkbook();
    if (!wb) { tampilkanModal("Info", "Belum ada catatan apapun (Transaksi/Harapan) untuk didownload."); return; }
    XLSX.writeFile(wb, `Laporan_Lengkap_Juwara2027_${safeName()}.xlsx`);
}

let tokenClient;
function initGoogleClient() {
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({ client_id: APP_CONFIG.googleClientId, scope: APP_CONFIG.googleScope, callback: '' });
    } catch (e) { console.log("Google SDK load failed", e); }
}
if (window.__gis) initGoogleClient();

async function simpanKeGoogleDrive() {
    if (!APP_CONFIG.googleClientId || APP_CONFIG.googleClientId.includes('MASUKKAN_CLIENT_ID')) {
        tampilkanModal("Info Tim IT", "Client ID Google API belum dikonfigurasi di js/config.js."); return;
    }
    const wb = buildWorkbook();
    if (!wb) { tampilkanModal("Info", "Belum ada catatan apapun (Transaksi/Harapan) untuk disimpan ke Drive."); return; }
    if (!tokenClient) { tampilkanModal("Error", "Gagal memuat Google Services."); return; }

    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) { tampilkanModal("Akses Ditolak", "Gagal menghubungkan ke akun Google Anda."); return; }
        tampilkanModal("Mengunggah...", "Sedang menyimpan laporan ke Google Drive Anda. Mohon tunggu sebentar.");
        try {
            const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: mime });
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify({ name: `Laporan_Juwara_${safeName()}.xlsx`, mimeType: mime })], { type: 'application/json' }));
            form.append('file', blob);
            const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST', headers: new Headers({ 'Authorization': 'Bearer ' + resp.access_token }), body: form
            });
            tampilkanModal(res.ok ? "Sukses" : "Gagal", res.ok ? "Laporan berhasil diunggah ke Google Drive pribadi Anda!" : "Terjadi kesalahan saat mengunggah ke Drive.");
        } catch (e) { tampilkanModal("Error", "Gagal mengunggah file. Pastikan koneksi internet Anda stabil."); }
    };
    const granted = google.accounts.oauth2.hasGrantedAllScopes(tokenClient, APP_CONFIG.googleScope);
    tokenClient.requestAccessToken({ prompt: granted ? '' : 'consent' });
}

/* ---------- 10. GRAFIK ---------- */
function updatePantauFilters() {
    const select = $('filter-harapan'); select.innerHTML = '';
    State.harapans.forEach(h => { const o = document.createElement('option'); o.value = h.id; o.innerText = h.name; select.appendChild(o); });
    if (State.activeHarapanId) select.value = State.activeHarapanId;
}

function renderChart() {
    if (!State.harapans.length) return;
    const hId = $('filter-harapan').value || State.activeHarapanId;
    const h = State.harapans.find(x => x.id == hId); if (!h) return;
    const mode = $('filter-waktu').value;
    const asc = [...h.trackerData].sort((a, b) => new Date(a.tgl) - new Date(b.tgl));
    let labels = [], pts = [], run = 0;
    if (mode === 'harian') asc.forEach(i => { run += i.nominal; labels.push(i.tgl.substring(5)); pts.push(run); });
    else {
        const m = {}; asc.forEach(i => { const k = i.tgl.substring(0, 7); m[k] = (m[k] || 0) + (i.nominal || 0); });
        for (const k in m) { run += m[k]; labels.push(k); pts.push(run); }
    }
    if (!labels.length) { labels = ['Mulai']; pts = [0]; }
    $('stat-terkumpul').innerText = formatRp(run); $('stat-target').innerText = formatRp(h.target);

    const css = getComputedStyle(document.documentElement);
    const green = css.getPropertyValue('--success-500').trim() || '#10b981';
    if (myChart) myChart.destroy();
    myChart = new Chart($('progressChart').getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [
            { label: 'Terkumpul', data: pts, borderColor: green, backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: green },
            { label: 'Target Harapan', data: Array(labels.length).fill(h.target), borderColor: '#cbd5e1', borderDash: [4, 4], pointRadius: 0, fill: false }
        ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { x: { ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 }, callback: v => 'Rp' + (v / 1000) + 'k' } } } }
    });
}

/* ---------- 11. PWA ---------- */
(function setupManifest() {
    const manifest = { name: APP_CONFIG.appName, short_name: APP_CONFIG.appShortName, start_url: "./", display: "standalone",
        background_color: "#f8fafc", theme_color: APP_CONFIG.themeColor, icons: [{ src: APP_CONFIG.iconUrl, sizes: "512x512", type: "image/png" }] };
    $('manifest-placeholder').href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
})();

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
function triggerPWAInstall() {
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(() => { deferredPrompt = null; }); }
    else tampilkanModal("Info Instalasi", "Ketuk menu browser (titik tiga) lalu pilih 'Tambahkan ke Layar Utama' / 'Add to Home Screen' untuk menjadikan web ini sebagai aplikasi di HP Anda.");
}
