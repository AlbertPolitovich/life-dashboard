/**
 * Google Apps Script — Web App JSON API (Routine/Sport dashboard).
 *
 * Как задеплоить (после любого изменения doGet / вспомогательных функций):
 * 1. Код должен быть в той же таблице: Extensions → Apps Script (контейнерный проект).
 * 2. Вставьте/обновите этот файл как основной .gs, сохраните (Ctrl/Cmd+S).
 * 3. Deploy → Manage deployments → карандаш у активного Web App → Version: New version → Deploy.
 *    (если деплоя ещё нет: Deploy → New deployment → тип Web app → Execute as: Me,
 *     Who has access: Anyone / Anyone with Google account — как нужно для клиента.)
 * 4. Скопируйте URL вида …/exec в константу API_URL во фронте (index.html).
 *
 * Фронт (index.html): donut по сферам, Sport by min, Sport by type (O,S + плашки Q33..V33), radar.
 * После правок API: New version → Deploy. Поле ответа: sportByType { byTypeColumn, statPills }.
 *
 * Лист месяца: имя = yyyy-MM (28–31 день — без разницы).
 *
 * Сферы: B1:I1; строки с меткой в A «факт» / «цель» (не фиксированные номера строк).
 * Если несколько «цель» — для сфер берётся строка с максимальной суммой B:I.
 *
 * Спорт (мин): J, K, N, P, T. Факт = сумма по строкам, где в A дата.
 * Спорт (тип): O (бег), S (велоспорт) — тот же факт/цель; плашки Q33,R33,U33,V33.
 * Цели по категориям: строка с «цель» в A, где сумма J+K+N+P+T максимальна;
 *   если везде 0 — та же строка «цель», что и для сфер (макс. сумма B:I).
 *
 * Итог минут: SPORT_ITOG_MINUTES_GOAL[месяц] или сумма пяти целей из найденной строки / fallback.
 */

var SPORT_TRACK_COLS_1BASED = [10, 11, 14, 16, 20];
var SPORT_BY_TYPE_COLS_1BASED = [15, 19];
/** Плашки Sport by type: R33 HR run, V33 HR cycling (целое). Q33 Pace, U33 Wt — не используем. */
var SPORT_BY_TYPE_STAT_CELLS = [
  { col1: 18, row1: 33, key: 'hrRunning' },
  { col1: 22, row1: 33, key: 'hrCycling', roundInt: true }
];

var SPORT_ITOG_MINUTES_GOAL = {
  '2026-05': 1417
};

var SPORT_GOAL_MINUTES_FALLBACK = {
  '2026-05': 1417
};

function doGet(e) {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var monthKey = Utilities.formatDate(now, tz, 'yyyy-MM');

  if (e && e.parameter && e.parameter.month) {
    var raw = String(e.parameter.month).trim();
    if (/^\d{4}-\d{2}$/.test(raw)) {
      monthKey = raw;
    } else {
      return jsonOut_({ ok: false, error: 'Параметр month: формат yyyy-MM, например 2026-05' });
    }
  }

  var SHEET_NAME = monthKey;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return jsonOut_({
      ok: false,
      error: 'Нет активной таблицы: вставьте скрипт в Extensions → Apps Script этой книги (не standalone без привязки).'
    });
  }
  var sh = ss.getSheetByName(SHEET_NAME);

  if (!sh) {
    return jsonOut_({ ok: false, error: 'Нет вкладки: ' + SHEET_NAME, month: monthKey });
  }

  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) {
    return jsonOut_({ ok: false, error: 'Лист пустой', month: monthKey });
  }

  var rows = buildLifeRows_(values);
  if (!rows.ok) {
    rows.month = monthKey;
    return jsonOut_(rows);
  }

  var sport = buildSportBlock_(values, monthKey);
  var sportByType = buildSportByTypeBlock_(values, monthKey);

  return jsonOut_({
    ok: true,
    month: monthKey,
    rows: rows.rows,
    sport: sport,
    sportByType: sportByType
  });
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function monthTitleRu_(key) {
  var names = {
    '01': 'Январь',
    '02': 'Февраль',
    '03': 'Март',
    '04': 'Апрель',
    '05': 'Май',
    '06': 'Июнь',
    '07': 'Июль',
    '08': 'Август',
    '09': 'Сентябрь',
    '10': 'Октябрь',
    '11': 'Ноябрь',
    '12': 'Декабрь'
  };
  var p = String(key).split('-');
  if (p.length !== 2) return key;
  var mon = names[p[1]] || p[1];
  return String(mon).toLowerCase() + ' ' + p[0];
}

function normLabel_(x) {
  return String(x == null ? '' : x)
    .replace(/\u00A0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[:：]$/, '');
}

function isDateCell_(a) {
  if (a instanceof Date) return true;
  var s = String(a || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function sumLifeGoalsBtoI_(row) {
  var s = 0;
  for (var i = 1; i <= 8 && i < row.length; i++) {
    s += Number(row[i]) || 0;
  }
  return s;
}

function sumSportGoalCellsJKNT_(row) {
  var s = 0;
  for (var t = 0; t < SPORT_TRACK_COLS_1BASED.length; t++) {
    var idx0 = SPORT_TRACK_COLS_1BASED[t] - 1;
    if (row.length <= idx0) continue;
    s += Number(row[idx0]) || 0;
  }
  return s;
}

/**
 * Строка (0-based index), где в A «цель» и лежат цели спорта в J,K,N,P,T.
 * При нескольких «цель» — приоритет строке с max суммой J..T; иначе max B:I (как сферы).
 */
function findSportGoalRowIndex_(values) {
  var bestSportSum = -1;
  var bestSportR = -1;
  var bestLifeSum = -1;
  var bestLifeR = -1;

  for (var r = 1; r < values.length; r++) {
    if (normLabel_(values[r][0]) !== 'цель') continue;
    var row = values[r];
    var ss = sumSportGoalCellsJKNT_(row);
    if (ss > bestSportSum) {
      bestSportSum = ss;
      bestSportR = r;
    }
    var ls = sumLifeGoalsBtoI_(row);
    if (ls > bestLifeSum) {
      bestLifeSum = ls;
      bestLifeR = r;
    }
  }

  if (bestSportR >= 0 && bestSportSum > 0) return bestSportR;
  if (bestLifeR >= 0) return bestLifeR;
  return -1;
}

function buildLifeRows_(values) {
  var spheres = [];
  for (var c = 1; c <= 8; c++) {
    spheres.push(String(values[0][c] || '').trim());
  }

  var fact = null;
  var goal = null;
  var bestGoalSum = -1;

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var lbl = normLabel_(row[0]);
    if (lbl === 'факт') {
      fact = row.slice(1, 9).map(function (v) { return Number(v) || 0; });
    } else if (lbl === 'цель') {
      var cand = row.slice(1, 9).map(function (v) { return Number(v) || 0; });
      var sumG = 0;
      for (var i = 0; i < cand.length; i++) sumG += cand[i];
      if (sumG > bestGoalSum) {
        bestGoalSum = sumG;
        goal = cand;
      }
    }
  }

  if (!fact || !goal) {
    return { ok: false, error: 'Не найдены строки «факт» и/или «цель» в колонке A' };
  }

  var rows = spheres.map(function (name, i) {
    return {
      sphere: name,
      fact: fact[i],
      goal: goal[i],
      progress: goal[i] > 0 ? Math.round((fact[i] / goal[i]) * 100) : 0
    };
  });

  return { ok: true, rows: rows };
}

function shortSportLabel_(full) {
  var s = String(full || '').trim();
  return s.replace(/, min$/i, '').trim();
}

function buildSportBlock_(values, monthKey) {
  var rGoal = findSportGoalRowIndex_(values);
  var byMinColumn = [];
  var totalFact = 0;
  var totalGoalFromSheet = 0;

  for (var t = 0; t < SPORT_TRACK_COLS_1BASED.length; t++) {
    var col1 = SPORT_TRACK_COLS_1BASED[t];
    var idx0 = col1 - 1;
    var label = String(values[0][idx0] || '').trim();

    var goalPart = 0;
    if (rGoal >= 0 && values.length > rGoal && values[rGoal].length > idx0) {
      goalPart = Number(values[rGoal][idx0]) || 0;
    }

    var sumM = 0;
    for (var r = 1; r < values.length; r++) {
      if (!isDateCell_(values[r][0])) continue;
      var v = Number(values[r][idx0]);
      if (!isNaN(v)) sumM += v;
    }

    sumM = Math.round(sumM * 100) / 100;
    totalFact += sumM;
    totalGoalFromSheet += goalPart;

    var pr = goalPart > 0 ? Math.round((sumM / goalPart) * 100) : 0;

    byMinColumn.push({
      label: label,
      shortLabel: shortSportLabel_(label),
      minutes: sumM,
      goalPart: goalPart,
      progress: pr
    });
  }

  totalFact = Math.round(totalFact * 100) / 100;

  var sumGoalsRow = totalGoalFromSheet;
  var kpiDen = sumGoalsRow;
  var rowNote = rGoal >= 0 ? 'row:' + (rGoal + 1) : 'row:none';
  var goalSource = 'sum J..T on «цель» (' + rowNote + ')';

  var overrideItog = SPORT_ITOG_MINUTES_GOAL[monthKey];
  if (overrideItog != null && overrideItog !== '' && Number(overrideItog) > 0) {
    kpiDen = Number(overrideItog);
    goalSource = 'SPORT_ITOG_MINUTES_GOAL[' + monthKey + ']';
  } else if (!kpiDen || kpiDen <= 0) {
    var fb = SPORT_GOAL_MINUTES_FALLBACK[monthKey];
    if (fb != null && fb !== '') {
      kpiDen = Number(fb) || 0;
      goalSource = 'fallback:SPORT_GOAL_MINUTES_FALLBACK[' + monthKey + ']';
    }
  }
  if (!kpiDen || kpiDen <= 0) {
    kpiDen = 1417;
    goalSource = 'default:1417';
  }

  var progressTotal =
    kpiDen > 0 ? Math.round((totalFact / kpiDen) * 1000) / 10 : 0;

  return {
    monthKey: monthKey,
    monthTitle: monthTitleRu_(monthKey),
    totalMinutes: totalFact,
    goalTotalMinutes: kpiDen,
    goalMinutes: kpiDen,
    goalSumSportTargets: sumGoalsRow,
    sportGoalRow1Based: rGoal >= 0 ? rGoal + 1 : null,
    goalSource: goalSource,
    progress: progressTotal,
    byMinColumn: byMinColumn
  };
}

function buildSportByTypeColumn_(values, rGoal, col1) {
  var idx0 = col1 - 1;
  var label = String(values[0][idx0] || '').trim();

  var goalPart = 0;
  if (rGoal >= 0 && values.length > rGoal && values[rGoal].length > idx0) {
    goalPart = Number(values[rGoal][idx0]) || 0;
  }

  var sumFact = 0;
  for (var r = 1; r < values.length; r++) {
    if (!isDateCell_(values[r][0])) continue;
    var v = Number(values[r][idx0]);
    if (!isNaN(v)) sumFact += v;
  }
  sumFact = Math.round(sumFact * 100) / 100;

  var pr = goalPart > 0 ? Math.round((sumFact / goalPart) * 100) : 0;

  return {
    label: label,
    shortLabel: shortSportLabel_(label),
    fact: sumFact,
    goal: goalPart,
    progress: pr
  };
}

function buildSportByTypeBlock_(values, monthKey) {
  var rGoal = findSportGoalRowIndex_(values);
  var byTypeColumn = [];

  for (var t = 0; t < SPORT_BY_TYPE_COLS_1BASED.length; t++) {
    byTypeColumn.push(buildSportByTypeColumn_(values, rGoal, SPORT_BY_TYPE_COLS_1BASED[t]));
  }

  var statPills = [];
  for (var p = 0; p < SPORT_BY_TYPE_STAT_CELLS.length; p++) {
    var spec = SPORT_BY_TYPE_STAT_CELLS[p];
    var idx0 = spec.col1 - 1;
    var r0 = spec.row1 - 1;
    var hdr = String(values[0][idx0] || '').trim();
    var raw = '';
    if (values.length > r0 && values[r0].length > idx0) {
      raw = values[r0][idx0];
    }
    if (raw instanceof Date) continue;
    var val = formatStatPillValue_(raw, spec);
    if (val === '') continue;
    statPills.push({
      key: spec.key,
      label: hdr,
      shortLabel: shortSportLabel_(hdr),
      value: val,
      cell: columnLetter_(spec.col1) + spec.row1
    });
  }

  return {
    monthKey: monthKey,
    monthTitle: monthTitleRu_(monthKey),
    byTypeColumn: byTypeColumn,
    statPills: statPills
  };
}

function formatStatPillValue_(raw, spec) {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date) return '';
  var n = Number(raw);
  if (!isNaN(n) && String(raw).trim() !== '') {
    if (spec.roundInt) return String(Math.round(n));
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return String(Math.round(n * 100) / 100);
  }
  return String(raw).trim();
}

function columnLetter_(col1) {
  var n = col1;
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Telegram-бот: найти строку дня для заполнения B:I.
 * POST JSON: { "action": "prepareDay", "date": "yyyy-MM-dd", "secret": "..." }
 * Строку не создаём — дата должна уже быть в колонке A. Иначе ok: false.
 * Опционально в Script properties: BOT_API_SECRET
 */
function doPost(e) {
  try {
    var body = {};
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Invalid JSON body' });
    }

    if (!checkBotSecret_(body)) {
      return jsonOut_({ ok: false, error: 'Unauthorized' });
    }

    var action = String(body.action || '');
    if (action === 'prepareDay') {
      return jsonOut_(prepareDay_(String(body.date || '')));
    }
    if (action === 'writeRoutine') {
      return jsonOut_(writeRoutine_(
        String(body.date || ''),
        Number(body.col1Based),
        Number(body.value)
      ));
    }
    if (action === 'writeRoutineBatch') {
      return jsonOut_(writeRoutineBatch_(
        String(body.date || ''),
        Number(body.row1Based),
        body.values
      ));
    }
    if (action === 'writeSportCell') {
      return jsonOut_(writeSportCell_(
        String(body.date || ''),
        Number(body.row1Based),
        Number(body.col1Based),
        Number(body.value)
      ));
    }
    if (action === 'writeSportBatch') {
      return jsonOut_(writeSportBatch_(
        String(body.date || ''),
        Number(body.row1Based),
        body.cells
      ));
    }

    return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  }
}

function checkBotSecret_(body) {
  var expected = PropertiesService.getScriptProperties().getProperty('BOT_API_SECRET');
  if (!expected) return true;
  return String(body.secret || '') === expected;
}

function formatDateCell_(a) {
  if (a instanceof Date) {
    return Utilities.formatDate(a, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(a || '').trim().replace(/\u00A0/g, ' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  var m4 = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m4) {
    return m4[3] + '-' + pad2_(m4[2]) + '-' + pad2_(m4[1]);
  }

  var m2 = s.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (m2) {
    var year = new Date().getFullYear();
    return year + '-' + pad2_(m2[2]) + '-' + pad2_(m2[1]);
  }

  return '';
}

function pad2_(n) {
  var s = String(n);
  return s.length === 1 ? '0' + s : s;
}

function findDayRow1Based_(values, dateIso) {
  for (var r = 1; r < values.length; r++) {
    if (formatDateCell_(values[r][0]) === dateIso) {
      return r + 1;
    }
  }
  return 0;
}

function prepareDay_(dateIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return { ok: false, error: 'bad_date' };
  }

  var monthKey = dateIso.substring(0, 7);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return { ok: false, error: 'no_spreadsheet' };
  }

  var sh = ss.getSheetByName(monthKey);
  if (!sh) {
    return { ok: false, error: 'sheet_not_found', month: monthKey };
  }

  var values = sh.getDataRange().getValues();
  var existing = findDayRow1Based_(values, dateIso);
  if (existing <= 0) {
    return { ok: false, error: 'row_not_found', date: dateIso, month: monthKey };
  }

  return {
    ok: true,
    action: 'prepareDay',
    date: dateIso,
    month: monthKey,
    row1Based: existing
  };
}

function writeRoutine_(dateIso, col1Based, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return { ok: false, error: 'table_not_configured' };
  }
  var col = Math.round(col1Based);
  if (col < 2 || col > 9) {
    return { ok: false, error: 'table_not_configured' };
  }
  var v = Number(value);
  if (v !== 0 && v !== 1) {
    return { ok: false, error: 'table_not_configured' };
  }

  var monthKey = dateIso.substring(0, 7);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return { ok: false, error: 'table_not_configured' };
  }

  var sh = ss.getSheetByName(monthKey);
  if (!sh) {
    return { ok: false, error: 'table_not_configured' };
  }

  var values = sh.getDataRange().getValues();
  var row1 = findDayRow1Based_(values, dateIso);
  if (row1 <= 0) {
    return { ok: false, error: 'table_not_configured' };
  }

  sh.getRange(row1, col).setValue(v);

  return {
    ok: true,
    action: 'writeRoutine',
    date: dateIso,
    col1Based: col,
    value: v
  };
}

function writeRoutineBatch_(dateIso, row1Based, values) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return { ok: false, error: 'table_not_configured' };
  }
  var row1 = Math.round(row1Based);
  if (row1 < 2) {
    return { ok: false, error: 'table_not_configured' };
  }
  if (!values || values.length !== 8) {
    return { ok: false, error: 'table_not_configured' };
  }

  var rowValues = [];
  for (var i = 0; i < 8; i++) {
    var v = Number(values[i]);
    if (v !== 0 && v !== 1) {
      return { ok: false, error: 'table_not_configured' };
    }
    rowValues.push(v);
  }

  var monthKey = dateIso.substring(0, 7);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return { ok: false, error: 'table_not_configured' };
  }

  var sh = ss.getSheetByName(monthKey);
  if (!sh) {
    return { ok: false, error: 'table_not_configured' };
  }

  sh.getRange(row1, 2, 1, 8).setValues([rowValues]);

  return {
    ok: true,
    action: 'writeRoutineBatch',
    date: dateIso,
    row1Based: row1
  };
}

/** Колонки J–V (1-based), которые бот может писать в строку дня. */
var SPORT_WRITE_COLS_1BASED = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
var SPORT_PACE_COL_1BASED = 17;

function normalizePaceForSheet_(raw) {
  var s = String(raw || '').trim();
  var m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  var minutes = Number(m[1]);
  var seconds = Number(m[2]);
  if (seconds < 0 || seconds > 59 || minutes < 0) return null;
  return pad2_(minutes) + ':' + pad2_(seconds) + ':' + m[3];
}

function normalizeSportNumber_(raw) {
  var s = String(raw || '').trim().replace(/\s/g, '').replace(',', '.');
  var v = Number(s);
  if (isNaN(v) || v < 0) return null;
  return v;
}

function writeSportCellValue_(sh, row1, col, rawValue) {
  if (col === SPORT_PACE_COL_1BASED) {
    var pace = normalizePaceForSheet_(rawValue);
    if (!pace) return false;
    sh.getRange(row1, col).setValue(pace);
    return true;
  }
  var v = normalizeSportNumber_(rawValue);
  if (v === null) return false;
  sh.getRange(row1, col).setValue(v);
  return true;
}

function isSportWriteCol_(col) {
  for (var i = 0; i < SPORT_WRITE_COLS_1BASED.length; i++) {
    if (SPORT_WRITE_COLS_1BASED[i] === col) return true;
  }
  return false;
}

function writeSportCell_(dateIso, row1Based, col1Based, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return { ok: false, error: 'table_not_configured' };
  }
  var row1 = Math.round(row1Based);
  if (row1 < 2) {
    return { ok: false, error: 'table_not_configured' };
  }
  var col = Math.round(col1Based);
  if (!isSportWriteCol_(col)) {
    return { ok: false, error: 'table_not_configured' };
  }

  var monthKey = dateIso.substring(0, 7);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return { ok: false, error: 'table_not_configured' };
  }

  var sh = ss.getSheetByName(monthKey);
  if (!sh) {
    return { ok: false, error: 'table_not_configured' };
  }

  if (!writeSportCellValue_(sh, row1, col, value)) {
    return { ok: false, error: 'table_not_configured' };
  }

  return {
    ok: true,
    action: 'writeSportCell',
    date: dateIso,
    row1Based: row1,
    col1Based: col,
    value: value
  };
}

function writeSportBatch_(dateIso, row1Based, cells) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return { ok: false, error: 'table_not_configured' };
  }
  var row1 = Math.round(row1Based);
  if (row1 < 2) {
    return { ok: false, error: 'table_not_configured' };
  }
  if (!cells || !cells.length) {
    return { ok: false, error: 'table_not_configured' };
  }

  var monthKey = dateIso.substring(0, 7);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return { ok: false, error: 'table_not_configured' };
  }

  var sh = ss.getSheetByName(monthKey);
  if (!sh) {
    return { ok: false, error: 'table_not_configured' };
  }

  var written = 0;
  for (var i = 0; i < cells.length; i++) {
    var col = Math.round(Number(cells[i].col1Based));
    if (!isSportWriteCol_(col)) {
      return { ok: false, error: 'table_not_configured' };
    }
    if (!writeSportCellValue_(sh, row1, col, cells[i].value)) {
      return { ok: false, error: 'table_not_configured' };
    }
    written++;
  }

  return {
    ok: true,
    action: 'writeSportBatch',
    date: dateIso,
    row1Based: row1,
    cellsWritten: written
  };
}
