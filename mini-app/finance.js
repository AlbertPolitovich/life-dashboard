/**
 * Финансы — home-виджет, detailFinance, bottom sheet ввода.
 */
(function () {
  const GROUP_COLORS = {
    blue: "#3685bf",
    green: "#1f8a65",
    orange: "#e67e22",
    purple: "#8e44ad",
    pink: "#e84393",
    yellow: "#d4a017",
    teal: "#16a085",
    gray: "#7f8c8d",
  };

  const INCOME_CHIP_SLUGS = [
    "darya_photo",
    "darya_salary",
    "artem_salary",
    "artem_bonus",
    "other",
  ];

  const ASSETS_BASE_SLUGS = ["darya_photo", "artem_salary", "artem_bonus"];

  const EXPENSE_CHIP_SLUGS = [
    "eda",
    "kafe",
    "ipoteka",
    "kvartplata",
    "dom_remont",
    "avto",
    "proezd",
    "internet",
    "rebenok",
  ];

  const INCOME_BAR_COLORS = ["#1f8a65", "#2e9d72", "#40b080", "#52c38e", "#64d69c"];
  const FINANCE_TAB_ORDER = ["overview", "metrics", "categories", "plan", "history"];
  const HISTORY_VISIBLE_LIMIT = 10;
  const OVERVIEW_SWIPE_MIN_DX = 20;
  const OVERVIEW_YEAR_LOOKBACK = 4;
  const MONTH_GENITIVE = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

  /** Сводные строки расходов — только вкладка Обзор (пары категорий). */
  const OVERVIEW_EXPENSE_BUCKETS = [
    { label: "Дом/ремонт", slugs: ["dom_remont", "technika"], colorKey: "purple" },
    { label: "Ипотека", slugs: ["ipoteka"], colorKey: "blue" },
    { label: "Кварплата", slugs: ["kvartplata"], colorKey: "blue" },
    { label: "Питание", slugs: ["eda", "kafe"], colorKey: "green" },
    { label: "Транспорт", slugs: ["avto", "proezd", "taksi"], colorKey: "orange" },
    { label: "Ребёнок", slugs: ["rebenok"], colorKey: "pink" },
    { label: "Накопления и подарки", slugs: ["nakopleniya_dasha", "podarki"], colorKey: "pink" },
    { label: "Здоровье и красота", slugs: ["zdorovie", "krasota"], colorKey: "yellow" },
    { label: "Спорт", slugs: ["sport"], colorKey: "yellow" },
    { label: "Развитие", slugs: ["obuchenie", "razvlecheniya", "internet"], colorKey: "teal" },
    { label: "Связь", slugs: ["svyaz"], colorKey: "blue" },
    { label: "Активы 10%", slugs: ["assets_10"], colorKey: "gray" },
    { label: "Налоги и бизнес", slugs: ["nalogi", "biznes"], colorKey: "gray" },
    { label: "Одежда и отпуск", slugs: ["odezhda", "otpusk"], colorKey: "gray" },
    { label: "Разное", slugs: ["raznoe"], colorKey: "gray" },
  ];

  let api = {};
  let esc = (s) => String(s);
  let monthNames = [];
  let monthNamesShort = [];
  let todayIso = () => "";
  let setElHidden = () => {};

  const fin = {
    monthKey: "",
    balanceMode: "ytd",
    overviewPeriodMode: "month",
    overviewBrowseMonth: "",
    overviewBrowseYear: 0,
    overviewMonthCache: {},
    overviewYearCache: {},
    overviewPlanFactMonthKey: "",
    overviewPlanFactData: null,
    homeData: null,
    monthData: null,
    ytdData: null,
    planMonthData: null,
    categories: [],
    tab: "overview",
    overviewIncomeOpen: false,
    overviewExpensesExpanded: false,
    historyMonthExpanded: false,
    historyMonthKey: "",
    historyMonthTxns: [],
    sheetKind: "expense",
    sheetCategoryId: null,
    sheetShowAll: false,
    sheetWheelOpen: false,
    deleteTxnId: null,
    categoryDrill: null,
    homeReminders: [],
    reminderWheel: { day: 1, month: 1, year: new Date().getFullYear() },
    txnWheel: { day: 1, month: 1, year: new Date().getFullYear() },
    exportPeriod: "year",
    exportFromIso: "",
    exportToIso: "",
    exportWheelTarget: null,
    exportWheelOpen: false,
    exportWheel: { day: 1, month: 1, year: new Date().getFullYear() },
    appScreen: "home",
    financeScrollLock: false,
    financeScrollBound: false,
  };

  const REMINDER_DISMISS_KEY = "financeReminderDismiss";
  const CUSHION_KEY = "financeEmergencyFund";
  const LAST_TXN_DATE_KEY = "financeLastTxnDate";
  const LAST_TXN_DATE_TTL_MS = 15 * 60 * 1000;
  let homeLoadSeq = 0;
  let reminderWheelScrollLocked = false;
  let reminderWheelUnlockTimer = null;
  let financeScrollUnlockTimer = null;
  let financeHistoryAlignTimer = null;
  const reminderWheelAbort = { day: null, month: null, year: null };
  const txnWheelAbort = { day: null, month: null, year: null };
  const exportWheelAbort = { day: null, month: null, year: null };

  let apiUrl = (path, params) => path;

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function formatRub(n) {
    const v = Math.round(Number(n) || 0);
    const sign = v < 0 ? "−" : "";
    return `${sign}${Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
  }

  function formatRubK(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs >= 1000) {
      const k = abs / 1000;
      const s =
        Math.abs(k - Math.round(k)) < 0.05
          ? String(Math.round(k))
          : k.toFixed(1).replace(".", ",");
      return `${v < 0 ? "−" : ""}${s}К`;
    }
    return formatRub(v);
  }

  function foodColor(status) {
    if (status === "ok") return "var(--green)";
    if (status === "warn") return "var(--yellow)";
    return "var(--red)";
  }

  function foodSharePct(foodAmount, incomeReal) {
    const income = Number(incomeReal) || 0;
    if (income <= 0) return 0;
    return Math.round(((Number(foodAmount) || 0) / income) * 1000) / 10;
  }

  function monthFoodShares(monthData) {
    const incomeReal = Number(monthData?.income?.real) || 0;
    const groups = monthData?.expenses?.groups || [];
    let eda = 0;
    let kafe = 0;
    groups.forEach((g) => {
      (g.categories || []).forEach((c) => {
        if (c.slug === "eda") eda += Number(c.amount) || 0;
        if (c.slug === "kafe") kafe += Number(c.amount) || 0;
      });
    });
    return {
      pctCore: foodSharePct(eda, incomeReal),
      pctWithCafe: foodSharePct(eda + kafe, incomeReal),
    };
  }

  function loadCushionAmount() {
    try {
      return Math.max(0, Math.round(Number(localStorage.getItem(CUSHION_KEY)) || 0));
    } catch {
      return 0;
    }
  }

  function saveCushionAmount(n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    localStorage.setItem(CUSHION_KEY, String(v));
    return v;
  }

  function cushionProgressColor(pct) {
    if (pct >= 100) return "var(--green)";
    if (pct >= 50) return "var(--yellow)";
    return "var(--red)";
  }

  function balanceColor(n) {
    return Number(n) >= 0 ? "var(--green)" : "var(--red)";
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function formatReminderDate(rem) {
    if (rem.dueDate && rem.dueDate.length >= 10) {
      const day = rem.dueDate.slice(8, 10).replace(/^0/, "");
      const month = rem.dueDate.slice(5, 7);
      return `${day}.${month}`;
    }
    if (rem.dayOfMonth) return `${rem.dayOfMonth}.??`;
    return "—";
  }

  function formatReminderLine(rem) {
    const label = rem.label || "";
    const dateStr = formatReminderDate(rem);
    if (rem.amountHint != null) {
      return `${dateStr} · ${label} · ${formatRubExact(rem.amountHint)}`;
    }
    return `${dateStr} · ${label}`;
  }

  function formatRubExact(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? "−" : "";
    const abs = Math.abs(v);
    const rounded = Math.round(abs * 100) / 100;
    let str;
    if (rounded % 1 === 0) {
      str = String(Math.round(rounded));
    } else if (Math.round(rounded * 10) === rounded * 10) {
      str = rounded.toFixed(1).replace(".", ",");
    } else {
      str = rounded.toFixed(2).replace(".", ",");
    }
    return `${sign}${str.replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
  }

  function formatHomeReminderLine(rem) {
    const dateStr = formatReminderDate(rem);
    const label = rem.label || "";
    if (rem.amountHint != null) {
      return `${label} · ${dateStr} · ${formatRubExact(rem.amountHint)}`;
    }
    return `${label} · ${dateStr}`;
  }

  function reminderDaysUntil(rem) {
    if (rem?.daysUntil != null) return Number(rem.daysUntil);
    if (!rem?.dueDate) return 99;
    const ref = new Date(todayIso() + "T12:00:00");
    const due = new Date(rem.dueDate + "T12:00:00");
    return Math.round((due - ref) / 86400000);
  }

  function reminderUrgencyClass(rem) {
    const days = reminderDaysUntil(rem);
    if (days <= 0) return "finance-mvp-reminder--due";
    if (days === 1) return "finance-mvp-reminder--soon";
    return "finance-mvp-reminder--upcoming";
  }

  function planMonthKey() {
    // Тот же месяц, что Категории / факт: выбранный в навигации.
    return fin.monthKey || currentMonthKey();
  }

  function reminderOccurrenceMonth(rem) {
    if (!rem?.dueDate) return currentMonthKey();
    return rem.dueDate.slice(0, 7);
  }

  function reminderDismissKey(rem) {
    return `${rem.id}:${reminderOccurrenceMonth(rem)}`;
  }

  function reminderDismissStore() {
    try {
      return JSON.parse(localStorage.getItem(REMINDER_DISMISS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function isReminderDismissed(rem) {
    if (!rem?.id) return false;
    return reminderDismissStore()[reminderDismissKey(rem)] === true;
  }

  function dismissHomeReminder(rem) {
    if (!rem?.id) return;
    const store = reminderDismissStore();
    store[reminderDismissKey(rem)] = true;
    localStorage.setItem(REMINDER_DISMISS_KEY, JSON.stringify(store));
    renderHomeReminders(fin.homeReminders);
  }

  function renderHomeReminders(rems) {
    fin.homeReminders = Array.isArray(rems) ? rems : (rems ? [rems] : []);
    const container = els.remindersContainer;
    if (!container) return;
    container.innerHTML = "";
    const visible = fin.homeReminders.filter((r) => !isReminderDismissed(r));
    setElHidden(els.balanceDivider, visible.length === 0);
    visible.forEach((rem) => {
      const urgency = reminderUrgencyClass(rem).replace("finance-mvp-reminder--", "");
      const row = document.createElement("div");
      row.className = `finance-zone__reminder finance-zone__reminder--${urgency}`;
      const dot = document.createElement("span");
      dot.className = `finance-zone__reminder-dot finance-zone__reminder-dot--${urgency}`;
      dot.setAttribute("aria-hidden", "true");
      const text = document.createElement("p");
      text.className = "finance-zone__reminder-text";
      text.textContent = formatHomeReminderLine(rem);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "finance-mvp-reminder__dismiss";
      btn.setAttribute("aria-label", "Скрыть напоминание");
      btn.textContent = "×";
      btn.addEventListener("click", (e) => { e.stopPropagation(); dismissHomeReminder(rem); });
      row.appendChild(dot);
      row.appendChild(text);
      row.appendChild(btn);
      container.appendChild(row);
    });
  }

  function loadLastTxnDate() {
    try {
      const raw = localStorage.getItem(LAST_TXN_DATE_KEY);
      if (!raw) return todayIso();
      const data = JSON.parse(raw);
      if (!data?.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return todayIso();
      const expiresAt = Number(data.expiresAt) || 0;
      if (expiresAt <= Date.now()) return todayIso();
      return data.date;
    } catch {
      /* empty */
    }
    return todayIso();
  }

  function saveLastTxnDate(iso) {
    try {
      localStorage.setItem(
        LAST_TXN_DATE_KEY,
        JSON.stringify({
          date: iso,
          expiresAt: Date.now() + LAST_TXN_DATE_TTL_MS,
        })
      );
    } catch {
      /* empty */
    }
  }

  function setWheelFromIso(wheel, iso) {
    const d = new Date(iso + "T12:00:00");
    wheel.day = d.getDate();
    wheel.month = d.getMonth() + 1;
    wheel.year = d.getFullYear();
  }

  function wheelIso(wheel) {
    const max = daysInMonth(wheel.year, wheel.month);
    if (wheel.day > max) wheel.day = max;
    if (wheel.day < 1) wheel.day = 1;
    const y = wheel.year;
    const m = String(wheel.month).padStart(2, "0");
    const day = String(wheel.day).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function clampTxnWheelDay() {
    const max = daysInMonth(fin.txnWheel.year, fin.txnWheel.month);
    if (fin.txnWheel.day > max) fin.txnWheel.day = max;
    if (fin.txnWheel.day < 1) fin.txnWheel.day = 1;
  }

  function txnWheelIso() {
    return wheelIso(fin.txnWheel);
  }

  function formatTxnDateBtn(iso) {
    const d = new Date((iso || txnWheelIso()) + "T12:00:00");
    const wd = WEEKDAY_SHORT[d.getDay()];
    const day = d.getDate();
    const month = MONTH_GENITIVE[d.getMonth()] || "";
    return `${wd} · ${day} ${month} ▾`;
  }

  function updateTxnDateBtn() {
    if (els.sheetDateBtn) {
      els.sheetDateBtn.textContent = formatTxnDateBtn(txnWheelIso());
    }
  }

  function renderTxnWheelDay() {
    const col = els.sheetWheelDay;
    if (!col) return;
    clampTxnWheelDay();
    const max = daysInMonth(fin.txnWheel.year, fin.txnWheel.month);
    const values = Array.from({ length: max }, (_, i) => ({
      value: i + 1,
      label: String(i + 1),
    }));
    buildReminderWheelColumn(
      col,
      values,
      fin.txnWheel.day,
      (v) => {
        fin.txnWheel.day = v;
        updateTxnDateBtn();
      },
      "day",
      txnWheelAbort
    );
  }

  function renderTxnWheelMonth() {
    const col = els.sheetWheelMonth;
    if (!col) return;
    const values = monthNamesShort.map((label, i) => ({ value: i + 1, label }));
    buildReminderWheelColumn(
      col,
      values,
      fin.txnWheel.month,
      (v) => {
        if (fin.txnWheel.month === v) return;
        fin.txnWheel.month = v;
        clampTxnWheelDay();
        lockReminderWheelScroll(200);
        renderTxnWheelDay();
        scrollReminderColToValue(els.sheetWheelDay, fin.txnWheel.day);
        updateTxnDateBtn();
      },
      "month",
      txnWheelAbort
    );
  }

  function renderTxnWheelYear() {
    const col = els.sheetWheelYear;
    if (!col) return;
    const y = new Date(todayIso() + "T12:00:00").getFullYear();
    const values = [y - 1, y].map((yr) => ({ value: yr, label: String(yr) }));
    buildReminderWheelColumn(
      col,
      values,
      fin.txnWheel.year,
      (v) => {
        if (fin.txnWheel.year === v) return;
        fin.txnWheel.year = v;
        clampTxnWheelDay();
        lockReminderWheelScroll(200);
        renderTxnWheelDay();
        scrollReminderColToValue(els.sheetWheelDay, fin.txnWheel.day);
        updateTxnDateBtn();
      },
      "year",
      txnWheelAbort
    );
  }

  function renderTxnWheel() {
    lockReminderWheelScroll(300);
    renderTxnWheelMonth();
    renderTxnWheelYear();
    renderTxnWheelDay();
    requestAnimationFrame(() => {
      scrollReminderColToValue(els.sheetWheelDay, fin.txnWheel.day);
      scrollReminderColToValue(els.sheetWheelMonth, fin.txnWheel.month);
      scrollReminderColToValue(els.sheetWheelYear, fin.txnWheel.year);
    });
  }

  function initTxnWheel(iso) {
    setWheelFromIso(fin.txnWheel, iso || loadLastTxnDate());
    updateTxnDateBtn();
  }

  function openTxnSheetWheel() {
    if (!els.sheetWheelWrap) return;
    fin.sheetWheelOpen = true;
    els.sheetWheelWrap.hidden = false;
    if (els.sheetDateBtn) els.sheetDateBtn.setAttribute("aria-expanded", "true");
    renderTxnWheel();
  }

  function closeTxnSheetWheel() {
    fin.sheetWheelOpen = false;
    if (els.sheetWheelWrap) els.sheetWheelWrap.hidden = true;
    if (els.sheetDateBtn) els.sheetDateBtn.setAttribute("aria-expanded", "false");
    updateTxnDateBtn();
  }

  function toggleTxnSheetWheel() {
    if (fin.sheetWheelOpen) closeTxnSheetWheel();
    else openTxnSheetWheel();
  }

  function shiftDaysIso(iso, delta) {
    const d = new Date((iso || todayIso()) + "T12:00:00");
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  function initExportDefaults() {
    const today = todayIso();
    fin.exportPeriod = "year";
    fin.exportFromIso = shiftDaysIso(today, -29);
    fin.exportToIso = today;
    fin.exportWheelTarget = null;
    fin.exportWheelOpen = false;
    setWheelFromIso(fin.exportWheel, fin.exportFromIso);
    setExportPeriod("year");
    updateExportDateBtns();
    closeExportWheel();
  }

  function setExportPeriod(period) {
    fin.exportPeriod = period;
    document.querySelectorAll("[data-finance-export-period]").forEach((btn) => {
      const on = btn.dataset.financeExportPeriod === period;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (els.exportCustom) setElHidden(els.exportCustom, period !== "period");
    if (period !== "period") closeExportWheel();
  }

  function formatExportDateBtn(iso) {
    const d = new Date((iso || todayIso()) + "T12:00:00");
    const wd = WEEKDAY_SHORT[d.getDay()];
    const day = d.getDate();
    const month = MONTH_GENITIVE[d.getMonth()] || "";
    return `${wd} · ${day} ${month} ▾`;
  }

  function updateExportDateBtns() {
    if (els.exportFromBtn) {
      els.exportFromBtn.textContent = formatExportDateBtn(fin.exportFromIso);
      els.exportFromBtn.setAttribute(
        "aria-expanded",
        fin.exportWheelOpen && fin.exportWheelTarget === "from" ? "true" : "false"
      );
    }
    if (els.exportToBtn) {
      els.exportToBtn.textContent = formatExportDateBtn(fin.exportToIso);
      els.exportToBtn.setAttribute(
        "aria-expanded",
        fin.exportWheelOpen && fin.exportWheelTarget === "to" ? "true" : "false"
      );
    }
  }

  function clampExportWheelDay() {
    const max = daysInMonth(fin.exportWheel.year, fin.exportWheel.month);
    if (fin.exportWheel.day > max) fin.exportWheel.day = max;
    if (fin.exportWheel.day < 1) fin.exportWheel.day = 1;
  }

  function applyExportWheelIso() {
    const iso = wheelIso(fin.exportWheel);
    if (fin.exportWheelTarget === "to") fin.exportToIso = iso;
    else fin.exportFromIso = iso;
    if (fin.exportFromIso > fin.exportToIso) {
      if (fin.exportWheelTarget === "from") fin.exportToIso = fin.exportFromIso;
      else fin.exportFromIso = fin.exportToIso;
    }
    updateExportDateBtns();
  }

  function exportWheelYearValues() {
    const y = new Date(todayIso() + "T12:00:00").getFullYear();
    return [y - 2, y - 1, y].map((yr) => ({ value: yr, label: String(yr) }));
  }

  function renderExportWheelDay() {
    const col = els.exportWheelDay;
    if (!col) return;
    clampExportWheelDay();
    const max = daysInMonth(fin.exportWheel.year, fin.exportWheel.month);
    const values = Array.from({ length: max }, (_, i) => ({
      value: i + 1,
      label: String(i + 1),
    }));
    buildReminderWheelColumn(
      col,
      values,
      fin.exportWheel.day,
      (v) => {
        fin.exportWheel.day = v;
        applyExportWheelIso();
      },
      "day",
      exportWheelAbort
    );
  }

  function renderExportWheelMonth() {
    const col = els.exportWheelMonth;
    if (!col) return;
    const values = monthNamesShort.map((label, i) => ({ value: i + 1, label }));
    buildReminderWheelColumn(
      col,
      values,
      fin.exportWheel.month,
      (v) => {
        if (fin.exportWheel.month === v) return;
        fin.exportWheel.month = v;
        clampExportWheelDay();
        lockReminderWheelScroll(200);
        renderExportWheelDay();
        scrollReminderColToValue(els.exportWheelDay, fin.exportWheel.day);
        applyExportWheelIso();
      },
      "month",
      exportWheelAbort
    );
  }

  function renderExportWheelYear() {
    const col = els.exportWheelYear;
    if (!col) return;
    const values = exportWheelYearValues();
    buildReminderWheelColumn(
      col,
      values,
      fin.exportWheel.year,
      (v) => {
        if (fin.exportWheel.year === v) return;
        fin.exportWheel.year = v;
        clampExportWheelDay();
        lockReminderWheelScroll(200);
        renderExportWheelDay();
        scrollReminderColToValue(els.exportWheelDay, fin.exportWheel.day);
        applyExportWheelIso();
      },
      "year",
      exportWheelAbort
    );
  }

  function renderExportWheel() {
    lockReminderWheelScroll(300);
    renderExportWheelMonth();
    renderExportWheelYear();
    renderExportWheelDay();
    requestAnimationFrame(() => {
      scrollReminderColToValue(els.exportWheelDay, fin.exportWheel.day);
      scrollReminderColToValue(els.exportWheelMonth, fin.exportWheel.month);
      scrollReminderColToValue(els.exportWheelYear, fin.exportWheel.year);
    });
  }

  function openExportWheel(target) {
    if (!els.exportWheelWrap) return;
    fin.exportWheelTarget = target;
    fin.exportWheelOpen = true;
    setWheelFromIso(fin.exportWheel, target === "to" ? fin.exportToIso : fin.exportFromIso);
    els.exportWheelWrap.hidden = false;
    updateExportDateBtns();
    renderExportWheel();
  }

  function closeExportWheel() {
    fin.exportWheelOpen = false;
    fin.exportWheelTarget = null;
    if (els.exportWheelWrap) els.exportWheelWrap.hidden = true;
    updateExportDateBtns();
  }

  function toggleExportWheel(target) {
    if (fin.exportWheelOpen && fin.exportWheelTarget === target) closeExportWheel();
    else openExportWheel(target);
  }

  function openExportSheet() {
    if (!els.exportSheet) return;
    initExportDefaults();
    els.exportSheet.hidden = false;
    document.body.classList.add("finance-sheet-open");
  }

  function closeExportSheet() {
    if (!els.exportSheet) return;
    closeExportWheel();
    els.exportSheet.hidden = true;
    document.body.classList.remove("finance-sheet-open");
  }

  async function downloadFinanceCsv() {
    const period = fin.exportPeriod || "year";
    const params = { period };
    if (period === "period") {
      if (fin.exportFromIso > fin.exportToIso) {
        throw new Error("Дата «от» не может быть позже «до»");
      }
      params.from = fin.exportFromIso;
      params.to = fin.exportToIso;
    }
    const label =
      period === "period"
        ? `${fin.exportFromIso}_${fin.exportToIso}`
        : String(new Date().getFullYear());
    const downloadApiFile = api.downloadApiFile;
    if (typeof downloadApiFile === "function") {
      await downloadApiFile("/finance/export.xlsx", params, `finance-${label}.xlsx`);
      return;
    }
    const url = apiUrl("/finance/export.xlsx", params);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-${label}.xlsx`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function lockReminderWheelScroll(ms = 200) {
    reminderWheelScrollLocked = true;
    clearTimeout(reminderWheelUnlockTimer);
    reminderWheelUnlockTimer = setTimeout(() => {
      reminderWheelScrollLocked = false;
    }, ms);
  }

  function scrollReminderColToValue(colEl, value) {
    const item = colEl.querySelector(`.wheel-item[data-value="${Number(value)}"]`);
    if (!item) return;
    colEl.scrollTop = item.offsetTop - colEl.clientHeight / 2 + item.offsetHeight / 2;
    colEl.querySelectorAll(".wheel-item").forEach((el) => {
      el.classList.toggle("is-selected", Number(el.dataset.value) === Number(value));
    });
  }

  function buildReminderWheelColumn(colEl, values, selectedValue, onSelect, abortKey, abortStore) {
    const store = abortStore || reminderWheelAbort;
    if (abortKey && store[abortKey]) store[abortKey].abort();
    const abort = new AbortController();
    if (abortKey) store[abortKey] = abort;
    colEl.innerHTML = "";
    const top = document.createElement("div");
    top.className = "wheel-spacer";
    const bottom = document.createElement("div");
    bottom.className = "wheel-spacer";
    colEl.appendChild(top);
    values.forEach((v) => {
      const el = document.createElement("div");
      el.className = "wheel-item";
      el.dataset.value = String(v.value);
      el.textContent = v.label;
      el.addEventListener(
        "click",
        () => {
          lockReminderWheelScroll(320);
          scrollReminderColToValue(colEl, v.value);
          onSelect(v.value);
        },
        { signal: abort.signal }
      );
      colEl.appendChild(el);
    });
    colEl.appendChild(bottom);
    let scrollTimer = null;
    colEl.addEventListener(
      "scroll",
      () => {
        if (reminderWheelScrollLocked) return;
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          if (reminderWheelScrollLocked) return;
          const center = colEl.scrollTop + colEl.clientHeight / 2;
          let best = null;
          let bestDist = Infinity;
          colEl.querySelectorAll(".wheel-item").forEach((el) => {
            const mid = el.offsetTop + el.offsetHeight / 2;
            const dist = Math.abs(mid - center);
            if (dist < bestDist) {
              bestDist = dist;
              best = el;
            }
          });
          if (best) {
            const v = Number(best.dataset.value);
            colEl.querySelectorAll(".wheel-item").forEach((el) => {
              el.classList.toggle("is-selected", el === best);
            });
            onSelect(v);
          }
        }, 80);
      },
      { signal: abort.signal }
    );
    requestAnimationFrame(() => scrollReminderColToValue(colEl, selectedValue));
  }

  function clampReminderWheelDay() {
    const max = daysInMonth(fin.reminderWheel.year, fin.reminderWheel.month);
    if (fin.reminderWheel.day > max) fin.reminderWheel.day = max;
    if (fin.reminderWheel.day < 1) fin.reminderWheel.day = 1;
  }

  function setReminderWheelToToday() {
    const t = new Date(todayIso() + "T12:00:00");
    fin.reminderWheel = {
      day: t.getDate(),
      month: t.getMonth() + 1,
      year: t.getFullYear(),
    };
  }

  function reminderWheelIso() {
    clampReminderWheelDay();
    const y = fin.reminderWheel.year;
    const m = String(fin.reminderWheel.month).padStart(2, "0");
    const d = String(fin.reminderWheel.day).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function renderReminderWheelDay() {
    const col = els.remWheelDay;
    if (!col) return;
    clampReminderWheelDay();
    const max = daysInMonth(fin.reminderWheel.year, fin.reminderWheel.month);
    const values = Array.from({ length: max }, (_, i) => ({
      value: i + 1,
      label: String(i + 1),
    }));
    buildReminderWheelColumn(col, values, fin.reminderWheel.day, (v) => {
      fin.reminderWheel.day = v;
    }, "day");
  }

  function renderReminderWheelMonth() {
    const col = els.remWheelMonth;
    if (!col) return;
    const values = monthNamesShort.map((label, i) => ({ value: i + 1, label }));
    buildReminderWheelColumn(col, values, fin.reminderWheel.month, (v) => {
      if (fin.reminderWheel.month === v) return;
      fin.reminderWheel.month = v;
      clampReminderWheelDay();
      lockReminderWheelScroll(200);
      renderReminderWheelDay();
      scrollReminderColToValue(els.remWheelDay, fin.reminderWheel.day);
    }, "month");
  }

  function renderReminderWheelYear() {
    const col = els.remWheelYear;
    if (!col) return;
    const y = new Date(todayIso() + "T12:00:00").getFullYear();
    const values = [y, y + 1].map((yr) => ({ value: yr, label: String(yr) }));
    buildReminderWheelColumn(col, values, fin.reminderWheel.year, (v) => {
      if (fin.reminderWheel.year === v) return;
      fin.reminderWheel.year = v;
      clampReminderWheelDay();
      lockReminderWheelScroll(200);
      renderReminderWheelDay();
      scrollReminderColToValue(els.remWheelDay, fin.reminderWheel.day);
    }, "year");
  }

  function initReminderWheel() {
    els.remWheelDay = els.tabPlan?.querySelector("#financeRemWheelDay");
    els.remWheelMonth = els.tabPlan?.querySelector("#financeRemWheelMonth");
    els.remWheelYear = els.tabPlan?.querySelector("#financeRemWheelYear");
    if (!els.remWheelDay) return;
    setReminderWheelToToday();
    lockReminderWheelScroll(300);
    renderReminderWheelMonth();
    renderReminderWheelYear();
    renderReminderWheelDay();
  }

  function toggleReminderForm(show) {
    const form = els.tabPlan?.querySelector("#financeReminderForm");
    const btn = els.tabPlan?.querySelector("#financeAddReminder");
    if (!form) return;
    setElHidden(form, !show);
    if (btn) btn.hidden = show;
    if (show) {
      setReminderWheelToToday();
      initReminderWheel();
      const label = form.querySelector("#financeRemLabel");
      const amount = form.querySelector("#financeRemAmount");
      if (label) label.value = "";
      if (amount) amount.value = "";
    }
  }

  async function submitReminderForm() {
    const form = els.tabPlan?.querySelector("#financeReminderForm");
    const label = form?.querySelector("#financeRemLabel")?.value?.trim();
    const amountRaw = form?.querySelector("#financeRemAmount")?.value;
    if (!label) throw new Error("Укажите название");
    const amount = parsePlanAmount(amountRaw);
    const body = { dueDate: reminderWheelIso(), label };
    if (amount > 0) body.amountHint = amount;
    await api.apiPostJson("/finance/reminders", body);
    toggleReminderForm(false);
    await renderPlan();
    if (fin.appScreen === "home") await loadHome({ fresh: true });
  }

  function currentMonthKey() {
    return todayIso().slice(0, 7);
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthTitle(ym) {
    const m = Number(ym.slice(5, 7)) - 1;
    return monthNames[m] || ym;
  }

  function monthShort(ym) {
    const m = Number(ym.slice(5, 7)) - 1;
    return monthNamesShort[m] || ym.slice(5, 7);
  }

  function categoriesByKind(kind) {
    return fin.categories.filter((c) => c.kind === kind);
  }

  function incomePlanCategories() {
    return INCOME_CHIP_SLUGS.map((slug) => fin.categories.find((c) => c.slug === slug)).filter(
      Boolean
    );
  }

  function expensePlanCategories() {
    return categoriesByKind("expense").sort(
      (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, "ru")
    );
  }

  function parsePlanAmount(raw) {
    const s = String(raw ?? "")
      .trim()
      .replace(/₽/g, "")
      .replace(/руб\.?/gi, "")
      .replace(",", ".")
      .replace(/\s/g, "");
    if (!s) return 0;
    const v = Number(s);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  function formatPlanInput(n) {
    const v = Math.round(Number(n) || 0);
    if (v < 0) return "";
    return formatRub(v);
  }

  function planInputAttrValue(n) {
    return ` value="${formatPlanInput(n)}"`;
  }

  function formatPlanInputExact(n) {
    const v = parsePlanAmount(n);
    return v > 0 ? formatRubExact(v) : "";
  }

  function bindPlanAmountInputs(root) {
    if (!root) return;
    root.querySelectorAll("[data-plan-income], [data-plan-expense], [data-plan-amount]").forEach((inp) => {
      const exact = Boolean(inp.dataset.planAmountExact);
      inp.addEventListener("focus", () => {
        const n = parsePlanAmount(inp.value);
        if (n <= 0) {
          inp.value = "";
          return;
        }
        inp.value = exact ? String(n).replace(".", ",") : String(n);
      });
      inp.addEventListener("blur", () => {
        inp.value = exact
          ? formatPlanInputExact(inp.value)
          : formatPlanInput(parsePlanAmount(inp.value));
        if (inp.dataset.planIncome || inp.dataset.planExpense) updatePlanFormTotals();
      });
      inp.addEventListener("input", () => {
        if (inp.dataset.planIncome || inp.dataset.planExpense) updatePlanFormTotals();
      });
      if (inp.value && !inp.value.includes("₽")) {
        inp.value = exact
          ? formatPlanInputExact(inp.value)
          : formatPlanInput(parsePlanAmount(inp.value));
      }
    });
  }

  function planBannerNextMonth() {
    return shiftMonth(todayIso().slice(0, 7), 1);
  }

  function shouldShowPlanBanner() {
    const d = new Date(todayIso() + "T12:00:00");
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() >= lastDay - 2;
  }

  function renderPlanBanner() {
    if (!els.planBanner) return;
    const show = shouldShowPlanBanner();
    setElHidden(els.planBanner, !show);
    if (!show) return;
    const next = planBannerNextMonth();
    if (els.planBannerText) {
      els.planBannerText.textContent = `Веди план финансов на ${monthTitle(next).toLowerCase()}`;
    }
  }

  function planAmountByCategory(planItems) {
    const map = {};
    (planItems || []).forEach((i) => {
      map[i.categoryId] = i.amountPlanned || 0;
    });
    return map;
  }

  function planHasAmounts(planData) {
    return (planData?.planIncomeTotal || 0) + (planData?.planExpenseTotal || 0) > 0;
  }

  function planItemsFromMap(planByCat) {
    const items = [];
    incomePlanCategories().forEach((c) => {
      items.push({ categoryId: c.id, amountPlanned: planByCat[c.id] || 0 });
    });
    expensePlanCategories().forEach((c) => {
      items.push({ categoryId: c.id, amountPlanned: planByCat[c.id] || 0 });
    });
    return items;
  }

  async function loadPlanForForm(monthKey) {
    const planData = await api.apiGet("/finance/plan", { month: monthKey });
    if (planHasAmounts(planData)) {
      return { planData, planByCat: planAmountByCategory(planData.items) };
    }

    const prevKey = shiftMonth(monthKey, -1);
    try {
      const prevData = await api.apiGet("/finance/plan", { month: prevKey });
      if (planHasAmounts(prevData)) {
        return {
          planData,
          planByCat: planAmountByCategory(prevData.items),
        };
      }
    } catch {
      /* empty */
    }
    return { planData, planByCat: {} };
  }

  function planGroupStyle(colorKey) {
    const color = GROUP_COLORS[colorKey] || GROUP_COLORS.gray;
    return `--plan-group-accent:${color}`;
  }

  function renderPlanExpenseRows(planByCat) {
    const parts = [];
    let lastGroup = null;
    let groupOpen = false;
    expensePlanCategories().forEach((c) => {
      if (c.groupName && c.groupName !== lastGroup) {
        if (groupOpen) parts.push("</div>");
        lastGroup = c.groupName;
        groupOpen = true;
        parts.push(
          `<div class="finance-plan-form__group" style="${planGroupStyle(c.colorKey)}">` +
            `<p class="finance-plan-form__group-label">${esc(c.groupName)}</p>`
        );
      }
      parts.push(`
        <label class="finance-plan-form__row">
          <span class="finance-plan-form__label">${esc(c.name)}</span>
          <input class="finance-plan-form__input finance-plan-form__input--amount" type="text" inputmode="decimal"
            data-plan-expense="${c.id}"${planInputAttrValue(planByCat[c.id])} placeholder="0 ₽" />
        </label>`);
    });
    if (groupOpen) parts.push("</div>");
    return parts.join("");
  }

  function renderPlanFormHtml(planByCat) {
    const incomes = incomePlanCategories();
    const incomeRows = incomes
      .map(
        (c) => `
        <label class="finance-plan-form__row">
          <span class="finance-plan-form__label">${esc(c.name)}</span>
          <input class="finance-plan-form__input finance-plan-form__input--amount" type="text" inputmode="decimal"
            data-plan-income="${c.id}"${planInputAttrValue(planByCat[c.id])} placeholder="0 ₽" />
        </label>`
      )
      .join("");

    const planMonth = planMonthKey();
    return `
      <div class="finance-plan-form" id="financePlanForm">
        <div class="finance-plan-form__heading">
          <p class="section-counter">План на ${monthTitle(planMonth).toLowerCase()}</p>
        </div>
        <div class="finance-plan-block finance-plan-block--income">
          <p class="finance-plan-block__title">Доходы</p>
          ${incomeRows}
        </div>
        <div class="finance-plan-block finance-plan-block--expense">
          <p class="finance-plan-block__title">Расходы</p>
          ${renderPlanExpenseRows(planByCat)}
        </div>
        <div class="finance-plan-form__totals" id="financePlanTotals" aria-live="polite"></div>
        <p class="finance-alert finance-plan-form__alert" id="financePlanOverAlert" hidden>План расходов больше плана доходов</p>
        <p class="finance-plan-form__saved" id="financePlanSavedHint" hidden>Сохранено</p>
        <button type="button" class="cta-btn cta-btn--inline finance-plan-form__save" id="financePlanSave">Сохранить план</button>
      </div>`;
  }

  function updatePlanFormTotals() {
    const form = els.tabPlan?.querySelector("#financePlanForm");
    if (!form) return;
    let income = 0;
    let expense = 0;
    form.querySelectorAll("[data-plan-income]").forEach((inp) => {
      income += parsePlanAmount(inp.value);
    });
    form.querySelectorAll("[data-plan-expense]").forEach((inp) => {
      expense += parsePlanAmount(inp.value);
    });
    const host = form.querySelector("#financePlanTotals");
    if (!host) return;
    const balance = income - expense;
    const over = expense > income && income > 0;
    host.innerHTML = `
      <span class="finance-plan-form__total finance-plan-form__total--income">Доход: <strong>${formatRub(income)}</strong></span>
      <span class="finance-plan-form__total finance-plan-form__total--balance">Баланс: <strong style="color:${balanceColor(balance)}">${formatRub(balance)}</strong></span>
      <span class="finance-plan-form__total finance-plan-form__total--expense">Расход: <strong style="color:${over ? "var(--red)" : "inherit"}">${formatRub(expense)}</strong></span>`;
    const alertEl = form.querySelector("#financePlanOverAlert");
    if (alertEl) setElHidden(alertEl, !over);
  }

  function collectPlanItems() {
    const form = els.tabPlan?.querySelector("#financePlanForm");
    if (!form) return [];
    const items = [];
    form.querySelectorAll("[data-plan-income]").forEach((inp) => {
      items.push({
        categoryId: Number(inp.dataset.planIncome),
        amountPlanned: parsePlanAmount(inp.value),
      });
    });
    form.querySelectorAll("[data-plan-expense]").forEach((inp) => {
      items.push({
        categoryId: Number(inp.dataset.planExpense),
        amountPlanned: parsePlanAmount(inp.value),
      });
    });
    return items;
  }

  function showPlanSaveFeedback() {
    const hint = els.tabPlan?.querySelector("#financePlanSavedHint");
    const btn = els.tabPlan?.querySelector("#financePlanSave");
    if (hint) {
      setElHidden(hint, false);
      setTimeout(() => setElHidden(hint, true), 2200);
    }
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = "Сохранено ✓";
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = orig;
        btn.disabled = false;
      }, 2200);
    }
    const anchor = els.tabPlan?.querySelector("#financePlanSave");
    anchor?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function savePlan() {
    await ensureCategories();
    const items = collectPlanItems();
    const month = planMonthKey();
    await api.apiPostJson("/finance/plan", { month, items });

    const planData = await api.apiGet("/finance/plan", { month });
    const planByCat = planAmountByCategory(planData.items);
    fin.planMonthData = planData;
    fin.overviewPlanFactMonthKey = "";
    fin.overviewPlanFactData = null;
    if (fin.monthData) {
      await renderOverview(fin.monthData);
      await renderCategories(fin.monthData, fin.planMonthData);
    }
    const rem = await api.apiGet("/finance/reminders").catch(() => ({ reminders: [] }));
    renderPlanContent(planByCat, planData, rem.reminders || []);
    bindPlanForm();
    showPlanSaveFeedback();
  }

  function bindPlanForm() {
    const form = els.tabPlan?.querySelector("#financePlanForm");
    if (!form) return;
    bindPlanAmountInputs(form);
    bindPlanAmountInputs(els.tabPlan?.querySelector("#financeReminderForm"));
    window.LifeInputKeyboards?.sync(form);
    window.LifeInputKeyboards?.sync(els.tabPlan?.querySelector("#financeReminderForm"));
    form.querySelector("#financePlanSave")?.addEventListener("click", () => {
      savePlan().catch((err) => alert(String(err.message || err)));
    });
    updatePlanFormTotals();
  }

  function categoryById(id) {
    return fin.categories.find((c) => c.id === Number(id));
  }

  async function ensureCategories() {
    if (fin.categories.length) return;
    const data = await api.apiGet("/finance/categories");
    fin.categories = data.categories || [];
  }

  async function fetchMonth(ym) {
    return api.apiGet("/finance/month", { month: ym });
  }

  async function fetchYtd(year, throughMonth) {
    const params = { year };
    if (throughMonth) params.throughMonth = throughMonth;
    return api.apiGet("/finance/ytd", params);
  }

  function assetsYtdPeriodLabel(ytdData) {
    const year = ytdData?.year;
    const through = ytdData?.throughMonth;
    if (!year) return "год";
    if (!through || through >= 12) return String(year);
    const endYm = `${year}-${String(through).padStart(2, "0")}`;
    return `янв–${monthShort(endYm)} ${year}`;
  }

  function resolveAssetsYtd(ytdData) {
    if (!ytdData?.ok) {
      return {
        assetsBase: 0,
        assetsTarget: 0,
        assetsActual: 0,
        assetsGap: 0,
        assetsBaseSources: [],
      };
    }
    if (ytdData.assetsYtd?.assetsBase != null) return ytdData.assetsYtd;

    const breakdown = ytdData.assetsBreakdownYtd || [];
    const incomeSources = ytdData.income?.sources || [];
    const sources = ASSETS_BASE_SLUGS.map((slug) => {
      const row =
        breakdown.find((s) => s.slug === slug) || incomeSources.find((s) => s.slug === slug);
      return {
        slug,
        name: row?.name || slug,
        amount: Number(row?.amount) || 0,
      };
    });
    const base = sources.reduce((sum, s) => sum + s.amount, 0);
    const target = Math.round(base * 0.1 * 10) / 10;
    const actual = (ytdData.monthlyAssets || []).reduce(
      (sum, m) => sum + (Number(m.actual) || 0),
      0
    );
    const gap = Math.max(0, Math.round((target - actual) * 10) / 10);
    return {
      assetsBase: base,
      assetsTarget: target,
      assetsActual: actual,
      assetsGap: gap,
      assetsBaseSources: sources,
    };
  }

  function renderHomeWidget(data) {
    if (!els.zone || !data?.ok) {
      setElHidden(els.zone, true);
      return;
    }
    setElHidden(els.zone, false);
    fin.homeData = data;

    if (els.zoneTitle) {
      els.zoneTitle.textContent = `Финансы · ${monthTitle(data.month)}`;
    }

    const balance =
      fin.balanceMode === "ytd" ? data.balanceYtd : data.balanceMonth;
    if (els.balanceLabel) {
      els.balanceLabel.textContent =
        fin.balanceMode === "ytd" ? "Баланс с начала года" : "Баланс месяца";
    }
    if (els.balanceValue) {
      els.balanceValue.textContent = formatRub(balance);
      els.balanceValue.style.color = balanceColor(balance);
    }
    if (els.balanceToggle) {
      els.balanceToggle.querySelectorAll("[data-finance-balance-mode]").forEach((btn) => {
        const active = btn.dataset.financeBalanceMode === fin.balanceMode;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    renderHomeReminders((data.widget || {}).nextReminders || ((data.widget || {}).nextReminder ? [(data.widget || {}).nextReminder] : []));

    renderPlanBanner();
  }

  function isCurrentHomeData(data) {
    return Boolean(data?.ok && data.month === currentMonthKey());
  }

  async function loadHome(opts = {}) {
    const fresh = Boolean(opts?.fresh);
    const monthKey = currentMonthKey();
    const seq = ++homeLoadSeq;
    if (!fresh && isCurrentHomeData(fin.homeData)) renderHomeWidget(fin.homeData);
    try {
      const data = await fetchMonth(monthKey);
      if (seq !== homeLoadSeq) return;
      renderHomeWidget(data);
    } catch {
      if (seq !== homeLoadSeq) return;
      if (isCurrentHomeData(fin.homeData)) {
        renderHomeWidget(fin.homeData);
      } else {
        setElHidden(els.zone, true);
      }
    }
    if (seq === homeLoadSeq) renderPlanBanner();
  }

  function getFinanceScrollOffset() {
    const header = document.getElementById("appHeader");
    const chrome = document.querySelector(".finance-detail-chrome");
    return (header?.offsetHeight || 46) + (chrome?.offsetHeight || 88) + 6;
  }

  function setFinanceTabUI(tab) {
    document.querySelectorAll("[data-finance-tab]").forEach((btn) => {
      const on = btn.dataset.financeTab === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("[data-finance-panel]").forEach((panel) => {
      const on = panel.dataset.financePanel === tab;
      panel.classList.toggle("is-active", on);
    });
  }

  function releaseFinanceScrollLock() {
    fin.financeScrollLock = false;
  }

  function scrollToFinanceSection(tab, opts = {}) {
    const panel = document.querySelector(`#flowDetailFinance [data-finance-panel="${tab}"]`);
    if (!panel) return;
    const instant = Boolean(opts.instant);
    if (!opts.silent) {
      fin.financeScrollLock = true;
      fin.tab = tab;
      setFinanceTabUI(tab);
    } else {
      fin.financeScrollLock = true;
    }
    const top = panel.getBoundingClientRect().top + window.scrollY - getFinanceScrollOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: instant ? "auto" : "smooth" });
    clearTimeout(financeScrollUnlockTimer);
    const unlock = () => {
      clearTimeout(financeScrollUnlockTimer);
      releaseFinanceScrollLock();
    };
    if ("onscrollend" in window && !instant) {
      const onEnd = () => {
        window.removeEventListener("scrollend", onEnd);
        unlock();
      };
      window.addEventListener("scrollend", onEnd, { once: true });
      financeScrollUnlockTimer = setTimeout(() => {
        window.removeEventListener("scrollend", onEnd);
        unlock();
      }, 1500);
    } else {
      financeScrollUnlockTimer = setTimeout(unlock, instant ? 80 : 1000);
    }
    if (tab === "history" && !instant) {
      clearTimeout(financeHistoryAlignTimer);
      const alignHistory = () =>
        scrollToFinanceSection("history", { instant: true, silent: true });
      requestAnimationFrame(() => requestAnimationFrame(alignHistory));
      financeHistoryAlignTimer = setTimeout(alignHistory, 700);
    }
  }

  function updateFinanceTabFromScroll() {
    if (fin.financeScrollLock || fin.appScreen !== "detailFinance") return;
    const panels = [...document.querySelectorAll("#flowDetailFinance [data-finance-panel]")];
    if (!panels.length) return;
    const offset = getFinanceScrollOffset();
    const probe = window.scrollY + offset + 40;
    let active = panels[0].dataset.financePanel || "overview";
    panels.forEach((panel) => {
      const top = panel.getBoundingClientRect().top + window.scrollY;
      if (top <= probe) active = panel.dataset.financePanel || active;
    });
    if (active && active !== fin.tab) {
      fin.tab = active;
      setFinanceTabUI(active);
      // Месяц и перезагрузка данных — только по тапу на вкладку (switchFinanceTab).
    }
  }

  function bindFinanceScrollSpy() {
    if (fin.financeScrollBound) return;
    fin.financeScrollBound = true;
    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          updateFinanceTabFromScroll();
        });
      },
      { passive: true }
    );
  }

  async function switchFinanceTab(tab) {
    if (!FINANCE_TAB_ORDER.includes(tab)) return;
    if (tab === "categories") fin.categoryDrill = null;
    if (tab === "history") {
      await renderHistory();
    } else if (tab === "plan") {
      await renderPlan();
    } else if (tab === "categories" && fin.monthData) {
      await renderCategories(fin.monthData, fin.planMonthData);
    }
    fin.tab = tab;
    setFinanceTabUI(tab);
    scrollToFinanceSection(tab);
  }

  function renderMonthNav() {
    if (!els.monthNav) return;
    const cur = fin.monthKey;
    const prev = shiftMonth(cur, -1);
    const next = shiftMonth(cur, 1);
    els.monthNav.innerHTML = `
      <button type="button" class="finance-month-nav__btn" data-finance-month="${prev}">${esc(monthTitle(prev))}</button>
      <button type="button" class="finance-month-nav__btn is-active" data-finance-month="${cur}" aria-current="true">${esc(monthTitle(cur))}</button>
      <button type="button" class="finance-month-nav__btn" data-finance-month="${next}">${esc(monthTitle(next))}</button>
    `;
    els.monthNav.querySelectorAll("[data-finance-month]").forEach((btn) => {
      btn.addEventListener("click", () => changeFinanceMonth(btn.dataset.financeMonth));
    });
  }

  async function changeFinanceMonth(ym) {
    if (ym === fin.monthKey) return;
    fin.monthKey = ym;
    fin.overviewBrowseMonth = ym;
    fin.overviewBrowseYear = Number(ym.slice(0, 4));
    fin.categoryDrill = null;
    fin.overviewIncomeOpen = false;
    fin.overviewExpensesExpanded = false;
    await refreshDetail();
  }

  function slugAmountsFromMonth(monthData) {
    const map = {};
    (monthData?.expenses?.groups || []).forEach((g) => {
      (g.categories || []).forEach((c) => {
        if (c.slug) map[c.slug] = (map[c.slug] || 0) + (Number(c.amount) || 0);
      });
    });
    return map;
  }

  function buildOverviewExpenseBuckets(monthData) {
    const slugAmounts = slugAmountsFromMonth(monthData);
    return OVERVIEW_EXPENSE_BUCKETS.map((b) => ({
      label: b.label,
      colorKey: b.colorKey,
      amount: b.slugs.reduce((sum, slug) => sum + (slugAmounts[slug] || 0), 0),
    })).sort((a, b) => b.amount - a.amount);
  }

  function overviewDisplayData(monthData, ytdData) {
    if (fin.overviewPeriodMode === "ytd") {
      const ytd = ytdData || fin.ytdData;
      if (!ytd?.ok) return monthData;
      const inc = ytd.income || {};
      return {
        income: {
          real: inc.real ?? ytd.incomeRealTotal ?? 0,
          carryover: inc.carryover ?? ytd.carryover ?? 0,
          total: inc.total ?? (inc.real ?? ytd.incomeRealTotal ?? 0) + (inc.carryover ?? ytd.carryover ?? 0),
          sources: inc.sources || [],
        },
        expenses: ytd.expenses || {
          total: ytd.expensesTotal || 0,
          groups: [],
        },
      };
    }
    return monthData;
  }

  function syncOverviewBrowse() {
    const mk = fin.monthKey || currentMonthKey();
    if (!fin.overviewBrowseMonth) fin.overviewBrowseMonth = mk;
    if (!fin.overviewBrowseYear) fin.overviewBrowseYear = Number(mk.slice(0, 4));
  }

  async function ensureOverviewMonthData(ym) {
    if (fin.overviewMonthCache[ym]) return fin.overviewMonthCache[ym];
    const data = await fetchMonth(ym);
    if (data?.ok) fin.overviewMonthCache[ym] = data;
    return fin.overviewMonthCache[ym] || null;
  }

  async function ensureOverviewYearData(year) {
    if (fin.overviewYearCache[year]) return fin.overviewYearCache[year];
    const data = await fetchYtd(year);
    if (data?.ok) fin.overviewYearCache[year] = data;
    return fin.overviewYearCache[year] || null;
  }

  function overviewYearSlots() {
    const end = Number(currentMonthKey().slice(0, 4));
    const years = [];
    for (let y = end - OVERVIEW_YEAR_LOOKBACK; y <= end; y += 1) years.push(y);
    return years;
  }

  function renderOverviewSwipeDots(count, activeIndex) {
    return `<div class="kpi-card__swipe-dots" aria-hidden="true">${Array.from(
      { length: count },
      (_, i) =>
        `<span class="kpi-card__swipe-dot${i === activeIndex ? " is-active" : ""}"></span>`
    ).join("")}</div>`;
  }

  function overviewSwipeLabel() {
    if (fin.overviewPeriodMode === "ytd") return String(fin.overviewBrowseYear);
    return monthTitle(fin.overviewBrowseMonth);
  }

  function overviewSwipeDotsHtml() {
    if (fin.overviewPeriodMode === "ytd") {
      const years = overviewYearSlots();
      const idx = Math.max(0, years.indexOf(fin.overviewBrowseYear));
      return renderOverviewSwipeDots(years.length, idx);
    }
    return renderOverviewSwipeDots(3, 1);
  }

  async function getOverviewDisplayData(fallbackMonthData) {
    syncOverviewBrowse();
    if (fin.overviewPeriodMode === "ytd") {
      const ytd = await ensureOverviewYearData(fin.overviewBrowseYear);
      return overviewDisplayData(fallbackMonthData, ytd);
    }
    const md = await ensureOverviewMonthData(fin.overviewBrowseMonth);
    return overviewDisplayData(md || fallbackMonthData);
  }

  async function prefetchOverviewNeighbors() {
    if (fin.overviewPeriodMode === "ytd") {
      const years = overviewYearSlots();
      const idx = years.indexOf(fin.overviewBrowseYear);
      await ensureOverviewYearData(fin.overviewBrowseYear);
      if (idx > 0) ensureOverviewYearData(years[idx - 1]);
      if (idx >= 0 && idx < years.length - 1) ensureOverviewYearData(years[idx + 1]);
      return;
    }
    const m = fin.overviewBrowseMonth;
    const today = currentMonthKey();
    await ensureOverviewMonthData(m);
    ensureOverviewMonthData(shiftMonth(m, -1));
    const next = shiftMonth(m, 1);
    if (next <= today) ensureOverviewMonthData(next);
  }

  async function cycleOverviewSwipe(dir) {
    if (fin.overviewPeriodMode === "ytd") {
      const years = overviewYearSlots();
      let idx = years.indexOf(fin.overviewBrowseYear);
      if (idx < 0) idx = years.length - 1;
      const next = idx + dir;
      if (next < 0 || next >= years.length) return;
      fin.overviewBrowseYear = years[next];
    } else {
      const browse = fin.overviewBrowseMonth || fin.monthKey || currentMonthKey();
      const today = currentMonthKey();
      if (dir > 0) {
        const next = shiftMonth(browse, 1);
        if (next > today) return;
        fin.overviewBrowseMonth = next;
      } else {
        fin.overviewBrowseMonth = shiftMonth(browse, -1);
      }
    }
    fin.overviewIncomeOpen = false;
    fin.overviewExpensesExpanded = false;
    if (fin.monthData) await renderOverview(fin.monthData);
  }

  function bindFinanceOverviewSwipe() {
    if (fin.overviewSwipeBound || !els.flow) return;
    fin.overviewSwipeBound = true;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let locked = false;
    let activeBlock = null;

    const resetTracking = () => {
      if (locked) window.LifePageScrollLock?.unlock?.();
      tracking = false;
      locked = false;
      activeBlock = null;
    };

    const trySwipe = (clientX, clientY) => {
      if (!tracking || !activeBlock) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      resetTracking();
      if (Math.abs(dx) < OVERVIEW_SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy)) return;
      const swipeDir = dx < 0 ? 1 : -1;
      cycleOverviewSwipe(swipeDir).catch(() => {});
    };

    els.flow.addEventListener("pointerdown", (ev) => {
      const block = ev.target.closest("[data-finance-overview-swipe]");
      if (!block || !els.flow.contains(block)) return;
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      tracking = true;
      locked = false;
      activeBlock = block;
      startX = ev.clientX;
      startY = ev.clientY;
    });

    document.addEventListener(
      "pointermove",
      (ev) => {
        if (!tracking || !activeBlock) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!locked) {
          if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
            resetTracking();
            return;
          }
          if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
            window.LifePageScrollLock?.lock?.();
            locked = true;
          }
        }
        if (locked) ev.preventDefault();
      },
      { passive: false }
    );

    document.addEventListener("pointerup", (ev) => {
      if (tracking) trySwipe(ev.clientX, ev.clientY);
    });
    document.addEventListener("pointercancel", resetTracking);
  }

  function buildOverviewContent(display) {
    const sources = incomeSourcesForOverview(display.income);
    const expenseBuckets = buildOverviewExpenseBuckets(display);
    const hasMoreExpenses = expenseBuckets.length > 5;
    const visibleBuckets = fin.overviewExpensesExpanded
      ? expenseBuckets
      : expenseBuckets.slice(0, 5);
    const expandLabel = !hasMoreExpenses
      ? ""
      : fin.overviewExpensesExpanded
        ? "Свернуть ↑"
        : `Ещё ${expenseBuckets.length - 5} категорий ↓`;
    const incomeOpen = fin.overviewIncomeOpen;
    const expensesExpanded = fin.overviewExpensesExpanded;

    return `
      <p class="finance-overview-swipe__label">${esc(overviewSwipeLabel())}</p>
      <div class="finance-overview-tiles">
        <button type="button" class="finance-overview-tile finance-overview-tile--income${incomeOpen ? " is-open" : ""}" data-overview-income-toggle aria-expanded="${incomeOpen ? "true" : "false"}">
          <span class="finance-overview-tile__label">Доходы</span>
          <span class="finance-overview-tile__value">${formatRub(display.income?.total ?? display.income?.real ?? 0)}</span>
          <span class="finance-overview-tile__chev" aria-hidden="true">›</span>
        </button>
        <button type="button" class="finance-overview-tile finance-overview-tile--expense${expensesExpanded ? " is-expanded" : ""}" data-overview-expense-toggle aria-expanded="${expensesExpanded ? "true" : "false"}">
          <span class="finance-overview-tile__label">Расходы</span>
          <span class="finance-overview-tile__value">${formatRub(display.expenses?.total || 0)}</span>
          <span class="finance-overview-tile__chev" aria-hidden="true">›</span>
        </button>
      </div>
      ${
        incomeOpen
          ? `
      <div class="finance-card finance-card--income finance-card--income-wide">
        <div class="finance-card__body">
          ${renderOverviewIncomeDetail(sources)}
        </div>
      </div>`
          : ""
      }
      <div class="finance-card finance-card--expense">
        <div class="finance-card__head">
          <span class="finance-card__title">Расходы</span>
          <span class="finance-card__total">${formatRub(display.expenses?.total || 0)}</span>
        </div>
        <div class="finance-card__divider"></div>
        <div class="finance-card__body" data-overview-exp-list>
          ${renderOverviewRowBars(visibleBuckets)}
        </div>
        <button type="button" class="finance-overview-expand" data-overview-exp-toggle${expandLabel ? "" : " hidden"}>${expandLabel || `Ещё ${expenseBuckets.length - 5} категорий ↓`}</button>
      </div>`;
  }

  function buildOverviewBalanceBlock(monthData) {
    const bm = monthData.balanceMonth;
    const by = monthData.balanceYtd;
    return `
      <div class="finance-card finance-card--balance" data-finance-overview-balance>
        <div class="finance-balance-strip finance-balance-strip--in-card">
          <div class="finance-balance-strip__half">
            <p class="finance-balance-strip__label">Баланс месяца</p>
            <p class="finance-balance-strip__val" style="color:${balanceColor(bm)}">${formatRub(bm)}</p>
          </div>
          <div class="finance-balance-strip__sep" aria-hidden="true"></div>
          <div class="finance-balance-strip__half finance-balance-strip__half--right">
            <p class="finance-balance-strip__label">Баланс YTD</p>
            <p class="finance-balance-strip__val" style="color:${balanceColor(by)}">${formatRub(by)}</p>
          </div>
        </div>
        <div class="finance-card__divider"></div>
        <p class="finance-card__section-label">Баланс по месяцам</p>
        <div class="finance-mini-bar finance-mini-bar--year" id="financeOverviewBars"></div>
      </div>`;
  }

  function incomeSourcesForOverview(income) {
    const sources = [...(income?.sources || [])];
    const carryover = Number(income?.carryover) || 0;
    if (carryover > 0) {
      sources.push({
        categoryId: "carryover",
        slug: "carryover",
        name: "Остаток",
        amount: carryover,
      });
    }
    return sources.sort((a, b) => b.amount - a.amount || String(a.name).localeCompare(String(b.name)));
  }

  function syncOverviewPeriodToggle() {
    if (!els.overviewPeriodToggle) return;
    els.overviewPeriodToggle.textContent = fin.overviewPeriodMode === "ytd" ? "год" : "мес";
  }

  function renderOverviewRowBars(rows) {
    if (!rows.length) return '<p class="finance-empty">Нет расходов</p>';
    const max = Math.max(...rows.map((r) => r.amount), 1);
    return rows
      .map((r) => {
        const w = Math.round((r.amount / max) * 100);
        const color = GROUP_COLORS[r.colorKey] || GROUP_COLORS.gray;
        return `
          <div class="finance-row-bar finance-row-bar--stacked">
            <div class="finance-row-bar__line">
              <span class="finance-row-bar__name">${esc(r.label)}</span>
              <span class="finance-row-bar__val">${formatRubK(r.amount)}</span>
            </div>
            <div class="finance-row-bar__track"><div class="finance-row-bar__fill" style="width:${w}%;background:${color}"></div></div>
          </div>`;
      })
      .join("");
  }

  function renderOverviewIncomeDetail(sources) {
    if (!sources.length) return '<p class="finance-empty">Нет доходов</p>';
    const maxSrc = Math.max(...sources.map((s) => s.amount), 1);
    return sources
      .map((s, i) => {
        const w = Math.round((s.amount / maxSrc) * 100);
        const color = INCOME_BAR_COLORS[i % INCOME_BAR_COLORS.length];
        return `
          <div class="finance-row-bar finance-row-bar--stacked">
            <div class="finance-row-bar__line">
              <span class="finance-row-bar__name">${esc(s.name)}</span>
              <span class="finance-row-bar__val" style="color:${color}">${formatRubK(s.amount)}</span>
            </div>
            <div class="finance-row-bar__track"><div class="finance-row-bar__fill" style="width:${w}%;background:${color}"></div></div>
          </div>`;
      })
      .join("");
  }

  function updateOverviewExpenseSection(monthData) {
    if (!els.tabOverview) return;
    getOverviewDisplayData(monthData).then((display) => {
      if (!display) return;
      const expenseBuckets = buildOverviewExpenseBuckets(display);
      const hasMoreExpenses = expenseBuckets.length > 5;
      const visibleBuckets = fin.overviewExpensesExpanded
        ? expenseBuckets
        : expenseBuckets.slice(0, 5);
      const expandLabel = !hasMoreExpenses
        ? ""
        : fin.overviewExpensesExpanded
          ? "Свернуть ↑"
          : `Ещё ${expenseBuckets.length - 5} категорий ↓`;

      const list = els.tabOverview.querySelector("[data-overview-exp-list]");
      if (list) list.innerHTML = renderOverviewRowBars(visibleBuckets);

      const btn = els.tabOverview.querySelector("[data-overview-exp-toggle]");
      if (btn) {
        btn.textContent = expandLabel;
        setElHidden(btn, !expandLabel);
      }

      const tile = els.tabOverview.querySelector("[data-overview-expense-toggle]");
      if (tile) {
        tile.classList.toggle("is-expanded", fin.overviewExpensesExpanded);
        tile.setAttribute("aria-expanded", fin.overviewExpensesExpanded ? "true" : "false");
      }
    });
  }

  function toggleOverviewExpenses() {
    if (!fin.monthData) return;
    fin.overviewExpensesExpanded = !fin.overviewExpensesExpanded;
    updateOverviewExpenseSection(fin.monthData);
  }

  function bindOverviewToggles() {
    els.tabOverview?.querySelector("[data-overview-income-toggle]")?.addEventListener("click", () => {
      fin.overviewIncomeOpen = !fin.overviewIncomeOpen;
      if (fin.monthData) renderOverview(fin.monthData).catch(() => {});
    });
    els.tabOverview
      ?.querySelector("[data-overview-expense-toggle]")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        toggleOverviewExpenses();
      });
    els.tabOverview?.querySelector("[data-overview-exp-toggle]")?.addEventListener("click", (e) => {
      e.preventDefault();
      toggleOverviewExpenses();
    });
  }

  async function renderOverview(monthData) {
    if (!els.tabOverview || !monthData) return;
    syncOverviewBrowse();
    const display = await getOverviewDisplayData(monthData);
    if (!display) return;
    await prefetchOverviewNeighbors();
    const planFactData = await ensureOverviewPlanFactData();

    const swipeHint =
      fin.overviewPeriodMode === "ytd" ? "другой год" : "другой месяц";
    els.tabOverview.innerHTML = `
      <div class="finance-overview-swipe progress-strip--swipe" data-finance-overview-swipe role="group" aria-label="Обзор · ${esc(overviewSwipeLabel())}. Свайп — ${swipeHint}">
        ${buildOverviewContent(display)}
        ${overviewSwipeDotsHtml()}
      </div>
      ${buildOverviewBalanceBlock(monthData)}
      ${buildOverviewPlanFactBlock(planFactData)}
    `;

    bindOverviewToggles();
    syncOverviewPeriodToggle();
    bindFinanceOverviewSwipe();

    const yearBars = fin.ytdData?.monthlyBalance || monthData.monthlyBalance || [];
    const host = els.tabOverview.querySelector("#financeOverviewBars");
    if (host && window.LifeCharts?.renderFinanceBalanceBars) {
      window.LifeCharts.renderFinanceBalanceBars(host, yearBars, monthShort, {
        compact: true,
        highlightMonth: fin.monthKey,
      });
    }
  }

  function planAmountMaps(planData) {
    const planned = {};
    const fact = {};
    (planData?.items || []).forEach((i) => {
      planned[i.categoryId] = i.amountPlanned || 0;
      fact[i.categoryId] = i.amountFact || 0;
    });
    return { planned, fact };
  }

  function factAmountFromMonth(monthData) {
    const map = {};
    (monthData?.expenses?.groups || []).forEach((g) => {
      (g.categories || []).forEach((c) => {
        map[c.categoryId] = c.amount || 0;
      });
    });
    return map;
  }

  function categoryPlanProgress(planned, fact) {
    const plan = Number(planned) || 0;
    const actual = Number(fact) || 0;
    const over = plan > 0 ? actual > plan : actual > 0;
    const pct = plan > 0 ? Math.round((actual / plan) * 100) : 0;
    const max = Math.max(plan, actual, 1);
    return {
      over,
      pct,
      pctLabel: plan > 0 ? `${pct}%` : actual > 0 ? ">100%" : "0%",
      planW: plan > 0 ? Math.round((plan / max) * 100) : 0,
      factW: actual > 0 ? Math.round((actual / max) * 100) : 0,
      actual,
      plan,
    };
  }

  function categoryExpensePlanColor(pct, over) {
    if (over || pct > 100) return "var(--red)";
    if (pct >= 95) return "var(--yellow)";
    return "var(--green)";
  }

  function categoryExpenseTotals(plannedMap, factMap) {
    let plan = 0;
    let fact = 0;
    expensePlanCategories().forEach((cat) => {
      plan += Number(plannedMap[cat.id]) || 0;
      fact += Number(factMap[cat.id]) || 0;
    });
    return { plan, fact };
  }

  function categoryExpenseMaps(monthData, planData) {
    const { planned, fact: planFact } = planAmountMaps(planData);
    const monthFact = factAmountFromMonth(monthData);
    const factMap = { ...monthFact };
    Object.keys(planFact).forEach((id) => {
      if (factMap[id] == null) factMap[id] = planFact[id];
    });
    return { planned, factMap };
  }

  function overviewPlanFactMonthKey() {
    return currentMonthKey();
  }

  function categoriesPlanMonthKey() {
    return fin.monthKey || currentMonthKey();
  }

  async function ensureCategoriesPlanData() {
    const mk = categoriesPlanMonthKey();
    if (fin.planMonthData?.ok && fin.planMonthData.month === mk) {
      return fin.planMonthData;
    }
    const planData = await api.apiGet("/finance/plan", { month: mk }).catch(() => ({
      ok: false,
      month: mk,
      items: [],
    }));
    fin.planMonthData = planData;
    return planData;
  }

  async function ensureOverviewPlanFactData() {
    const mk = overviewPlanFactMonthKey();
    if (fin.overviewPlanFactMonthKey === mk && fin.overviewPlanFactData?.ok) {
      return fin.overviewPlanFactData;
    }
    const planData = await api
      .apiGet("/finance/plan", { month: mk })
      .catch(() => ({
        ok: false,
        planExpenseTotal: 0,
        factExpenseTotal: 0,
      }));
    fin.overviewPlanFactMonthKey = mk;
    fin.overviewPlanFactData = planData;
    return planData;
  }

  function buildOverviewPlanFactBlock(planData) {
    const plan = Number(planData?.planExpenseTotal) || 0;
    const fact = Number(planData?.factExpenseTotal) || 0;
    const p = categoryPlanProgress(plan, fact);
    const barColor = categoryExpensePlanColor(p.pct, p.over);
    const planBar =
      p.plan > 0
        ? `<div class="finance-plan-row__plan" style="width:${p.planW}%"></div>`
        : `<div class="finance-plan-row__plan finance-plan-row__plan--zero"></div>`;
    const factBar =
      p.actual > 0
        ? `<div class="finance-plan-row__fact${p.over ? " finance-plan-row__fact--over" : ""}" style="width:${p.factW}%;background:${barColor}"></div>`
        : "";
    const monthLabel = monthTitle(overviewPlanFactMonthKey()).toLowerCase();
    return `
      <div class="finance-card finance-card--plan-fact" data-finance-overview-plan-fact>
        <div class="finance-card__head">
          <span class="finance-card__title">Расходы · план и факт · ${esc(monthLabel)}</span>
          <span class="finance-card__total finance-overview-plan-fact__pct" style="color:${barColor}">${p.pctLabel}</span>
        </div>
        <div class="finance-card__divider"></div>
        <div class="finance-card__body finance-overview-plan-fact__body">
          <div class="finance-overview-plan-fact__sums">
            <span>Факт <strong>${formatRub(fact)}</strong></span>
            <span>План <strong>${formatRub(plan)}</strong></span>
          </div>
          <div class="finance-plan-row__bars finance-overview-plan-fact__bar" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Расходы относительно плана за ${esc(monthLabel)}">
            ${planBar}
            ${factBar}
          </div>
        </div>
      </div>`;
  }

  function renderCategoryProgressRow(cat, planned, fact) {
    const p = categoryPlanProgress(planned, fact);
    const color = GROUP_COLORS[cat.colorKey] || GROUP_COLORS.gray;
    const factBg = p.over ? "var(--red)" : color;
    const pctClass = p.over ? " finance-cat-row__pct--over" : "";
    const planBar =
      p.plan > 0
        ? `<div class="finance-plan-row__plan" style="width:${p.planW}%"></div>`
        : `<div class="finance-plan-row__plan finance-plan-row__plan--zero"></div>`;
    const factBar =
      p.actual > 0
        ? `<div class="finance-plan-row__fact${p.over ? " finance-plan-row__fact--over" : ""}" style="width:${p.factW}%;background:${factBg}"></div>`
        : "";
    return `
      <button type="button" class="finance-cat-row" data-cat-id="${cat.id}">
        <span class="finance-cat-row__name">${esc(cat.name)}</span>
        <div class="finance-cat-row__bar">
          <div class="finance-plan-row__bars">
            ${planBar}
            ${factBar}
          </div>
        </div>
        <span class="finance-cat-row__pct${pctClass}">${p.pctLabel}</span>
      </button>`;
  }

  function renderCategoryExpenseList(plannedMap, factMap) {
    const parts = [];
    let lastGroup = null;
    let groupOpen = false;
    expensePlanCategories().forEach((cat) => {
      if (cat.groupName && cat.groupName !== lastGroup) {
        if (groupOpen) parts.push("</div>");
        lastGroup = cat.groupName;
        groupOpen = true;
        parts.push(
          `<div class="finance-plan-form__group" style="${planGroupStyle(cat.colorKey)}">` +
            `<p class="finance-plan-form__group-label">${esc(cat.groupName)}</p>`
        );
      }
      const planned = plannedMap[cat.id] || 0;
      const fact = factMap[cat.id] || 0;
      parts.push(renderCategoryProgressRow(cat, planned, fact));
    });
    if (groupOpen) parts.push("</div>");
    return parts.join("");
  }

  async function renderCategories(monthData, planData) {
    if (!els.tabCategories) return;
    if (fin.categoryDrill) {
      await renderCategoryDrill(fin.categoryDrill);
      return;
    }
    await ensureCategories();
    const mk = categoriesPlanMonthKey();
    const plan =
      planData?.ok && planData.month === mk ? planData : await ensureCategoriesPlanData();
    const { planned, factMap } = categoryExpenseMaps(monthData, plan);
    const rows = renderCategoryExpenseList(planned, factMap);
    els.tabCategories.innerHTML = `
      <p class="section-counter">Расходы · план и факт · ${esc(monthTitle(mk).toLowerCase())}</p>
      <div class="finance-cat-list">${rows || '<p class="finance-empty">Нет категорий</p>'}</div>
    `;
    els.tabCategories.querySelectorAll("[data-cat-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = categoryById(btn.dataset.catId);
        if (cat) {
          fin.categoryDrill = { categoryId: cat.id, name: cat.name };
          renderCategoryDrill(fin.categoryDrill);
        }
      });
    });
  }

  async function renderCategoryDrill(cat) {
    if (!els.tabCategories) return;
    const categoryId = Number(cat.categoryId || cat.id);
    let txns = [];
    try {
      const res = await api.apiGet("/finance/transactions", { month: fin.monthKey });
      txns = (res.transactions || []).filter((t) => t.categoryId === categoryId);
    } catch {
      txns = [];
    }
    const factTotal = txns.reduce((s, t) => s + (t.amount || 0), 0);
    const planData = await ensureCategoriesPlanData();
    const planned = (planData?.items || []).find((i) => i.categoryId === categoryId)
      ?.amountPlanned;
    const progress = categoryPlanProgress(planned || 0, factTotal);

    els.tabCategories.innerHTML = `
      <button type="button" class="finance-back-link" id="financeCatBack">‹ ${esc(cat.name)}</button>
      <div class="finance-cat-drill-sum">
        <span>Факт</span>
        <strong>${formatRub(factTotal)}</strong>
        ${planned > 0 ? `<span class="finance-cat-drill-sum__plan">план ${formatRub(planned)} · ${progress.pctLabel}</span>` : ""}
      </div>
      <p class="section-counter">Транзакции</p>
      <ul class="finance-txn-list">
        ${txns
          .map(
            (t) => `
          <li class="finance-txn-item">
            <div class="finance-txn-item__main">
              <span class="finance-txn-item__date">${t.txDate.slice(8, 10)}.${t.txDate.slice(5, 7)}</span>
              <span class="finance-txn-item__name">${esc(t.categoryName)}</span>
              <span class="finance-txn-item__amt">${formatRub(t.amount)}</span>
            </div>
            <button type="button" class="finance-txn-item__del" data-del-txn="${t.id}" aria-label="Удалить">×</button>
          </li>`
          )
          .join("") || '<li class="finance-empty">Нет транзакций</li>'}
      </ul>
      <button type="button" class="cta-btn cta-btn--inline" id="financeCatAdd">+ Добавить</button>
    `;

    els.tabCategories.querySelector("#financeCatBack")?.addEventListener("click", () => {
      fin.categoryDrill = null;
      renderCategories(fin.monthData, fin.planMonthData);
    });
    els.tabCategories.querySelector("#financeCatAdd")?.addEventListener("click", () => {
      openTxnSheet("expense", categoryId);
    });
    els.tabCategories.querySelectorAll("[data-del-txn]").forEach((btn) => {
      btn.addEventListener("click", () => openTxnDeleteConfirm(Number(btn.dataset.delTxn)));
    });
  }

  function renderMetrics(monthData, ytdData) {
    if (!els.tabMetrics || !monthData?.ok) return;
    const foodCurrent = monthFoodShares(monthData);
    const foodCompleted = ytdData?.foodShareCompleted || {};
    const foodCorePct = Number(foodCompleted.corePct) || foodCurrent.pctCore;
    const foodCafePct = Number(foodCompleted.cafePct) || 0;

    const assetsYtd = resolveAssetsYtd(ytdData);
    const assetsPeriod = assetsYtdPeriodLabel(ytdData);
    const assetsBase = assetsYtd.assetsBase ?? assetsYtd.assets_base ?? 0;
    const assetsTarget = assetsYtd.assetsTarget ?? assetsYtd.assets_target ?? 0;
    const assetsActual = assetsYtd.assetsActual ?? assetsYtd.assets_actual ?? 0;
    const assetsTopUp = Math.max(
      0,
      assetsYtd.assetsGap ??
        assetsYtd.assets_gap ??
        Math.round((assetsTarget - assetsActual) * 10) / 10
    );
    const assetsSources =
      assetsYtd.assetsBaseSources ||
      assetsYtd.assets_base_sources ||
      ytdData?.assetsBreakdownYtd ||
      [];
    const zeroClass = assetsActual <= 0 ? " finance-tile--alert" : "";
    const sourceRows = assetsSources
      .map(
        (s) => `
        <div class="finance-metric__source-row">
          <span>${esc(s.name)}</span>
          <span>${formatRub(s.amount || 0)}</span>
        </div>`
      )
      .join("");

    const avg = ytdData?.avgMonthlyIncome || 0;
    const med = ytdData?.medianMonthlyIncome || 0;
    const monthly = ytdData?.monthlyIncome || [];
    const formatKInt = (n) => `${Math.round(Number(n) / 1000)}К`;
    const cushionTarget = Math.round(med * 3);
    const cushionSaved = loadCushionAmount();
    const cushionPct =
      cushionTarget > 0 ? Math.round((cushionSaved / cushionTarget) * 100) : 0;
    const cushionBarPct = Math.min(cushionPct, 100);
    const cushionColor = cushionProgressColor(cushionPct);

    els.tabMetrics.innerHTML = `
      <div class="finance-metric">
        <p class="section-counter">Доход домохозяйства</p>
        <div class="finance-tiles">
          <div class="finance-tile finance-tile--green">
            <span>Среднее</span>
            <strong>${formatKInt(avg)}</strong>
          </div>
          <div class="finance-tile finance-tile--green">
            <span>Медиана</span>
            <strong>${formatKInt(med)}</strong>
          </div>
        </div>
        <div class="finance-mini-bar" id="financeIncomeTrend"></div>
      </div>
      <div class="finance-metric">
        <p class="section-counter">Активы 10%</p>
        <div class="finance-tiles finance-tiles--triple">
          <div class="finance-tile finance-tile--blue">
            <span>Цель (10%)</span>
            <strong>${formatRub(assetsTarget)}</strong>
          </div>
          <div class="finance-tile${zeroClass}">
            <span>Факт</span>
            <strong>${formatRub(assetsActual)}</strong>
          </div>
          <div class="finance-tile finance-tile--topup">
            <span>Доложить</span>
            <strong>${formatRub(assetsTopUp)}</strong>
          </div>
        </div>
        <p class="finance-metric__caption">10% от доходов за ${esc(assetsPeriod)}:</p>
        <div class="finance-metric__sources">${sourceRows}</div>
        <p class="finance-metric__total">База за год: ${formatRub(assetsBase)} → цель ${formatRub(assetsTarget)}</p>
        <div class="finance-mini-bar" id="financeAssetsTrend"></div>
      </div>
      <div class="finance-metric">
        <p class="section-counter">Подушка безопасности</p>
        <p class="finance-metric__sub">Цель: 3 × медиана (${formatKInt(med)}) = ${formatRub(cushionTarget)}</p>
        <div class="finance-tiles">
          <div class="finance-tile finance-tile--violet">
            <span>Цель</span>
            <strong>${formatRub(cushionTarget)}</strong>
          </div>
          <div class="finance-tile finance-tile--cushion">
            <span>Накоплено</span>
            <div class="finance-cushion__main" id="financeCushionView">
              <strong>${formatRub(cushionSaved)}</strong>
              <button type="button" class="finance-cushion-btn" id="financeCushionEditBtn">Ввести</button>
            </div>
            <div class="finance-cushion__edit" id="financeCushionEdit" hidden>
              <input class="finance-cushion-input" id="financeCushionAmount" type="text" inputmode="decimal"
                data-plan-amount value="${formatPlanInput(cushionSaved)}" placeholder="0 ₽" aria-label="Накоплено в подушку" />
            </div>
          </div>
        </div>
        <div class="finance-metric__row finance-metric__row--cushion">
          <div class="finance-metric__bar-wrap">
            <div class="finance-food-bar__track finance-metric__track">
              <div class="finance-food-bar__fill" style="width:${cushionBarPct}%;background:${cushionColor}"></div>
            </div>
          </div>
          <div class="finance-metric__pct">
            <strong style="color:${cushionColor}">${cushionPct}%</strong>
            <span>${formatRub(cushionSaved)} / ${formatRub(cushionTarget)}</span>
          </div>
        </div>
      </div>
      <div class="finance-metric">
        <p class="section-counter">Продукты от дохода</p>
        <p class="finance-metric__food-pct">${Math.round(foodCorePct)}%</p>
        <div class="finance-mini-bar" id="financeFoodCoreTrend"></div>
      </div>
      <div class="finance-metric">
        <p class="section-counter">Кафе/рестораны от дохода</p>
        <p class="finance-metric__food-pct">${Math.round(foodCafePct)}%</p>
        <div class="finance-mini-bar" id="financeFoodWithCafeTrend"></div>
      </div>
    `;

    const incHost = els.tabMetrics.querySelector("#financeIncomeTrend");
    if (incHost && window.LifeCharts?.renderFinanceIncomeBars) {
      window.LifeCharts.renderFinanceIncomeBars(incHost, monthly, monthShort);
    }
    const assetsHost = els.tabMetrics.querySelector("#financeAssetsTrend");
    const assetsMonthly = ytdData?.monthlyAssets || [];
    if (assetsHost && window.LifeCharts?.renderFinanceAssetsBars) {
      window.LifeCharts.renderFinanceAssetsBars(assetsHost, assetsMonthly, monthShort);
    }
    const foodCoreHost = els.tabMetrics.querySelector("#financeFoodCoreTrend");
    const foodWithCafeHost = els.tabMetrics.querySelector("#financeFoodWithCafeTrend");
    const foodShareHistory = ytdData?.foodShareHistory || [];
    if (foodCoreHost && window.LifeCharts?.renderFinanceFoodTrend) {
      const historyCore = foodShareHistory.map((r) => ({
        month: r.month,
        pct: Number(r.pctCore) || 0,
      }));
      window.LifeCharts.renderFinanceFoodTrend(foodCoreHost, historyCore, monthShort, {
        barColor: "#3685bf",
        trendColor: "#3685bf",
      });
    }
    if (foodWithCafeHost && window.LifeCharts?.renderFinanceFoodTrend) {
      const historyWithCafe = foodShareHistory.map((r) => ({
        month: r.month,
        pct: Number(r.pctCafe) || 0,
      }));
      window.LifeCharts.renderFinanceFoodTrend(foodWithCafeHost, historyWithCafe, monthShort, {
        barColor: "#3685bf",
        trendColor: "#3685bf",
      });
    }

    const cushionEditBtn = els.tabMetrics.querySelector("#financeCushionEditBtn");
    const cushionView = els.tabMetrics.querySelector("#financeCushionView");
    const cushionEdit = els.tabMetrics.querySelector("#financeCushionEdit");
    const cushionInp = els.tabMetrics.querySelector("#financeCushionAmount");
    cushionEditBtn?.addEventListener("click", () => {
      setElHidden(cushionView, true);
      setElHidden(cushionEdit, false);
      bindPlanAmountInputs(els.tabMetrics);
      if (cushionInp) {
        const n = loadCushionAmount();
        cushionInp.value = n > 0 ? String(n) : "";
        window.LifeInputKeyboards?.focus?.(cushionInp) ?? cushionInp.focus();
      }
    });
    cushionInp?.addEventListener("blur", () => {
      saveCushionAmount(parsePlanAmount(cushionInp.value));
      renderMetrics(monthData, ytdData);
    });
    cushionInp?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") cushionInp.blur();
    });
    window.LifeInputKeyboards?.sync(els.tabMetrics);
  }

  function renderReminderFormHtml() {
    return `
      <div class="finance-reminder-form" id="financeReminderForm" hidden>
        <p class="finance-reminder-form__caption">Дата напоминания</p>
        <div class="wheel-picker wheel-picker--compact" id="financeRemWheel">
          <div class="wheel-picker__frame"></div>
          <div class="wheel-col" id="financeRemWheelDay"></div>
          <div class="wheel-col" id="financeRemWheelMonth"></div>
          <div class="wheel-col" id="financeRemWheelYear"></div>
        </div>
        <label class="finance-plan-form__row finance-reminder-form__field">
          <span class="finance-plan-form__label">Название</span>
          <input class="finance-plan-form__input finance-plan-form__input--wide" id="financeRemLabel" type="text" data-keyboard="text" placeholder="Ипотека" />
        </label>
        <label class="finance-plan-form__row finance-reminder-form__field">
          <span class="finance-plan-form__label">Сумма</span>
          <input class="finance-plan-form__input finance-plan-form__input--amount" id="financeRemAmount" data-plan-amount data-plan-amount-exact inputmode="decimal" placeholder="0 ₽" />
        </label>
        <div class="finance-reminder-form__actions">
          <button type="button" class="cta-btn cta-btn--inline cta-btn--secondary" id="financeRemCancel">Отмена</button>
          <button type="button" class="cta-btn cta-btn--inline" id="financeRemSubmit">Сохранить</button>
        </div>
      </div>`;
  }

  function renderPlanReminders(reminders) {
    const remHtml = reminders
      .map(
        (r) => `
        <li class="finance-reminder-item">
          <span>${esc(formatReminderLine(r))}</span>
          <button type="button" class="finance-reminder-item__del" data-del-rem="${r.id}" aria-label="Удалить напоминание">×</button>
        </li>`
      )
      .join("");
    return `
      <p class="section-counter">Напоминания о платежах</p>
      <ul class="finance-reminder-list">${remHtml || '<li class="finance-empty">Нет напоминаний</li>'}</ul>
      ${renderReminderFormHtml()}
      <button type="button" class="cta-btn cta-btn--inline cta-btn--secondary" id="financeAddReminder">Создать напоминание</button>`;
  }

  function bindPlanReminders() {
    els.tabPlan?.querySelectorAll("[data-del-rem]").forEach((btn) => {
      btn.addEventListener("click", () => {
        api
          .apiDelete(`/finance/reminders/${btn.dataset.delRem}`)
          .then(async () => {
            await renderPlan();
            if (fin.appScreen === "home") await loadHome({ fresh: true });
          })
          .catch((err) => alert(String(err.message || err)));
      });
    });
    els.tabPlan?.querySelector("#financeAddReminder")?.addEventListener("click", () => {
      toggleReminderForm(true);
    });
    els.tabPlan?.querySelector("#financeRemCancel")?.addEventListener("click", () => {
      toggleReminderForm(false);
    });
    els.tabPlan?.querySelector("#financeRemSubmit")?.addEventListener("click", () => {
      submitReminderForm().catch((err) => alert(String(err.message || err)));
    });
  }

  function renderPlanContent(planByCat, planData, reminders) {
    if (!els.tabPlan) return;
    els.tabPlan.innerHTML = `
      ${renderPlanFormHtml(planByCat)}
      ${renderPlanReminders(reminders)}
    `;
    bindPlanReminders();
    if (planData?.planOverBudget) {
      const alertEl = els.tabPlan.querySelector("#financePlanOverAlert");
      if (alertEl) setElHidden(alertEl, false);
    }
  }

  function formatTxnDate(iso) {
    if (!iso || iso.length < 10) return "";
    return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  }

  function formatTxnDay(iso) {
    if (!iso || iso.length < 10) return "";
    return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  }

  function renderHistoryTxnRow(t, opts = {}) {
    const isIncome = t.kind === "income" || t.kind === "carryover";
    const amtClass = isIncome ? " finance-txn-item__amt--income" : "";
    const note = t.note
      ? `<span class="finance-txn-item__note">${esc(t.note)}</span>`
      : "";
    const dateLabel = opts.dayOnly ? formatTxnDay(t.txDate) : formatTxnDate(t.txDate);
    return `
      <li class="finance-txn-item">
        <div class="finance-txn-item__main finance-txn-item__main--history">
          <span class="finance-txn-item__date">${dateLabel}</span>
          <span class="finance-txn-item__name">${esc(t.categoryName)}${note}</span>
          <span class="finance-txn-item__amt${amtClass}">${formatRub(t.amount)}</span>
        </div>
        <button type="button" class="finance-txn-item__del" data-del-txn="${t.id}" aria-label="Удалить">×</button>
      </li>`;
  }

  function bindHistoryTxnDeletes(root) {
    root?.querySelectorAll("[data-del-txn]").forEach((btn) => {
      btn.addEventListener("click", () => openTxnDeleteConfirm(Number(btn.dataset.delTxn)));
    });
  }

  function sortHistoryTxns(txns) {
    return [...txns].sort((a, b) => {
      const byDate = String(b.txDate).localeCompare(String(a.txDate));
      if (byDate !== 0) return byDate;
      return (b.id || 0) - (a.id || 0);
    });
  }

  async function loadHistoryTxns(monthKey) {
    const params = monthKey ? { month: monthKey } : {};
    const res = await api.apiGet("/finance/transactions", params);
    return sortHistoryTxns((res.transactions || []).filter((t) => t.source === "manual"));
  }

  function txnCountLabel(n) {
    if (n === 1) return "операция";
    if (n >= 2 && n < 5) return "операции";
    return "операций";
  }

  function historyMoreToggleHtml(total) {
    if (total <= HISTORY_VISIBLE_LIMIT) return "";
    if (fin.historyMonthExpanded) {
      return `<button type="button" class="finance-history-more" data-history-collapse>Свернуть ↑</button>`;
    }
    return `<button type="button" class="finance-history-more" data-history-expand>Показаны последние ${HISTORY_VISIBLE_LIMIT} из ${total} ↓</button>`;
  }

  function paintHistoryView(allTxns) {
    if (!els.tabHistory) return;
    const cacheKey = `${allTxns.length}:${allTxns[0]?.id || 0}`;
    if (cacheKey !== fin.historyMonthKey) {
      fin.historyMonthExpanded = false;
      fin.historyMonthKey = cacheKey;
    }
    fin.historyMonthTxns = allTxns;

    const total = allTxns.length;
    const expanded = fin.historyMonthExpanded;
    const visibleTxns =
      expanded || total <= HISTORY_VISIBLE_LIMIT
        ? allTxns
        : allTxns.slice(0, HISTORY_VISIBLE_LIMIT);

    const incomeTotal = visibleTxns
      .filter((t) => t.kind === "income" || t.kind === "carryover")
      .reduce((s, t) => s + (t.amount || 0), 0);
    const expenseTotal = visibleTxns
      .filter((t) => t.kind === "expense")
      .reduce((s, t) => s + (t.amount || 0), 0);

    els.tabHistory.innerHTML = `
      <div class="finance-history-summary">
        <p class="finance-history-summary__count">${total} ${txnCountLabel(total)}</p>
        <p class="finance-history-summary__totals">
          <span class="finance-history-summary__income">+${formatRub(incomeTotal)}</span>
          <span class="finance-history-summary__sep">·</span>
          <span class="finance-history-summary__expense">−${formatRub(expenseTotal)}</span>
        </p>
      </div>
      <div class="finance-history-groups">
        <div class="finance-card finance-card--history-month finance-card--history-month-open">
          <ul class="finance-txn-list finance-txn-list--history">
            ${visibleTxns.map((t) => renderHistoryTxnRow(t, { dayOnly: true })).join("")}
          </ul>
          ${historyMoreToggleHtml(total)}
        </div>
      </div>
    `;
    bindHistoryTxnDeletes(els.tabHistory);
    bindHistoryMonthToggle(els.tabHistory);
  }

  function bindHistoryMonthToggle(root) {
    root?.querySelector("[data-history-expand]")?.addEventListener("click", () => {
      fin.historyMonthExpanded = true;
      paintHistoryView(fin.historyMonthTxns);
    });
    root?.querySelector("[data-history-collapse]")?.addEventListener("click", () => {
      fin.historyMonthExpanded = false;
      paintHistoryView(fin.historyMonthTxns);
    });
  }

  async function renderHistory() {
    if (!els.tabHistory) return;
    const hasRenderedHistory =
      els.tabHistory.querySelector(".finance-history-summary") ||
      els.tabHistory.querySelector(".finance-history-groups");
    if (!hasRenderedHistory) {
      els.tabHistory.innerHTML = '<p class="finance-empty">Загрузка…</p>';
    }
    let allTxns = [];
    try {
      allTxns = await loadHistoryTxns();
    } catch (err) {
      els.tabHistory.innerHTML = `<p class="finance-empty">${esc(err.message || err)}</p>`;
      return;
    }

    if (!allTxns.length) {
      fin.historyMonthKey = "";
      fin.historyMonthTxns = [];
      fin.historyMonthExpanded = false;
      els.tabHistory.innerHTML = '<p class="finance-empty">Нет операций</p>';
      return;
    }

    paintHistoryView(allTxns);
  }

  async function renderPlan() {
    if (!els.tabPlan) return;
    await ensureCategories();
    let planData = { ok: true, items: [], planOverBudget: false };
    let planByCat = {};
    let reminders = [];
    try {
      const loaded = await loadPlanForForm(planMonthKey());
      planData = loaded.planData;
      planByCat = loaded.planByCat;
      const rem = await api.apiGet("/finance/reminders");
      reminders = rem.reminders || [];
    } catch {
      /* empty */
    }

    renderPlanContent(planByCat, planData, reminders);
    bindPlanForm();
  }

  async function refreshDetail(opts = {}) {
    const silent = Boolean(opts.silent);
    renderMonthNav();
    if (!silent && els.tabOverview) els.tabOverview.innerHTML = '<p class="finance-empty">Загрузка…</p>';
    try {
      const data = await fetchMonth(fin.monthKey);
      fin.monthData = data;
      if (data?.ok) {
        fin.overviewMonthCache[fin.monthKey] = data;
        if (fin.monthKey === currentMonthKey()) fin.homeData = data;
      }
      const year = Number(fin.monthKey.slice(0, 4));
      const throughMonth = Number(fin.monthKey.slice(5, 7));
      fin.ytdData = await fetchYtd(year, throughMonth);
      if (fin.ytdData?.ok) fin.overviewYearCache[year] = fin.ytdData;
      fin.planMonthData = await api
        .apiGet("/finance/plan", { month: fin.monthKey })
        .catch(() => ({ items: [] }));
      fin.overviewPlanFactMonthKey = "";
      fin.overviewPlanFactData = null;
      await renderOverview(data);
      renderMetrics(data, fin.ytdData);
      await renderCategories(data, fin.planMonthData);
      await renderPlan();
      await renderHistory();
    } catch (err) {
      if (els.tabOverview) {
        els.tabOverview.innerHTML = `<p class="finance-empty">${esc(err.message || err)}</p>`;
      }
    }
  }

  async function openDetail(monthKey, tab) {
    fin.categoryDrill = null;
    const targetTab = tab || "overview";
    fin.monthKey = monthKey || currentMonthKey();
    fin.overviewBrowseMonth = fin.monthKey;
    fin.overviewBrowseYear = Number(fin.monthKey.slice(0, 4));
    fin.tab = targetTab;
    api.setScreen("detailFinance");
    await refreshDetail();
    setFinanceTabUI(targetTab);
    requestAnimationFrame(() => scrollToFinanceSection(targetTab));
  }

  function sheetCategories() {
    const kind = fin.sheetKind === "income" ? "income" : "expense";
    return fin.categories.filter((c) => c.kind === kind);
  }

  function sheetChipSlugs() {
    return fin.sheetKind === "income" ? INCOME_CHIP_SLUGS : EXPENSE_CHIP_SLUGS;
  }

  function sheetChipBtn(c, active) {
    return `<button type="button" class="finance-sheet__chip${active ? " is-active" : ""}" data-cat-id="${c.id}">${esc(c.name)}</button>`;
  }

  function focusTxnSheetAmount() {
    if (!els.sheet || els.sheet.hidden || !els.sheetAmount) return;
    window.LifeInputKeyboards?.focus?.(els.sheetAmount) ?? els.sheetAmount.focus();
  }

  function bindTxnSheetAmountFocus() {
    if (!els.sheet || els.sheet.dataset.amountFocusBound === "1") return;
    els.sheet.dataset.amountFocusBound = "1";
    const panel = els.sheet.querySelector(".finance-sheet__panel");
    if (!panel) return;

    panel.addEventListener(
      "pointerdown",
      (e) => {
        if (els.sheet.hidden) return;
        const t = e.target;
        if (t === els.sheetAmount) return;
        if (t.closest("#financeSheetClose, #financeSheetBackdrop")) return;
        if (t === els.sheetNote) {
          e.preventDefault();
          focusTxnSheetAmount();
          return;
        }
        if (t.closest("button, .wheel-col, .wheel-item")) {
          e.preventDefault();
        }
      },
      { capture: true }
    );

    els.sheetAmount?.addEventListener("blur", () => {
      if (els.sheet.hidden) return;
      requestAnimationFrame(() => {
        if (els.sheet.hidden) return;
        focusTxnSheetAmount();
      });
    });

    els.sheetWheelWrap?.addEventListener(
      "touchstart",
      () => {
        if (!els.sheet.hidden) focusTxnSheetAmount();
      },
      { passive: true }
    );
  }

  function bindSheetChipClicks(root) {
    root?.querySelectorAll("[data-cat-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        fin.sheetCategoryId = Number(btn.dataset.catId);
        renderSheetChips();
        focusTxnSheetAmount();
      });
    });
  }

  function renderSheetChips() {
    if (!els.sheetChips) return;
    const slugs = sheetChipSlugs();
    const chips = fin.categories.filter((c) => slugs.includes(c.slug));
    const extra = sheetCategories().filter((c) => !slugs.includes(c.slug));
    let html = chips
      .map((c) => sheetChipBtn(c, fin.sheetCategoryId === c.id))
      .join("");
    if (extra.length) {
      html += `<button type="button" class="finance-sheet__chip${fin.sheetShowAll ? " is-active" : ""}" data-sheet-more>${fin.sheetShowAll ? "Скрыть ↑" : "Ещё →"}</button>`;
    }
    els.sheetChips.innerHTML = html;
    bindSheetChipClicks(els.sheetChips);
    els.sheetChips.querySelector("[data-sheet-more]")?.addEventListener("click", () => {
      fin.sheetShowAll = !fin.sheetShowAll;
      renderSheetChips();
      renderSheetMore();
    });
    renderSheetMore();
  }

  function renderSheetMore() {
    if (!els.sheetMore) return;
    if (!fin.sheetShowAll) {
      els.sheetMore.innerHTML = "";
      setElHidden(els.sheetMore, true);
      return;
    }
    const slugs = new Set(sheetChipSlugs());
    const extra = sheetCategories().filter((c) => !slugs.has(c.slug));
    els.sheetMore.innerHTML = extra
      .map((c) => sheetChipBtn(c, fin.sheetCategoryId === c.id))
      .join("");
    setElHidden(els.sheetMore, extra.length === 0);
    bindSheetChipClicks(els.sheetMore);
  }

  async function openTxnSheet(kind, categoryId) {
    await ensureCategories();
    fin.sheetKind = kind;
    fin.sheetShowAll = false;
    fin.sheetCategoryId = categoryId || null;
    if (!fin.sheetCategoryId) {
      const slugs = kind === "income" ? INCOME_CHIP_SLUGS : EXPENSE_CHIP_SLUGS;
      const first = fin.categories.find((c) => c.slug === slugs[0]);
      fin.sheetCategoryId = first?.id || null;
    }
    if (els.sheetTitle) {
      els.sheetTitle.textContent = kind === "income" ? "Новый доход" : "Новый расход";
    }
    if (els.sheetAmountWrap) {
      els.sheetAmountWrap.classList.toggle("finance-sheet__amount-wrap--income", kind === "income");
      els.sheetAmountWrap.classList.toggle("finance-sheet__amount-wrap--expense", kind !== "income");
    }
    if (els.sheetAmount) els.sheetAmount.value = "";
    if (els.sheetNote) els.sheetNote.value = "";
    initTxnWheel(loadLastTxnDate());
    closeTxnSheetWheel();
    renderSheetChips();
    if (els.sheet) {
      els.sheet.hidden = false;
      document.body.classList.add("finance-sheet-open");
    }
    window.LifeInputKeyboards?.sync(els.sheet);
    requestAnimationFrame(() => {
      focusTxnSheetAmount();
      requestAnimationFrame(focusTxnSheetAmount);
    });
  }

  function closeTxnSheet() {
    closeTxnSheetWheel();
    if (els.sheet) els.sheet.hidden = true;
    document.body.classList.remove("finance-sheet-open");
    fin.sheetShowAll = false;
  }

  async function submitTxn(closeAfter) {
    const rawAmount = String(els.sheetAmount?.value || "").trim();
    const amount = Number(rawAmount.replace(",", "."));
    const hasAmount = rawAmount && amount > 0;
    if (!hasAmount) {
      if (closeAfter) {
        closeTxnSheet();
        return;
      }
      throw new Error("Укажите сумму");
    }
    if (!fin.sheetCategoryId) throw new Error("Выберите категорию");
    const txDate = txnWheelIso();
    const body = {
      txDate,
      categoryId: fin.sheetCategoryId,
      amount,
      kind: fin.sheetKind,
    };
    if (fin.sheetKind === "income" && els.sheetNote?.value?.trim()) {
      body.note = els.sheetNote.value.trim();
    }
    await api.apiPostJson("/finance/transactions", body);
    saveLastTxnDate(txDate);
    if (fin.appScreen === "detailFinance") {
      await refreshDetail();
    } else {
      await loadHome({ fresh: true });
    }
    await window.LifeLedger?.onFinanceChange?.();
    if (closeAfter) {
      closeTxnSheet();
    } else {
      if (els.sheetAmount) els.sheetAmount.value = "";
      initTxnWheel(loadLastTxnDate());
      closeTxnSheetWheel();
      updateTxnDateBtn();
      focusTxnSheetAmount();
      requestAnimationFrame(() => {
        focusTxnSheetAmount();
        requestAnimationFrame(focusTxnSheetAmount);
      });
    }
  }

  function openTxnDeleteConfirm(id) {
    fin.deleteTxnId = id;
    if (els.deleteConfirm) els.deleteConfirm.hidden = false;
  }

  function closeTxnDeleteConfirm() {
    fin.deleteTxnId = null;
    if (els.deleteConfirm) els.deleteConfirm.hidden = true;
  }

  async function confirmDeleteTxn() {
    if (!fin.deleteTxnId) return;
    await api.apiDelete(`/finance/transactions/${fin.deleteTxnId}`);
    closeTxnDeleteConfirm();
    if (fin.appScreen === "detailFinance") {
      await refreshDetail();
    } else {
      await loadHome({ fresh: true });
    }
    await window.LifeLedger?.onFinanceChange?.();
  }

  function bindEls() {
    els.zone = $("financeZoneBtn");
    els.zoneTitle = $("financeZoneTitle");
    els.zoneOpen = $("financeZoneOpenBtn");
    els.balanceLabel = $("financeBalanceLabel");
    els.balanceValue = $("financeBalanceValue");
    els.balanceToggle = $("financeBalanceToggle");
    els.balanceDivider = $("financeBalanceDivider");
    els.remindersContainer = $("financeRemindersContainer");
    els.planBanner = $("financePlanBanner");
    els.planBannerText = $("financePlanBannerText");
    els.expenseBtn = $("financeExpenseBtn");
    els.incomeBtn = $("financeIncomeBtn");
    els.flow = $("flowDetailFinance");
    els.monthNav = $("financeMonthNav");
    els.tabOverview = $("financeTabOverview");
    els.overviewPeriodToggle = $("financeOverviewPeriodToggle");
    els.tabCategories = $("financeTabCategories");
    els.tabMetrics = $("financeTabMetrics");
    els.tabPlan = $("financeTabPlan");
    els.tabHistory = $("financeTabHistory");
    els.sheet = $("financeTxnSheet");
    els.sheetBackdrop = $("financeSheetBackdrop");
    els.sheetTitle = $("financeSheetTitle");
    els.sheetClose = $("financeSheetClose");
    els.sheetAmountWrap = $("financeSheetAmountWrap");
    els.sheetAmount = $("financeSheetAmount");
    els.sheetChips = $("financeSheetChips");
    els.sheetMore = $("financeSheetMore");
    els.sheetNote = $("financeSheetNote");
    els.sheetDateBtn = $("financeSheetDateBtn");
    els.sheetWheelWrap = $("financeSheetWheelWrap");
    els.sheetWheelDay = $("financeSheetWheelDay");
    els.sheetWheelMonth = $("financeSheetWheelMonth");
    els.sheetWheelYear = $("financeSheetWheelYear");
    els.sheetSaveMore = $("financeSheetSaveMore");
    els.sheetDone = $("financeSheetDone");
    els.deleteConfirm = $("financeTxnDeleteConfirm");
    els.deleteBackdrop = $("financeTxnDeleteBackdrop");
    els.deleteNo = $("financeTxnDeleteNo");
    els.deleteYes = $("financeTxnDeleteYes");
    els.exportHeaderBtn = $("financeExportHeaderBtn");
    els.historyExportBtn = $("financeHistoryExportBtn");
    els.exportSheet = $("financeExportSheet");
    els.exportBackdrop = $("financeExportBackdrop");
    els.exportClose = $("financeExportClose");
    els.exportCustom = $("financeExportCustom");
    els.exportFromBtn = $("financeExportFromBtn");
    els.exportToBtn = $("financeExportToBtn");
    els.exportWheelWrap = $("financeExportWheelWrap");
    els.exportWheelDay = $("financeExportWheelDay");
    els.exportWheelMonth = $("financeExportWheelMonth");
    els.exportWheelYear = $("financeExportWheelYear");
    els.exportDownload = $("financeExportDownload");
  }

  function bindEvents() {
    els.zoneOpen?.addEventListener("click", () => openDetail(currentMonthKey()));
    els.planBanner?.addEventListener("click", (e) => {
      e.stopPropagation();
      openDetail(planBannerNextMonth(), "plan");
    });
    els.expenseBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      openTxnSheet("expense").catch((err) => alert(String(err.message || err)));
    });
    els.incomeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      openTxnSheet("income").catch((err) => alert(String(err.message || err)));
    });

    els.balanceToggle?.addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.target.closest("[data-finance-balance-mode]");
      const mode = btn?.dataset.financeBalanceMode;
      if (!mode || mode === fin.balanceMode) return;
      fin.balanceMode = mode;
      if (isCurrentHomeData(fin.homeData)) renderHomeWidget(fin.homeData);
    });

    els.overviewPeriodToggle?.addEventListener("click", () => {
      fin.overviewPeriodMode = fin.overviewPeriodMode === "ytd" ? "month" : "ytd";
      fin.overviewIncomeOpen = false;
      fin.overviewExpensesExpanded = false;
      if (fin.overviewPeriodMode === "ytd") {
        fin.overviewBrowseYear = Number((fin.monthKey || currentMonthKey()).slice(0, 4));
      } else {
        fin.overviewBrowseMonth = fin.monthKey || currentMonthKey();
      }
      syncOverviewPeriodToggle();
      if (fin.monthData) renderOverview(fin.monthData).catch(() => {});
    });

    document.querySelectorAll("[data-finance-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchFinanceTab(btn.dataset.financeTab).catch((err) =>
          alert(String(err.message || err))
        );
      });
    });

    els.sheetBackdrop?.addEventListener("click", closeTxnSheet);
    els.sheetClose?.addEventListener("click", closeTxnSheet);
    els.sheetDateBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTxnSheetWheel();
      focusTxnSheetAmount();
    });
    bindTxnSheetAmountFocus();
    els.sheetSaveMore?.addEventListener("click", () => {
      submitTxn(false).catch((err) => alert(String(err.message || err)));
    });
    els.sheetDone?.addEventListener("click", () => {
      submitTxn(true).catch((err) => alert(String(err.message || err)));
    });

    els.deleteBackdrop?.addEventListener("click", closeTxnDeleteConfirm);
    els.deleteNo?.addEventListener("click", closeTxnDeleteConfirm);
    els.deleteYes?.addEventListener("click", () => {
      confirmDeleteTxn().catch((err) => alert(String(err.message || err)));
    });

    els.exportHeaderBtn?.addEventListener("click", openExportSheet);
    els.historyExportBtn?.addEventListener("click", openExportSheet);
    els.exportBackdrop?.addEventListener("click", closeExportSheet);
    els.exportClose?.addEventListener("click", closeExportSheet);
    document.querySelectorAll("[data-finance-export-period]").forEach((btn) => {
      btn.addEventListener("click", () => setExportPeriod(btn.dataset.financeExportPeriod));
    });
    els.exportFromBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleExportWheel("from");
    });
    els.exportToBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleExportWheel("to");
    });
    els.exportDownload?.addEventListener("click", () => {
      downloadFinanceCsv().catch((err) => alert(String(err.message || err)));
    });
  }

  function onScreenChange(screen, ctx = {}) {
    fin.appScreen = screen;
    const isHome = screen === "home";
    const isFinance = screen === "detailFinance";
    setElHidden(els.flow, !isFinance);
    setElHidden(els.exportHeaderBtn, !isFinance);
    if (!els.zone) return;
    if (isHome) {
      if (ctx.homeFresh && isCurrentHomeData(fin.monthData)) {
        fin.homeData = fin.monthData;
        renderHomeWidget(fin.homeData);
      } else if (!ctx.homeFresh && isCurrentHomeData(fin.homeData)) {
        renderHomeWidget(fin.homeData);
      }
    } else {
      setElHidden(els.zone, true);
    }
    if (isFinance) {
      requestAnimationFrame(() => updateFinanceTabFromScroll());
    }
  }

  function navigateBack() {
    if (els.exportSheet && !els.exportSheet.hidden) {
      if (fin.exportWheelOpen) {
        closeExportWheel();
        return true;
      }
      closeExportSheet();
      return true;
    }
    if (els.sheet && !els.sheet.hidden) {
      if (fin.sheetWheelOpen) {
        closeTxnSheetWheel();
        return true;
      }
      closeTxnSheet();
      return true;
    }
    if (els.deleteConfirm && !els.deleteConfirm.hidden) {
      closeTxnDeleteConfirm();
      return true;
    }
    if (fin.appScreen === "detailFinance") {
      if (fin.categoryDrill) {
        fin.categoryDrill = null;
        renderCategories(fin.monthData, fin.planMonthData);
        return true;
      }
      api.setScreen("home");
      return true;
    }
    return false;
  }

  function init(deps) {
    api = deps;
    apiUrl = deps.apiUrl || apiUrl;
    esc = deps.escapeHtml || esc;
    monthNames = deps.monthNames || [];
    monthNamesShort = deps.monthNamesShort || [];
    todayIso = deps.todayIso || todayIso;
    setElHidden = deps.setElHidden || setElHidden;
    fin.monthKey = currentMonthKey();
    bindEls();
    bindEvents();
    bindFinanceScrollSpy();
  }

  window.LifeFinance = {
    init,
    loadHome,
    refreshDetail,
    openDetail,
    onScreenChange,
    navigateBack,
    closeTxnSheet,
    isFinanceScreen: (s) => s === "detailFinance",
  };
})();
