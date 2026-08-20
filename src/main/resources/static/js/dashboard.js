const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const tonNumberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const TARGET_CAPA_TON = 10700;
const MAX_CAPA_TON = 12000;
const decimalFormat = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let dashboardData = [];
let dashboardPayload = {};
let baselinePayload = null;
let inventoryChart;
let capaChart;
let flowChart;
let categoryChart;
let marketChart;
let selectedDate = '';
let manualOverrides = {};
const OVERRIDES_STORAGE_KEY = 'inventory-flow-overrides-v1';

const valueOrZero = (value) => typeof value === 'number' ? value : 0;
const formatTon = (value) => value == null ? '-' : tonNumberFormat.format(value);
const formatRatio = (value) => value == null ? '-' : `${decimalFormat.format(value)}x`;
const targetRatio = (record) => valueOrZero(record.currentStock) / TARGET_CAPA_TON;
const maxRatio = (record) => valueOrZero(record.currentStock) / MAX_CAPA_TON;
const dateLabel = (date) => {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
};
const compactDate = (date) => date.replaceAll('-', '.');
const isForecast = (record) => record.dataType === 'forecast';
const actualRecords = (records) => records.filter((record) => !isForecast(record));
const latestOperationalRecord = (records) => records[records.length - 1];
const localDateString = (date = new Date()) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
};
const readManualOverrides = () => {
  try {
    manualOverrides = JSON.parse(localStorage.getItem(OVERRIDES_STORAGE_KEY) || '{}');
  } catch (error) {
    manualOverrides = {};
  }
};
const writeManualOverrides = () => localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(manualOverrides));
const clampDate = (date, records) => {
  if (!records.length) return date;
  const min = records[0].date;
  const max = records[records.length - 1].date;
  return date < min ? min : date > max ? max : date;
};
const updateClock = () => {
  document.getElementById('live-clock').textContent = `현재시간 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date())}`;
};

async function loadDashboard() {
  const response = await fetch('/data/inventory-dashboard.json');
  if (!response.ok) throw new Error('대시보드 데이터를 불러오지 못했습니다.');
  baselinePayload = await response.json();
  setDashboardPayload(baselinePayload);
  document.getElementById('upload-status').textContent = '첫 번째 WMS 시트 사용';
}

function mergeItemSnapshot(payload) {
  const historicalRecords = baselinePayload?.records?.length
    ? baselinePayload.records
    : dashboardData;
  const recordsByDate = new Map(historicalRecords.map((record) => [record.date, record]));
  (payload.records || []).forEach((record) => {
    recordsByDate.set(record.date, { ...recordsByDate.get(record.date), ...record });
  });
  return {
    ...baselinePayload,
    ...payload,
    records: [...recordsByDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  };
}

function setDashboardPayload(payload) {
  if (payload.mode === 'wms-item-summary' && baselinePayload?.records?.length) {
    payload = mergeItemSnapshot(payload);
  }
  dashboardPayload = payload;
  readManualOverrides();
  dashboardData = (payload.records || []).map((record) => ({
    ...record,
    ...(manualOverrides[record.date] || {})
  }));
  selectedDate = clampDate(selectedDate || localDateString(), dashboardData);
  const dateInput = document.getElementById('as-of-date');
  dateInput.value = selectedDate;
  document.getElementById('data-date').textContent = `조회 기준 ${compactDate(selectedDate)} · ${isForecast(dashboardData.find((record) => record.date === selectedDate)) ? '예상' : '실적'}`;
  renderAll();
}

function getFilteredRecords() {
  const selected = document.getElementById('period-select').value;
  const dateLimited = dashboardData.filter((item) => !selectedDate || item.date <= selectedDate);
  if (selected === 'all') return dateLimited;
  const month = selected.slice(-2);
  return dateLimited.filter((item) => item.date.slice(5, 7) === month);
}

function renderAll() {
  renderWmsSummary();
  const records = getFilteredRecords();
  if (!records.length) return;
  const latest = records[records.length - 1];
  const uploadTime = dashboardPayload.mode === 'wms-item-summary' && dashboardPayload.uploadedAt
    ? ` · 업로드 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(dashboardPayload.uploadedAt))}`
    : '';
  document.getElementById('data-date').textContent = `조회 기준 ${compactDate(latest.date)} · ${isForecast(latest) ? '예상' : '실적'}${uploadTime}`;
  renderMetrics(records);
  renderInventoryChart(records);
  renderCapaChart(records);
  renderFlowChart(records);
  renderRecentTable(records);
}

function renderWmsSummary() {
  const panel = document.getElementById('wms-summary');
  const summary = dashboardPayload.inventorySummary;
  if (!summary) {
    panel.hidden = true;
    destroyChart(categoryChart);
    destroyChart(marketChart);
    return;
  }

  panel.hidden = false;
  const categories = ['시트', '원지', '상품'];
  const markets = ['내수', '수출'];
  const byCategory = summary.byCategory || {};
  const byMarket = summary.byMarket || {};
  const byCategoryMarket = summary.byCategoryMarket || {};
  const categoryValues = categories.map((category) => valueOrZero(byCategory[category]));
  const marketValues = markets.map((market) => valueOrZero(byMarket[market]));

  document.getElementById('wms-summary-badge').textContent = `${formatTon(summary.totalWeight)} TON`;
  document.getElementById('wms-summary-help').textContent = `${dashboardPayload.sheetName || '첫 번째 시트'} · 총중량 기준 · ${summary.itemCount ?? 0}건 품목 집계`;

  destroyChart(categoryChart);
  categoryChart = new Chart(document.getElementById('category-chart'), {
    type: 'doughnut',
    data: { labels: categories, datasets: [{ data: categoryValues, backgroundColor: ['#2446a7', '#46c2a5', '#f1a34a'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: 'Noto Sans KR', size: 10 }, color: '#72809a' } }, tooltip: { callbacks: { label: (context) => `${context.label}: ${formatTon(context.parsed)} TON` } } } }
  });

  destroyChart(marketChart);
  marketChart = new Chart(document.getElementById('market-chart'), {
    type: 'bar',
    data: { labels: markets, datasets: [{ label: '현재고', data: marketValues, backgroundColor: ['#5f82dd', '#f1a34a'], borderRadius: 5, maxBarThickness: 36 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${formatTon(context.parsed.y)} TON` } } }, scales: { x: { grid: { display: false }, ticks: { color: '#72809a', font: { family: 'Noto Sans KR', size: 10 } } }, y: { beginAtZero: true, grid: { color: '#edf1f6' }, border: { display: false }, ticks: { color: '#8e9ab0', font: { family: 'Manrope', size: 10 }, callback: (value) => numberFormat.format(value) } } } }
  });

  const rows = categories.map((category) => {
    const values = byCategoryMarket[category] || {};
    const domestic = valueOrZero(values['내수']);
    const exportValue = valueOrZero(values['수출']);
    return `<tr><td>${category}</td><td>${formatTon(domestic)}</td><td>${formatTon(exportValue)}</td><td>${formatTon(domestic + exportValue)}</td></tr>`;
  }).join('');
  const totalDomestic = valueOrZero(byMarket['내수']);
  const totalExport = valueOrZero(byMarket['수출']);
  document.getElementById('category-market-table').innerHTML = `${rows}<tr><td>합계</td><td>${formatTon(totalDomestic)}</td><td>${formatTon(totalExport)}</td><td>${formatTon(summary.totalWeight)}</td></tr>`;

  const unknownCodes = summary.unknownCodes || [];
  const unknownNote = document.getElementById('unknown-code-note');
  unknownNote.hidden = !unknownCodes.length;
  if (unknownCodes.length) {
    unknownNote.textContent = `분류 제외 ${summary.unknownCodeCount ?? unknownCodes.length}건: 품목코드 5번째 문자가 1(내수) 또는 2(수출)이 아닌 코드입니다. ${unknownCodes.join(', ')}`;
  }
}

function renderMetrics(records) {
  const latest = latestOperationalRecord(records);
  const operationalIndex = records.indexOf(latest);
  const previous = operationalIndex > 0 ? records[operationalIndex - 1] : latest;
  const change = valueOrZero(latest.currentStock) - valueOrZero(previous.currentStock);
  const netFlow = valueOrZero(latest.inbound) - valueOrZero(latest.outbound);
  const target = targetRatio(latest);
  const max = maxRatio(latest);

  document.getElementById('current-stock').textContent = formatTon(latest.currentStock);
  document.querySelector('.metric-primary .metric-tag').textContent = dashboardPayload.mode === 'wms-item-summary'
    ? '파일 업로드 시각 기준'
    : '09:00 기준';
  document.getElementById('stock-change').textContent = `${change >= 0 ? '+' : ''}${formatTon(change)} 전일 대비`;
  document.getElementById('target-capa').textContent = formatRatio(target);
  document.getElementById('max-capa').textContent = formatRatio(max);
  document.getElementById('net-flow').textContent = `${netFlow >= 0 ? '+' : ''}${formatTon(netFlow)}`;
  document.getElementById('target-status').textContent = target <= 1 ? '안정' : '초과';
  document.getElementById('max-status').textContent = max <= 1 ? '여유' : '주의';
  document.getElementById('capa-summary-value').textContent = formatRatio(records.reduce((sum, record) => sum + targetRatio(record), 0) / records.length);
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
  const targetCapa = records.map(() => TARGET_CAPA_TON);
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
      { label: '적정 CAPA 10,700 TON', data: records.map(() => 1), borderColor: '#2446a7', backgroundColor: 'rgba(36,70,167,.08)', fill: true, borderWidth: 2, pointRadius: 0, tension: .35 },
      { label: 'MAX CAPA 12,000 TON', data: records.map(() => MAX_CAPA_TON / TARGET_CAPA_TON), borderColor: '#f1a34a', borderWidth: 1.8, pointRadius: 0, borderDash: [4, 4], tension: .35 }
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
    return `<tr><td>${compactDate(record.date)}</td><td>${typeLabel}</td><td>${formatTon(record.currentStock)}</td><td><input class="flow-edit" data-date="${record.date}" data-field="inbound" type="number" min="0" step="0.001" value="${record.inbound ?? ''}" aria-label="${record.date} 입고량"></td><td><input class="flow-edit" data-date="${record.date}" data-field="outbound" type="number" min="0" step="0.001" value="${record.outbound ?? ''}" aria-label="${record.date} 출고량"></td><td class="${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${formatTon(net)}</td></tr>`;
  }).join('');
  document.getElementById('recent-table').innerHTML = rows;
}

function saveFlowEdits() {
  const inputs = document.querySelectorAll('.flow-edit');
  inputs.forEach((input) => {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) return;
    manualOverrides[input.dataset.date] = {
      ...(manualOverrides[input.dataset.date] || {}),
      [input.dataset.field]: value
    };
  });
  writeManualOverrides();
  dashboardData = dashboardData.map((record) => ({ ...record, ...(manualOverrides[record.date] || {}) }));
  renderAll();
  document.getElementById('upload-status').textContent = '입고·출고 수기 변경을 저장했습니다.';
}

function resetFlowEdits() {
  if (!window.confirm('저장된 입고·출고 수기 변경을 모두 초기화할까요?')) return;
  manualOverrides = {};
  localStorage.removeItem(OVERRIDES_STORAGE_KEY);
  dashboardData = (dashboardPayload.records || []).map((record) => ({ ...record }));
  renderAll();
  document.getElementById('upload-status').textContent = '수기 변경을 초기화했습니다.';
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
    status.textContent = payload.mode === 'wms-item-summary'
      ? `${payload.sheetName} 품목 요약 반영 완료`
      : `${payload.sheetName} 반영 완료`;
  } catch (error) {
    status.textContent = error.message;
  }
}

document.getElementById('period-select').addEventListener('change', renderAll);
document.getElementById('as-of-date').addEventListener('change', (event) => {
  selectedDate = clampDate(event.target.value, dashboardData);
  event.target.value = selectedDate;
  renderAll();
});
document.getElementById('today-button').addEventListener('click', () => {
  selectedDate = clampDate(localDateString(), dashboardData);
  document.getElementById('as-of-date').value = selectedDate;
  renderAll();
});
document.getElementById('save-flow-button').addEventListener('click', saveFlowEdits);
document.getElementById('reset-flow-button').addEventListener('click', resetFlowEdits);
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
updateClock();
setInterval(updateClock, 1000);
loadDashboard().catch((error) => {
  document.getElementById('data-date').textContent = error.message;
  console.error(error);
});
