/* ============================================================
   script.js — LoadAlert Dashboard
   ============================================================ */

const LIFF_ID = '2010082961-cYVgNo5d';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzJmzozbDKcW8kFjaQ8qmHEqJxCv140qGa90usviPEtxuNJ6fE1mfbNiFwk3AbkvtWZCA/exec';

let allJobs = [];
let trendChart = null;
let currentChartMode = 'incidents';
let refreshTimer = null;

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
    updateClock();
    setInterval(updateClock, 30000);

    try {
        await liff.init({ liffId: LIFF_ID });
    } catch (e) {
        console.warn('LIFF init failed (non-LINE browser):', e.message);
    }

    await loadDashboard();
    scheduleRefresh();
});

function scheduleRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(loadDashboard, REFRESH_INTERVAL);
}

// ============================================================
// LOAD DATA
// ============================================================
async function loadDashboard() {
    try {
        const res = await fetch(GAS_URL + '?action=getJobs&t=' + Date.now(), { redirect: 'follow' });
        const data = await readJsonResponse_(res);
        allJobs = (data.jobs || data.data || []);
        renderAll();
        document.getElementById('last-update-time').textContent = new Date().toLocaleTimeString('th-TH');
    } catch (err) {
        showToast('ไม่สามารถโหลดข้อมูลได้: ' + err.message, true);
    } finally {
        showApp();
    }
}

async function readJsonResponse_(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error('Invalid server response');
    }
}

async function refreshDashboard() {
    const btn = document.getElementById('btn-refresh');
    btn.classList.add('spinning');
    await loadDashboard();
    setTimeout(() => btn.classList.remove('spinning'), 700);
    showToast('อัปเดตข้อมูลแล้ว ✓');
}

// ============================================================
// RENDER ALL
// ============================================================
function renderAll() {
    renderKPI();
    renderLoss();
    renderMachines();
    renderLog();
    renderChart(currentChartMode);
    renderPredictions();
}

// ============================================================
// KPI
// ============================================================
function renderKPI() {
    const today = todayStr();
    const todayJobs = allJobs.filter(j => isSameDay(j.startProblem || j.timestamp, today));

    const total = allJobs.length;
    const waiting = allJobs.filter(j => j.repairStatus === 'Waiting').length;
    const active = allJobs.filter(j => j.repairStatus === 'Checking' || j.repairStatus === 'Repairing').length;
    const done = allJobs.filter(j => j.repairStatus === 'Completed').length;

    setText('kpi-total', total);
    setText('kpi-waiting', waiting);
    setText('kpi-active', active);
    setText('kpi-done', done);

    const badge = document.getElementById('kpi-waiting-badge');
    if (waiting > 0) {
        badge.textContent = '⚠ รอด่วน';
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

// ============================================================
// LOSS
// ============================================================
function renderLoss() {
    const completed = allJobs.filter(j => j.repairStatus === 'Completed');
    const today = todayStr();
    const todayDone = completed.filter(j => isSameDay(j.startProblem || j.timestamp, today));

    const totalLoss = completed.reduce((s, j) => s + num(j.lossCost), 0);
    const todayLoss = todayDone.reduce((s, j) => s + num(j.lossCost), 0);

    const downtimes = completed.filter(j => num(j.downtimeMin) > 0).map(j => num(j.downtimeMin));
    const responses = completed.filter(j => num(j.responseMin) > 0).map(j => num(j.responseMin));
    const repairs = completed.filter(j => num(j.repairMin) > 0).map(j => num(j.repairMin));

    setText('loss-total', '฿' + fmt(totalLoss));
    setText('loss-sub-today', 'วันนี้: ฿' + fmt(todayLoss));
    setText('loss-avg-downtime', downtimes.length ? avg(downtimes).toFixed(1) : '--');
    setText('loss-avg-response', responses.length ? avg(responses).toFixed(1) : '--');
    setText('loss-avg-repair', repairs.length ? avg(repairs).toFixed(1) : '--');
}

// ============================================================
// MACHINE STATUS
// ============================================================
function renderMachines() {
    const machineMap = {};
    const latestByMachine = {};

    // กลุ่มตาม Machine โดยเอาเคสล่าสุดก่อน
    allJobs.forEach(j => {
        const m = j.machine || 'Unknown';
        if (!machineMap[m]) machineMap[m] = [];
        machineMap[m].push(j);
    });

    const machines = Object.keys(machineMap).sort();
    document.getElementById('machine-count').textContent = machines.length + ' เครื่อง';

    const grid = document.getElementById('machine-grid');
    grid.innerHTML = '';

    machines.forEach(m => {
        const jobs = machineMap[m];
        // หาเคสล่าสุดที่ไม่ Completed ก่อน
        const activeJob = jobs.find(j => j.repairStatus !== 'Completed') || jobs[jobs.length - 1];
        const card = buildMachineCard(m, activeJob, jobs);
        grid.appendChild(card);
    });
}

function buildMachineCard(machineName, job, allMachineJobs) {
    const status = job.repairStatus || 'Waiting';
    const completedCount = allMachineJobs.filter(j => j.repairStatus === 'Completed').length;
    const totalCount = allMachineJobs.length;

    let cssClass = 'status-ok';
    let statusText = 'ปกติ';
    let statusDot = '🟢';

    if (status === 'Waiting') { cssClass = 'status-warn'; statusText = 'รอรับงาน'; statusDot = '🟡'; }
    else if (status === 'Checking') { cssClass = 'status-repair'; statusText = 'ตรวจสอบ'; statusDot = '🔵'; }
    else if (status === 'Repairing') { cssClass = 'status-danger'; statusText = 'กำลังซ่อม'; statusDot = '🔴'; }
    else if (status === 'Completed' && totalCount === completedCount) { cssClass = 'status-ok'; statusText = 'ปกติ'; statusDot = '🟢'; }

    const div = document.createElement('div');
    div.className = 'machine-card ' + cssClass;
    div.onclick = () => showJobDetail(job);
    div.innerHTML = `
    <div class="machine-status-bar"></div>
    <div class="machine-name">${esc(machineName)}</div>
    <div class="machine-sp">${esc(job.spNo || '-')}</div>
    <div class="machine-status-pill">${statusDot} ${statusText}</div>
    ${job.currentWeight ? `<div class="machine-weight">⚖️ ${esc(String(job.currentWeight))} kg</div>` : ''}
    ${job.technician && status !== 'Completed' ? `<div class="machine-tech">👨‍🔧 ${esc(job.technician)}</div>` : ''}
  `;
    return div;
}

// ============================================================
// CHART
// ============================================================
function switchChart(mode) {
    currentChartMode = mode;
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + mode)?.classList.add('active');
    renderChart(mode);
}

function renderChart(mode) {
    const days = last7Days();
    const labels = days.map(d => shortDate(d));

    let data, color, label;
    if (mode === 'incidents') {
        data = days.map(d => allJobs.filter(j => isSameDay(j.startProblem || j.timestamp, d)).length);
        color = '#00d2b4'; label = 'จำนวนเคส';
    } else if (mode === 'loss') {
        data = days.map(d => {
            const jobs = allJobs.filter(j => isSameDay(j.startProblem || j.timestamp, d) && j.repairStatus === 'Completed');
            return jobs.reduce((s, j) => s + num(j.lossCost), 0);
        });
        color = '#ff6b6b'; label = 'ค่าสูญเสีย (฿)';
    } else {
        data = days.map(d => {
            const jobs = allJobs.filter(j => isSameDay(j.startProblem || j.timestamp, d) && num(j.downtimeMin) > 0);
            return jobs.length ? avg(jobs.map(j => num(j.downtimeMin))) : 0;
        });
        color = '#ffb300'; label = 'Downtime เฉลี่ย (นาที)';
    }

    const ctx = document.getElementById('trend-chart').getContext('2d');
    if (trendChart) trendChart.destroy();

    trendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label,
                data,
                backgroundColor: color + '33',
                borderColor: color,
                borderWidth: 2,
                borderRadius: 6,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: color,
                pointRadius: 4,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(0,210,180,0.07)' }, ticks: { color: '#7abfb5', font: { size: 10 } } },
                y: { grid: { color: 'rgba(0,210,180,0.07)' }, ticks: { color: '#7abfb5', font: { size: 10 } }, beginAtZero: true }
            }
        }
    });
}

// ============================================================
// PREDICTION (Logic-based AI simulation)
// ============================================================
function renderPredictions() {
    const container = document.getElementById('prediction-cards');
    container.innerHTML = '';

    const preds = generatePredictions();
    preds.forEach(p => {
        const div = document.createElement('div');
        div.className = 'pred-card';
        const riskClass = p.score >= 70 ? 'risk-high' : p.score >= 40 ? 'risk-med' : 'risk-low';
        const barColor = p.score >= 70 ? '#ff4f6d' : p.score >= 40 ? '#ffb300' : '#00e676';
        div.innerHTML = `
      <div class="pred-icon">${p.icon}</div>
      <div class="pred-body">
        <div class="pred-title">${p.title}</div>
        <div class="pred-desc">${p.desc}</div>
        <div class="pred-risk ${riskClass}">ความเสี่ยง ${p.score}%</div>
        <div class="pred-score-bar">
          <div class="pred-score-fill" style="width:${p.score}%;background:${barColor};"></div>
        </div>
      </div>
    `;
        container.appendChild(div);
    });
}

function generatePredictions() {
    const completed = allJobs.filter(j => j.repairStatus === 'Completed');
    const days = last7Days();
    const counts = days.map(d => allJobs.filter(j => isSameDay(j.startProblem || j.timestamp, d)).length);
    const avgCount = avg(counts) || 0;
    const todayCount = counts[counts.length - 1];
    const trend = counts.slice(-3).reduce((a, b) => a + b, 0) / 3;

    // เครื่องที่มีปัญหาบ่อย
    const machineFreq = {};
    allJobs.forEach(j => { machineFreq[j.machine] = (machineFreq[j.machine] || 0) + 1; });
    const topMachine = Object.entries(machineFreq).sort((a, b) => b[1] - a[1])[0];

    // ค่าเฉลี่ย downtime
    const downtimes = completed.map(j => num(j.downtimeMin)).filter(v => v > 0);
    const avgDowntime = downtimes.length ? avg(downtimes) : 0;

    // วันนี้
    const hour = new Date().getHours();
    const shiftRisk = (hour >= 7 && hour <= 9) || (hour >= 15 && hour <= 17) ? 65 : 30;

    const preds = [];

    // Prediction 1: แนวโน้มเคสพรุ่งนี้
    const tomorrowScore = Math.min(95, Math.round((trend / Math.max(avgCount, 1)) * 50 + 20));
    preds.push({
        icon: '📅', title: 'คาดการณ์เคสพรุ่งนี้',
        desc: `จากแนวโน้ม 7 วันที่ผ่านมา (เฉลี่ย ${avgCount.toFixed(1)} เคส/วัน) คาดว่าพรุ่งนี้จะมี ${Math.round(trend)} เคส`,
        score: tomorrowScore
    });

    // Prediction 2: เครื่องที่เสี่ยง
    if (topMachine) {
        const score = Math.min(90, Math.round((topMachine[1] / allJobs.length) * 100 * 1.2));
        preds.push({
            icon: '🏭', title: `เครื่อง ${topMachine[0]} เสี่ยงสูง`,
            desc: `มีประวัติปัญหา ${topMachine[1]} ครั้ง คิดเป็น ${Math.round(topMachine[1] / allJobs.length * 100)}% ของเคสทั้งหมด`,
            score
        });
    }

    // Prediction 3: ช่วงเปลี่ยนกะ
    preds.push({
        icon: '🔄', title: 'ความเสี่ยงช่วงเปลี่ยนกะ',
        desc: `ปัจจุบันเวลา ${hour}:00 น. ${shiftRisk >= 60 ? '⚠ อยู่ในช่วงเปลี่ยนกะ (07-09, 15-17 น.) ควรระวังการส่งต่องาน' : 'ช่วงเวลาปกติ ความเสี่ยงต่ำ'}`,
        score: shiftRisk
    });

    // Prediction 4: ค่าสูญเสียที่คาด
    if (avgDowntime > 0) {
        const expectedLoss = Math.round((trend * avgDowntime / 15) * 100);
        const lossScore = Math.min(85, Math.round(expectedLoss / 10000 * 50));
        preds.push({
            icon: '💸', title: 'ค่าสูญเสียที่คาดการณ์',
            desc: `หากแนวโน้มเดิม คาดว่าพรุ่งนี้จะมีค่าสูญเสียประมาณ ฿${fmt(expectedLoss)} (Downtime เฉลี่ย ${avgDowntime.toFixed(0)} นาที/เคส)`,
            score: lossScore
        });
    }

    return preds;
}

// ============================================================
// LOG
// ============================================================
function filterLog() {
    renderLog();
}

function renderLog() {
    const filter = document.getElementById('log-filter').value;
    const jobs = filter === 'all' ? allJobs : allJobs.filter(j => j.repairStatus === filter);
    const sorted = [...jobs].sort((a, b) => new Date(b.startProblem || b.timestamp || 0) - new Date(a.startProblem || a.timestamp || 0));

    const list = document.getElementById('log-list');
    list.innerHTML = '';

    if (!sorted.length) {
        list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--c-muted);font-size:13px;">ไม่มีข้อมูล</div>';
        return;
    }

    sorted.forEach(job => {
        const item = document.createElement('div');
        item.className = 'log-item st-' + (job.repairStatus || 'Waiting');
        item.onclick = () => showJobDetail(job);

        const loss = num(job.lossCost);
        const st = statusLabel(job.repairStatus);
        const timeStr = shortDateTime(job.startProblem || job.timestamp);

        item.innerHTML = `
      <div class="log-item-header">
        <div class="log-case-id">${esc(job.numberRepair || 'N/A')}</div>
        <div class="log-status-pill">${st}</div>
      </div>
      <div class="log-item-meta">
        <div class="log-meta-chip">🏭 ${esc(job.machine || '-')}</div>
        ${job.spNo ? `<div class="log-meta-chip">📌 ${esc(job.spNo)}</div>` : ''}
        ${job.technician ? `<div class="log-meta-chip">👨‍🔧 ${esc(job.technician)}</div>` : ''}
        <div class="log-meta-chip">🕐 ${timeStr}</div>
      </div>
      ${loss > 0 ? `<div class="log-loss">💸 ค่าสูญเสีย: ฿${fmt(loss)}</div>` : ''}
    `;
        list.appendChild(item);
    });
}

// ============================================================
// DETAIL MODAL
// ============================================================
function showJobDetail(job) {
    const status = job.repairStatus || 'Waiting';
    const badge = document.getElementById('modal-detail-status-badge');
    badge.textContent = statusLabel(status);
    badge.className = 'detail-status-badge st-' + status;

    const loss = num(job.lossCost);
    const body = document.getElementById('modal-detail-body');
    body.innerHTML = `
    <div class="detail-section-title">ข้อมูลเคส</div>
    <div class="detail-row"><div class="detail-row-label">เลขที่เคส</div><div class="detail-row-value">${esc(job.numberRepair || '-')}</div></div>
    <div class="detail-row"><div class="detail-row-label">เครื่อง</div><div class="detail-row-value">${esc(job.machine || '-')}</div></div>
    <div class="detail-row"><div class="detail-row-label">SP No.</div><div class="detail-row-value">${esc(job.spNo || '-')}</div></div>
    <div class="detail-row"><div class="detail-row-label">น้ำหนัก</div><div class="detail-row-value">${esc(String(job.currentWeight || '-'))}</div></div>
    <div class="detail-row"><div class="detail-row-label">ช่างซ่อม</div><div class="detail-row-value">${esc(job.technician || '-')}</div></div>

    <div class="detail-section-title">เวลา</div>
    <div class="detail-row"><div class="detail-row-label">แจ้งปัญหา</div><div class="detail-row-value">${shortDateTime(job.startProblem || job.timestamp)}</div></div>
    <div class="detail-row"><div class="detail-row-label">รับงาน</div><div class="detail-row-value">${shortDateTime(job.acceptTime)}</div></div>
    <div class="detail-row"><div class="detail-row-label">เริ่มซ่อม</div><div class="detail-row-value">${shortDateTime(job.startRepairTime)}</div></div>
    <div class="detail-row"><div class="detail-row-label">ปิดงาน</div><div class="detail-row-value">${shortDateTime(job.closeTime)}</div></div>

    ${(job.repairMin || job.responseMin || job.downtimeMin) ? `
    <div class="detail-section-title">ประสิทธิภาพ</div>
    <div class="detail-kpi-row">
      <div class="detail-kpi-box"><div class="detail-kpi-val">${job.responseMin || '--'}</div><div class="detail-kpi-lbl">Response (นาที)</div></div>
      <div class="detail-kpi-box"><div class="detail-kpi-val">${job.repairMin || '--'}</div><div class="detail-kpi-lbl">ซ่อม (นาที)</div></div>
      <div class="detail-kpi-box"><div class="detail-kpi-val">${job.downtimeMin || '--'}</div><div class="detail-kpi-lbl">Downtime (นาที)</div></div>
    </div>
    ` : ''}

    ${loss > 0 ? `
    <div class="detail-loss-box">
      <div class="detail-loss-label">ค่าสูญเสียที่เกิดขึ้น</div>
      <div class="detail-loss-val">฿${fmt(loss)}</div>
    </div>
    ` : ''}

    ${job.note ? `
    <div class="detail-section-title">หมายเหตุ</div>
    <div style="font-size:12px;color:var(--c-muted);line-height:1.6;">${esc(job.note)}</div>
    ` : ''}
  `;

    document.getElementById('modal-detail').classList.remove('hidden');
}

function closeDetailModal() {
    document.getElementById('modal-detail').classList.add('hidden');
}

// Close on backdrop click
document.getElementById('modal-detail').addEventListener('click', function (e) {
    if (e.target === this) closeDetailModal();
});

// ============================================================
// HELPERS
// ============================================================
function showApp() {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
}

function updateClock() {
    const now = new Date();
    document.getElementById('current-date').textContent = now.toLocaleDateString('th-TH', {
        weekday: 'short', day: 'numeric', month: 'short'
    });
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function num(val) {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
}

function avg(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function fmt(n) {
    return Number(n).toLocaleString('th-TH');
}

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

function isSameDay(isoStr, dateStr) {
    if (!isoStr) return false;
    try { return new Date(isoStr).toISOString().slice(0, 10) === dateStr; } catch { return false; }
}

function last7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
    }
    return days;
}

function shortDate(isoStr) {
    if (!isoStr) return '--';
    try {
        const d = new Date(isoStr);
        return (d.getMonth() + 1) + '/' + d.getDate();
    } catch { return '--'; }
}

function shortDateTime(isoStr) {
    if (!isoStr) return '--';
    try {
        return new Date(isoStr).toLocaleString('th-TH', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    } catch { return '--'; }
}

function statusLabel(s) {
    const map = { Waiting: '⏳ รอรับ', Checking: '🔍 ตรวจสอบ', Repairing: '⚙️ ซ่อม', Completed: '✅ เสร็จแล้ว' };
    return map[s] || s;
}

function showToast(msg, isErr = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' error' : '');
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
}
