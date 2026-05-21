/* Артиллерийский калькулятор — 2Б14 (Tushino, система 60-00)
   Все формулы по PDF "ARTILLERIIa-TUShINO":
   - Угломер: У = Ac - Atn + mil/2, нормализация по mil
   - Дальность: ΔXΣ = X_T + X_H + X_W, ΔП = -ΔXΣ / ΔX_тыс (для 2Б14)
   - Направление: ΔZΣ = Z_W - Z (прибавляется к угломеру)
   - Высоты (мортирная): Ph = (hc - ho)/100 × ΔПh, ΔП = Ph (для 2Б14)
   - Разложение ветра: Wx = W·cos(Aw), Wz = W·sin(Aw); Aw = Дц - Дw
*/

// ============== КОНФИГУРАЦИЯ ОРУДИЙ ==============
const MORTARS = {
  '2b14': {
    name: '2Б14 «Поднос»',
    mil: 6000,
    rangeSignFor2B14: true,
    heightFormula: 'mortar-2b14',
  },
  '2b11': {
    name: '2Б11 «Сани» 120мм',
    mil: 6000,
    rangeSignFor2B14: true,
    heightFormula: 'mortar-2b14',
    trajectories: ['mortar'],
    defaultTrajectory: 'mortar',
    tableTitle: 'Таблица стрельбы 2Б11',
  },
  '2b9': {
    name: '2Б9 «Василёк» 82мм',
    mil: 6000,
    heightFormula: '2b9',
    trajectories: ['mortar', 'flat'],
    defaultTrajectory: 'mortar',
    tableTitle: 'Таблица стрельбы 2Б9',
  },
   'd30': {
    name: '2А18 Д-30 122мм',
    mil: 6000,
    heightFormula: 'd30',
    trajectories: ['mortar', 'flat'],
    defaultTrajectory: 'flat',
    tableTitle: 'Таблица стрельбы 2А18 Д-30',
  }
};

let currentMortar = '2b14';
let currentTrajectory = 'mortar';

// Состояние расчётов между вкладками
const state = {
  aim: null,        // {U: число, mil}
  range: null,      // {dP, dxSum, xt, xh, xw}
  dir: null,        // {dZ, zw, z}
  height: null,     // {Ph}
  table: null,      // последний применённый пресет
};

// ============== УТИЛИТЫ ==============

// Парсит угол в тысячные системы 60-00:
//   "20-00" → 2000, "1500" → 1500, "-5" → -5
//   "90°" / "90 deg" / "90d" → 1500 (90·6000/360)
//   "12.5°" → 208.33
// mil по умолчанию = 6000 (2Б14, система 60-00)
function parseAngle(str, mil) {
  if (str == null) return NaN;
  const m_unit = (mil ?? (MORTARS[currentMortar] && MORTARS[currentMortar].mil) ?? 6000);
  let s = String(str).trim().replace(',', '.');
  if (s === '') return NaN;

  // Градусы: суффикс °, ° может быть отдельно; либо суффикс d/deg/градусов
  const degMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:°|deg|d|гр|°\.?)$/i);
  if (degMatch) {
    const deg = parseFloat(degMatch[1]);
    return isFinite(deg) ? (deg / 360) * m_unit : NaN;
  }

  // Формат "XX-XX" (тысячные через дефис)
  const m = s.match(/^(-?)(\d+)\s*-\s*(\d+)$/);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    const hi = parseInt(m[2], 10);
    const lo = parseInt(m[3], 10);
    return sign * (hi * 100 + lo);
  }

  // Чистое число — трактуем как тысячные (разрешаем десятичные)
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

// Получает значение поля "угол ветра" с учётом переключателя единиц (тыс/град)
function readAwField(inputId) {
  const el = $(inputId);
  if (!el) return NaN;
  const unitToggle = $(inputId + '-unit');
  const mil = (MORTARS[currentMortar] && MORTARS[currentMortar].mil) || 6000;
  const raw = el.value;
  // Если пользователь явно использует °/-/буквы — parseAngle сам определит формат
  if (/[°dг-]/i.test(raw)) return parseAngle(raw, mil);
  // Иначе — смотрим на переключатель
  if (unitToggle && unitToggle.value === 'deg') {
    const deg = parseFloat(String(raw).replace(',', '.'));
    return isFinite(deg) ? (deg / 360) * mil : NaN;
  }
  return parseAngle(raw, mil);
}

// Форматирует угол в формат "XX-XX"
function formatAngle(value) {
  if (!isFinite(value)) return '—';
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const hi = Math.floor(abs / 100);
  const lo = abs % 100;
  return `${sign}${hi}-${String(lo).padStart(2, '0')}`;
}

function parseNum(value) {
  if (value == null) return NaN;
  const s = String(value).trim().replace(',', '.');
  if (s === '') return NaN;
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

function $(id) { return document.getElementById(id); }
function $$(sel) { return document.querySelectorAll(sel); }

function showResult(id, big, detail, isError = false) {
  const box = $(id);
  box.hidden = false;
  box.classList.toggle('error', isError);
  box.querySelector('.result__big').textContent = big;
  box.querySelector('.result__small').textContent = detail;
}


function getTrajectorySelect() { return $('global-trajectory'); }
function getCurrentTrajectory() {
  const mortar = MORTARS[currentMortar] || {};
  const allowed = mortar.trajectories || ['mortar'];
  if (!allowed.includes(currentTrajectory)) currentTrajectory = mortar.defaultTrajectory || allowed[0] || 'mortar';
  return currentTrajectory;
}
function isMortarTrajectory() { return getCurrentTrajectory() === 'mortar'; }
function rangeSignForCurrentSetup() {
  if (currentMortar === '2b9' || currentMortar === 'd30') return isMortarTrajectory() ? 1 : -1;
  return -1;
}
function getHeightModeLabel() {
  if (currentMortar === '2b9') return isMortarTrajectory() ? '2Б9 (мортирная)' : '2Б9 (настильная)';
  if (currentMortar === 'd30') return isMortarTrajectory() ? '2А18 Д-30 (мортирная)' : '2А18 Д-30 (настильная)';
  return `${MORTARS[currentMortar].name} (мортирная)`;
}
function updateTrajectoryOptions(mortar) {
  const sel = getTrajectorySelect();
  if (!sel) return;
  const cfg = MORTARS[mortar] || MORTARS['2b14'];
  const allowed = cfg.trajectories || ['mortar'];
  sel.innerHTML = '';
  const labels = { mortar: 'Мортирная', flat: 'Настильная' };
  allowed.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labels[v] || v;
    sel.appendChild(opt);
  });
  currentTrajectory = allowed.includes(currentTrajectory) ? currentTrajectory : (cfg.defaultTrajectory || allowed[0]);
  sel.value = currentTrajectory;
  sel.disabled = allowed.length < 2;
  sel.closest('label')?.classList.toggle('is-disabled', allowed.length < 2);
}
function updateMortarUi() {
  const hint = $('mortar-hint');
  const tableTitle = $('tables-title');
  const trajText = isMortarTrajectory() ? 'мортирная' : 'настильная';
  const chargeSel = $('global-charge');
  const chargeText = chargeSel?.selectedOptions?.[0]?.textContent?.trim();
  if (hint) hint.textContent = `${MORTARS[currentMortar].name}${chargeText ? ' · ' + chargeText : ''} · ${trajText} траектория · Arma 3 · Tushino`;
  if (tableTitle) tableTitle.textContent = `${MORTARS[currentMortar].tableTitle || 'Таблица стрельбы'}${MORTARS[currentMortar].trajectories?.length > 1 ? ' · ' + trajText + ' траектория' : ''}`;
}

// ============== УГЛОМЕР ==============
function calcAim() {
  const ac = parseAngle($('aim-ac').value);
  const atn = parseAngle($('aim-atn').value);
  if (!isFinite(ac) || !isFinite(atn)) {
  $('aim-result').hidden = true; return;
  }
  const mil = MORTARS[currentMortar].mil;
  let U = ac - atn + mil / 2;
  let normalisation = '';
  if (U >= mil) { U = U - mil; normalisation = `У ≥ ${mil} → У − ${mil}`; }
  else if (U < 0) { U = U + mil; normalisation = `У < 0 → У + ${mil}`; }

  state.aim = { U, mil };

  showResult(
    'aim-result',
    `У = ${formatAngle(U)}  (${Math.round(U)} тыс.)`,
    `Формула: У = А_ц − А_тн + mil/2\n` +
    `       = ${ac} − ${atn} + ${mil / 2} = ${ac - atn + mil / 2}\n` +
    (normalisation ? `Нормализация: ${normalisation}\n` : '') +
    `Система: ${MORTARS[currentMortar].name} (mil = ${mil})`
  );
}

// ============== РАЗЛОЖЕНИЕ ВЕТРА ==============
// Aw = Дц - Дw (в тысячных). Aw отсчитывается ПРОТИВ часовой стрелки от направления стрельбы
// к направлению, ОТКУДА дует ветер. То есть вектор этого угла противоположен
// вектору движения воздуха.
//
// Проверка по примеру из PDF: Дц=32-00, Дw=21-00 → Aw=11-00, W=6 м/с
//   Ожидается: Wx = -2 м/с (встречный), Wz = +5 м/с (слева направо)
//   Обычный cos/sin даёт +2.44 / +5.48 — знак Wx инвертирован.
//   Причина: вектор ветра в PDF направлен ОТ цели К орудию — нужно
//   инвертировать Wx, чтобы получить проекцию в направлении полёта
//   снаряда (+ попутный / − встречный).
function decomposeWind(W, Aw_thou, mil) {
  const angleRad = (Aw_thou / mil) * 2 * Math.PI;
  const Wx = -W * Math.cos(angleRad);  // инверсия: PDF отсчитывает откуда дует ветер
  const Wz = -W * Math.sin(angleRad);
  return { Wx, Wz, angleRad };
}

// Разложение «по таблице устава» (Табл. 7, стр. 35):
//   Абсолютные величины = round(W*cos(φ)), round(W*sin(φ)),
//   где φ — угол внутри четверти (от 0 до mil/4).
//   Знаки по четвертям (Aw отсчитывается ПРОТИВ ч.с. от напр. стрельбы к точке ОТКУДА дует ветер):
//     0 (0-15):  -/+ (встречный + слева-направо)
//     1 (15-30): +/+ (попутный + слева-направо)
//     2 (30-45): +/- (попутный + справа-налево)
//     3 (45-60): -/- (встречный + справа-налево)
function decomposeWindTable(W, Aw_thou, mil) {
  mil = mil || 6000;
  const A = ((Aw_thou % mil) + mil) % mil;
  const q = mil / 4;
  const quarter = Math.floor(A / q);
  const inQuarter = A - quarter * q;
  const phi = (inQuarter / q) * (Math.PI / 2); 
  const absWx = Math.round(W * Math.cos(phi));
  const absWz = Math.round(W * Math.sin(phi));
  const signs = [
    [-1, -1],
    [+1, -1],
    [+1, +1],
    [-1, +1],
  ];
  const [sx, sz] = signs[quarter];
  return { Wx: sx * absWx, Wz: sz * absWz, quarter, inQuarter, method: 'table' };
}

// Объединённая функция разложения — выбор метода
function decomposeWindBy(method, W, Aw_thou, mil) {
  if (method === 'table') return decomposeWindTable(W, Aw_thou, mil);
  return decomposeWind(W, Aw_thou, mil);
}

// ============== ДАЛЬНОСТЬ ==============
function calcRange() {
  const t = parseNum($('r-temp').value);
  const h = parseNum($('r-press').value);
  const dxt = parseNum($('r-dxt').value);
  const dxh = parseNum($('r-dxh').value);
  const dxw = parseNum($('r-dxw').value);
  const dxtys = parseNum($('r-dxtys').value);

  if (!isFinite(t) || !isFinite(h) || !isFinite(dxt) || !isFinite(dxh) || !isFinite(dxw) || !isFinite(dxtys)) {
	$('r-result').hidden = true; return;
  }
  if (dxtys === 0) {
    showResult('r-result', 'Ошибка', 'ΔX_тыс не может быть 0.', true);
    return;
  }

  // Определение Wx
  let Wx;
  const W = parseNum($('r-wind').value);
  const Aw = readAwField('r-aw');
  const WxManual = parseNum($('r-wx').value);
  let windDetail = '';

  if (isFinite(W) && isFinite(Aw)) {
    const mil = MORTARS[currentMortar].mil;
    const dec = decomposeWindBy(windMethod, W, Aw, mil);
    Wx = dec.Wx;
    windDetail = `Wx = W·cos(Aw) = ${W}·cos(${formatAngle(Aw)}) = ${Wx.toFixed(2)} м/с`;
  } else if (isFinite(WxManual)) {
    Wx = WxManual;
    windDetail = `Wx (ручной ввод) = ${Wx} м/с`;
  } else {
    Wx = 0;
    windDetail = `Wx = 0 (ветер не задан)`;
  }

  const X_T = ((t - 15) / 10) * dxt;
  const X_H = ((1013.25 - h) / 10) * dxh;
  const X_W = Wx * dxw;
  const dxSum = X_T + X_H + X_W;

  // Для 2Б14: ΔП = -ΔXΣ / ΔX_тыс
  const sign = rangeSignForCurrentSetup();
  const dP = (sign * dxSum) / dxtys;

  state.range = { dP, dxSum, X_T, X_H, X_W };

  showResult(
    'r-result',
    `ΔП = ${dP >= 0 ? '+' : ''}${dP.toFixed(1)} (прицел)`,
    `X_T = (t−15)/10 · ΔX_T = (${t}−15)/10 · ${dxt} = ${X_T.toFixed(1)} м\n` +
    `X_H = (1013.25−h)/10 · ΔX_H = (1013.25−${h})/10 · ${dxh} = ${X_H.toFixed(1)} м\n` +
    `${windDetail}\n` +
    `X_W = Wx · ΔX_W = ${Wx.toFixed(2)} · ${dxw} = ${X_W.toFixed(1)} м\n` +
    `ΔXΣ = ${X_T.toFixed(1)} + ${X_H.toFixed(1)} + ${X_W.toFixed(1)} = ${dxSum.toFixed(1)} м\n` +
    `ΔП = ${sign === -1 ? '−' : ''}ΔXΣ / ΔX_тыс = ${dP.toFixed(2)}`
  );
}

// ============== НАПРАВЛЕНИЕ ==============
function calcDir() {
  const dzw = parseNum($('d-dzw').value);
  const z = parseNum($('d-z').value);

  if (!isFinite(dzw) || !isFinite(z)) {
    $('d-result').hidden = true; return;
  }

  let Wz;
  const W = parseNum($('d-wind').value);
  const Aw = readAwField('d-aw');
  const WzManual = parseNum($('d-wz').value);
  let windDetail = '';

  if (isFinite(W) && isFinite(Aw)) {
    const mil = MORTARS[currentMortar].mil;
    const dec = decomposeWindBy(windMethod, W, Aw, mil);
    Wz = dec.Wz;
    windDetail = `Wz = W·sin(Aw) = ${W}·sin(${formatAngle(Aw)}) = ${Wz.toFixed(2)} м/с`;
  } else if (isFinite(WzManual)) {
    Wz = WzManual;
    windDetail = `Wz (ручной ввод) = ${Wz} м/с`;
  } else {
    Wz = 0;
    windDetail = `Wz = 0 (ветер не задан)`;
  }

  const Zw = Wz * dzw;
  //деривация
  const dZ = Zw + z;

  state.dir = { dZ, Zw, z };

  showResult(
    'd-result',
    `ΔZΣ = ${dZ >= 0 ? '+' : ''}${dZ.toFixed(1)} тыс. (к угломеру)`,
    `${windDetail}\n` +
    `Z_W = Wz · ΔZ_W = ${Wz.toFixed(2)} · ${dzw} = ${Zw.toFixed(2)} тыс.\n` +
    `ΔZΣ = Z_W + Z = ${Zw.toFixed(2)} + ${z} = ${dZ.toFixed(2)} тыс.\n` +
    `→ прибавить к угломеру`
  );
}

// ============== ВЫСОТЫ ==============
function calcHeight() {
  const ho = parseNum($('h-ho').value);
  const hc = parseNum($('h-hc').value);
  const dph = parseNum($('h-dph').value);

  if (!isFinite(ho) || !isFinite(hc) || !isFinite(dph)) {
    $('h-result').hidden = true; return;
  }

  // Мортирная траектория: Ph = (hc - ho)/100 × ΔПh
  const deltaH = hc - ho;
  const S = parseNum($('global-dist').value) || parseNum($('aim-dist').value);
  let Ph = (deltaH / 100) * dph;
  let dP = Ph;
  let detailTail = '';
  if (currentMortar === '2b9' || currentMortar === 'd30') {
    if (isMortarTrajectory()) {
      dP = -1 * Ph;
      detailTail = 'Для 2Б9 (мортирная): ΔП = −Ph';
    } else {
      const extra = isFinite(S) && S !== 0 ? (deltaH / (0.001 * S)) : 0;
      Ph = Ph + extra;
      dP = Ph;
      detailTail = `Для 2Б9 (настильная): ΔП = Ph${isFinite(S) && S !== 0 ? `, добавка угла места цели = ${extra.toFixed(2)}` : ', добавка угла места цели требует дистанцию S'}`;
    }
  } else {
    detailTail = `Для ${MORTARS[currentMortar].name}: ΔП = Ph`;
  }

  state.height = { Ph, dP };

  showResult(
    'h-result',
    `ΔП = ${dP >= 0 ? '+' : ''}${dP.toFixed(1)} (прицел)`,
    `Ph = (h_ц − h_о)/100 · ΔПh\n` +
    `   = (${hc} − ${ho})/100 · ${dph}\n` +
    `   = ${Ph.toFixed(2)}\n` +
    `Для 2Б14 (мортирная): ΔП = Ph`
  );
}

// ============== ИТОГ ==============
function buildSolution() {
  const p0 = parseNum($('s-p0').value);

  // Угломер
  if (state.aim) {
    $('s-u-base').textContent = formatAngle(state.aim.U);
  } else {
    $('s-u-base').textContent = 'не рассчитан';
  }

  const dZ = state.dir ? state.dir.dZ : 0;
  $('s-dz').textContent = state.dir
    ? `${dZ >= 0 ? '+' : ''}${dZ.toFixed(1)} тыс.`
    : 'не рассчитан';

  if (state.aim) {
    const mil = state.aim.mil;
    let Ufinal = state.aim.U + dZ;
    if (Ufinal >= mil) Ufinal -= mil;
    else if (Ufinal < 0) Ufinal += mil;
    $('s-u-final').textContent = formatAngle(Ufinal);
  } else {
    $('s-u-final').textContent = '—';
  }

  // Прицел
  $('s-p0-out').textContent = isFinite(p0) ? p0.toFixed(0) : 'не задан';
  const dpR = state.range ? state.range.dP : 0;
  const dpH = state.height ? state.height.dP : 0;
  $('s-dp-range').textContent = state.range
    ? `${dpR >= 0 ? '+' : ''}${dpR.toFixed(1)}`
    : 'не рассчитан';
  $('s-dp-h').textContent = state.height
    ? `${dpH >= 0 ? '+' : ''}${dpH.toFixed(1)}`
    : 'не рассчитан';

  if (isFinite(p0)) {
    const pFinal = p0 + dpR + dpH;
    $('s-p-final').textContent = pFinal.toFixed(0);
  } else {
    $('s-p-final').textContent = state.range || state.height
      ? `Δ = ${(dpR + dpH).toFixed(1)} (введи П_0)`
      : '—';
  }

  $('s-result').hidden = false;
}

function clearAll() {
  state.aim = state.range = state.dir = state.height = null;
  $$('input').forEach(i => { i.value = ''; });
  $$('.result, .solution').forEach(r => { r.hidden = true; });
}

// ============== АВТОПОДСТАНОВКА ИЗ ТАБЛИЦЫ ==============
// Глобальный пресет по заряду и дальности — подставляет все коэффициенты во все вкладки
const AUTOFILL_MAP = [
  // [field_id, table_key]
  ['r-dxt',   'dXt'],
  ['r-dxh',   'dXh'],
  ['r-dxw',   'dXw'],
  ['r-dxtys', 'dXtys'],
  ['d-dzw',   'dZw'],
  ['d-z',     'Z'],
  ['h-dph',   'dPh'],
  ['s-p0',    'P'],
];

let lastLookup = null;

// Дополнительная информация для правильного выбора ΔXp (плотность воздуха):
// в таблице две колонки — ниже/выше нормы. Сейчас не используется в расчётах.

function markAutofilled(id, fromTable) {
  const el = $(id);
  if (!el) return;
  if (fromTable) {
    el.classList.add('autofilled');
    el.dataset.autoVal = el.value;
  } else {
    el.classList.remove('autofilled');
    delete el.dataset.autoVal;
  }
}

function applyTableLookup(chargeKey, distance) {
  const r = typeof lookupTableForMortar === 'function'
    ? lookupTableForMortar(currentMortar, chargeKey, distance, getCurrentTrajectory())
    : lookupTable(chargeKey, distance);
  if (!r) return null;
  lastLookup = r;
  for (const [fieldId, tableKey] of AUTOFILL_MAP) {
    const v = r[tableKey];
    if (isFinite(v)) {
      const el = $(fieldId);
      if (el) {
        el.value = v;
        markAutofilled(fieldId, true);
      }
    }
  }
  // Статус-бар
  const status = $('global-status');
  if (status) {
    const warn = r.inRange ? '' : ` ⚠ вне диапазона (${r.minD}–${r.maxD} м) — экстраполяция`;
    status.hidden = false;
    status.classList.toggle('warn', !r.inRange);
    status.textContent = `Подставлено: ${r.chargeName}, D=${distance} м → П=${r.P}, ΔXтыс=${r.dXtys}, T=${r.T} с${warn}`;
  }
  state.table = { source: 'auto', charge: chargeKey, D: distance, lookup: r };
  // Обновить просмотр таблицы
  renderFiringTable(chargeKey, distance);
  return r;
}

function handleManualEdit(e) {
  const el = e.target;
  if (el.classList.contains('autofilled') && el.value !== el.dataset.autoVal) {
    markAutofilled(el.id, false);
  }
}

// ============== СИНХРОНИЗАЦИЯ ДУБЛИРУЮЩИХСЯ ПОЛЕЙ ==============
// Группы полей, которые встречаются в разных разделах и должны быть одинаковыми:
//   Скорость ветра W → r-wind и d-wind
//   Угол ветра Aw → r-aw и d-aw (включая переключатель единиц)
//   Дальность D → global-dist и aim-dist
const MIRROR_GROUPS = [
  ['r-wind', 'd-wind'],
  ['r-aw',   'd-aw'],
  ['global-dist', 'aim-dist'],
];

let _mirrorSyncing = false;

function syncMirrorField(sourceId, value) {
  if (_mirrorSyncing) return;
  _mirrorSyncing = true;
  try {
    for (const group of MIRROR_GROUPS) {
      if (!group.includes(sourceId)) continue;
      for (const targetId of group) {
        if (targetId === sourceId) continue;
        const target = $(targetId);
        if (!target) continue;
        if (target.value === value) continue;
        target.value = value;
        target.classList.toggle('synced', value !== '');
      }
      // Парные переключатели единиц для углов ветра
      if (sourceId.endsWith('-aw')) {
        const srcUnit = $(sourceId + '-unit');
        if (srcUnit) {
          for (const targetId of group) {
            if (targetId === sourceId) continue;
            const tu = $(targetId + '-unit');
            if (tu && tu.value !== srcUnit.value) tu.value = srcUnit.value;
          }
        }
      }
    }
  } finally {
    _mirrorSyncing = false;
  }
}

function installMirrorListeners() {
  for (const group of MIRROR_GROUPS) {
    for (const id of group) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('input', () => {
        syncMirrorField(id, el.value);
        // Редактируем оригинал — снимаем метку 'synced' с самого источника
        el.classList.remove('synced');
      });
      // Переключатель единиц для -aw полей
      if (id.endsWith('-aw')) {
        const unit = $(id + '-unit');
        if (unit) {
          unit.addEventListener('change', () => {
            // Просто передаём текущее значение, чтобы синхронизировать переключатель в другом разделе
            syncMirrorField(id, el.value);
          });
        }
      }
    }
  }
}

// ============== ПРОСМОТР ТАБЛИЦЫ ==============
function renderFiringTable(chargeKey, highlightD) {
  const TABLES = typeof getTablesForMortar === 'function' ? getTablesForMortar(currentMortar, getCurrentTrajectory()) : ((currentMortar === '2b11' && typeof FIRING_TABLES_2B11 !== 'undefined') ? FIRING_TABLES_2B11 : FIRING_TABLES_2B14);
  if (typeof TABLES === 'undefined') return;
  const t = TABLES[chargeKey];
  const head = $('table-viewer-head');
  const tbl  = $('firing-table');
  if (!t || !head || !tbl) return;
  const d0 = t.rows[0][0];
  const d1 = t.rows[t.rows.length - 1][0];
  head.textContent = `${t.name} · диапазон ${Math.min(d0, d1)}–${Math.max(d0, d1)} м`;
  // Сжатые заголовки для мобильного
  const shortHead = ['Д, м', 'П', 'ΔXтыс', 'ΔП', 'ΔПh', 'Z', 'ΔZw', 'ΔXw', 'ΔXт', 'ΔXн', 'ΔXp⁻', 'ΔXp⁺', 'T', 'Вб', 'Вд'];
  let html = '<thead><tr>' + shortHead.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
  // Найдём ближайшую строку для подсветки
  let bestIdx = -1, bestDelta = Infinity;
  if (isFinite(highlightD)) {
    t.rows.forEach((r, i) => {
      const d = Math.abs(r[0] - highlightD);
      if (d < bestDelta) { bestDelta = d; bestIdx = i; }
    });
  }
  t.rows.forEach((row, i) => {
    const cls = i === bestIdx ? ' class="hl"' : '';
    html += `<tr${cls}>` + row.map(v => `<td>${v}</td>`).join('') + '</tr>';
  });
  html += '</tbody>';
  tbl.innerHTML = html;
}

// ============== ПРЕСЕТЫ (ручные) ==============
// Сохраняем текущее состояние полей вкладок, чтобы быстро восстановить
let presets = [];

async function loadPresets() {
  try {
    if ('caches' in self) {
      const cache = await caches.open('arty-data');
      const resp = await cache.match('/__presets');
      if (resp) presets = await resp.json();
    }
  } catch { presets = []; }
}
async function savePresets() {
  try {
    if ('caches' in self) {
      const cache = await caches.open('arty-data');
      await cache.put('/__presets', new Response(JSON.stringify(presets), {
        headers: { 'Content-Type': 'application/json' }
      }));
    }
  } catch {}
}
function renderPresets() {
  const list = $('presets-list');
  if (!list) return;
  list.innerHTML = '';
  if (presets.length === 0) {
    list.innerHTML = '<p class="muted" style="padding:8px 0">Пресетов пока нет.</p>';
    return;
  }
  presets.forEach((p, idx) => {
    const el = document.createElement('div');
    el.className = 'preset';
    el.innerHTML = `
      <div>
        <div class="preset__name">${escapeHtml(p.name)}</div>
        <div class="muted" style="margin-top:2px">ΔX_тыс=${p.dxtys ?? '—'}, ΔПh=${p.dph ?? '—'}, Z=${p.z ?? '—'}, П₀=${p.p0 ?? '—'}</div>
      </div>
      <div class="preset__actions">
        <button data-idx="${idx}" data-act="apply">Применить</button>
        <button class="preset__delete" data-idx="${idx}" data-act="delete">Удалить</button>
      </div>
    `;
    list.appendChild(el);
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Читает текущие значения полей как пресет
function snapshotCurrentForm() {
  return {
    name: ($('t-name')?.value || '').trim() || `Пресет ${presets.length + 1}`,
    dxt: parseNum($('r-dxt').value),
    dxh: parseNum($('r-dxh').value),
    dxw: parseNum($('r-dxw').value),
    dxtys: parseNum($('r-dxtys').value),
    dzw: parseNum($('d-dzw').value),
    z: parseNum($('d-z').value),
    dph: parseNum($('h-dph').value),
    p0: parseNum($('s-p0').value),
  };
}

function applyPresetToTabs(p) {
  const set = (id, v) => { if (isFinite(v)) { $(id).value = v; markAutofilled(id, false); } };
  set('r-dxt', p.dxt);
  set('r-dxh', p.dxh);
  set('r-dxw', p.dxw);
  set('r-dxtys', p.dxtys);
  set('d-dzw', p.dzw);
  set('d-z', p.z);
  set('h-dph', p.dph);
  set('s-p0', p.p0);
  state.table = { source: 'preset', ...p };
}

// ============== ВКЛАДКИ ==============
function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  // Если открыли «Итог» — пересчитаем
  if (name === 'solution') buildSolution();
}

// ============== ИНИЦИАЛИЗАЦИЯ ==============
// ============== СМЕНА ЗАРЯДОВ ПО ТИПУ МИНОМЁТА ==============
const CHARGES_2B14 = [
  { value: 'osn', label: 'Основной', selected: true},
  { value: '1',   label: '1-й' },
  { value: '2',   label: '2-й' },
  { value: '3',   label: '3-й' },
  { value: 'dal', label: 'Дальнобойный' }
];
const CHARGES_2B11 = [
  { value: '1', label: 'ОФ, #1', selected: true  },
  { value: '2', label: 'ОФ, #2'},
  { value: '3', label: 'ОФ, #3' },
  { value: '4', label: 'ОФ, #4' },
  { value: '5', label: 'ОФ, #5' },
  { value: '6', label: 'ОФ, #6' }
];
const CHARGES_2B9 = [
  { value: 'of1', label: 'ОФ, 1-й', selected: true },
  { value: 'dal', label: 'ОФ, дальнобойный' }
];
const CHARGES_D30 = [
  { value: '6', label: 'Ш, 6-й', selected: true },
  { value: '5', label: 'Ш, 5-й' },
  { value: '4', label: 'Ш, 4-й' },
  { value: '3', label: 'Ш, 3-й' },
  { value: '2', label: 'Ш, 2-й' },
  { value : '1', label: 'Ш, 1-й'},
  { value: 'smal', label: 'Ш, уменьш.'},
  { value: 'full', label: 'Ш, полный' }
];

function updateChargeOptions(mortar) {
  const sel = $('global-charge');
  if (!sel) return;
  const charges = mortar === '2b11' ? CHARGES_2B11 
    : (mortar === '2b9' ? CHARGES_2B9
    : (mortar === 'd30' ? CHARGES_D30 : CHARGES_2B14));
  const curVal = sel.value;
  sel.innerHTML = '';
  charges.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.value;
    opt.textContent = c.label;
    if (c.selected) opt.selected = true;
    sel.appendChild(opt);
  });
  const vals = charges.map(c => c.value);
  if (vals.includes(curVal)) sel.value = curVal;
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

// Aim
$('aim-calc').addEventListener('click', calcAim);
['aim-ac', 'aim-atn'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('input', calcAim);
});

// Range
$('r-calc').addEventListener('click', calcRange);
['r-temp','r-press','r-wind','r-aw','r-wx','r-dxt','r-dxh','r-dxw','r-dxtys'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('input', calcRange);
});
const rawUnit = $('r-aw-unit');
if (rawUnit) rawUnit.addEventListener('change', calcRange);

// Dir
$('d-calc').addEventListener('click', calcDir);
['d-wind', 'd-aw', 'd-wz', 'd-dzw', 'd-z'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('input', calcDir);
});
const dirUnit = $('d-aw-unit');
if (dirUnit) dirUnit.addEventListener('change', calcDir);

// Height
$('h-calc').addEventListener('click', calcHeight);
['h-ho','h-hc','h-dph'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('input', calcHeight);
});

  // Solution
  $('s-calc').addEventListener('click', buildSolution);
  $('s-clear').addEventListener('click', clearAll);

  // Tables / presets
  $('t-save').addEventListener('click', async () => {
    const p = snapshotCurrentForm();
    presets.push(p);
    await savePresets();
    renderPresets();
  });
  $('presets-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (btn.dataset.act === 'apply') {
      applyPresetToTabs(presets[idx]);
      switchTab('range');
    } else if (btn.dataset.act === 'delete') {
      presets.splice(idx, 1);
      savePresets().then(renderPresets);
    }
  });

  // Mortar select (future: switch configs)
  $('mortar-select').addEventListener('change', (e) => {
    currentMortar = e.target.value;
    updateChargeOptions(currentMortar);
    updateTrajectoryOptions(currentMortar);
    updateMortarUi();
    renderFiringTable($('global-charge').value);
  });

  // ГЛОБАЛЬНЫЙ ПРЕСЕТ ПО ДАЛЬНОСТИ И ЗАРЯДУ
  const applyGlobal = () => {
    const charge = $('global-charge').value;
    const D = parseNum($('global-dist').value);
    if (!isFinite(D)) {
      const status = $('global-status');
      status.hidden = false;
      status.classList.add('warn');
      status.textContent = 'Введи дальность до цели в метрах';
      return;
    }
    applyTableLookup(charge, D);
    // Автоподстановка в поле «дальность до цели» во вкладке «Угломер» — через систему зеркалирования
    syncMirrorField('global-dist', String(D));
  };
  $('global-apply').addEventListener('click', applyGlobal);
  $('global-charge').addEventListener('change', () => {
    updateMortarUi();
    renderFiringTable($('global-charge').value, parseNum($('global-dist').value));
  });
  const trajectorySel = $('global-trajectory');
  if (trajectorySel) trajectorySel.addEventListener('change', () => {
    currentTrajectory = trajectorySel.value;
    updateMortarUi();
    renderFiringTable($('global-charge').value, parseNum($('global-dist').value));
    if (isFinite(parseNum($('global-dist').value))) applyTableLookup($('global-charge').value, parseNum($('global-dist').value));
    calcRange();
    calcHeight();
  });
  $('global-dist').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyGlobal();
  });

  // Отслеживаем ручные правки в автоподставленных полях — снимаем подсветку
  AUTOFILL_MAP.forEach(([id]) => {
    const el = $(id);
    if (el) el.addEventListener('input', handleManualEdit);
  });

  // Синхронизация дублирующихся полей между разделами
  installMirrorListeners();

  // Виджет разложения ветра
  installWindWidget();

  // Первичный рендер таблицы и пресеты
  updateChargeOptions(currentMortar);
  updateTrajectoryOptions(currentMortar);
  updateMortarUi();
  renderFiringTable($('global-charge').value);
  loadPresets().then(renderPresets);
});

// ============== ВИДЖЕТ РАЗЛОЖЕНИЯ ВЕТРА ==============
let windMethod = 'table'; // 'table' | 'trig'
let lastWindResult = null;

function recalcWind() {
  const dc = readAwField('w-dc');
  const dw = readAwField('w-dw');
  const W  = parseNum($('w-speed').value);
  const mil = MORTARS[currentMortar].mil;

  const applyBtn = $('w-apply');
  const wAw = $('w-aw');
  const wWx = $('w-wx');
  const wWz = $('w-wz');
  const hint = $('w-hint');
  const arrow = $('wind-arrow');
  const sectorPath = $('wind-sector');

  if (!isFinite(dc) || !isFinite(dw) || !isFinite(W)) {
    wAw.textContent = '—'; wWx.textContent = '—'; wWz.textContent = '—';
    hint.firstElementChild.innerHTML = '&nbsp;';
    applyBtn.disabled = true;
    arrow.style.display = 'none';
    sectorPath.setAttribute('d', '');
    lastWindResult = null;
    return;
  }

  // Aw = Дц − Дw, если меньше 0 — прибавить mil (по PDF)
  let Aw = dc - dw;
  if (Aw < 0) Aw += mil;
  Aw = ((Aw % mil) + mil) % mil;

  const r = decomposeWindBy(windMethod, W, Aw, mil);

  wAw.textContent = formatAngle(Aw);
  const fmtNum = (n) => windMethod === 'table'
    ? `${n >= 0 ? '+' : ''}${n}`
    : `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
  wWx.textContent = `${fmtNum(r.Wx)} м/с`;
  wWz.textContent = `${fmtNum(r.Wz)} м/с`;

  // Словесная интерпретация
  const xWord = r.Wx < 0 ? 'встречный' : (r.Wx > 0 ? 'попутный' : 'нет продольн.');
  const zWord = r.Wz > 0 ? 'справа→налево' : (r.Wz < 0 ? 'слева→направо' : 'нет боков.');
  hint.firstElementChild.innerHTML = `${xWord} · ${zWord}`;

  // SVG: вектор ветра рисуем от точки «откуда» к центру.
  // Орудие смотрит вверх (−Y). Aw отсчитывается против ч.с. к «откуда».
  // В SVG ось Y вниз → против ч.с. экранных коорд. = по ч.с. математических.
  const phi = (Aw / mil) * 2 * Math.PI;
  const R = 90;
  // «Откуда дует»: поворот от (−0,-1) на +Aw против ч.с. в мат. коорд.
  // в экранных SVG: x = R·sin(−phi) = −R·sin(phi),  y = −R·cos(phi)
  const fromX = -R * Math.sin(phi);
  const fromY = -R * Math.cos(phi);
  // Направление движения воздуха: ОТ точки K центру
  const line = $('wind-arrow-line');
  line.setAttribute('x1', fromX.toFixed(2));
  line.setAttribute('y1', fromY.toFixed(2));
  line.setAttribute('x2', (-fromX * 0.82).toFixed(2));
  line.setAttribute('y2', (-fromY * 0.82).toFixed(2));
  // Стрелка в центре (направлена в центр)
  const headTipX = (-fromX * 0.82), headTipY = (-fromY * 0.82);
  const dx = -fromX, dy = -fromY;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux; // перпендикуляр
  const baseX = headTipX - ux * 10;
  const baseY = headTipY - uy * 10;
  const headPts = `${headTipX},${headTipY} ${(baseX + px * 5).toFixed(2)},${(baseY + py * 5).toFixed(2)} ${(baseX - px * 5).toFixed(2)},${(baseY - py * 5).toFixed(2)}`;
  $('wind-arrow-head').setAttribute('points', headPts);
  arrow.style.display = '';

  // Подсветка сектора четверти (в которой лежит Aw)
  const q = mil / 4;
  const quarter = Math.floor(Aw / q);
  // Сектор от quarter*q до (quarter+1)*q
  const a0 = (quarter * q / mil) * 2 * Math.PI;
  const a1 = ((quarter + 1) * q / mil) * 2 * Math.PI;
  const sectorR = 100;
  const p0x = -sectorR * Math.sin(a0), p0y = -sectorR * Math.cos(a0);
  const p1x = -sectorR * Math.sin(a1), p1y = -sectorR * Math.cos(a1);
  sectorPath.setAttribute('d', `M 0 0 L ${p0x.toFixed(2)} ${p0y.toFixed(2)} A ${sectorR} ${sectorR} 0 0 0 ${p1x.toFixed(2)} ${p1y.toFixed(2)} Z`);

  lastWindResult = { Aw, Wx: r.Wx, Wz: r.Wz, W, method: windMethod };
  applyBtn.disabled = false;
}

function applyWindToCalcs() {
  if (!lastWindResult) return;
  const { Aw, Wx, Wz, W } = lastWindResult;
  // Ручные продольный/боковой
  $('r-wx').value = String(Wx);
  $('d-wz').value = String(Wz);
  // Обнулим дублирующие поля ввода W/Aw — разборка уже сделана
  $('r-wind').value = String(W);
  $('d-wind').value = String(W);
  $('r-aw').value = formatAngle(Aw);
  $('d-aw').value = formatAngle(Aw);
  // Переключатели единиц в «тысячные»
  if ($('r-aw-unit')) $('r-aw-unit').value = 'tys';
  if ($('d-aw-unit')) $('d-aw-unit').value = 'tys';
  // Пометка 'synced' на всех этих полях
  ['r-wind','d-wind','r-aw','d-aw','r-wx','d-wz'].forEach(id => {
    const el = $(id);
    if (el) el.classList.add('synced');
  });
  calcRange();
  calcDir();
  // Визуальный фидбэк на кнопке
  const btn = $('w-apply');
  const old = btn.textContent;
  btn.textContent = '✓ Применено';
  setTimeout(() => { btn.textContent = old; }, 1400);
}

function installWindWidget() {
  const toggle = $('wind-toggle');
  const body = $('wind-body');
  if (!toggle || !body) return;

  toggle.addEventListener('click', () => {
    const open = body.hasAttribute('hidden');
    if (open) {
      body.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    } else {
      body.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  ['w-dc','w-dw','w-speed'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', recalcWind);
  });

  // Переключатели единиц тыс/° для Дц и Дw
  ['w-dc-unit','w-dw-unit'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', recalcWind);
  });

  // Переключатель метода
  document.querySelectorAll('.seg__btn[data-method]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg__btn[data-method]').forEach(b => b.classList.toggle('active', b === btn));
      windMethod = btn.dataset.method;
      recalcWind();
    });
  });

  $('w-apply').addEventListener('click', applyWindToCalcs);
}

// Экспорт для тестов
if (typeof module !== 'undefined') {
  module.exports = { parseAngle, formatAngle, decomposeWind, decomposeWindTable, decomposeWindBy, MORTARS };
}
