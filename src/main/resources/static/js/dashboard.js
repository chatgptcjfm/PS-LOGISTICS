const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let dashboardData = [];
let dashboardPayload = {};
let inventoryChart;
let capaChart;
let flowChart;

const valueOrZero = (value) => typeof value === 'number' ? value : 0;
const formatTon = (value) => value == null ? '-' : numberFormat.format(Math.round(value));
const formatRatio = (value) => value == null ? '-' : `${decimalFormat.format(value)}x`;
const dateLabel = (date) => {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
};
const compactDate = (date) => date.replaceAll('-', '.');
const isForecast = (record) => record.dataType === 'forecast';
const actualRecords = (records) => records.filter((record) => !isForecast(record));
const latestOperationalRecord = (records) => {
  const actual = actualRecords(records);
  return actual.length ? actual[actual.length - 1] : records[records.length - 1];
};

async function loadDashboard() {
  const response = await fetch('/data/inventory-dashboard.json');
  if (!response.ok) throw new Error('대시보드 데이터를 불러오지 못했습니다.');
  setDashboardPayload(await response.json());
  document.getElementById('upload-status').textContent = '첫 번째 WMS 시트 사용';
}

function setDashboardPayload(payload) {
  dashboardPayload = payload;
  dashboardData = payload.records || [];
  const asOf = payload.asOfDate || '2026-08-13';
  document.getElementById('data-date').textContent = `기준일 ${asOf.replaceAll('-', '.')} · 이후 예상`;
  renderAll();
}

function getFilteredRecords() {
  const selected = document.getElementById('period-select').value;
  if (selected === 'all') return dashboardData;
  const month = selected.slice(-2);
  return dashboardData.filter((item) => item.date.slice(5, 7) === month);
}

function renderAll() {
  const records = getFilteredRecords();
  if (!records.length) return;
  renderMetrics(records);
  renderInventoryChart(records);
  renderCapaChart(records);
  renderFlowChart(records);
  renderRecentTable(records);
}

function renderMetrics(records) {
  const latest = latestOperationalRecord(records);
  const operationalIndex = records.indexOf(latest);
  const previous = operationalIndex > 0 ? records[operationalIndex - 1] : latest;
  const change = valueOrZero(latest.currentStock) - valueOrZero(previous.currentStock);
  const netFlow = valueOrZero(latest.inbound) - valueOrZero(latest.outbound);
  const target = valueOrZero(latest.targetCapaRatio);
  const max = valueOrZero(latest.maxCapaRatio);

  document.getElementById('current-stock').textContent = formatTon(latest.currentStock);
  document.getElementById('stock-change').textContent = `${change >= 0 ? '+' : ''}${formatTon(change)} 전일 대비`;
  document.getElementById('target-capa').textContent = formatRatio(latest.targetCapaRatio);
  document.getElementById('max-capa').textContent = formatRatio(latest.maxCapaRatio);
  document.getElementById('net-flow').textContent = `${netFlow >= 0 ? '+' : ''}${formatTon(netFlow)}`;
  document.getElementById('target-status').textContent = target <= 1 ? '안정' : '초과';
  document.getElementById('max-status').textContent = max <= 1 ? '여유' : '주의';
  document.getElementById('capa-summary-value').textContent = formatRatio(records.reduce((sum, r) => sum + valueOrZero(r.targetCapaRatio), 0) / records.length);
  const pill = document.getElementById('capa-pill');
  pill.textContent = max <= 1 ? 'MAX 기준 여유' : 'MAX 기준 초과';
  pill.style.color = max <= 1 ? '#147e69' : '#b46c27';
  pill.style.background = max <= 1 ? '#e7f8f2' : '#fff1df';
}

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false }, tooltip: { backgroundColor: '#16233f', padding: 11, titleFont: { family: 'Noto Sans KR' }, bodyFont: { family: 'Manrope' } } },
  scales: {
    x: { grid: { display: false }, ticks: { color: '#8e9ab0', font: { family: 'Manrope', size: 10 }, maxTicksLimit: 9 } },
    y: { grid: { color: '#edf1f6' }, border: { display: false }, ticks: { color: '#8e9ab0', font: { family: 'Manrope', size: 10 }, callback: (value) => numberFormat.format(value) } }
  }
};

function destroyChart(chart) { if (chart) chart.destroy(); }
function renderInventoryChart(records) {
  destroyChart(inventoryChart);
  const actual = records.map((record) => !isForecast(record) ? record.currentStock : null);
  const forecast = records.map((record) => isForecast(record) ? record.currentStock : null);
  const targetCapa = records.map((record) => record.currentStock && record.targetCapaRatio ? record.currentStock / record.targetCapaRatio : null);
  inventoryChart = new Chart(document.getElementById('inventory-chart'), {
    type: 'line',
    data: { labels: records.map(r => dateLabel(r.date)), datasets: [
      { label: '실적 현재고', data: actual, borderColor: '#2446a7', backgroundColor: 'rgba(36,70,167,.08)', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: .35 },
      { label: '예상재고', data: forecast, borderColor: '#8195df', backgroundColor: 'rgba(129,149,223,.05)', borderWidth: 2.5, borderDash: [7, 5], pointRadius: 0, pointHoverRadius: 4, fill: true, tension: .35 },
      { label: '적정 CAPA', data: targetCapa, borderColor: '#46c2a5', borderWidth: 1.7, pointRadius: 0, borderDash: [5, 5], tension: .35 }
    ] },
    options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, tooltip: { ...chartDefaults.plugins.tooltip, callbacks: { label: (context) => `${context.dataset.label}: ${formatTon(context.parsed.y)} TON` } } } }
  });
}

function renderCapaChart(records) {
  destroyChart(capaChart);
  capaChart = new Chart(document.getElementById('capa-chart'), {
    type: 'line',
    data: { labels: records.map(r => dateLabel(r.date)), datasets: [
      { label: '적정 CAPA', data: records.map(r => r.targetCapaRatio), borderColor: '#2446a7', backgroundColor: 'rgba(36,70,167,.08)', fill: true, borderWidth: 2, pointRadius: 0, tension: .35 },
      { label: 'MAX CAPA', data: records.map(r => r.maxCapaRatio), borderColor: '#f1a34a', borderWidth: 1.8, pointRadius: 0, borderDash: [4, 4], tension: .35 }
    ] },
    options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, ticks: { ...chartDefaults.scales.y.ticks, callback: (value) => `${Number(value).toFixed(1)}x` } } }, plugins: { ...chartDefaults.plugins, tooltip: { ...chartDefaults.plugins.tooltip, callbacks: { label: (context) => `${context.dataset.label}: ${formatRatio(context.parsed.y)}` } } } }
  });
}

function renderFlowChart(records) {
  destroyChart(flowChart);
  flowChart = new Chart(document.getElementById('flow-chart'), {
    type: 'bar',
    data: { labels: records.map(r => dateLabel(r.date)), datasets: [
      { label: '입고', data: records.map(r => r.inbound), backgroundColor: '#46c2a5', borderRadius: 3, maxBarThickness: 13 },
      { label: '출고', data: records.map(r => r.outbound), backgroundColor: '#f1a34a', borderRadius: 3, maxBarThickness: 13 }
    ] },
    options: { ...chartDefaults, scales: { ...chartDefaults.scales, x: { ...chartDefaults.scales.x, stacked: false }, y: { ...chartDefaults.scales.y, beginAtZero: true } }, plugins: { ...chartDefaults.plugins, tooltip: { ...chartDefaults.plugins.tooltip, callbacks: { label: (context) => `${context.dataset.label}: ${formatTon(context.parsed.y)} TON` } } } }
  });
}

function renderRecentTable(records) {
  const rows = records.slice(-7).reverse().map((record) => {
    const net = valueOrZero(record.inbound) - valueOrZero(record.outbound);
    const typeLabel = isForecast(record) ? '<span class="table-badge forecast">예상</span>' : '<span class="table-badge actual">실적</span>';
    return `<tr><td>${compactDate(record.date)}</td><td>${typeLabel}</td><td>${formatTon(record.currentStock)}</td><td>${formatTon(record.inbound)}</td><td>${formatTon(record.outbound)}</td><td class="${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${formatTon(net)}</td></tr>`;
  }).join('');
  document.getElementById('recent-table').innerHTML = rows;
}

async function uploadExcel(file) {
  const status = document.getElementById('upload-status');
  if (!file) return;
  status.textContent = '업로드 및 분석 중...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const response = await fetch('/api/inventory/upload', { method: 'POST', body: formData });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || 'Excel 업로드에 실패했습니다.');
    setDashboardPayload(payload);
    status.textContent = `${payload.sheetName} 반영 완료`;
  } catch (error) {
    status.textContent = error.message;
  }
}

document.getElementById('period-select').addEventListener('change', renderAll);
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((navItem) => navItem.classList.remove('active'));
    item.classList.add('active');
  });
});
document.getElementById('excel-upload').addEventListener('change', (event) => {
  uploadExcel(event.target.files[0]);
  event.target.value = '';
});
loadDashboard().catch((error) => {
  document.getElementById('data-date').textContent = error.message;
  console.error(error);
});
