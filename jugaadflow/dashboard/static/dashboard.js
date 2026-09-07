const MAX_POINTS = 60;
const TIER_COLORS = {
    1: '#34d399',
    2: '#38bdf8',
    3: '#fb923c',
    4: '#f87171',
};
const TIER_FILL = {
    1: 'rgba(52,211,153,0.08)',
    2: 'rgba(56,189,248,0.08)',
    3: 'rgba(251,146,60,0.08)',
    4: 'rgba(248,113,113,0.08)',
};
const LEVEL_CLASSES = ['level-0', 'level-1', 'level-2', 'level-3'];

let latencyChart, throughputChart, classChart;
let currentMode = 'adaptive';
const TIER_LABELS = ['Tier 1 (Payment/Order)', 'Tier 2 (Inventory)', 'Tier 3 (Clicks)', 'Tier 4 (Logs)'];

function makeGradient(ctx, color) {
    const grad = ctx.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, color.replace(')', ', 0.25)').replace('rgb', 'rgba'));
    grad.addColorStop(1, color.replace(')', ', 0)').replace('rgb', 'rgba'));
    return grad;
}

function initCharts() {
    const sharedOpts = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
            x: { display: false },
            y: {
                beginAtZero: true,
                ticks: { color: '#5a7494', font: { family: 'JetBrains Mono', size: 10 } },
                grid: { color: 'rgba(99,179,255,0.06)' },
                border: { color: 'transparent' }
            }
        },
        plugins: {
            legend: { labels: { color: '#94a3b8', boxWidth: 10, font: { size: 11, family: 'Inter' }, usePointStyle: true, pointStyle: 'circle' } },
            tooltip: {
                backgroundColor: 'rgba(13,20,33,0.9)',
                titleColor: '#94a3b8',
                bodyColor: '#e2eaf5',
                borderColor: 'rgba(99,179,255,0.15)',
                borderWidth: 1,
                padding: 10,
                bodyFont: { family: 'JetBrains Mono', size: 12 },
            }
        }
    };

    const latCtx = document.getElementById('latencyChart').getContext('2d');
    latencyChart = new Chart(latCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Tier 1', data: [], borderColor: TIER_COLORS[1], backgroundColor: TIER_FILL[1], borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true, spanGaps: false },
                { label: 'Tier 2', data: [], borderColor: TIER_COLORS[2], backgroundColor: TIER_FILL[2], borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true, spanGaps: false },
                { label: 'Tier 3', data: [], borderColor: TIER_COLORS[3], backgroundColor: TIER_FILL[3], borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true, spanGaps: false },
                { label: 'Tier 4', data: [], borderColor: TIER_COLORS[4], backgroundColor: TIER_FILL[4], borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true, spanGaps: false },
            ]
        },
        options: sharedOpts
    });

    classChart = new Chart(document.getElementById('classChart'), {
        type: 'doughnut',
        data: {
            labels: TIER_LABELS,
            datasets: [{
                data: [0, 0, 0, 0],
                backgroundColor: [TIER_COLORS[1], TIER_COLORS[2], TIER_COLORS[3], TIER_COLORS[4]],
                borderWidth: 2,
                borderColor: '#080c14',
                hoverOffset: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            cutout: '62%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(13,20,33,0.9)',
                    titleColor: '#94a3b8',
                    bodyColor: '#e2eaf5',
                    borderColor: 'rgba(99,179,255,0.15)',
                    borderWidth: 1,
                    padding: 10,
                }
            }
        }
    });

    const tpCtx = document.getElementById('throughputChart').getContext('2d');
    throughputChart = new Chart(tpCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Tier 1', data: [], borderColor: TIER_COLORS[1], backgroundColor: TIER_FILL[1], borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
                { label: 'Tier 2', data: [], borderColor: TIER_COLORS[2], backgroundColor: TIER_FILL[2], borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
                { label: 'Tier 3', data: [], borderColor: TIER_COLORS[3], backgroundColor: TIER_FILL[3], borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
                { label: 'Tier 4', data: [], borderColor: TIER_COLORS[4], backgroundColor: TIER_FILL[4], borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
            ]
        },
        options: sharedOpts
    });
}

function pushChartData(chart, label, values) {
    chart.data.labels.push(label);
    values.forEach((v, i) => chart.data.datasets[i].data.push(v));
    if (chart.data.labels.length > MAX_POINTS) {
        chart.data.labels.shift();
        chart.data.datasets.forEach(ds => ds.data.shift());
    }
    chart.update('none');
}

function renderCounters(elementId, counters) {
    const el = document.getElementById(elementId);
    el.innerHTML = Object.entries(counters)
        .map(([k, v]) => `<div class="counter-item"><span class="counter-label">${k}</span><span class="counter-value">${v.toLocaleString()}</span></div>`)
        .join('');
}

const QUEUE_CONFIG = [
    { key: 'input',          label: 'Input',  max: 10000, css: 'input' },
    { key: 'tier1',          label: 'Tier 1', max: null,  css: 'tier1' },
    { key: 'tier2',          label: 'Tier 2', max: 5000,  css: 'tier2' },
    { key: 'tier3',          label: 'Tier 3', max: 2000,  css: 'tier3' },
    { key: 'tier4',          label: 'Tier 4', max: 500,   css: 'tier4' },
    { key: 'deferred_tier2', label: 'Def T2', max: 3000,  css: 'deferred' },
    { key: 'deferred_tier3', label: 'Def T3', max: 2000,  css: 'deferred' },
    { key: 'fifo',           label: 'FIFO',   max: null,  css: 'input' },
];

function renderQueueDepths(queues) {
    const el = document.getElementById('queueDepths');
    el.innerHTML = QUEUE_CONFIG.map(q => {
        const current = queues[q.key] || 0;
        const unlimited = q.max === null;
        const pct = unlimited ? Math.min(current / 100, 1) * 100 : (current / q.max) * 100;
        const danger = !unlimited && pct > 90;
        const full = !unlimited && current >= q.max;
        const maxLabel = unlimited ? '∞' : q.max.toLocaleString();
        const fullTag = full ? '<span class="full-tag">FULL</span>' : '';
        return `<div class="queue-bar-row">
            <span class="queue-bar-label">${q.label}</span>
            <div class="queue-bar">
                <div class="queue-bar-fill ${q.css}${danger ? ' danger' : ''}" style="width:${Math.min(pct, 100)}%"></div>
            </div>
            <span class="queue-bar-count">${current.toLocaleString()} / ${maxLabel}${fullTag}</span>
        </div>`;
    }).join('');
}

function handleMessage(data) {
    // Level bar
    const bar = document.getElementById('levelBar');
    bar.textContent = data.level_name;
    bar.className = 'level-bar ' + LEVEL_CLASSES[data.level];

    // Latency values
    for (let t = 1; t <= 4; t++) {
        const val = data.latency_ms['tier' + t];
        document.getElementById('lat' + t).textContent = val !== null ? val.toFixed(1) + ' ms' : '— ms';
    }

    // Proof line
    const proof = document.getElementById('proofLine');
    const paymentShed = data.counters.shed.payment || 0;
    if (paymentShed === 0) {
        proof.innerHTML = 'Payments shed: <strong>0</strong> &mdash; Critical events protected &check;';
        proof.className = 'proof-line';
    } else {
        proof.innerHTML = 'Payments shed: <strong>' + paymentShed + '</strong> &mdash; ALERT: Critical events dropped!';
        proof.className = 'proof-line proof-fail';
    }

    // Queue depths
    renderQueueDepths(data.queues);

    // Backpressure
    const bp = document.getElementById('bpStatus');
    bp.textContent = data.backpressure ? 'ACTIVE' : 'Inactive';
    bp.className = data.backpressure ? 'value bp-active' : 'value bp-inactive';
    document.getElementById('inputQ').textContent = data.queues.input.toLocaleString();

    // Rate
    const approxRate = Math.round(data.rate_multiplier * BASE_RATE);
    document.getElementById('rateValue').textContent = data.rate_multiplier.toFixed(1) + 'x (~' + approxRate.toLocaleString() + '/min)';
    highlightRateButton(data.rate_multiplier);

    // Total processed
    const total = Object.values(data.counters.processed).reduce((a, b) => a + b, 0);
    document.getElementById('totalProcessed').textContent = total.toLocaleString();

    // Charts
    const label = new Date(data.timestamp * 1000).toLocaleTimeString();
    pushChartData(latencyChart, label, [
        data.latency_ms.tier1,
        data.latency_ms.tier2,
        data.latency_ms.tier3,
        data.latency_ms.tier4,
    ]);
    pushChartData(throughputChart, label, [
        data.throughput_per_sec['1'] || 0,
        data.throughput_per_sec['2'] || 0,
        data.throughput_per_sec['3'] || 0,
        data.throughput_per_sec['4'] || 0,
    ]);

    // Classification donut
    if (data.classified_per_sec) {
        const cls = data.classified_per_sec;
        const vals = [cls['1'] || 0, cls['2'] || 0, cls['3'] || 0, cls['4'] || 0];
        classChart.data.datasets[0].data = vals;
        classChart.update();
        const total = vals.reduce((a, b) => a + b, 0) || 1;
        document.getElementById('classRates').innerHTML = vals.map((v, i) => {
            const pct = ((v / total) * 100).toFixed(0);
            return `<span class="class-badge" style="border-color:${TIER_COLORS[i+1]}">T${i+1}: ${v}/s (${pct}%)</span>`;
        }).join('');
    }

    // Mode sync
    if (data.naive_mode !== undefined) {
        currentMode = data.naive_mode ? 'naive' : 'adaptive';
        document.getElementById('modeBtn').textContent = 'Mode: ' + (data.naive_mode ? 'Naive' : 'Adaptive');
    }

    // Counter tables
    renderCounters('shedCounters', data.counters.shed);
    renderCounters('deferredCounters', data.counters.deferred);
    renderCounters('batchedCounters', data.counters.batched);
    renderCounters('processedCounters', data.counters.processed);

    // Active spikes panel
    if (data.active_spikes !== undefined) {
        renderActiveSpikes(data.active_spikes);
    }
}

function connectWS() {
    const ws = new WebSocket('ws://' + location.host + '/ws');
    ws.onmessage = (evt) => handleMessage(JSON.parse(evt.data));
    ws.onclose = () => setTimeout(connectWS, 2000);
}

// ── Admin Spike Controls ────────────────────────────────────
const SPIKE_LABEL = {
    payment:   'Payment',
    order:     'Order',
    inventory: 'Inventory',
    click:     'Click',
    log:       'Log',
};

async function triggerSpike(eventType) {
    const count    = parseInt(document.getElementById('spikeBurstSize').value, 10) || 500;
    const duration = parseFloat(document.getElementById('spikeDuration').value)    || 5;

    // Immediately mark button as firing
    const btn = document.getElementById('spikeBtn-' + eventType);
    if (btn) {
        btn.classList.add('firing');
        btn.disabled = true;
        const origText = btn.innerHTML;
        btn.innerHTML = btn.innerHTML.replace(SPIKE_LABEL[eventType], 'Spiking...');

        setTimeout(() => {
            btn.classList.remove('firing');
            btn.disabled = false;
            btn.innerHTML = origText;
        }, duration * 1000);
    }

    try {
        const res = await fetch('/api/event-spike', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_type: eventType, count, duration_sec: duration }),
        });
        const data = await res.json();
        console.log('Spike response:', data);
    } catch (err) {
        console.error('Spike failed:', err);
        if (btn) { btn.classList.remove('firing'); btn.disabled = false; }
    }
}

function renderActiveSpikes(activeSpikes) {
    const row = document.getElementById('spikeActiveRow');
    if (!activeSpikes || Object.keys(activeSpikes).length === 0) {
        row.innerHTML = '';
        // Clear all firing states from buttons
        document.querySelectorAll('.spike-btn.firing').forEach(b => {
            if (!b.disabled) b.classList.remove('firing');
        });
        return;
    }

    const now = Date.now() / 1000;
    row.innerHTML = Object.entries(activeSpikes).map(([etype, info]) => {
        const secsLeft = Math.max(0, Math.round(info.end_time - now));
        const label = SPIKE_LABEL[etype] || etype;
        return `<span class="spike-badge ${etype}">
            <span class="spike-badge-dot"></span>
            ${label} spike &mdash; ${info.injected.toLocaleString()} events &mdash; ${secsLeft}s left
        </span>`;
    }).join('');

    // Mark matching buttons as firing
    Object.keys(SPIKE_LABEL).forEach(etype => {
        const btn = document.getElementById('spikeBtn-' + etype);
        if (!btn) return;
        if (activeSpikes[etype]) {
            btn.classList.add('firing');
        } else if (!btn.disabled) {
            btn.classList.remove('firing');
        }
    });
}

const BASE_RATE = 3400;
const PRESETS = [1000, 3400, 10000, 20000, 50000, 68000];

function setRate(eventsPerMin) {
    fetch('/api/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events_per_min: eventsPerMin }),
    });
}

function setCustomRate() {
    const input = document.getElementById('customRate');
    const val = parseInt(input.value, 10);
    if (val >= 100 && val <= 340000) {
        setRate(val);
        input.value = '';
    }
}

function highlightRateButton(multiplier) {
    const currentRate = Math.round(multiplier * BASE_RATE);
    document.querySelectorAll('.btn-rate').forEach(btn => {
        const btnRate = parseInt(btn.dataset.rate, 10);
        btn.classList.toggle('active', Math.abs(btnRate - currentRate) < 200);
    });
}

function toggleMode() {
    const btn = document.getElementById('modeBtn');
    if (currentMode === 'adaptive') {
        fetch('/api/mode/naive', { method: 'POST' });
        currentMode = 'naive';
        btn.textContent = 'Mode: Naive';
    } else {
        fetch('/api/mode/adaptive', { method: 'POST' });
        currentMode = 'adaptive';
        btn.textContent = 'Mode: Adaptive';
    }
}

initCharts();
connectWS();
