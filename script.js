/* ============================================================
   Saudara Bakery — Quality Dashboard  |  script.js
   Vanilla JavaScript — no framework
   Data source: data.json (200 production records)
   ============================================================ */

'use strict';

// ── Colour palette (consistent across all charts) ──────────────
const COLORS = {
  brand   : '#3b82d4',
  danger  : '#ef4444',
  warn    : '#f59e0b',
  success : '#22c55e',
  purple  : '#7c5cd8',
  teal    : '#14b8a6',
  orange  : '#f97316',
  pink    : '#ec4899',
  indigo  : '#6366f1',
};

// Defect-type → colour mapping (stable)
const DEFECT_COLORS = {
  'Gepeng'              : COLORS.brand,
  'Gosong'              : COLORS.danger,
  'Gagal Mengembang'    : COLORS.warn,
  'Bentuk Tidak Seragam': COLORS.purple,
};

function defectColor(type) {
  return DEFECT_COLORS[type] || COLORS.teal;
}

// ── Global state ────────────────────────────────────────────────
let rawData    = [];   // all 200 records from data.json
let filtered   = [];   // currently filtered subset
let sortCol    = 'date';
let sortDir    = 'asc';
let currentPage = 1;
let pageSize   = 15;
let tableSearch = '';

// Chart instances (kept for destroy-on-redraw)
const charts = {};

// ── Chart.js global defaults ────────────────────────────────────
Chart.defaults.font.family  = "-apple-system, 'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size    = 12;
Chart.defaults.color        = '#57606a';
Chart.defaults.plugins.legend.labels.boxWidth  = 12;
Chart.defaults.plugins.legend.labels.padding   = 14;
Chart.defaults.plugins.tooltip.cornerRadius    = 6;
Chart.defaults.plugins.tooltip.padding         = 10;
Chart.defaults.plugins.tooltip.titleFont.weight = '700';

// ── Utilities ───────────────────────────────────────────────────

/** Format number with thousand separator */
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('id-ID');
}

/** Format percentage */
function fmtPct(rate) {
  if (rate == null || isNaN(rate)) return '—';
  return (rate * 100).toFixed(2) + '%';
}

/** Parse YYYY-MM-DD string → Date object (local) */
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format Date → 'DD MMM YYYY' */
function fmtDate(dateStr) {
  const d = parseDate(dateStr);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Format YYYY-MM → 'Mmm YYYY' */
function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}

/** Group array by key getter, returns Map<key, items[]> */
function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

/** Sum a numeric property over an array */
function sumOf(arr, prop) {
  return arr.reduce((a, r) => a + (r[prop] || 0), 0);
}

/** Destroy existing chart instance before recreating */
function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

// ── Bootstrap ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetch('data.json')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json();
    })
    .then(data => {
      rawData = data;
      initDashboard();
    })
    .catch(err => {
      document.getElementById('loading-state').classList.add('hidden');
      const errState = document.getElementById('error-state');
      errState.classList.remove('hidden');
      document.getElementById('error-message').textContent = err.message;
    });
});

// ── Initialise dashboard after data load ────────────────────────
function initDashboard() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  // Populate filter dropdowns with unique values from dataset
  populateFilters();

  // Set default date range to cover full dataset
  const dates = rawData.map(r => r.date).sort();
  document.getElementById('filter-date-from').value = dates[0];
  document.getElementById('filter-date-to').value   = dates[dates.length - 1];

  // Wire up filter events
  ['filter-date-from', 'filter-date-to', 'filter-defect-type', 'filter-category']
    .forEach(id => document.getElementById(id)
      .addEventListener('change', applyFilters));

  document.getElementById('btn-reset-filter').addEventListener('click', resetFilters);

  document.getElementById('table-search').addEventListener('input', e => {
    tableSearch = e.target.value.toLowerCase();
    currentPage = 1;
    renderTable();
  });

  document.getElementById('page-size').addEventListener('change', e => {
    pageSize = parseInt(e.target.value, 10);
    currentPage = 1;
    renderTable();
  });

  // Sortable column headers
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = 'asc';
      }
      document.querySelectorAll('th.sortable').forEach(h => {
        h.classList.remove('asc', 'desc');
      });
      th.classList.add(sortDir);
      renderTable();
    });
  });

  // Initial render
  applyFilters();
}

// ── Populate filter dropdowns ────────────────────────────────────
function populateFilters() {
  const defectTypes = [...new Set(rawData.map(r => r.defect_type))].sort();
  const categories  = [...new Set(rawData.map(r => r.category))].sort();

  const dtSel = document.getElementById('filter-defect-type');
  defectTypes.forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    dtSel.appendChild(o);
  });

  const catSel = document.getElementById('filter-category');
  categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
}

// ── Apply active filters ─────────────────────────────────────────
function applyFilters() {
  const from    = document.getElementById('filter-date-from').value;
  const to      = document.getElementById('filter-date-to').value;
  const dtype   = document.getElementById('filter-defect-type').value;
  const cat     = document.getElementById('filter-category').value;

  filtered = rawData.filter(r => {
    if (from && r.date < from) return false;
    if (to   && r.date > to)   return false;
    if (dtype !== 'all' && r.defect_type !== dtype) return false;
    if (cat   !== 'all' && r.category    !== cat)   return false;
    return true;
  });

  // Show active filter badge
  const isFiltered = (from !== rawData.map(r=>r.date).sort()[0]) ||
                     (to   !== rawData.map(r=>r.date).sort().at(-1)) ||
                     dtype !== 'all' || cat !== 'all';
  document.getElementById('active-filter-badge').classList.toggle('hidden', !isFiltered);

  // Update header labels
  if (filtered.length) {
    const fdates = filtered.map(r => r.date).sort();
    document.getElementById('data-range-label').textContent =
      `${fmtDate(fdates[0])} — ${fmtDate(fdates[fdates.length - 1])}`;
  }
  document.getElementById('record-count-label').textContent =
    `${fmtNum(filtered.length)} batch`;

  currentPage = 1;
  renderAll();
}

// ── Reset filters ────────────────────────────────────────────────
function resetFilters() {
  const dates = rawData.map(r => r.date).sort();
  document.getElementById('filter-date-from').value = dates[0];
  document.getElementById('filter-date-to').value   = dates[dates.length - 1];
  document.getElementById('filter-defect-type').value = 'all';
  document.getElementById('filter-category').value    = 'all';
  applyFilters();
}

// ── Render all components ────────────────────────────────────────
function renderAll() {
  renderKPIs();
  renderProductionTrend();
  renderDefectTrend();
  renderDefectRateTrend();
  renderProdVsDefect();
  renderDefectDistribution();
  renderDefectQtyByType();
  renderDailyBreakdown();
  renderPareto();
  renderTop10Defect();
  renderTable();
  renderInsights();
}

// ══════════════════════════════════════════════════════════════════
// KPI CARDS
// KPI calculations:
//   Total Produced    = Σ produced
//   Total Defective   = Σ defective (from Total_Defective column)
//   Overall Defect Rate = Σ defective / Σ produced
//   Avg Daily Production = Σ produced / count(unique dates)
// ══════════════════════════════════════════════════════════════════
function renderKPIs() {
  if (!filtered.length) {
    ['kpi-total-produced','kpi-total-defective','kpi-defect-rate','kpi-avg-daily']
      .forEach(id => document.getElementById(id).textContent = '—');
    return;
  }

  const totalProduced  = sumOf(filtered, 'produced');
  const totalDefective = sumOf(filtered, 'defective');
  const defectRate     = totalProduced > 0 ? totalDefective / totalProduced : 0;
  const uniqueDates    = new Set(filtered.map(r => r.date)).size;
  const avgDaily       = uniqueDates > 0 ? Math.round(totalProduced / uniqueDates) : 0;

  document.getElementById('kpi-total-produced').textContent  = fmtNum(totalProduced);
  document.getElementById('kpi-total-defective').textContent = fmtNum(totalDefective);
  document.getElementById('kpi-defect-rate').textContent     = fmtPct(defectRate);
  document.getElementById('kpi-avg-daily').textContent       = fmtNum(avgDaily);

  // Footer date range
  const fdates = filtered.map(r => r.date).sort();
  document.getElementById('footer-date-range').textContent =
    `${fmtDate(fdates[0])} s.d. ${fmtDate(fdates[fdates.length - 1])}`;
}

// ══════════════════════════════════════════════════════════════════
// CHART 1 — Production Trend (line)
// Per-date total produced, sorted chronologically
// ══════════════════════════════════════════════════════════════════
function renderProductionTrend() {
  const byDate = groupBy(filtered, r => r.date);
  const labels = [...byDate.keys()].sort();
  const values = labels.map(d => sumOf(byDate.get(d), 'produced'));

  destroyChart('productionTrend');
  const ctx = document.getElementById('chart-production-trend').getContext('2d');
  charts.productionTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total Produksi',
        data: values,
        borderColor: COLORS.brand,
        backgroundColor: hexAlpha(COLORS.brand, 0.1),
        fill: true,
        tension: 0.35,
        pointRadius: labels.length > 60 ? 0 : 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          type: 'category',
          ticks: {
            maxTicksLimit: 8,
            callback(v, i) { return labels[i] ? labels[i].slice(5) : ''; }
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { callback: v => fmtNum(v) },
          grid: { color: '#f0f1f3' },
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// CHART 2 — Defect Trend (line)
// ══════════════════════════════════════════════════════════════════
function renderDefectTrend() {
  const byDate = groupBy(filtered, r => r.date);
  const labels = [...byDate.keys()].sort();
  const values = labels.map(d => sumOf(byDate.get(d), 'defective'));

  destroyChart('defectTrend');
  const ctx = document.getElementById('chart-defect-trend').getContext('2d');
  charts.defectTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total Cacat',
        data: values,
        borderColor: COLORS.danger,
        backgroundColor: hexAlpha(COLORS.danger, 0.1),
        fill: true,
        tension: 0.35,
        pointRadius: labels.length > 60 ? 0 : 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          type: 'category',
          ticks: {
            maxTicksLimit: 8,
            callback(v, i) { return labels[i] ? labels[i].slice(5) : ''; }
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { callback: v => fmtNum(v) },
          grid: { color: '#f0f1f3' },
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// CHART 3 — Defect Rate Trend (scatter/line per batch)
// Each point = one batch record's defect_rate × 100 (%)
// ══════════════════════════════════════════════════════════════════
function renderDefectRateTrend() {
  // Sort by date then use index as x-axis; show date on hover
  const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(r => r.date);
  const values = sorted.map(r => +(r.defect_rate * 100).toFixed(3));

  destroyChart('defectRateTrend');
  const ctx = document.getElementById('chart-defect-rate-trend').getContext('2d');
  charts.defectRateTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Defect Rate (%)',
        data: values,
        borderColor: COLORS.warn,
        backgroundColor: hexAlpha(COLORS.warn, 0.08),
        fill: true,
        tension: 0.25,
        pointRadius: values.length > 80 ? 0 : 2,
        pointHoverRadius: 5,
        borderWidth: 1.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `Tanggal: ${items[0].label}`,
            label: (item)  => `Defect Rate: ${item.parsed.y.toFixed(2)}%`,
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          ticks: {
            maxTicksLimit: 8,
            callback(v, i) { return labels[i] ? labels[i].slice(5) : ''; }
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { callback: v => v.toFixed(1) + '%' },
          grid: { color: '#f0f1f3' },
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// CHART 4 — Production vs Defective (grouped bar, monthly)
// ══════════════════════════════════════════════════════════════════
function renderProdVsDefect() {
  // Group by YYYY-MM
  const byMonth = groupBy(filtered, r => r.date.slice(0, 7));
  const labels  = [...byMonth.keys()].sort();
  const prod    = labels.map(m => sumOf(byMonth.get(m), 'produced'));
  const defect  = labels.map(m => sumOf(byMonth.get(m), 'defective'));

  destroyChart('prodVsDefect');
  const ctx = document.getElementById('chart-prod-vs-defect').getContext('2d');
  charts.prodVsDefect = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(fmtMonth),
      datasets: [
        {
          label: 'Total Produksi',
          data: prod,
          backgroundColor: hexAlpha(COLORS.brand, 0.75),
          borderColor: COLORS.brand,
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Total Cacat',
          data: defect,
          backgroundColor: hexAlpha(COLORS.danger, 0.75),
          borderColor: COLORS.danger,
          borderWidth: 1,
          borderRadius: 4,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { callback: v => fmtNum(v) },
          grid: { color: '#f0f1f3' },
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// CHART 5 — Defect Distribution (doughnut)
// Count of batches per defect_type
// ══════════════════════════════════════════════════════════════════
function renderDefectDistribution() {
  const byType  = groupBy(filtered, r => r.defect_type);
  const labels  = [...byType.keys()].sort();
  const counts  = labels.map(t => byType.get(t).length);
  const bgColors = labels.map(t => hexAlpha(defectColor(t), 0.8));
  const borders  = labels.map(t => defectColor(t));

  destroyChart('defectDist');
  const ctx = document.getElementById('chart-defect-distribution').getContext('2d');
  charts.defectDist = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: bgColors,
        borderColor: borders,
        borderWidth: 2,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 10 } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const total = item.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = ((item.parsed / total) * 100).toFixed(1);
              return ` ${item.label}: ${item.parsed} batch (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// CHART 6 — Defect Qty by Type (horizontal bar)
// Sum of defect_qty per defect_type
// ══════════════════════════════════════════════════════════════════
function renderDefectQtyByType() {
  const byType   = groupBy(filtered, r => r.defect_type);
  const entries  = [...byType.entries()]
    .map(([t, recs]) => ({ type: t, qty: sumOf(recs, 'defect_qty') }))
    .sort((a, b) => b.qty - a.qty);

  const labels   = entries.map(e => e.type);
  const values   = entries.map(e => e.qty);
  const bgColors = labels.map(t => hexAlpha(defectColor(t), 0.8));

  destroyChart('defectQtyType');
  const ctx = document.getElementById('chart-defect-qty-type').getContext('2d');
  charts.defectQtyType = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Defect Qty',
        data: values,
        backgroundColor: bgColors,
        borderColor: labels.map(t => defectColor(t)),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { callback: v => fmtNum(v) },
          grid: { color: '#f0f1f3' },
        },
        y: { grid: { display: false } }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// CHART 7 — Daily Defect Breakdown (stacked bar, monthly)
// Stacked by defect_type using defect_qty per month
// ══════════════════════════════════════════════════════════════════
function renderDailyBreakdown() {
  const months     = [...new Set(filtered.map(r => r.date.slice(0, 7)))].sort();
  const defectTypes = Object.keys(DEFECT_COLORS).concat(
    [...new Set(filtered.map(r => r.defect_type))]
      .filter(t => !DEFECT_COLORS[t])
  );

  const datasets = defectTypes.map(dtype => {
    const data = months.map(m => {
      return filtered
        .filter(r => r.date.slice(0, 7) === m && r.defect_type === dtype)
        .reduce((s, r) => s + r.defect_qty, 0);
    });
    // Skip types with zero across all months
    if (data.every(v => v === 0)) return null;
    return {
      label: dtype,
      data,
      backgroundColor: hexAlpha(defectColor(dtype), 0.8),
      borderColor: defectColor(dtype),
      borderWidth: 1,
      borderRadius: 2,
    };
  }).filter(Boolean);

  destroyChart('dailyBreakdown');
  const ctx = document.getElementById('chart-daily-breakdown').getContext('2d');
  charts.dailyBreakdown = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(fmtMonth),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { padding: 8, boxWidth: 10 } } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { callback: v => fmtNum(v) },
          grid: { color: '#f0f1f3' },
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// CHART 8 — Pareto Analysis (combo: bar + cumulative line)
// Sorted descending by total defect_qty per defect_type
// ══════════════════════════════════════════════════════════════════
function renderPareto() {
  const byType = groupBy(filtered, r => r.defect_type);
  const entries = [...byType.entries()]
    .map(([t, recs]) => ({ type: t, qty: sumOf(recs, 'defect_qty') }))
    .sort((a, b) => b.qty - a.qty);

  const labels   = entries.map(e => e.type);
  const values   = entries.map(e => e.qty);
  const total    = values.reduce((a, b) => a + b, 0);
  let   cumSum   = 0;
  const cumPct   = values.map(v => {
    cumSum += v;
    return total > 0 ? +((cumSum / total) * 100).toFixed(2) : 0;
  });

  destroyChart('pareto');
  const ctx = document.getElementById('chart-pareto').getContext('2d');
  charts.pareto = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Defect Qty',
          data: values,
          backgroundColor: labels.map(t => hexAlpha(defectColor(t), 0.8)),
          borderColor:     labels.map(t => defectColor(t)),
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'yBar',
          order: 2,
        },
        {
          type: 'line',
          label: 'Kumulatif (%)',
          data: cumPct,
          borderColor: COLORS.purple,
          backgroundColor: 'transparent',
          pointBackgroundColor: COLORS.purple,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2,
          tension: 0.1,
          yAxisID: 'yLine',
          order: 1,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (item) => {
              if (item.dataset.type === 'bar' || item.dataset.label === 'Defect Qty') {
                return ` Qty: ${fmtNum(item.parsed.y)}`;
              }
              return ` Kumulatif: ${item.parsed.y.toFixed(1)}%`;
            }
          }
        },
        // 80% reference line via annotation — done manually via afterDraw
      },
      scales: {
        x: { grid: { display: false } },
        yBar: {
          beginAtZero: true,
          position: 'left',
          ticks: { callback: v => fmtNum(v) },
          grid: { color: '#f0f1f3' },
          title: { display: true, text: 'Jumlah Cacat', font: { size: 11 } }
        },
        yLine: {
          beginAtZero: true,
          max: 100,
          position: 'right',
          ticks: { callback: v => v + '%' },
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Kumulatif %', font: { size: 11 } }
        }
      }
    },
    plugins: [{
      // Draw 80% reference line
      id: 'pareto80',
      afterDraw(chart) {
        const { ctx: c, scales } = chart;
        if (!scales.yLine) return;
        const y = scales.yLine.getPixelForValue(80);
        c.save();
        c.setLineDash([6, 4]);
        c.strokeStyle = COLORS.danger;
        c.lineWidth   = 1.2;
        c.beginPath();
        c.moveTo(scales.x.left,  y);
        c.lineTo(scales.x.right, y);
        c.stroke();
        c.fillStyle = COLORS.danger;
        c.font      = '10px sans-serif';
        c.fillText('80%', scales.x.right + 4, y + 4);
        c.restore();
      }
    }]
  });
}

// ══════════════════════════════════════════════════════════════════
// CHART 9 — Top 10 Highest Defect Dates (horizontal bar)
// Sorted by defect_rate (per batch record) descending
// ══════════════════════════════════════════════════════════════════
function renderTop10Defect() {
  const sorted = [...filtered]
    .sort((a, b) => b.defect_rate - a.defect_rate)
    .slice(0, 10);

  const labels = sorted.map(r => `${r.date} | ${r.category} (${r.batch.slice(-3)})`);
  const values = sorted.map(r => +(r.defect_rate * 100).toFixed(2));

  destroyChart('top10');
  const ctx = document.getElementById('chart-top10-defect').getContext('2d');
  charts.top10 = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Defect Rate (%)',
        data: values,
        backgroundColor: values.map(v =>
          v >= 7 ? hexAlpha(COLORS.danger, 0.8) :
          v >= 4 ? hexAlpha(COLORS.warn,   0.8) :
                   hexAlpha(COLORS.brand,  0.8)
        ),
        borderColor: values.map(v =>
          v >= 7 ? COLORS.danger :
          v >= 4 ? COLORS.warn   :
                   COLORS.brand
        ),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: item => ` Defect Rate: ${item.parsed.x.toFixed(2)}%`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { callback: v => v + '%' },
          grid: { color: '#f0f1f3' },
        },
        y: {
          ticks: { font: { size: 10 } },
          grid: { display: false },
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// TABLE — Production Quality Data
// ══════════════════════════════════════════════════════════════════
function renderTable() {
  // Search filter
  let rows = filtered.filter(r => {
    if (!tableSearch) return true;
    return (
      r.batch.toLowerCase().includes(tableSearch)    ||
      r.category.toLowerCase().includes(tableSearch) ||
      r.inspector.toLowerCase().includes(tableSearch)||
      r.defect_type.toLowerCase().includes(tableSearch) ||
      r.status.toLowerCase().includes(tableSearch)  ||
      r.date.includes(tableSearch)
    );
  });

  // Sort
  rows = rows.sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    // Numeric columns
    if (['produced','defective','defect_rate','defect_qty'].includes(sortCol)) {
      va = Number(va); vb = Number(vb);
    } else {
      va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
    }
    if (va < vb) return sortDir === 'asc' ? -1 :  1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  // Count
  document.getElementById('table-count').textContent =
    `${fmtNum(rows.length)} baris`;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  const startIdx = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(startIdx, startIdx + pageSize);

  // Render rows
  const tbody = document.getElementById('table-body');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-10 text-muted text-sm">
      Tidak ada data yang sesuai dengan filter/pencarian aktif.</td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map(r => {
      const badge = r.status === 'Baik'
        ? 'badge-ok' : r.status === 'Perlu Perhatian'
        ? 'badge-warn' : 'badge-eval';
      return `<tr>
        <td class="text-gray-700 whitespace-nowrap">${fmtDate(r.date)}</td>
        <td class="font-medium text-gray-800 whitespace-nowrap">${r.category}</td>
        <td class="text-gray-600">${r.shift}</td>
        <td class="text-gray-600">${r.line}</td>
        <td class="text-right tabular-nums">${fmtNum(r.produced)}</td>
        <td class="text-right tabular-nums text-danger font-medium">${fmtNum(r.defective)}</td>
        <td class="text-right tabular-nums font-semibold ${r.defect_rate >= 0.07 ? 'text-danger' : r.defect_rate >= 0.04 ? 'text-warn' : 'text-gray-700'}">${fmtPct(r.defect_rate)}</td>
        <td class="whitespace-nowrap">
          <span class="inline-block px-2 py-0.5 rounded text-xs font-medium"
            style="background:${hexAlpha(defectColor(r.defect_type),0.12)};color:${defectColor(r.defect_type)}">
            ${r.defect_type}
          </span>
        </td>
        <td class="text-right tabular-nums">${fmtNum(r.defect_qty)}</td>
        <td><span class="badge ${badge}">${r.status}</span></td>
        <td class="text-gray-600">${r.inspector}</td>
      </tr>`;
    }).join('');
  }

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = document.getElementById('pagination-controls');
  container.innerHTML = '';

  const addBtn = (label, page, disabled = false, active = false) => {
    const btn = document.createElement('button');
    btn.className = `page-btn${active ? ' active' : ''}`;
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', () => {
      currentPage = page;
      renderTable();
    });
    container.appendChild(btn);
  };

  addBtn('‹', currentPage - 1, currentPage === 1);

  // Show window of pages
  const delta = 2;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= currentPage - delta && p <= currentPage + delta)) {
      addBtn(p, p, false, p === currentPage);
    } else if (p === currentPage - delta - 1 || p === currentPage + delta + 1) {
      const ell = document.createElement('span');
      ell.className = 'page-btn';
      ell.textContent = '…';
      ell.style.cursor = 'default';
      container.appendChild(ell);
    }
  }

  addBtn('›', currentPage + 1, currentPage === totalPages);
}

// ══════════════════════════════════════════════════════════════════
// QUALITY INSIGHTS
// All findings derived from actual data calculations.
// No speculation about root-causes not provable from dataset.
// ══════════════════════════════════════════════════════════════════
function renderInsights() {
  const grid = document.getElementById('insights-grid');
  if (!filtered.length) {
    grid.innerHTML = '<p class="text-muted text-sm col-span-3">Tidak ada data untuk insight.</p>';
    return;
  }

  const totalProduced  = sumOf(filtered, 'produced');
  const totalDefective = sumOf(filtered, 'defective');
  const overallRate    = totalProduced > 0 ? totalDefective / totalProduced : 0;

  // Dominant defect type by qty
  const byType = groupBy(filtered, r => r.defect_type);
  const typeQty = [...byType.entries()]
    .map(([t, recs]) => ({ type: t, qty: sumOf(recs, 'defect_qty'), count: recs.length }))
    .sort((a, b) => b.qty - a.qty);
  const topType = typeQty[0];

  // Highest defect rate batch
  const topBatch = [...filtered].sort((a, b) => b.defect_rate - a.defect_rate)[0];

  // Month with highest total defective
  const byMonth = groupBy(filtered, r => r.date.slice(0, 7));
  const monthDef = [...byMonth.entries()]
    .map(([m, recs]) => ({ month: m, total: sumOf(recs, 'defective'), rate: sumOf(recs,'defective')/sumOf(recs,'produced') }))
    .sort((a, b) => b.total - a.total);
  const worstMonth = monthDef[0];

  // Category with highest avg defect rate
  const byCat = groupBy(filtered, r => r.category);
  const catRates = [...byCat.entries()]
    .map(([c, recs]) => ({
      cat : c,
      rate: sumOf(recs,'defective') / sumOf(recs,'produced'),
      batches: recs.length
    }))
    .sort((a, b) => b.rate - a.rate);
  const worstCat = catRates[0];

  // Batches with 'Perlu Evaluasi' status
  const evalCount  = filtered.filter(r => r.status === 'Perlu Evaluasi').length;
  const evalPct    = (evalCount / filtered.length * 100).toFixed(1);

  // Defect qty vs defective gap (Σ defective - Σ defect_qty)
  const totalDefQty = sumOf(filtered, 'defect_qty');
  const gap         = totalDefective - totalDefQty;

  const insights = [
    {
      icon: '📊',
      color: COLORS.brand,
      title: 'Overall Defect Rate',
      value: fmtPct(overallRate),
      body: `Dari ${fmtNum(totalProduced)} unit diproduksi, ${fmtNum(totalDefective)} unit tercatat cacat (berdasarkan kolom Total_Defective).`
    },
    {
      icon: '⚠️',
      color: COLORS.danger,
      title: 'Jenis Cacat Dominan (by Qty)',
      value: topType?.type || '—',
      body: `Total ${fmtNum(topType?.qty)} unit cacat dari ${topType?.count} batch. Merupakan kontributor terbesar dari total defect_qty tercatat.`
    },
    {
      icon: '📅',
      color: COLORS.warn,
      title: 'Bulan dengan Defect Tertinggi',
      value: worstMonth ? fmtMonth(worstMonth.month) : '—',
      body: `Total ${fmtNum(worstMonth?.total)} unit cacat (defect rate: ${fmtPct(worstMonth?.rate)}). Identifikasi batch-batch pada bulan ini untuk investigasi lebih lanjut.`
    },
    {
      icon: '🏭',
      color: COLORS.purple,
      title: 'Kategori dengan Defect Rate Tertinggi',
      value: worstCat?.cat || '—',
      body: `Rata-rata defect rate: ${fmtPct(worstCat?.rate)} dari ${worstCat?.batches} batch. Lakukan evaluasi proses produksi pada kategori ini.`
    },
    {
      icon: '🔴',
      color: COLORS.danger,
      title: 'Batch Defect Rate Tertinggi',
      value: topBatch ? fmtPct(topBatch.defect_rate) : '—',
      body: `Batch ${topBatch?.batch} — ${topBatch?.category} (${topBatch?.date}). ${fmtNum(topBatch?.defective)} unit cacat dari ${fmtNum(topBatch?.produced)} produksi.`
    },
    {
      icon: '🔍',
      color: COLORS.warn,
      title: 'Batch Berstatus "Perlu Evaluasi"',
      value: `${evalCount} batch`,
      body: `${evalPct}% dari total batch aktif memerlukan evaluasi lanjutan (defect rate ≥ 4% atau kriteria kualitas tidak terpenuhi).`
    },
  ];

  grid.innerHTML = insights.map(ins => `
    <div class="insight-card">
      <div class="insight-icon" style="background:${hexAlpha(ins.color, 0.12)}">
        <span style="font-size:1rem">${ins.icon}</span>
      </div>
      <p class="insight-title">${ins.title}</p>
      <p class="insight-value" style="color:${ins.color}">${ins.value}</p>
      <p class="insight-body">${ins.body}</p>
    </div>
  `).join('');

  // Validation note
  const validText = gap === 0
    ? `Σ Total_Defective (${fmtNum(totalDefective)}) = Σ Defect_Quantity (${fmtNum(totalDefQty)}). Data konsisten.`
    : `Σ Total_Defective (${fmtNum(totalDefective)}) ≠ Σ Defect_Quantity (${fmtNum(totalDefQty)}). ` +
      `Selisih: ${fmtNum(Math.abs(gap))} unit. ` +
      `Ini lazim terjadi karena setiap batch hanya mencatat satu jenis cacat dominan dalam kolom Defect_Type/Defect_Quantity, ` +
      `sedangkan Total_Defective mencakup semua unit cacat. ` +
      `KPI dashboard menggunakan Total_Defective (kolom asli) untuk perhitungan defect rate.`;
  document.getElementById('validation-text').textContent = validText;
}

// ── Helper: hex colour with alpha (rgba) ────────────────────────
function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
