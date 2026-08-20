const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const tonNumberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const TARGET_CAPA_TON = 10700;
const MAX_CAPA_TON = 12000;
const decimalFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
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
const formatRatio = (value) => value == null ? '-' : `${decimalFormat.format(value * 100)}%`;
const targetRatio = (record) => valueOrZero(record.currentStock) / TARGET_CAPA_TON;
const maxRatio = (record) => valueOrZero(record.currentStock) / MAX_CAPA_TON;
const dateLabel = (date) => {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
};
const compactDate = (date) => date.replaceAll('-', '.');
const isForecast = (record) => record.dataType === 'forecast' && record.date > localDateString();
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
const loadManualOverrides = async () => {
  const response = await fetch('/api/inventory/manual-overrides');
  if (!response.ok) {
    readManualOverrides();
    return;
  }
  const overrides = await response.json();
  manualOverrides = Object.fromEntries(overrides.map((item) => [item.date, item]));
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

  const historyResponse = await fetch('/api/inventory/history');
  const history = historyResponse.ok ? await historyResponse.json() : [];
  await loadManualOverrides();
  setDashboardPayload(mergePersistedHistory(baselinePayload, history));
  document.getElementById('upload-status').textContent = history.length
    ? `저장된 업로드 ${history.length}건을 복원했습니다.`
    : '첫 번째 WMS 시트 사용';
}

function mergePersistedHistory(basePayload, history) {
  const recordsByDate = new Map((basePayload.records || []).map((record) => [record.date, { ...record }]));
  let latestItemPayload = null;

  [...history].sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || ''))).forEach((entry) => {
    const payload = entry.payload || entry;
    (payload.records || []).forEach((record) => {
      const existing = recordsByDate.get(record.date) || {};
      const isItemSnapshot = payload.mode === 'wms-item-summary';
      recordsByDate.set(record.date, isItemSnapshot
        ? { ...existing, date: record.date, dataType: record.dataType || existing.dataType, currentStock: record.currentStock, uploadedAt: record.uploadedAt }
        : { ...existing, ...record });
    });
    if (payload.mode === 'wms-item-summary') {
      latestItemPayload = payload;
    }
  });

  return {
    ...basePayload,
    ...(latestItemPayload || {}),
    records: [...recordsByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    uploadHistoryCount: history.length
  };
}

function mergeItemSnapshot(payload) {
  return mergePersistedHistory(baselinePayload || { records: [] }, [{ payload }]);
}

function setDashboardPayload(payload) {
  if (payload.mode === 'wms-item-summary' && baselinePayload?.records?.length) {
    payload = mergeItemSnapshot(payload);
  }
  dashboardPayload = payload;
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

function getPeriodRecords() {
  const selected = document.getElementById('period-select').value;
  if (selected === 'all') return dashboardData;
  const month = selected.slice(-2);
  return dashboardData.filter((item) => item.date.slice(5, 7) === month);
}

function getFilteredRecords() {
  return getPeriodRecords().filter((item) => !selectedDate || item.date <= selectedDate);
}

function renderAll() {
  renderWmsSummary();
  const records = getFilteredRecords();
  const trendRecords = getPeriodRecords();
  if (!records.length) return;
  const latest = records[records.length - 1];
  const uploadTime = dashboardPayload.mode === 'wms-item-summary' && dashboardPayload.uploadedAt
    ? ` · 업로드 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(dashboardPayload.uploadedAt))}`
    : '';
  document.getElementById('data-date').textContent = `조회 기준 ${compactDate(latest.date)} · ${isForecast(latest) ? '예상' : '실적'}${uploadTime}`;
  renderMetrics(records);
  renderInventoryChart(trendRecords);
  renderCapaChart(trendRecords);
  renderFlowChart(trendRecords);
  renderRecentTable(records);
  renderWeeklyForecast();
  renderHistoryTable();
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
  document.getElementById('wms-summary-help').textContent = 'WMS 업로드 파일 기준 현재고 요약';

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
    options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, ticks: { ...chartDefaults.scales.y.ticks, callback: (value) => `${Number(value * 100).toFixed(0)}%` } } }, plugins: { ...chartDefaults.plugins, tooltip: { ...chartDefaults.plugins.tooltip, callbacks: { label: (context) => `${context.dataset.label}: ${formatRatio(context.parsed.y)}` } } } }
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
    return `<tr><td>${compactDate(record.date)}</td><td>${typeLabel}</td><td>${formatTon(record.currentStock)}</td><td><input class="manual-edit" data-date="${record.date}" data-field="inbound" type="number" min="0" step="1" value="${record.inbound ?? ''}" aria-label="${record.date} 입고량"></td><td><input class="manual-edit" data-date="${record.date}" data-field="outbound" type="number" min="0" step="1" value="${record.outbound ?? ''}" aria-label="${record.date} 출고량"></td><td class="${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${formatTon(net)}</td></tr>`;
  }).join('');
  document.getElementById('recent-table').innerHTML = rows;
}

function dateAfterDays(days) {
  const date = new Date(`${localDateString()}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function recordForDate(date) {
  return dashboardData.find((record) => record.date === date) || {};
}

function renderWeeklyForecast() {
  const byDate = new Map(dashboardData.map((record) => [record.date, record]));
  let runningStock = valueOrZero(recordForDate(localDateString()).currentStock);
  const rows = Array.from({ length: 7 }, (_, index) => {
    const date = dateAfterDays(index);
    const record = byDate.get(date) || {};
    const override = manualOverrides[date] || {};
    const inbound = override.inbound ?? valueOrZero(record.inbound);
    const outbound = override.outbound ?? valueOrZero(record.outbound);
    const baseStock = index === 0
      ? (override.currentStock != null
        ? override.currentStock
        : (valueOrZero(record.currentStock) || runningStock))
      : runningStock;
    runningStock = Math.round(baseStock + inbound - outbound);
    const typeLabel = isForecast(record) ? '<span class="table-badge forecast">예상</span>' : '<span class="table-badge actual">실적</span>';
    return `<tr><td>${compactDate(date)}</td><td>${typeLabel}</td><td>${formatTon(baseStock)}</td><td><input class="manual-edit" data-date="${date}" data-field="inbound" type="number" min="0" step="1" value="${inbound}" aria-label="${date} 1주일 입고량"></td><td><input class="manual-edit" data-date="${date}" data-field="outbound" type="number" min="0" step="1" value="${outbound}" aria-label="${date} 1주일 출고량"></td><td class="projected-stock">${formatTon(runningStock)}</td><td class="${inbound - outbound >= 0 ? 'positive' : 'negative'}">${inbound - outbound >= 0 ? '+' : ''}${formatTon(inbound - outbound)}</td></tr>`;
  }).join('');
  document.getElementById('weekly-forecast-table').innerHTML = rows;
}

function renderHistoryTable() {
  const rows = dashboardData.map((record) => {
    const typeLabel = isForecast(record) ? '<span class="table-badge forecast">예상</span>' : '<span class="table-badge actual">실적</span>';
    return `<tr><td>${compactDate(record.date)}</td><td>${typeLabel}</td><td><input class="manual-edit" data-date="${record.date}" data-field="currentStock" type="number" min="0" step="1" value="${record.currentStock ?? ''}" aria-label="${record.date} 현재고"></td></tr>`;
  }).join('');
  document.getElementById('history-table').innerHTML = rows;
}

function applyManualOverrides() {
  dashboardData = (dashboardPayload.records || []).map((record) => ({
    ...record,
    ...(manualOverrides[record.date] || {})
  }));
}

async function saveManualOverrides() {
  const valuesByDate = new Map();
  document.querySelectorAll('.manual-edit').forEach((input) => {
    const value = input.value === '' ? null : Math.round(Number(input.value));
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    const dateValues = valuesByDate.get(input.dataset.date) || {};
    dateValues[input.dataset.field] = value;
    valuesByDate.set(input.dataset.date, dateValues);
  });
  try {
    await Promise.all([...valuesByDate].map(([date, values]) => fetch(`/api/inventory/manual-overrides/${date}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values)
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).message || '수기 데이터를 저장하지 못했습니다.');
    })));
    await loadManualOverrides();
    applyManualOverrides();
    renderAll();
    document.getElementById('upload-status').textContent = `수기 재고·입출고 데이터를 ${valuesByDate.size}일 저장했습니다.`;
  } catch (error) {
    document.getElementById('upload-status').textContent = error.message;
  }
}

async function resetFlowEdits() {
  if (!window.confirm('저장된 수기 재고·입출고 데이터를 모두 초기화할까요?')) return;
  await fetch('/api/inventory/manual-overrides', { method: 'DELETE' });
  manualOverrides = {};
  localStorage.removeItem(OVERRIDES_STORAGE_KEY);
  applyManualOverrides();
  renderAll();
  document.getElementById('upload-status').textContent = '수기 재고·입출고 데이터를 초기화했습니다.';
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
    const historyResponse = await fetch('/api/inventory/history');
    const history = historyResponse.ok ? await historyResponse.json() : [{ payload }];
    setDashboardPayload(mergePersistedHistory(baselinePayload, history));
    status.textContent = payload.mode === 'wms-item-summary'
      ? `${payload.sheetName} 품목 요약 저장 및 반영 완료 (누적 ${history.length}건)`
      : `${payload.sheetName} 저장 및 반영 완료 (누적 ${history.length}건)`;
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
document.getElementById('save-flow-button').addEventListener('click', saveManualOverrides);
document.getElementById('save-weekly-button').addEventListener('click', saveManualOverrides);
document.getElementById('save-history-button').addEventListener('click', saveManualOverrides);
document.getElementById('reset-flow-button').addEventListener('click', resetFlowEdits);
document.getElementById('reset-history-button').addEventListener('click', resetFlowEdits);
document.querySelectorAll('.trend-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.trend-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.trend-tab-panel').forEach((panel) => {
      panel.hidden = panel.id !== tab.getAttribute('aria-controls');
      panel.classList.toggle('active', !panel.hidden);
    });
  });
});
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((navItem) => navItem.classList.remove('active'));
    item.classList.add('active');
    if (item.getAttribute('href') === '#flow-trend-panel') {
      document.querySelector('.trend-tab[data-trend-tab="flow"]').click();
    }
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
