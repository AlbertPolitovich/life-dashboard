/**
 * Хозяйство (Ledger) — home variant A, detailLedger, inbox + распределение.
 */
(function () {
  const APARTMENT_BUCKET_LABELS = {
    mortgage: "Ипотека",
    repair: "Ремонт",
    misc: "Разное",
    kvartplata: "Квартплата",
  };

  const CAR_BUCKET_LABELS = {
    service: "Сервис",
    consumables: "Расходники",
    loan: "Кредит",
  };

  const ASSET_ICONS = {
    apartment: "🏠",
    car: "🚗",
  };

  const LEDGER_TAB_LABELS = {
    overview: "Обзор",
    mortgage: "Ипотека",
    repair: "Ремонт",
    kvartplata: "Кварплата",
    service: "Ремонт",
    consumables: "Расходники",
    tech: "Техобсл",
    inbox: "Inbox",
  };

  const MAINT_KIND_ORDER = ["engine_oil", "gearbox_oil"];
  const MAINT_BAR_COLORS = {
    engine_oil: "#e8a030",
    gearbox_oil: "#3685bf",
  };

  const SERVICE_UNIT_LABELS = {
    general: "Общее",
    body: "Кузов",
    chassis: "Ходовая",
    motor: "Мотор",
    maintenance: "ТО / фильтры",
  };

  const SERVICE_PURPOSE_LABELS = {
    repair: "Ремонт",
    service: "ТО",
    misc: "Прочее",
  };

  const MORTGAGE_ALLOC_KINDS = [
    { value: "payment", label: "Платёж по ипотеке", ledgerLabel: "платеж по ипотеке" },
    { value: "insurance", label: "Страховка", ledgerLabel: "страховка" },
    { value: "down_payment", label: "Первоначальный взнос", ledgerLabel: "первоначальный взнос" },
    { value: "booking", label: "Бронь", ledgerLabel: "бронь" },
    { value: "domclick", label: "Домклик", ledgerLabel: "домклик" },
    { value: "other", label: "Прочее", ledgerLabel: "" },
  ];

  const MORTGAGE_ALLOC_KIND_LABELS = Object.fromEntries(
    MORTGAGE_ALLOC_KINDS.map((k) => [k.value, k.label])
  );

  const SERVICE_UNIT_ORDER = ["motor", "chassis", "body", "maintenance", "general"];

  const CONSUMABLE_SUB_LABELS = {
    fuel: "Топливо",
    tolls: "Платные дороги",
    transport_tax: "Транспортный налог",
    fines: "Штрафы",
    parking: "Парковка",
    wash: "Мойка",
    misc: "Разное",
  };

  const CONSUMABLE_SUB_ORDER = [
    "fuel",
    "tolls",
    "transport_tax",
    "fines",
    "parking",
    "wash",
    "misc",
  ];

  const SERVICE_PURPOSE_ORDER = ["repair", "service", "misc"];

  const CAR_STATS_FIRST_YEAR = 2023;
  const SWIPE_MIN_DX = 20;

  const BALANCE_MODE_KEY = "lifeDashboard.ledgerBalanceMode";
  const KVART_METER_REMINDER_ID = "kvartplata-meters";
  const KVART_METER_REMINDER_DISMISS_KEY = "lifeDashboard.kvartplataMeterReminderDismiss";
  const KVART_METER_WINDOW_FROM = 15;
  const KVART_METER_WINDOW_TO = 20;

  let api = {};
  let esc = (s) => String(s);
  let todayIso = () => "";
  let setElHidden = () => {};
  let setScreen = () => {};
  let monthNames = [];
  let monthNamesShort = [];

  const led = {
    balanceMode: "ytd",
    assets: [],
    homeData: null,
    appScreen: "home",
    detailAssetId: null,
    detailTab: "overview",
    pendingDetailTab: null,
    detailYear: new Date().getFullYear(),
    inboxItems: [],
    allocItem: null,
    detailSummaries: {},
    detailMortgageSchedule: null,
    detailTech: null,
    detailAllocations: [],
    carStatsYears: [],
    carStatsYear: null,
    carStatsCache: {},
    ledgerScrollLock: false,
    ledgerScrollBound: false,
  };

  let homeLoadSeq = 0;
  let ledgerScrollUnlockTimer = null;
  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function currentMonthKey() {
    return todayIso().slice(0, 7);
  }

  function currentYear() {
    return Number(todayIso().slice(0, 4));
  }

  function currentDayOfMonth() {
    return Number(todayIso().slice(8, 10)) || 0;
  }

  function kvartMeterReminderDismissStore() {
    try {
      return JSON.parse(localStorage.getItem(KVART_METER_REMINDER_DISMISS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function kvartMeterReminderDismissKey() {
    return `${KVART_METER_REMINDER_ID}:${currentMonthKey()}`;
  }

  function isKvartMeterReminderDismissed() {
    return kvartMeterReminderDismissStore()[kvartMeterReminderDismissKey()] === true;
  }

  function dismissKvartMeterReminder() {
    const store = kvartMeterReminderDismissStore();
    store[kvartMeterReminderDismissKey()] = true;
    try {
      localStorage.setItem(KVART_METER_REMINDER_DISMISS_KEY, JSON.stringify(store));
    } catch {
      /* empty */
    }
    renderHomeKvartMeterReminder();
    const asset = assetById(led.detailAssetId);
    if (led.appScreen === "detailLedger" && asset?.kind === "apartment") {
      renderApartmentKvartplataPanel();
    }
  }

  function kvartMeterReminderActive() {
    const day = currentDayOfMonth();
    return day >= KVART_METER_WINDOW_FROM && day <= KVART_METER_WINDOW_TO;
  }

  function kvartMeterReminderUrgency() {
    const day = currentDayOfMonth();
    if (day >= KVART_METER_WINDOW_TO) return "due";
    if (day >= KVART_METER_WINDOW_TO - 1) return "soon";
    return "upcoming";
  }

  function renderKvartMeterReminder(extraClass) {
    if (!kvartMeterReminderActive() || isKvartMeterReminderDismissed()) return "";
    const urgency = kvartMeterReminderUrgency();
    const cls = extraClass ? ` ${extraClass}` : "";
    return `
      <div class="finance-zone__reminder finance-zone__reminder--${urgency}${cls}" role="status">
        <span class="finance-zone__reminder-dot finance-zone__reminder-dot--${urgency}" aria-hidden="true"></span>
        <p class="finance-zone__reminder-text">Передать показания счётчиков · до 20 числа</p>
        <button type="button" class="finance-mvp-reminder__dismiss" data-kvart-reminder-dismiss aria-label="Скрыть напоминание">×</button>
      </div>`;
  }

  function bindKvartMeterReminderIn(root) {
    root?.querySelector("[data-kvart-reminder-dismiss]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissKvartMeterReminder();
    });
  }

  function renderHomeKvartMeterReminder() {
    if (!els.remindersContainer) return;
    const html = renderKvartMeterReminder();
    const show = Boolean(html);
    setElHidden(els.reminderDivider, !show);
    els.remindersContainer.innerHTML = html;
    if (show) bindKvartMeterReminderIn(els.remindersContainer);
  }

  function bindKvartMeterReminder() {
    bindKvartMeterReminderIn(els.apartmentKvartplataPanel);
  }

  function initCarStatsYears() {
    const end = currentYear();
    const start = Math.min(CAR_STATS_FIRST_YEAR, end);
    const years = [];
    for (let y = start; y <= end; y += 1) years.push(y);
    led.carStatsYears = years;
    if (!led.carStatsYear || !years.includes(led.carStatsYear)) {
      led.carStatsYear = end;
    }
  }

  async function ensureCarStatsYear(asset, year) {
    if (led.carStatsCache[year]) return led.carStatsCache[year];
    const [svc, cons, allocData] = await Promise.all([
      api.apiGet("/ledger/car/service/summary", { assetId: asset.id, year }),
      api.apiGet("/ledger/car/consumables", { assetId: asset.id, year }),
      api.apiGet("/ledger/allocations", { assetId: asset.id, year }),
    ]);
    led.carStatsCache[year] = {
      service: svc,
      consumables: cons,
      allocations: allocData?.allocations || [],
    };
    return led.carStatsCache[year];
  }

  async function fetchCarStatsYears(asset) {
    initCarStatsYears();
    await Promise.all(led.carStatsYears.map((y) => ensureCarStatsYear(asset, y)));
  }

  function carStatsBundle(year) {
    return led.carStatsCache[year] || null;
  }

  function renderYearSwipeDots(count, activeIndex) {
    return `<div class="kpi-card__swipe-dots" aria-hidden="true">${Array.from(
      { length: count },
      (_, i) =>
        `<span class="kpi-card__swipe-dot${i === activeIndex ? " is-active" : ""}"></span>`
    ).join("")}</div>`;
  }

  function wrapYearBlock(content, year) {
    const years = led.carStatsYears;
    const idx = Math.max(0, years.indexOf(year));
    return `
      <div class="ledger-year-block progress-strip--swipe" data-ledger-year-swipe role="group" aria-label="Статистика · ${year}. Свайп — другой год">
        ${content}
        ${renderYearSwipeDots(years.length, idx)}
      </div>`;
  }

  async function cycleCarStatsYear(dir) {
    const years = led.carStatsYears;
    if (!years.length) return;
    let idx = years.indexOf(led.carStatsYear);
    if (idx < 0) idx = years.length - 1;
    const next = idx + dir;
    if (next < 0 || next >= years.length) return;
    led.carStatsYear = years[next];
    const asset = assetById(led.detailAssetId);
    if (asset?.kind === "car") {
      await ensureCarStatsYear(asset, led.carStatsYear);
      renderCarServicePanel();
      renderCarConsumablesPanel();
    }
  }

  function bindLedgerYearSwipe() {
    if (!els.flow || els.flow.dataset.ledgerYearSwipeBound) return;
    els.flow.dataset.ledgerYearSwipeBound = "1";

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
      if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy)) return;
      const dir = dx < 0 ? 1 : -1;
      cycleCarStatsYear(dir).catch(() => {});
    };

    els.flow.addEventListener("pointerdown", (ev) => {
      const block = ev.target.closest("[data-ledger-year-swipe]");
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

  function readBalanceMode() {
    try {
      const v = localStorage.getItem(BALANCE_MODE_KEY);
      if (v === "month" || v === "ytd") return v;
    } catch {
      /* ignore */
    }
    return "ytd";
  }

  function saveBalanceMode(mode) {
    try {
      localStorage.setItem(BALANCE_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }

  function formatRub(n) {
    const v = Math.round(Number(n) || 0);
    const sign = v < 0 ? "−" : "";
    return `${sign}${Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
  }

  function formatKm(n) {
    const v = Math.round(Number(n) || 0);
    return `${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} км`;
  }

  /** Пробег: целое км. «298.074» / «298,074» / «298 074» → 298074 (не 298). */
  function parseOdometerKm(raw) {
    let s = String(raw ?? "")
      .trim()
      .replace(/[\s\u00a0\u202f]/g, "");
    if (!s) return null;
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
      s = s.replace(/[.,]/g, "");
    } else {
      s = s.replace(",", ".");
    }
    const km = Number(s);
    if (!Number.isFinite(km) || km < 0) return null;
    return Math.round(km);
  }

  function formatDateRu(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-");
    if (!y || !m || !d) return iso;
    return `${d}.${m}.${y}`;
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

  function sumBucketTotals(buckets) {
    if (!buckets) return 0;
    return Object.values(buckets).reduce((s, b) => s + (Number(b?.total) || 0), 0);
  }

  function apartmentTotal(summary, mode, monthKey) {
    if (!summary?.ok) return 0;
    if (mode === "ytd") return sumBucketTotals(summary.buckets);
    const row = (summary.monthlyPivot || []).find((r) => r.yearMonth === monthKey);
    return Number(row?.total) || 0;
  }

  function carTotal(service, consumables, mode, monthKey) {
    if (mode === "ytd") {
      return (Number(service?.overall?.total) || 0) + (Number(consumables?.yearStats?.total) || 0);
    }
    const svcMonth =
      (service?.monthly || []).find((m) => m.yearMonth === monthKey)?.total || 0;
    const consMonth =
      (consumables?.monthly || []).find((m) => m.yearMonth === monthKey)?.total || 0;
    return Number(svcMonth) + Number(consMonth);
  }

  function assetById(id) {
    return led.assets.find((a) => a.id === Number(id));
  }

  function bucketsForAsset(asset) {
    if (!asset) return [];
    if (asset.kind === "apartment") {
      return Object.entries(APARTMENT_BUCKET_LABELS).map(([value, label]) => ({ value, label }));
    }
    return Object.entries(CAR_BUCKET_LABELS).map(([value, label]) => ({ value, label }));
  }

  function bucketLabel(asset, bucket) {
    if (!asset) return bucket;
    const map = asset.kind === "apartment" ? APARTMENT_BUCKET_LABELS : CAR_BUCKET_LABELS;
    return map[bucket] || bucket;
  }

  function txCategoryName(tx) {
    return tx?.categoryName || tx?.category?.name || "—";
  }

  function formatTxDate(iso, tx) {
    if (!iso) return "—";
    const today = todayIso();
    const isMonthAggregate =
      tx?.source === "excel_import" || (iso > today && iso.slice(0, 7) === today.slice(0, 7));
    if (isMonthAggregate && iso > today) {
      const m = Number(iso.slice(5, 7)) - 1;
      return `${monthNames[m] || iso.slice(5, 7)} ${iso.slice(0, 4)}`;
    }
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y?.slice(2) || ""}`;
  }

  function inboxCount() {
    return (led.inboxItems || []).length;
  }

  function inboxRemainingSum() {
    return (led.inboxItems || []).reduce((s, i) => s + (Number(i.remainingSum) || 0), 0);
  }

  function renderHomeWidget() {
    if (!els.zone || !led.homeData?.ok) {
      setElHidden(els.zone, true);
      return;
    }
    setElHidden(els.zone, false);

    const { apartment, carService, carConsumables } = led.homeData;
    const monthKey = currentMonthKey();
    const mode = led.balanceMode;

    if (els.balanceLabel) {
      els.balanceLabel.textContent =
        mode === "ytd" ? "Вложено с начала года" : "Вложено за месяц";
    }
    if (els.balanceToggle) {
      els.balanceToggle.querySelectorAll("[data-ledger-balance-mode]").forEach((btn) => {
        const active = btn.dataset.ledgerBalanceMode === mode;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    const aptAsset = led.assets.find((a) => a.kind === "apartment");
    const carAsset = led.assets.find((a) => a.kind === "car");
    const aptSum = apartmentTotal(apartment, mode, monthKey);
    const carSum = carTotal(carService, carConsumables, mode, monthKey);
    const grand = aptSum + carSum;

    if (els.balanceValue) {
      els.balanceValue.textContent = formatRub(grand);
    }

    const count = inboxCount();
    const hasInbox = count > 0;
    setElHidden(els.inboxDivider, !hasInbox);
    setElHidden(els.inboxRow, !hasInbox);
    setElHidden(els.ctaDivider, !hasInbox);
    setElHidden(els.ctaWrap, !hasInbox);
    if (hasInbox && els.inboxText) {
      const sum = inboxRemainingSum();
      const word = count === 1 ? "не распределена" : "не распределены";
      els.inboxText.textContent = `${count} ${word} · ${formatRub(sum)}`;
    }

    if (els.assetRows) {
      const rows = [];
      if (aptAsset) rows.push({ asset: aptAsset, total: aptSum });
      if (carAsset) rows.push({ asset: carAsset, total: carSum });
      els.assetRows.innerHTML = rows
        .map(
          ({ asset, total }) => `
        <div class="ledger-zone__asset-row">
          <span class="ledger-zone__asset-name">${ASSET_ICONS[asset.kind] || ""} ${esc(asset.name)}</span>
          <span class="ledger-zone__asset-sum">${esc(formatRubK(total))}</span>
        </div>`
        )
        .join("");
    }

    renderHomeKvartMeterReminder();
  }

  async function fetchHomeData(year, monthKey) {
    const assetsData = await api.apiGet("/ledger/assets");
    if (!assetsData?.ok) throw new Error(assetsData?.error || "Нет объектов");
    led.assets = assetsData.assets || [];

    const apt = led.assets.find((a) => a.kind === "apartment");
    const car = led.assets.find((a) => a.kind === "car");
    const inboxParams = led.balanceMode === "month" ? { month: monthKey } : {};

    const [inbox, apartment, carService, carConsumables] = await Promise.all([
      api.apiGet("/ledger/inbox", inboxParams),
      apt
        ? api.apiGet("/ledger/apartment/summary", { assetId: apt.id, year })
        : Promise.resolve({ ok: false }),
      car
        ? api.apiGet("/ledger/car/service/summary", { assetId: car.id, year })
        : Promise.resolve({ ok: false }),
      car
        ? api.apiGet("/ledger/car/consumables", { assetId: car.id, year })
        : Promise.resolve({ ok: false }),
    ]);

    if (!inbox?.ok) throw new Error(inbox?.error || "Inbox недоступен");

    led.inboxItems = inbox.items || [];
    led.homeData = { ok: true, apartment, carService, carConsumables };
    return led.homeData;
  }

  async function loadHome(opts = {}) {
    const fresh = Boolean(opts?.fresh);
    const seq = ++homeLoadSeq;
    if (!fresh && led.homeData?.ok) renderHomeWidget();
    try {
      await fetchHomeData(currentYear(), currentMonthKey());
      if (seq !== homeLoadSeq) return;
      renderHomeWidget();
    } catch {
      if (seq !== homeLoadSeq) return;
      if (led.homeData?.ok) {
        renderHomeWidget();
      } else {
        setElHidden(els.zone, true);
      }
    }
  }

  function tabsForAsset(asset) {
    const tabs = ["overview"];
    if (asset?.kind === "apartment") {
      tabs.push("mortgage", "repair", "kvartplata");
    }
    if (asset?.kind === "car") {
      tabs.push("consumables", "service", "tech");
    }
    if (inboxCount() > 0) tabs.push("inbox");
    return tabs;
  }

  function normalizeDetailTab() {
    const asset = assetById(led.detailAssetId);
    const allowed = tabsForAsset(asset);
    if (!allowed.includes(led.detailTab)) {
      led.detailTab = "overview";
    }
  }

  function renderLedgerTabs() {
    if (!els.tabs) return;
    const asset = assetById(led.detailAssetId);
    const tabs = tabsForAsset(asset);
    els.tabs.innerHTML = tabs
      .map((tab) => {
        const active = tab === led.detailTab;
        return `<button type="button" class="segmented__btn${active ? " is-active" : ""}" data-ledger-tab="${tab}" role="tab" aria-selected="${active}">${esc(LEDGER_TAB_LABELS[tab] || tab)}</button>`;
      })
      .join("");
  }

  function syncLedgerPanelsForAsset() {
    const asset = assetById(led.detailAssetId);
    const allowed = tabsForAsset(asset);
    document.querySelectorAll("#flowDetailLedger [data-ledger-panel]").forEach((panel) => {
      const tab = panel.dataset.ledgerPanel || "";
      setElHidden(panel, !allowed.includes(tab));
    });
  }

  function getLedgerScrollOffset() {
    const header = document.getElementById("appHeader");
    const chrome = document.querySelector(".ledger-detail-chrome");
    return (header?.offsetHeight || 46) + (chrome?.offsetHeight || 100) + 6;
  }

  function setLedgerTabUI(tab) {
    led.detailTab = tab;
    document.querySelectorAll("[data-ledger-tab]").forEach((btn) => {
      const on = btn.dataset.ledgerTab === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("#flowDetailLedger [data-ledger-panel]").forEach((panel) => {
      const on = panel.dataset.ledgerPanel === tab;
      panel.classList.toggle("is-active", on);
    });
  }

  function releaseLedgerScrollLock() {
    led.ledgerScrollLock = false;
  }

  function scrollToLedgerSection(tab) {
    const panel = document.querySelector(`#flowDetailLedger [data-ledger-panel="${tab}"]`);
    if (!panel || panel.hidden) return;
    const top = panel.getBoundingClientRect().top + window.scrollY - getLedgerScrollOffset();
    led.ledgerScrollLock = true;
    led.detailTab = tab;
    setLedgerTabUI(tab);
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    clearTimeout(ledgerScrollUnlockTimer);
    const unlock = () => {
      clearTimeout(ledgerScrollUnlockTimer);
      releaseLedgerScrollLock();
    };
    if ("onscrollend" in window) {
      const onEnd = () => {
        window.removeEventListener("scrollend", onEnd);
        unlock();
      };
      window.addEventListener("scrollend", onEnd, { once: true });
      ledgerScrollUnlockTimer = setTimeout(() => {
        window.removeEventListener("scrollend", onEnd);
        unlock();
      }, 1500);
    } else {
      ledgerScrollUnlockTimer = setTimeout(unlock, 1000);
    }
  }

  function updateLedgerTabFromScroll() {
    if (led.ledgerScrollLock || led.pendingDetailTab || led.appScreen !== "detailLedger") return;
    const asset = assetById(led.detailAssetId);
    const allowed = tabsForAsset(asset);
    const panels = [...document.querySelectorAll("#flowDetailLedger [data-ledger-panel]")].filter(
      (panel) => allowed.includes(panel.dataset.ledgerPanel || "") && !panel.hidden
    );
    if (!panels.length) return;
    const offset = getLedgerScrollOffset();
    const probe = window.scrollY + offset + 40;
    let active = panels[0].dataset.ledgerPanel || "overview";
    panels.forEach((panel) => {
      const panelTop = panel.getBoundingClientRect().top + window.scrollY;
      if (panelTop <= probe) active = panel.dataset.ledgerPanel || active;
    });
    if (active && active !== led.detailTab) {
      led.detailTab = active;
      setLedgerTabUI(active);
    }
  }

  function bindLedgerScrollSpy() {
    if (led.ledgerScrollBound) return;
    led.ledgerScrollBound = true;
    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          updateLedgerTabFromScroll();
        });
      },
      { passive: true }
    );
  }

  function switchLedgerTab(tab) {
    const asset = assetById(led.detailAssetId);
    if (!tabsForAsset(asset).includes(tab)) return;
    scrollToLedgerSection(tab);
  }

  function buildCarYearOverviewSeries() {
    initCarStatsYears();
    return (led.carStatsYears || [])
      .map((year) => {
        const bundle = led.carStatsCache[year];
        const repair = Number(bundle?.service?.overall?.total) || 0;
        const consumables = Number(bundle?.consumables?.yearStats?.total) || 0;
        const total = repair + consumables;
        return { year, repair, consumables, total };
      })
      .filter((y) => y.total > 0);
  }

  function renderOverviewYoyLine(year, allTotal, series) {
    const prev = series.find((y) => y.year === year - 1);
    if (!prev?.total) return "";
    const pct = Math.round(((allTotal - prev.total) / prev.total) * 100);
    if (!pct) {
      return `<p class="ledger-overview-yoy">как в ${year - 1}</p>`;
    }
    const cls = pct > 0 ? "ledger-overview-yoy--up" : "ledger-overview-yoy--down";
    const sign = pct > 0 ? "+" : "";
    return `<p class="ledger-overview-yoy ${cls}">${sign}${pct}% к ${year - 1}</p>`;
  }

  function renderAssetNav() {
    if (!els.assetNav) return;
    els.assetNav.innerHTML = led.assets
      .map((a) => {
        const active = a.id === led.detailAssetId;
        return `<button type="button" class="finance-month-nav__btn${active ? " is-active" : ""}" data-ledger-asset="${a.id}" role="tab" aria-selected="${active}">${esc(a.name)}</button>`;
      })
      .join("");
    els.assetNav.querySelectorAll("[data-ledger-asset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.ledgerAsset);
        if (id === led.detailAssetId) return;
        led.detailAssetId = id;
        led.detailTab = "overview";
        window.scrollTo({ top: 0 });
        refreshDetail().catch((err) => alert(String(err.message || err)));
      });
    });
  }

  function renderOverview() {
    const asset = assetById(led.detailAssetId);
    if (!asset) return;

    const isCar = asset.kind === "car";
    setElHidden(els.overviewApartment, isCar);
    setElHidden(els.overviewCar, !isCar);

    if (isCar) {
      renderCarOverview(asset);
      return;
    }

    renderApartmentOverview(asset);
  }

  function apartmentProgress(summary) {
    return summary?.mortgageProgress?.metricsReady ? summary.mortgageProgress : null;
  }

  function renderMortgageSurplusMeta(progress) {
    const surplus = Number(progress?.surplusOnAccount) || 0;
    const scheduleDelta = Number(progress?.scheduleDelta) || 0;
    const earlyTotal = Number(progress?.earlyPrincipalTotal) || 0;
    const parts = [];
    if (earlyTotal > 0) {
      parts.push(`Досрочно в срок · ${formatRub(earlyTotal)}`);
    }
    if (surplus > 0) {
      parts.push(`На счёте ипотеки · ${formatRub(surplus)} (свыше 20% от платежа)`);
    }
    if (scheduleDelta > 0.5) {
      parts.push(`Ниже графика на ${formatRub(scheduleDelta)} (ранние платежи)`);
    }
    if (!parts.length) return "";
    return `<p class="ledger-mortgage-surplus">${parts.map((p) => esc(p)).join(" · ")}</p>`;
  }

  function renderMortgageProgressBar(progress, { compact = false } = {}) {
    if (!progress?.metricsReady) {
      return `<p class="ledger-fallback">График ипотеки не загружен</p>`;
    }
    const pct = Math.min(100, Math.max(0, Number(progress.progressPct) || 0));
    const next = progress.nextPayment;
    const nextLine = next
      ? `След. платёж · ${esc(formatDateRu(next.dueDate))} · ${esc(formatRub(next.paymentTotal))}`
      : "График погашен";
    const endLine = progress.scheduleEndDate
      ? `До конца · ${esc(formatDateRu(progress.scheduleEndDate))}${progress.remainingPayments ? ` · ${progress.remainingPayments} пл.` : ""}`
      : "";
    return `
      <div class="ledger-mortgage-hero${compact ? " ledger-mortgage-hero--compact" : ""}">
        <div class="ledger-mortgage-progress__head">
          <span class="ledger-mortgage-progress__title">Погашение долга</span>
          <span class="ledger-mortgage-progress__pct">${pct.toFixed(1)}%</span>
        </div>
        <div class="ledger-mortgage-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="ledger-mortgage-progress__fill" style="width:${pct}%"></div>
        </div>
        <div class="ledger-mortgage-progress__stats">
          <div class="ledger-mortgage-stat">
            <span class="ledger-mortgage-stat__label">Остаток</span>
            <span class="ledger-mortgage-stat__val">${esc(formatRub(progress.principalRemaining))}</span>
          </div>
          <div class="ledger-mortgage-stat">
            <span class="ledger-mortgage-stat__label">Погашено</span>
            <span class="ledger-mortgage-stat__val">${esc(formatRub(progress.principalPaid))}</span>
          </div>
        </div>
        <p class="ledger-mortgage-progress__next">${nextLine}</p>
        ${endLine ? `<p class="ledger-mortgage-progress__end">${endLine}</p>` : ""}
        ${renderMortgageSurplusMeta(progress)}
      </div>`;
  }

  function renderApartmentKpiTile(label, value, tone) {
    return `
      <div class="finance-tile ${tone}">
        <span>${esc(label)}</span>
        <strong>${esc(formatRub(value))}</strong>
      </div>`;
  }

  function renderMonthlyBarBlock(label, monthly, stats, chartId, emptyText) {
    const hasData = (monthly || []).some((m) => Number(m.total) > 0);
    const statsBlock =
      stats?.count > 0
        ? `<div class="finance-tiles ledger-kvart-stats">
            ${renderApartmentKpiTile("Среднее", stats.avg || 0, "finance-tile--blue")}
            ${renderApartmentKpiTile("Медиана", stats.median || 0, "finance-tile--blue")}
          </div>`
        : "";
    return `
      <div class="ledger-chart-card ledger-kvart-card">
        <p class="ledger-chart-card__label">${esc(label)}</p>
        ${
          hasData
            ? `<div class="finance-mini-bar" id="${chartId}"></div>${statsBlock}`
            : `<p class="ledger-fallback">${esc(emptyText || "Пока нет платежей")}</p>`
        }
      </div>`;
  }

  function renderKvartplataBlock(monthly, stats, chartId) {
    return renderMonthlyBarBlock("Кварплата", monthly, stats, chartId);
  }

  function renderRepairMonthlyBlock(monthly, stats, chartId) {
    return renderMonthlyBarBlock("По месяцам", monthly, stats, chartId, "Пока нет трат");
  }

  function renderApartmentOverview(asset) {
    const year = led.detailYear;
    const summary = led.detailSummaries.apartment;
    const host = els.apartmentOverview;
    if (!host) return;
    if (!summary?.ok) {
      host.innerHTML = `<p class="ledger-fallback">Нет данных</p>`;
      return;
    }

    const progress = apartmentProgress(summary);
    const allTime = summary.allTimeTotals || {};
    const kvartMonthly = summary.kvartplataMonthly || [];
    const kvartStats = summary.kvartplataStats || {};

    const repairTotal = (Number(allTime.repair) || 0) + (Number(allTime.misc) || 0);

    host.innerHTML = `
      ${renderMortgageProgressBar(progress, { compact: true })}
      <div class="ledger-apartment-kpis">
        ${renderApartmentKpiTile("Ремонт всего", repairTotal, "finance-tile--repair")}
      </div>
      ${renderKvartplataBlock(kvartMonthly, kvartStats, "ledgerOverviewKvartBars")}`;

    if (window.LifeCharts?.renderFinanceMonthlyBars) {
      const bars = consumableMonthlyBars(kvartMonthly, year);
      window.LifeCharts.renderFinanceMonthlyBars(
        host.querySelector("#ledgerOverviewKvartBars"),
        bars,
        monthShort,
        { barColor: "#1a9e96", trendColor: "#1a9e96", valueKey: "amount", ...ledgerMonthChartOpts(year) }
      );
    }
  }

  function renderAncillaryBlock(progress) {
    if (!progress?.metricsReady) return "";
    const paid = Number(progress.mortgagePaidTotal) || 0;
    return `
      <div class="ledger-mortgage-section">
        <div class="ledger-simple-total ledger-kpi-stack">
          ${renderApartmentKpiTile("Уплачено всего", paid, "finance-tile--blue")}
        </div>
      </div>`;
  }

  function renderInsuranceYoY(insuranceByYear) {
    const rows = insuranceByYear || [];
    if (!rows.length) {
      return `<p class="ledger-fallback">Страховка ещё не учтена</p>`;
    }
    const max = Math.max(...rows.map((r) => Number(r.total) || 0), 1);
    const bars = rows
      .map((row, idx) => {
        const total = Number(row.total) || 0;
        const prev = idx > 0 ? Number(rows[idx - 1].total) || 0 : null;
        const h = Math.max(8, Math.round((total / max) * 56));
        let delta = "";
        if (prev && prev > 0 && total !== prev) {
          const pct = Math.round(((total - prev) / prev) * 100);
          const cls = pct > 0 ? "ledger-ins-delta--up" : "ledger-ins-delta--down";
          delta = `<span class="ledger-ins-delta ${cls}">${pct > 0 ? "+" : ""}${pct}%</span>`;
        }
        return `
          <div class="finance-vbar finance-vbar--sm">
            <span class="finance-vbar__val">${esc(formatRubK(total))}</span>
            <div class="finance-vbar__col" style="height:${h}px;background:#3685bf"></div>
            <span class="finance-vbar__month">${row.year}${delta}</span>
          </div>`;
      })
      .join("");
    return `<div class="finance-mini-bar finance-mini-bar--year ledger-ins-bars">${bars}</div>`;
  }

  function renderApartmentMortgagePanel() {
    if (!els.apartmentMortgagePanel) return;
    const asset = assetById(led.detailAssetId);
    if (!asset || asset.kind !== "apartment") return;

    const summary = led.detailSummaries.apartment;
    const progress = apartmentProgress(summary);
    const schedule = led.detailMortgageSchedule;

    if (!progress) {
      els.apartmentMortgagePanel.innerHTML = `<p class="ledger-fallback">${
        summary?.ok ? "Настройте график ипотеки" : "Загрузка…"
      }</p>`;
      return;
    }

    const maxExtra = progress.maxExtra20Pct;
    const next = progress.nextPayment;
    const scheduleHint =
      schedule?.rows?.length && next
        ? `<p class="ledger-mortgage-hint">Макс. досрочно в этом месяце: <strong>${esc(
            formatRub(maxExtra)
          )}</strong> (20% от ${esc(formatRub(next.paymentTotal))})</p>`
        : "";

    const paidRows = (schedule?.rows || []).filter((r) => r.isPaid).slice(-3);
    const upcoming = (schedule?.rows || []).filter((r) => !r.isPaid && r.paymentTotal > 0).slice(0, 3);
    const scheduleList = [...paidRows, ...upcoming]
      .map(
        (row) => `
        <div class="ledger-mortgage-schedule-row${row.isPaid ? " is-paid" : ""}">
          <span>${esc(formatDateRu(row.dueDate))}</span>
          <span>${esc(formatRub(row.paymentTotal))}</span>
          <span>${row.isPaid ? "✓" : ""}</span>
        </div>`
      )
      .join("");

    const paymentDetails = (progress.paymentDetails || [])
      .map(
        (row) => `
        <div class="ledger-mortgage-pay-row">
          <span>${esc(formatDateRu(row.txDate))}</span>
          <span>${esc(formatRub(row.transferred))}</span>
          <span class="ledger-mortgage-pay-row__applied">−${esc(formatRub(row.applied))}</span>
          ${Number(row.earlyExtra) > 0 ? `<span class="ledger-mortgage-pay-row__early">досрочно ${esc(formatRub(row.earlyExtra))}</span>` : ""}
          ${Number(row.surplus) > 0 ? `<span class="ledger-mortgage-pay-row__surplus">+${esc(formatRub(row.surplus))} счёт</span>` : ""}
        </div>`
      )
      .join("");

    els.apartmentMortgagePanel.innerHTML = `
      ${renderMortgageProgressBar(progress)}
      ${scheduleHint}
      ${
        paymentDetails
          ? `<div class="ledger-mortgage-section">
              <p class="section-counter">Фактические платежи</p>
              <p class="ledger-tech-meta">перевод · списано банком · остаток на счёте</p>
              <div class="ledger-mortgage-pay-list">${paymentDetails}</div>
            </div>`
          : ""
      }
      ${renderAncillaryBlock(progress)}
      <div class="ledger-mortgage-section">
        <p class="section-counter">Страховка по годам</p>
        ${renderInsuranceYoY(progress.insuranceByYear)}
      </div>
      ${
        scheduleList
          ? `<div class="ledger-mortgage-section">
              <p class="section-counter">График · оплачено ${schedule?.paidCount || 0}</p>
              <div class="ledger-mortgage-schedule">${scheduleList}</div>
            </div>`
          : ""
      }`;
  }

  function renderApartmentRepairPanel() {
    if (!els.apartmentRepairPanel) return;
    const asset = assetById(led.detailAssetId);
    if (!asset || asset.kind !== "apartment") return;

    const summary = led.detailSummaries.apartment;
    const allTime = summary?.allTimeTotals || {};
    const repair = Number(allTime.repair) || 0;
    const misc = Number(allTime.misc) || 0;
    const monthly = summary?.repairMonthly || [];
    const stats = summary?.repairStats || {};
    const year = led.detailYear;

    els.apartmentRepairPanel.innerHTML = `
      <div class="ledger-simple-total ledger-kpi-stack">
        ${renderApartmentKpiTile("Ремонт", repair, "finance-tile--repair")}
        ${renderApartmentKpiTile("Разное", misc, "finance-tile--cushion")}
        ${renderApartmentKpiTile("Всего", repair + misc, "finance-tile--violet")}
      </div>
      <p class="ledger-overview-year">${year}</p>
      ${renderRepairMonthlyBlock(monthly, stats, "ledgerRepairBars")}`;

    if (window.LifeCharts?.renderFinanceMonthlyBars) {
      window.LifeCharts.renderFinanceMonthlyBars(
        els.apartmentRepairPanel.querySelector("#ledgerRepairBars"),
        consumableMonthlyBars(monthly, year),
        monthShort,
        { barColor: "#e8a030", trendColor: "#e8a030", valueKey: "amount", ...ledgerMonthChartOpts(year) }
      );
    }
  }

  function renderApartmentKvartplataPanel() {
    if (!els.apartmentKvartplataPanel) return;
    const asset = assetById(led.detailAssetId);
    if (!asset || asset.kind !== "apartment") return;

    const summary = led.detailSummaries.apartment;
    const monthly = summary?.kvartplataMonthly || [];
    const stats = summary?.kvartplataStats || {};
    const year = led.detailYear;
    const allocations = (led.detailAllocations || []).filter((a) => a.bucket === "kvartplata");

    els.apartmentKvartplataPanel.innerHTML = `
      ${renderKvartMeterReminder("ledger-kvart-reminder")}
      <p class="ledger-overview-year">${year}</p>
      ${renderKvartplataBlock(monthly, stats, "ledgerKvartBars")}
      ${
        allocations.length
          ? `<div class="ledger-kvart-list">
              ${allocations
                .map(
                  (a) => `
                <div class="ledger-kvart-row">
                  <span>${esc(formatDateRu(a.txDate))}</span>
                  <span>${esc(a.label || "Кварплата")}</span>
                  <span>${esc(formatRub(a.amount))}</span>
                </div>`
                )
                .join("")}
            </div>`
          : ""
      }`;

    if (window.LifeCharts?.renderFinanceMonthlyBars) {
      window.LifeCharts.renderFinanceMonthlyBars(
        els.apartmentKvartplataPanel.querySelector("#ledgerKvartBars"),
        consumableMonthlyBars(monthly, year),
        monthShort,
        { barColor: "#1a9e96", trendColor: "#1a9e96", valueKey: "amount", ...ledgerMonthChartOpts(year) }
      );
    }
    bindKvartMeterReminder();
  }

  function renderCarOverview(asset) {
    const year = led.detailYear;
    const svc = led.detailSummaries.carService;
    const cons = led.detailSummaries.carConsumables;
    if (!svc?.ok && !cons?.ok) {
      if (els.overviewMetrics) {
        els.overviewMetrics.innerHTML = `<p class="ledger-fallback">Нет данных</p>`;
      }
      return;
    }
    const repairTotal = Number(svc?.overall?.total) || 0;
    const consumablesTotal = Number(cons?.yearStats?.total) || 0;
    const allTotal = repairTotal + consumablesTotal;
    const series = buildCarYearOverviewSeries();

    if (!els.overviewMetrics) return;

    els.overviewMetrics.innerHTML = `
      <p class="ledger-overview-year">${year}</p>
      <div class="ledger-metric-strip">
        <div class="ledger-metric">
          <p class="ledger-metric__label">Все траты</p>
          <p class="ledger-metric__val">${esc(formatRub(allTotal))}</p>
        </div>
        <div class="ledger-metric">
          <p class="ledger-metric__label">Расходники</p>
          <p class="ledger-metric__val">${esc(formatRub(consumablesTotal))}</p>
        </div>
        <div class="ledger-metric">
          <p class="ledger-metric__label">Ремонт</p>
          <p class="ledger-metric__val">${esc(formatRub(repairTotal))}</p>
        </div>
      </div>
      ${renderOverviewYoyLine(year, allTotal, series)}
      <div class="ledger-overview-years">
        <p class="ledger-overview-years__label">Траты по годам</p>
        <div class="finance-mini-bar finance-mini-bar--year" id="ledgerOverviewYearBars"></div>
        <div class="ledger-overview-years__legend">
          <span class="ledger-overview-years__legend-item">
            <span class="ledger-overview-years__dot ledger-overview-years__dot--cons"></span>Расходники
          </span>
          <span class="ledger-overview-years__legend-item">
            <span class="ledger-overview-years__dot ledger-overview-years__dot--repair"></span>Ремонт
          </span>
        </div>
      </div>`;

    if (window.LifeCharts?.renderLedgerCarYearStackedBars) {
      window.LifeCharts.renderLedgerCarYearStackedBars(
        els.overviewMetrics.querySelector("#ledgerOverviewYearBars"),
        series,
        { highlightYear: year }
      );
    }
  }

  function renderCarServicePanel() {
    if (!els.carServicePanel) return;
    const asset = assetById(led.detailAssetId);
    if (!asset || asset.kind !== "car") return;

    const year = led.carStatsYear || currentYear();
    const bundle = carStatsBundle(year);
    const svc = bundle?.service;
    const yearlySource =
      carStatsBundle(currentYear())?.service || led.detailSummaries.carService || svc;

    if (!svc?.ok && !yearlySource?.ok) {
      els.carServicePanel.innerHTML = `<p class="ledger-fallback">Нет данных</p>`;
      return;
    }

    els.carServicePanel.innerHTML = [
      `
      <div class="ledger-chart-card ledger-service-year">
        <p class="ledger-chart-card__label">Ремонт по годам</p>
        <div class="finance-mini-bar finance-mini-bar--year" id="ledgerCarRepairYearBars"></div>
      </div>`,
      svc?.ok
        ? wrapYearBlock(
            renderConsumableMetricBlock(
              "Итого сервис",
              year,
              svc.yearStats || svc.overall,
              "ledgerServiceTrend",
              "finance-tile--repair"
            ),
            year
          )
        : `<div class="finance-metric"><p class="ledger-fallback">Нет данных за ${year}</p></div>`,
      svc?.ok ? wrapYearBlock(renderServiceUnitsBlock(year, svc), year) : "",
    ].join("");

    const yearly = yearlySource?.yearlyTotals || [];
    if (window.LifeCharts?.renderLedgerYearBars) {
      window.LifeCharts.renderLedgerYearBars(
        els.carServicePanel.querySelector("#ledgerCarRepairYearBars"),
        yearly,
        { highlightYear: year, barColor: "#e8a030" }
      );
    }
    if (svc?.ok) {
      renderServiceTrendChart(
        els.carServicePanel.querySelector("#ledgerServiceTrend"),
        consumableMonthlyBars(svc.monthly, year),
        year
      );
    }
  }

  function maintProgress(item, currentKm) {
    const interval = Number(item?.intervalKm) || 0;
    const last = Number(item?.lastOdometerKm) || 0;
    const next = Number(item?.nextOdometerKm) || last + interval;
    const current = Number(currentKm);
    if (!interval || !Number.isFinite(current)) {
      return { pct: 0, status: "unknown", remaining: null };
    }
    const used = Math.max(0, current - last);
    const pct = Math.min(100, Math.round((used / interval) * 100));
    const remaining = next - current;
    let status = "ok";
    if (remaining <= 0) status = "due";
    else if (remaining < 2000) status = "soon";
    return { pct, status, remaining };
  }

  function addOwnershipYearPeriod(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return iso;
    return `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function techOdometerKm() {
    const input = els.carTechPanel?.querySelector("#ledgerTechOdometerInput");
    const fromInput = parseOdometerKm(input?.value);
    if (fromInput != null) return fromInput;
    const saved = led.detailTech?.asset?.currentOdometerKm;
    return saved != null ? Number(saved) : null;
  }

  function computeMileageChartRows(tech, currentKm) {
    const stored = tech?.mileageYearsStored || [];
    const rows = stored.map((y) => ({
      year: mileageYearLabel(y.periodEnd, y.yearIndex),
      total: Number(y.kmDriven) || 0,
    }));
    const purchaseKm = Number(tech?.asset?.purchaseOdometerKm);
    const purchaseDate = tech?.asset?.purchaseDate;
    if (!purchaseDate || !Number.isFinite(currentKm) || !Number.isFinite(purchaseKm)) {
      return rows;
    }
    let baseline = purchaseKm;
    for (const y of stored) baseline += Number(y.kmDriven) || 0;
    const lastEnd = stored.length ? stored[stored.length - 1].periodEnd : purchaseDate;
    const today = todayIso().slice(0, 10);
    // После последней закрытой годовщины — текущий (или ещё не сохранённый) год.
    if (today > String(lastEnd).slice(0, 10)) {
      const nextEnd = addOwnershipYearPeriod(lastEnd);
      rows.push({
        year: mileageYearLabel(nextEnd, stored.length + 1),
        total: Math.max(0, Math.round(currentKm) - baseline),
      });
    }
    return rows;
  }

  function kmTileValue(km) {
    return km != null && Number.isFinite(km) ? esc(formatKm(km).replace(" км", "")) : "—";
  }

  function renderTechMileageChart(currentKm) {
    const host = els.carTechPanel?.querySelector("#ledgerTechMileageBars");
    if (!host || !led.detailTech?.ok) return;
    const chartRows = computeMileageChartRows(led.detailTech, currentKm);
    if (window.LifeCharts?.renderLedgerYearBars) {
      window.LifeCharts.renderLedgerYearBars(host, chartRows, { barColor: "#3685bf" });
    }
  }

  function refreshTechOdometerUI() {
    if (!els.carTechPanel || !led.detailTech?.ok) return;
    const tech = led.detailTech;
    const currentKm = techOdometerKm();
    const purchaseKm = Number(tech.asset?.purchaseOdometerKm);
    const sincePurchase =
      purchaseKm != null && currentKm != null
        ? Math.max(0, currentKm - purchaseKm)
        : null;

    const nowEl = els.carTechPanel.querySelector("#ledgerTechTileNow");
    const sinceEl = els.carTechPanel.querySelector("#ledgerTechTileSince");
    if (nowEl) nowEl.textContent = kmTileValue(currentKm);
    if (sinceEl) sinceEl.textContent = kmTileValue(sincePurchase);

    const maintMap = Object.fromEntries((tech.maintenance || []).map((m) => [m.kind, m]));
    const maintItems = MAINT_KIND_ORDER.map((k) => maintMap[k]).filter(Boolean);
    const listEl = els.carTechPanel.querySelector("#ledgerTechMaintList");
    if (listEl) {
      listEl.innerHTML = maintItems.length
        ? maintItems.map((item) => renderMaintCard(item, currentKm)).join("")
        : `<p class="ledger-fallback">Интервалы масла не настроены</p>`;
    }

    renderTechMileageChart(currentKm);
  }

  function mileageYearLabel(periodEnd, yearIndex) {
    if (periodEnd) return String(periodEnd).slice(0, 4);
    return `Год ${yearIndex}`;
  }

  function renderMaintCard(item, currentKm) {
    const prog = maintProgress(item, currentKm);
    const color = MAINT_BAR_COLORS[item.kind] || "#e8a030";
    const remaining =
      prog.remaining != null
        ? prog.remaining <= 0
          ? `Пора менять · проехали на ${formatKm(Math.abs(prog.remaining))}`
          : `Осталось ${formatKm(prog.remaining)}`
        : "Укажите текущий пробег";
    return `
      <div class="ledger-tech-maint" data-tech-kind="${esc(item.kind)}">
        <div class="ledger-tech-maint__head">
          <span class="ledger-tech-maint__label">${esc(item.label)}</span>
          <span class="ledger-tech-maint__next">до ${esc(formatKm(item.nextOdometerKm))}</span>
        </div>
        <div class="ledger-tech-progress ledger-tech-progress--${esc(prog.status)}" aria-hidden="true">
          <div class="ledger-tech-progress__fill" style="width:${prog.pct}%;background:${color}"></div>
        </div>
        <p class="ledger-tech-maint__meta">
          Последняя · ${esc(formatKm(item.lastOdometerKm))}
          <span class="ledger-tech-maint__dot">·</span>
          интервал ${esc(formatKm(item.intervalKm))}
        </p>
        <p class="ledger-tech-maint__remain ledger-tech-maint__remain--${esc(prog.status)}">${esc(remaining)}</p>
        <button type="button" class="ledger-tech-maint__done" data-tech-done="${esc(item.kind)}">Замена сделана</button>
      </div>`;
  }

  function renderCarTechPanel(opts = {}) {
    if (!els.carTechPanel) return;
    const asset = assetById(led.detailAssetId);
    if (!asset || asset.kind !== "car") return;

    const tech = led.detailTech;
    if (!tech?.ok) {
      els.carTechPanel.innerHTML = `<p class="ledger-fallback">${esc(
        tech?.error || "Загрузка…"
      )}</p>`;
      return;
    }

    const a = tech.asset || {};
    const savedKm = a.currentOdometerKm;
    const purchaseKm = a.purchaseOdometerKm;
    const purchaseDate = a.purchaseDate;
    const maintMap = Object.fromEntries((tech.maintenance || []).map((m) => [m.kind, m]));
    const maintItems = MAINT_KIND_ORDER.map((k) => maintMap[k]).filter(Boolean);
    const currentKm = savedKm != null ? Number(savedKm) : null;

    const purchaseLine =
      purchaseKm != null
        ? `С покупки · ${formatKm(purchaseKm)}${purchaseDate ? ` · ${formatDateRu(purchaseDate)}` : ""}`
        : "Пробег при покупке не задан";

    const maintBlock = maintItems.length
      ? maintItems.map((item) => renderMaintCard(item, currentKm)).join("")
      : `<p class="ledger-fallback">Интервалы масла не настроены</p>`;

    els.carTechPanel.innerHTML = `
      <div class="finance-metric ledger-tech-block">
        <p class="section-counter">Масло</p>
        <div class="ledger-tech-maint-list" id="ledgerTechMaintList">${maintBlock}</div>
      </div>
      <div class="ledger-chart-card ledger-tech-mileage-card">
        <p class="ledger-chart-card__label">Пробег за год владения</p>
        <p class="ledger-tech-meta">Годовщина покупки · км за период</p>
        <div class="finance-mini-bar finance-mini-bar--year" id="ledgerTechMileageBars"></div>
      </div>
      <div class="finance-metric ledger-tech-block">
        <p class="section-counter">Пробег</p>
        <p class="ledger-tech-meta">${esc(purchaseLine)}</p>
        <div class="finance-tiles ledger-tech-summary">
          <div class="finance-tile finance-tile--blue">
            <span>Сейчас</span>
            <strong id="ledgerTechTileNow">${kmTileValue(currentKm)}</strong>
          </div>
          <div class="finance-tile finance-tile--violet">
            <span>С покупки</span>
            <strong id="ledgerTechTileSince">${kmTileValue(
              purchaseKm != null && currentKm != null ? Math.max(0, currentKm - purchaseKm) : null
            )}</strong>
          </div>
        </div>
        <label class="field-label ledger-tech-odometer-label">Сейчас на спидометре, км
          <input class="field-input field-input--numeric" id="ledgerTechOdometerInput" type="text" inputmode="numeric" dir="ltr" autocomplete="off" value="${currentKm != null ? esc(String(currentKm)) : ""}" placeholder="например 292353" />
        </label>
        <button type="button" class="cta-btn cta-btn--inline ledger-tech-odometer-save${opts.odometerSaved ? " is-success" : ""}" id="ledgerTechOdometerSave"${opts.odometerSaved ? " disabled" : ""}>${opts.odometerSaved ? "Успешно сохранено ✓" : "Сохранить пробег"}</button>
      </div>`;

    renderTechMileageChart(currentKm);
    bindCarTechPanelEvents();
    if (opts.odometerSaved) {
      const savedBtn = els.carTechPanel.querySelector("#ledgerTechOdometerSave");
      if (savedBtn) {
        setTimeout(() => {
          if (!savedBtn.isConnected) return;
          savedBtn.disabled = false;
          savedBtn.classList.remove("is-success");
          savedBtn.textContent = "Сохранить пробег";
        }, 2200);
      }
    }
  }

  async function refreshCarTech() {
    const asset = assetById(led.detailAssetId);
    if (!asset || asset.kind !== "car") return;
    led.detailTech = await api.apiGet("/ledger/car/tech", { assetId: asset.id });
    renderCarTechPanel();
  }

  function bindCarTechPanelEvents() {
    if (!els.carTechPanel) return;
    if (!els.carTechPanel.dataset.techBound) {
      els.carTechPanel.dataset.techBound = "1";
      els.carTechPanel.addEventListener("click", (e) => {
        const doneBtn = e.target.closest("[data-tech-done]");
        if (doneBtn) {
          markMaintenanceDone(doneBtn.dataset.techDone).catch((err) =>
            alert(String(err.message || err))
          );
          return;
        }
        if (e.target.id === "ledgerTechOdometerSave" || e.target.closest("#ledgerTechOdometerSave")) {
          saveTechOdometer().catch((err) => alert(String(err.message || err)));
        }
      });
      els.carTechPanel.addEventListener("input", (e) => {
        if (e.target.id === "ledgerTechOdometerInput") {
          refreshTechOdometerUI();
        }
      });
    }
  }

  async function saveTechOdometer() {
    const asset = assetById(led.detailAssetId);
    if (!asset) return;
    const btn = els.carTechPanel?.querySelector("#ledgerTechOdometerSave");
    const km = parseOdometerKm(els.carTechPanel?.querySelector("#ledgerTechOdometerInput")?.value);
    if (km == null) {
      alert("Укажите пробег в километрах");
      return;
    }
    if (!api.apiPatchJson) throw new Error("PATCH недоступен");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Сохранение…";
    }
    try {
      led.detailTech = await api.apiPatchJson(`/ledger/car/tech/odometer?assetId=${asset.id}`, {
        currentOdometerKm: km,
      });
      const idx = led.assets.findIndex((a) => a.id === asset.id);
      if (idx >= 0 && led.detailTech?.asset) {
        led.assets[idx] = { ...led.assets[idx], ...led.detailTech.asset };
      }
      // Успех сразу в разметке: полный re-render раньше затирал «Сохранено» на кнопке.
      renderCarTechPanel({ odometerSaved: true });
    } catch (err) {
      if (btn?.isConnected) {
        btn.disabled = false;
        btn.classList.remove("is-success");
        btn.textContent = "Сохранить пробег";
      }
      throw err;
    }
  }

  async function markMaintenanceDone(kind) {
    const asset = assetById(led.detailAssetId);
    if (!asset || !kind) return;
    const km = techOdometerKm();
    if (!Number.isFinite(km) || km < 0) {
      alert("Сначала укажите текущий пробег");
      return;
    }
    const item = (led.detailTech?.maintenance || []).find((m) => m.kind === kind);
    if (!item) return;
    if (!api.apiPutJson) throw new Error("PUT недоступен");
    led.detailTech = await api.apiPutJson(`/ledger/car/tech/maintenance?assetId=${asset.id}`, {
      kind,
      lastOdometerKm: Math.round(km),
      intervalKm: item.intervalKm,
      currentOdometerKm: Math.round(km),
    });
    const input = els.carTechPanel?.querySelector("#ledgerTechOdometerInput");
    if (input) input.value = String(Math.round(km));
    const idx = led.assets.findIndex((a) => a.id === asset.id);
    if (idx >= 0 && led.detailTech?.asset) {
      led.assets[idx] = { ...led.assets[idx], ...led.detailTech.asset };
    }
    renderCarTechPanel();
  }

  function renderServiceTrendChart(host, monthly, year) {
    if (!host || !window.LifeCharts?.renderFinanceMonthlyBars) return;
    window.LifeCharts.renderFinanceMonthlyBars(host, monthly, monthShort, {
      barColor: "#e8a030",
      trendColor: "#e8a030",
      ...ledgerMonthChartOpts(year),
    });
  }

  function renderServiceUnitsBlock(year, svc) {
    const byUnit = svc.byUnit || svc.bySubBucket || {};
    const units = SERVICE_UNIT_ORDER.map((key) => ({
      key,
      label: SERVICE_UNIT_LABELS[key] || key,
      total: Number(byUnit[key]?.total) || 0,
    })).filter((u) => u.total > 0);
    const unitTotal = units.reduce((s, u) => s + u.total, 0);

    const byPurpose = svc.byPurposeGroup || svc.byPurpose || {};
    const purposeOrder = ["repair", "service", "misc"];
    const purposeTotal = purposeOrder.reduce(
      (s, key) => s + (Number(byPurpose[key]?.total) || 0),
      0
    );
    const purposeLine = purposeOrder
      .filter((key) => Number(byPurpose[key]?.total) > 0)
      .map(
        (key) =>
          `${SERVICE_PURPOSE_LABELS[key]} ${sharePct(Number(byPurpose[key]?.total) || 0, purposeTotal)}%`
      )
      .join(" · ");

    return `
      <div class="finance-metric ledger-service-units">
        <p class="section-counter">На что ушло · ${year}</p>
        <p class="ledger-road-block__sub">Доля в сервисных тратах · ${esc(formatRub(unitTotal))} за год</p>
        ${renderShareBar(
          units.map((u) => ({ mod: u.key, val: u.total })),
          unitTotal,
          "ledger-service-share"
        )}
        <div class="ledger-service-legend">
          ${units
            .map((u) => renderShareLegendRow(u.label, u.total, unitTotal, u.key, "ledger-service-legend"))
            .join("")}
        </div>
        ${
          purposeLine
            ? `<p class="ledger-service-type">Тип: ${esc(purposeLine)}</p>`
            : ""
        }
      </div>`;
  }

  function monthShort(ym) {
    const m = Number(ym?.slice(5, 7)) - 1;
    return monthNamesShort[m] || ym?.slice(5, 7) || "";
  }

  function monthsThroughForYear(year) {
    const y = Number(year) || currentYear();
    const now = new Date(todayIso() + "T12:00:00");
    const curY = now.getFullYear();
    if (y < curY) return 12;
    if (y > curY) return 0;
    return now.getMonth() + 1;
  }

  function padMonthlyThroughCurrent(rows, year) {
    const endMonth = monthsThroughForYear(year);
    if (!endMonth) return rows || [];
    const byYm = new Map();
    (rows || []).forEach((r) => {
      const ym = r.yearMonth || r.month;
      if (ym) byYm.set(ym, r);
    });
    const y = Number(year) || currentYear();
    const out = [];
    for (let m = 1; m <= endMonth; m++) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      const row = byYm.get(ym);
      out.push(row ? { ...row, yearMonth: ym } : { yearMonth: ym, total: 0 });
    }
    return out;
  }

  function consumableMonthlyBars(rows, year) {
    return padMonthlyThroughCurrent(rows, year).map((m) => ({
      month: m.yearMonth,
      amount: m.total,
    }));
  }

  function ledgerMonthChartOpts(year, extra = {}) {
    const y = Number(year) || currentYear();
    const cur = currentMonthKey();
    if (cur.startsWith(`${y}-`)) {
      return { ...extra, highlightMonth: cur };
    }
    return extra;
  }

  function consumableSubKpi(subBucket, allocations) {
    const items = (allocations || []).filter(
      (a) => a.bucket === "consumables" && a.subBucket === subBucket
    );
    if (!items.length) return { total: 0, count: 0, max: 0 };
    const amounts = items.map((a) => Number(a.amount) || 0);
    return {
      total: amounts.reduce((s, n) => s + n, 0),
      count: items.length,
      max: Math.max(...amounts),
    };
  }

  function sharePct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  function renderShareBar(segments, total, classPrefix) {
    if (!total) {
      return `<div class="${classPrefix} ${classPrefix}--empty"><span class="ledger-fallback">Нет данных</span></div>`;
    }
    const visible = segments.filter((s) => s.val > 0);
    return `
      <div class="${classPrefix}">
        ${visible
          .map(
            (s) =>
              `<div class="${classPrefix}__seg ${classPrefix}__seg--${s.mod}" style="width:${Math.max(sharePct(s.val, total), 4)}%"></div>`
          )
          .join("")}
      </div>`;
  }

  function renderShareLegendRow(label, amount, total, mod, classPrefix) {
    const p = sharePct(amount, total);
    return `
      <div class="${classPrefix}__row">
        <span class="${classPrefix}__dot ${classPrefix}__dot--${mod}"></span>
        <span class="${classPrefix}__label">${esc(label)}</span>
        <span class="${classPrefix}__pct">${p}%</span>
        <span class="${classPrefix}__sum">${esc(formatRub(amount))}</span>
      </div>`;
  }

  function renderRoadShareBar(fuel, tolls, fines, total) {
    return renderShareBar(
      [
        { mod: "fuel", val: fuel },
        { mod: "tolls", val: tolls },
        { mod: "fines", val: fines },
      ],
      total,
      "ledger-road-share"
    );
  }

  function renderRoadLegendRow(label, amount, total, mod) {
    return renderShareLegendRow(label, amount, total, mod, "ledger-road-legend");
  }

  function renderIrregularKpiTiles(stats, tileClass) {
    return `
      <div class="finance-tiles finance-tiles--triple">
        <div class="finance-tile ${tileClass}">
          <span>Всего</span>
          <strong>${esc(formatRub(stats.total))}</strong>
        </div>
        <div class="finance-tile ${tileClass}">
          <span>Платежей</span>
          <strong>${esc(String(stats.count))}</strong>
        </div>
        <div class="finance-tile ${tileClass}">
          <span>Крупнейший</span>
          <strong>${esc(formatRub(stats.max))}</strong>
        </div>
      </div>`;
  }

  function renderConsumableMetricBlock(title, year, stats, chartId, tileClass) {
    const avg = stats?.avg ?? 0;
    const med = stats?.median ?? 0;
    const tile = tileClass || "finance-tile--green";
    return `
      <div class="finance-metric">
        <p class="section-counter">${esc(title)} · ${year}</p>
        <div class="finance-tiles">
          <div class="finance-tile ${tile}">
            <span>Среднее</span>
            <strong>${esc(formatRub(avg))}</strong>
          </div>
          <div class="finance-tile ${tile}">
            <span>Медиана</span>
            <strong>${esc(formatRub(med))}</strong>
          </div>
        </div>
        <div class="finance-mini-bar" id="${chartId}"></div>
      </div>`;
  }

  function renderRoadBlock(year, cons, allocations) {
    const fuelStats = cons.bySubBucket?.fuel?.yearStats || {};
    const tollsStats = cons.bySubBucket?.tolls?.yearStats || {};
    const finesStats = cons.bySubBucket?.fines?.yearStats || {};
    const fuelTotal = Number(fuelStats.total) || 0;
    const tollsTotal = Number(tollsStats.total) || 0;
    const finesTotal = Number(finesStats.total) || 0;
    const roadTotal = fuelTotal + tollsTotal + finesTotal;
    const tollsKpi = consumableSubKpi("tolls", allocations);
    const finesKpi = consumableSubKpi("fines", allocations);
    const fuelAvg = fuelStats.avg ?? 0;
    const fuelMed = fuelStats.median ?? 0;

    return `
      <div class="finance-metric ledger-road-block">
        <p class="section-counter">Дорога · ${year}</p>
        <p class="ledger-road-block__sub">Доля в дорожных тратах · ${esc(formatRub(roadTotal))} за год</p>
        ${renderRoadShareBar(fuelTotal, tollsTotal, finesTotal, roadTotal)}
        <div class="ledger-road-legend">
          ${renderRoadLegendRow("Топливо", fuelTotal, roadTotal, "fuel")}
          ${renderRoadLegendRow("Платные дороги", tollsTotal, roadTotal, "tolls")}
          ${renderRoadLegendRow("Штрафы", finesTotal, roadTotal, "fines")}
        </div>
        <div class="ledger-road-divider"></div>
        <div class="ledger-road-sub">
          <p class="section-counter ledger-road-sub__label">Топливо</p>
          <div class="finance-tiles">
            <div class="finance-tile finance-tile--fuel">
              <span>Среднее</span>
              <strong>${esc(formatRub(fuelAvg))}</strong>
            </div>
            <div class="finance-tile finance-tile--fuel">
              <span>Медиана</span>
              <strong>${esc(formatRub(fuelMed))}</strong>
            </div>
          </div>
          <div class="finance-mini-bar" id="ledgerFuelTrend"></div>
        </div>
        <div class="ledger-road-divider"></div>
        <div class="ledger-road-sub">
          <p class="section-counter ledger-road-sub__label">Платные дороги</p>
          ${renderIrregularKpiTiles(tollsKpi, "finance-tile--blue")}
        </div>
        <div class="ledger-road-divider"></div>
        <div class="ledger-road-sub">
          <p class="section-counter ledger-road-sub__label">Транспортный налог по годам</p>
          <div class="finance-mini-bar finance-mini-bar--year" id="ledgerTransportTaxYearBars"></div>
        </div>
        <div class="ledger-road-divider"></div>
        <div class="ledger-road-sub">
          <p class="section-counter ledger-road-sub__label">Штрафы</p>
          ${renderIrregularKpiTiles(finesKpi, "finance-tile--fine")}
        </div>
      </div>`;
  }

  function renderConsumableTrendChart(host, monthly, mode, year) {
    if (!host || !window.LifeCharts?.renderFinanceMonthlyBars) return;
    const color =
      mode === "fuel" ? "#c45c1a" : mode === "transport_tax" ? "#2a9d8f" : "#1f8a65";
    const opts = { barColor: color, trendColor: color, ...ledgerMonthChartOpts(year) };
    window.LifeCharts.renderFinanceMonthlyBars(host, monthly, monthShort, opts);
  }

  function renderTransportTaxYearChart(host, yearly) {
    if (!host || !window.LifeCharts?.renderLedgerYearBars) return;
    const rows = (yearly || []).map((y) => ({
      year: Number(y.year) || 0,
      total: Number(y.total) || 0,
    }));
    window.LifeCharts.renderLedgerYearBars(host, rows, { barColor: "#2a9d8f" });
  }

  function renderCarConsumablesPanel() {
    if (!els.carConsumablesPanel) return;
    const asset = assetById(led.detailAssetId);
    if (!asset || asset.kind !== "car") return;

    const year = led.carStatsYear || currentYear();
    const bundle = carStatsBundle(year);
    const cons = bundle?.consumables;

    if (!cons?.ok) {
      els.carConsumablesPanel.innerHTML = `<p class="ledger-fallback">${
        bundle ? `Нет данных за ${year}` : "Загрузка…"
      }</p>`;
      return;
    }

    const fuel = cons.bySubBucket?.fuel || { monthly: [] };
    const allocations = bundle.allocations || [];

    els.carConsumablesPanel.innerHTML = [
      wrapYearBlock(renderRoadBlock(year, cons, allocations), year),
      wrapYearBlock(
        renderConsumableMetricBlock(
          "Итого расходники",
          year,
          cons.yearStats,
          "ledgerConsumablesTrend",
          "finance-tile--green"
        ),
        year
      ),
    ].join("");

    renderConsumableTrendChart(
      els.carConsumablesPanel.querySelector("#ledgerFuelTrend"),
      consumableMonthlyBars(fuel.monthly, year),
      "fuel",
      year
    );
    renderTransportTaxYearChart(
      els.carConsumablesPanel.querySelector("#ledgerTransportTaxYearBars"),
      cons.transportTaxYearly || []
    );
    renderConsumableTrendChart(
      els.carConsumablesPanel.querySelector("#ledgerConsumablesTrend"),
      consumableMonthlyBars(cons.monthly, year),
      "total",
      year
    );
  }

  function renderInboxList() {
    if (!els.inboxList) return;
    const items = led.inboxItems || [];
    if (!items.length) {
      els.inboxList.innerHTML = `<p class="ledger-fallback">Всё распределено</p>`;
      return;
    }
    els.inboxList.innerHTML = items
      .map((item, idx) => {
        const tx = item.transaction || {};
        const cat = txCategoryName(tx);
        const mortgageHint =
          item.suggestedMortgageKind && item.suggestedBucket === "mortgage"
            ? MORTGAGE_ALLOC_KIND_LABELS[item.suggestedMortgageKind] || item.suggestedMortgageKind
            : "";
        const hintParts = [];
        if (item.suggestedAsset?.name) {
          hintParts.push(
            `${item.suggestedAsset.name} → ${bucketLabel(item.suggestedAsset, item.suggestedBucket || "…")}`
          );
        }
        if (mortgageHint) hintParts.push(mortgageHint);
        const hint = hintParts.length ? `подсказка: ${hintParts.join(" · ")}` : "";
        const partial =
          Number(item.allocatedSum) > 0
            ? `распределено: ${formatRub(item.allocatedSum)} · осталось: ${formatRub(item.remainingSum)}`
            : `осталось: ${formatRub(item.remainingSum)}`;
        return `
        <div class="ledger-inbox-row">
          <button type="button" class="ledger-inbox-row__main" data-inbox-idx="${idx}">
            <p class="ledger-inbox-row__title">${esc(formatTxDate(tx.txDate, tx))} · ${esc(cat)} · ${esc(formatRub(tx.amount))}</p>
            <p class="ledger-inbox-row__sub">${esc(partial)}</p>
            ${hint ? `<p class="ledger-inbox-row__hint">${esc(hint)}</p>` : ""}
          </button>
          <button type="button" class="ledger-inbox-row__dismiss" data-inbox-dismiss="${tx.id}" aria-label="Убрать из inbox">×</button>
        </div>`;
      })
      .join("");

    els.inboxList.querySelectorAll("[data-inbox-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openAllocSheet(led.inboxItems[Number(btn.dataset.inboxIdx)]);
      });
    });
    els.inboxList.querySelectorAll("[data-inbox-dismiss]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        dismissInboxItem(Number(btn.dataset.inboxDismiss)).catch((err) => {
          alert(err.message || String(err));
        });
      });
    });
  }

  async function dismissInboxItem(txnId) {
    if (!txnId) return;
    const result = await api.apiPostJson("/ledger/inbox/dismiss", { financeTransactionId: txnId });
    if (!result?.ok) throw new Error(result?.error || "Не удалось убрать");
    led.inboxItems = (led.inboxItems || []).filter((i) => i.transaction?.id !== txnId);
    renderInboxList();
    if (led.homeData?.ok) renderHomeWidget();
    await loadHome({ fresh: true });
  }

  function syncLedgerAddCarBtn() {
    if (!els.addCarBtn) return;
    const asset = assetById(led.detailAssetId);
    const show = led.appScreen === "detailLedger" && asset?.kind === "car";
    setElHidden(els.addCarBtn, !show);
  }

  function renderDetail() {
    renderAssetNav();
    normalizeDetailTab();
    renderLedgerTabs();
    syncLedgerAddCarBtn();
    renderOverview();
    renderApartmentMortgagePanel();
    renderApartmentRepairPanel();
    renderApartmentKvartplataPanel();
    renderCarConsumablesPanel();
    renderCarServicePanel();
    renderCarTechPanel();
    renderInboxList();
    syncLedgerPanelsForAsset();
    setLedgerTabUI(led.detailTab);
  }

  async function fetchDetailData(asset) {
    const year = led.detailYear;
    const summaries = {};
    let allocations = [];

    if (asset.kind === "apartment") {
      const [summary, allocData, schedule] = await Promise.all([
        api.apiGet("/ledger/apartment/summary", { assetId: asset.id, year }),
        api.apiGet("/ledger/allocations", { assetId: asset.id, year }),
        api.apiGet("/ledger/mortgage/schedule", { assetId: asset.id }),
      ]);
      summaries.apartment = summary;
      led.detailMortgageSchedule = schedule?.ok ? schedule : null;
      allocations = allocData?.allocations || [];
    } else {
      led.detailMortgageSchedule = null;
      led.carStatsCache = {};
      led.carStatsYear = currentYear();
      const [svc, cons, allocData, loanCfg, tech] = await Promise.all([
        api.apiGet("/ledger/car/service/summary", { assetId: asset.id, year }),
        api.apiGet("/ledger/car/consumables", { assetId: asset.id, year }),
        api.apiGet("/ledger/allocations", { assetId: asset.id, year }),
        api.apiGet("/ledger/loan/config", { assetId: asset.id }),
        api.apiGet("/ledger/car/tech", { assetId: asset.id }),
      ]);
      summaries.carService = svc;
      summaries.carConsumables = cons;
      summaries.loanConfig = loanCfg;
      led.detailTech = tech;
      allocations = allocData?.allocations || [];
      await fetchCarStatsYears(asset);
    }

    led.detailSummaries = summaries;
    led.detailAllocations = allocations;
  }

  async function refreshDetail() {
    if (!led.assets.length) {
      const data = await api.apiGet("/ledger/assets");
      if (!data?.ok) throw new Error(data?.error || "Нет объектов");
      led.assets = data.assets || [];
    }
    if (!led.detailAssetId && led.assets.length) {
      led.detailAssetId = led.assets[0].id;
    }
    const asset = assetById(led.detailAssetId);
    if (!asset) throw new Error("Объект не найден");

    const inbox = await api.apiGet("/ledger/inbox");
    if (inbox?.ok) led.inboxItems = inbox.items || [];

    await fetchDetailData(asset);
    renderDetail();
  }

  function openDetail(tab) {
    const targetTab = tab || "overview";
    led.detailTab = targetTab;
    led.pendingDetailTab = targetTab !== "overview" ? targetTab : null;
    led.detailYear = currentYear();
    led.carStatsYear = currentYear();
    if (!led.detailAssetId && led.assets.length) {
      led.detailAssetId = led.assets[0].id;
    }
    setScreen("detailLedger");
    window.scrollTo({ top: 0 });
    if (els.overviewApartment) setElHidden(els.overviewApartment, true);
    if (els.overviewCar) setElHidden(els.overviewCar, true);
    if (els.apartmentOverview) els.apartmentOverview.innerHTML = `<p class="ledger-fallback">Загрузка…</p>`;
    if (els.overviewMetrics) els.overviewMetrics.innerHTML = "";
    refreshDetail()
      .then(() => {
        if (!led.pendingDetailTab) return;
        led.detailTab = led.pendingDetailTab;
        normalizeDetailTab();
        renderLedgerTabs();
        syncLedgerPanelsForAsset();
        setLedgerTabUI(led.detailTab);
        const scrollTab = led.detailTab;
        led.pendingDetailTab = null;
        if (scrollTab !== "overview") {
          requestAnimationFrame(() => scrollToLedgerSection(scrollTab));
        }
      })
      .catch((err) => {
        led.pendingDetailTab = null;
        if (els.apartmentOverview) {
          els.apartmentOverview.innerHTML = `<p class="ledger-fallback">${esc(String(err.message || err))}</p>`;
        }
      });
  }

  function openInbox(tab) {
    if (inboxCount() === 0) return;
    openDetail(tab || "inbox");
  }

  function closeAllocSheet() {
    if (els.allocSheet) els.allocSheet.hidden = true;
    led.allocItem = null;
  }

  function closeAddCarSheet() {
    if (els.addCarSheet) els.addCarSheet.hidden = true;
  }

  function openAddCarSheet() {
    if (!els.addCarSheet) return;
    if (els.addCarName) els.addCarName.value = "";
    els.addCarSheet.hidden = false;
    window.LifeInputKeyboards?.sync?.(els.addCarSheet);
    els.addCarName?.focus();
  }

  async function saveNewCar() {
    const name = String(els.addCarName?.value || "").trim();
    if (!name) {
      alert("Укажите название");
      return;
    }
    const slug = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9а-яё-]/gi, "")
      .slice(0, 40);
    const result = await api.apiPostJson("/ledger/assets", {
      kind: "car",
      name,
      slug: slug || undefined,
    });
    if (!result?.ok) throw new Error(result?.error || "Не удалось добавить");

    closeAddCarSheet();
    led.assets = [];
    led.detailAssetId = result.asset?.id || null;
    led.detailTab = "overview";
    await refreshDetail();
  }

  function fillSelectOptions(selectEl, options, selected) {
    if (!selectEl) return;
    const pick = selected && options.some((o) => o.value === selected) ? selected : "";
    selectEl.innerHTML = [
      !pick ? '<option value="" disabled selected>Выберите</option>' : "",
      ...options.map(
        (o) =>
          `<option value="${esc(o.value)}"${o.value === pick ? " selected" : ""}>${esc(o.label)}</option>`
      ),
    ].join("");
  }

  function allocAssetSelected() {
    return assetById(Number(els.allocAsset?.value));
  }

  function guessCarAllocation(text) {
    const t = String(text || "").toLowerCase();
    if (/транспортн\w*\s*налог|налог\s*на\s*транспорт/.test(t) || (/налог/.test(t) && /транспорт|авто|машин/.test(t))) {
      return { bucket: "consumables", subBucket: "transport_tax" };
    }
    if (/штраф/.test(t)) return { bucket: "consumables", subBucket: "fines" };
    if (/платн|дорог|транспондер|м\s*11|м-11|м12/.test(t)) {
      return { bucket: "consumables", subBucket: "tolls" };
    }
    if (/парков/.test(t)) return { bucket: "consumables", subBucket: "parking" };
    if (/мойк/.test(t)) return { bucket: "consumables", subBucket: "wash" };
    if (/топлив|заправ|азс|бензин|дизел|газпром|лукойл|rosneft|shell/.test(t)) {
      return { bucket: "consumables", subBucket: "fuel" };
    }
    if (/то\b|техобсл|фильтр|расходник/.test(t)) {
      return { bucket: "service", subBucket: "maintenance", purpose: "service" };
    }
    if (/мотор|двигат|колен|грм|turbo|турб/.test(t)) {
      return { bucket: "service", subBucket: "motor", purpose: "repair" };
    }
    if (/ходов|подвеск|амортиз|тормоз|коробк|transmission|шрус|рулев/.test(t)) {
      return { bucket: "service", subBucket: "chassis", purpose: "repair" };
    }
    if (/кузов|бампер|крыл|локер|краск|lcp|стекл/.test(t)) {
      return { bucket: "service", subBucket: "body", purpose: "repair" };
    }
    if (/ремонт|сервис|запчаст|детал/.test(t)) {
      return { bucket: "service", subBucket: "general", purpose: "repair" };
    }
    return { bucket: "consumables", subBucket: "fuel" };
  }

  function fillConsumableSubSelect(selected) {
    fillSelectOptions(
      els.allocConsumableSub,
      CONSUMABLE_SUB_ORDER.map((value) => ({ value, label: CONSUMABLE_SUB_LABELS[value] || value })),
      selected
    );
  }

  function fillServiceSubSelects(selectedUnit, selectedPurpose) {
    fillSelectOptions(
      els.allocServiceUnit,
      SERVICE_UNIT_ORDER.map((value) => ({ value, label: SERVICE_UNIT_LABELS[value] || value })),
      selectedUnit
    );
    fillSelectOptions(
      els.allocServicePurpose,
      SERVICE_PURPOSE_ORDER.map((value) => ({ value, label: SERVICE_PURPOSE_LABELS[value] || value })),
      selectedPurpose
    );
  }

  function guessApartmentMortgageAllocation(text, amount) {
    const t = String(text || "").toLowerCase();
    if (/страх/.test(t)) return { mortgageKind: "insurance" };
    if (/бронь/.test(t)) return { mortgageKind: "booking" };
    if (/домклик/.test(t)) return { mortgageKind: "domclick" };
    if (/взнос/.test(t)) return { mortgageKind: "down_payment" };
    const n = Number(amount) || 0;
    if (n >= 60000 && n <= 70000) return { mortgageKind: "payment" };
    return { mortgageKind: "payment" };
  }

  function fillMortgageKindSelect(selected) {
    fillSelectOptions(
      els.allocMortgageKind,
      MORTGAGE_ALLOC_KINDS.map((k) => ({ value: k.value, label: k.label })),
      selected
    );
  }

  function syncAllocMortgageFields(mortgageHint) {
    const asset = allocAssetSelected();
    const bucket = els.allocBucket?.value || "";
    const show = asset?.kind === "apartment" && bucket === "mortgage";
    setElHidden(els.allocMortgageFields, !show);
    if (!show) return;
    const kind =
      mortgageHint?.mortgageKind || els.allocMortgageKind?.value || itemMortgageKind(led.allocItem) || "payment";
    fillMortgageKindSelect(kind);
  }

  function itemMortgageKind(item) {
    return item?.suggestedMortgageKind || null;
  }

  function syncAllocCarFields(carHint) {
    const asset = allocAssetSelected();
    const bucket = els.allocBucket?.value || "";
    const isCar = asset?.kind === "car";
    const isConsumables = isCar && bucket === "consumables";
    const isService = isCar && bucket === "service";

    setElHidden(els.allocCarFields, !isConsumables && !isService);
    setElHidden(els.allocConsumableFields, !isConsumables);
    setElHidden(els.allocServiceFields, !isService);

    if (isConsumables) {
      fillConsumableSubSelect((carHint || {}).subBucket || "");
      return;
    }
    if (isService) {
      fillServiceSubSelects((carHint || {}).subBucket || "", (carHint || {}).purpose || "repair");
    }
  }

  function syncAllocExtraFields(hint) {
    syncAllocCarFields(hint?.car || hint);
    syncAllocMortgageFields(hint?.mortgage || hint);
  }

  function fillBucketSelect(asset, selected, fieldHint) {
    if (!els.allocBucket) return;
    const buckets = bucketsForAsset(asset);
    const pick = selected && buckets.some((b) => b.value === selected) ? selected : "";
    els.allocBucket.innerHTML = [
      !pick ? '<option value="" disabled selected>Выберите раздел</option>' : "",
      ...buckets.map(
        (b) =>
          `<option value="${esc(b.value)}"${b.value === pick ? " selected" : ""}>${esc(b.label)}</option>`
      ),
    ].join("");
    syncAllocExtraFields(fieldHint);
  }

  function openAllocSheet(item) {
    if (!item || !els.allocSheet) return;
    led.allocItem = item;
    const tx = item.transaction || {};
    const asset = item.suggestedAsset || led.assets[0];
    let bucket = item.suggestedBucket || "";
    let carHint = null;
    let mortgageHint = null;

    if (asset?.kind === "car" || item.suggestedAsset?.kind === "car") {
      const noteText = [tx.note, tx.incomeNote, led.allocItem?.label].filter(Boolean).join(" ");
      carHint = guessCarAllocation(noteText);
      if (item.suggestedSubBucket) {
        carHint = {
          ...(carHint || {}),
          bucket: item.suggestedBucket || carHint?.bucket || "consumables",
          subBucket: item.suggestedSubBucket,
        };
        if (item.suggestedPurpose) carHint.purpose = item.suggestedPurpose;
      }
      if (!bucket && carHint.bucket) bucket = carHint.bucket;
    }

    if (asset?.kind === "apartment" || item.suggestedAsset?.kind === "apartment") {
      const noteText = [tx.note, tx.incomeNote].filter(Boolean).join(" ");
      mortgageHint = guessApartmentMortgageAllocation(noteText, tx.amount);
      if (item.suggestedMortgageKind) {
        mortgageHint = { ...mortgageHint, mortgageKind: item.suggestedMortgageKind };
      }
      if (!bucket && item.suggestedBucket) bucket = item.suggestedBucket;
    }

    if (els.allocTitle) els.allocTitle.textContent = "Распределить";
    if (els.allocMeta) {
      els.allocMeta.textContent = `${formatRub(tx.amount)} · ${txCategoryName(tx)} · ${formatTxDate(tx.txDate, tx)}`;
    }
    if (els.allocAsset) {
      els.allocAsset.innerHTML = led.assets
        .map(
          (a) =>
            `<option value="${a.id}"${a.id === asset?.id ? " selected" : ""}>${esc(a.name)}</option>`
        )
        .join("");
    }
    fillBucketSelect(asset || led.assets[0], bucket, { car: carHint, mortgage: mortgageHint });
    if (els.allocAmount) els.allocAmount.value = String(Math.round(Number(item.remainingSum) || 0));
    if (els.allocLabel) {
      const noteHint = String(tx.incomeNote || tx.note || "").trim();
      els.allocLabel.value =
        carHint?.subBucket === "transport_tax" && noteHint ? noteHint : "";
    }
    els.allocSheet.hidden = false;
    window.LifeInputKeyboards?.sync?.(els.allocSheet);
  }

  async function saveAllocation() {
    if (!led.allocItem) return;
    const tx = led.allocItem.transaction || {};
    const asset = allocAssetSelected();
    const assetId = Number(els.allocAsset?.value);
    const bucket = els.allocBucket?.value;
    const amountRaw = String(els.allocAmount?.value || "").replace(/\s/g, "").replace(",", ".");
    const amount = Number(amountRaw);
    const label = String(els.allocLabel?.value || "").trim() || null;

    if (!assetId || !bucket || !Number.isFinite(amount) || amount <= 0) {
      alert("Выберите объект, раздел и сумму");
      return;
    }

    const body = {
      financeTransactionId: tx.id,
      assetId,
      bucket,
      amount,
      txDate: tx.txDate,
      label,
    };

    if (asset?.kind === "car") {
      if (bucket === "consumables") {
        const subBucket = els.allocConsumableSub?.value;
        if (!subBucket) {
          alert("Выберите тип расходника");
          return;
        }
        body.subBucket = subBucket;
        if (subBucket === "transport_tax") {
          const noteText = [tx.note, tx.incomeNote, label].filter(Boolean).join(" ");
          const yearMatch = String(noteText).match(/за\s*(20\d{2})/i);
          const payYear = Number(String(tx.txDate || "").slice(0, 4));
          const taxYear = yearMatch
            ? Number(yearMatch[1])
            : Number.isFinite(payYear) && payYear > 2000
              ? payYear - 1
              : null;
          if (taxYear) {
            body.purpose = String(taxYear);
            if (!label) body.label = `Транспортный налог за ${taxYear}`;
          }
        }
      } else if (bucket === "service") {
        const subBucket = els.allocServiceUnit?.value;
        const purpose = els.allocServicePurpose?.value;
        if (!subBucket || !purpose) {
          alert("Выберите узел и тип работ");
          return;
        }
        body.subBucket = subBucket;
        body.purpose = purpose;
      }
    }

    if (asset?.kind === "apartment" && bucket === "mortgage") {
      const mortgageKind = els.allocMortgageKind?.value;
      if (!mortgageKind) {
        alert("Выберите тип платежа по ипотеке");
        return;
      }
      if (label) body.label = label;
      else delete body.label;
      body.mortgageKind = mortgageKind;
    }

    const result = await api.apiPostJson("/ledger/allocations", body);
    if (!result?.ok) throw new Error(result?.error || "Не удалось сохранить");

    closeAllocSheet();
    await loadHome({ fresh: true });
    if (led.appScreen === "detailLedger") {
      await refreshDetail();
    }
  }

  function onScreenChange(screen, ctx = {}) {
    led.appScreen = screen;
    const isHome = screen === "home";
    const isLedger = screen === "detailLedger";
    setElHidden(els.flow, !isLedger);
    if (!els.zone) return;
    if (isHome) {
      if (led.homeData?.ok) renderHomeWidget();
    } else if (!isLedger) {
      setElHidden(els.zone, true);
    }
    if (isLedger && !led.pendingDetailTab) {
      requestAnimationFrame(() => updateLedgerTabFromScroll());
    }
  }

  function navigateBack() {
    if (els.addCarSheet && !els.addCarSheet.hidden) {
      closeAddCarSheet();
      return true;
    }
    if (els.allocSheet && !els.allocSheet.hidden) {
      closeAllocSheet();
      return true;
    }
    if (led.appScreen === "detailLedger") {
      setScreen("home");
      return true;
    }
    return false;
  }

  function bindEls() {
    els.zone = $("ledgerZoneBtn");
    els.zoneOpen = $("ledgerZoneOpenBtn");
    els.balanceLabel = $("ledgerBalanceLabel");
    els.balanceValue = $("ledgerBalanceValue");
    els.balanceToggle = $("ledgerBalanceToggle");
    els.reminderDivider = $("ledgerReminderDivider");
    els.remindersContainer = $("ledgerRemindersContainer");
    els.inboxDivider = $("ledgerInboxDivider");
    els.inboxRow = $("ledgerInboxRow");
    els.inboxText = $("ledgerInboxText");
    els.assetRows = $("ledgerAssetRows");
    els.ctaDivider = $("ledgerCtaDivider");
    els.ctaWrap = $("ledgerCtaWrap");
    els.allocateBtn = $("ledgerAllocateBtn");
    els.flow = $("flowDetailLedger");
    els.assetNav = $("ledgerAssetNav");
    els.tabs = $("ledgerTabs");
    els.addCarBtn = $("ledgerAddCarBtn");
    els.addCarSheet = $("ledgerAddCarSheet");
    els.overviewApartment = $("ledgerOverviewApartment");
    els.apartmentOverview = $("ledgerApartmentOverview");
    els.overviewCar = $("ledgerOverviewCar");
    els.overviewMetrics = $("ledgerOverviewMetrics");
    els.apartmentMortgagePanel = $("ledgerApartmentMortgagePanel");
    els.apartmentRepairPanel = $("ledgerApartmentRepairPanel");
    els.apartmentKvartplataPanel = $("ledgerApartmentKvartplataPanel");
    els.carServicePanel = $("ledgerCarServicePanel");
    els.carConsumablesPanel = $("ledgerCarConsumablesPanel");
    els.carTechPanel = $("ledgerCarTechPanel");
    els.inboxList = $("ledgerInboxList");
    els.allocSheet = $("ledgerAllocSheet");
    els.addCarBackdrop = $("ledgerAddCarBackdrop");
    els.addCarClose = $("ledgerAddCarClose");
    els.addCarName = $("ledgerAddCarName");
    els.addCarSave = $("ledgerAddCarSave");
    els.allocBackdrop = $("ledgerAllocBackdrop");
    els.allocClose = $("ledgerAllocClose");
    els.allocTitle = $("ledgerAllocTitle");
    els.allocMeta = $("ledgerAllocMeta");
    els.allocAsset = $("ledgerAllocAsset");
    els.allocBucket = $("ledgerAllocBucket");
    els.allocMortgageFields = $("ledgerAllocMortgageFields");
    els.allocMortgageKind = $("ledgerAllocMortgageKind");
    els.allocCarFields = $("ledgerAllocCarFields");
    els.allocConsumableFields = $("ledgerAllocConsumableFields");
    els.allocConsumableSub = $("ledgerAllocConsumableSub");
    els.allocServiceFields = $("ledgerAllocServiceFields");
    els.allocServiceUnit = $("ledgerAllocServiceUnit");
    els.allocServicePurpose = $("ledgerAllocServicePurpose");
    els.allocAmount = $("ledgerAllocAmount");
    els.allocLabel = $("ledgerAllocLabel");
    els.allocSave = $("ledgerAllocSave");
  }

  function bindEvents() {
    els.zoneOpen?.addEventListener("click", () => openDetail("overview"));
    els.balanceToggle?.addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.target.closest("[data-ledger-balance-mode]");
      const mode = btn?.dataset.ledgerBalanceMode;
      if (!mode || mode === led.balanceMode) return;
      led.balanceMode = mode;
      saveBalanceMode(led.balanceMode);
      loadHome().catch(() => {});
    });
    els.inboxRow?.addEventListener("click", (e) => {
      e.stopPropagation();
      openInbox("inbox");
    });
    els.allocateBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      openInbox("inbox");
    });
    els.addCarBtn?.addEventListener("click", () => openAddCarSheet());
    els.addCarBackdrop?.addEventListener("click", closeAddCarSheet);
    els.addCarClose?.addEventListener("click", closeAddCarSheet);
    els.addCarSave?.addEventListener("click", () => {
      saveNewCar().catch((err) => alert(String(err.message || err)));
    });
    els.tabs?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ledger-tab]");
      if (!btn || !els.tabs.contains(btn)) return;
      const tab = btn.dataset.ledgerTab;
      if (tab) switchLedgerTab(tab);
    });
    els.allocBackdrop?.addEventListener("click", closeAllocSheet);
    els.allocClose?.addEventListener("click", closeAllocSheet);
    els.allocAsset?.addEventListener("change", () => {
      const asset = assetById(Number(els.allocAsset.value));
      if (asset) fillBucketSelect(asset, "", null);
    });
    els.allocAsset?.addEventListener("change", () => syncAllocExtraFields(null));
    els.allocBucket?.addEventListener("change", () => syncAllocExtraFields(null));
    els.allocBucket?.addEventListener("input", () => syncAllocExtraFields(null));
    els.allocMortgageKind?.addEventListener("change", () => {
      syncAllocExtraFields(null);
    });
    els.allocSave?.addEventListener("click", () => {
      saveAllocation().catch((err) => alert(String(err.message || err)));
    });
  }

  function init(deps) {
    api = deps;
    api.apiPatchJson = deps.apiPatchJson;
    api.apiPutJson = deps.apiPutJson;
    esc = deps.escapeHtml || esc;
    todayIso = deps.todayIso || todayIso;
    setElHidden = deps.setElHidden || setElHidden;
    setScreen = deps.setScreen || setScreen;
    monthNames = deps.monthNames || [];
    monthNamesShort = deps.monthNamesShort || [];
    led.balanceMode = readBalanceMode();
    led.detailYear = currentYear();
    bindEls();
    bindEvents();
    bindLedgerYearSwipe();
    bindLedgerScrollSpy();
  }

  async function onFinanceChange() {
    await loadHome({ fresh: true });
    if (led.appScreen === "detailLedger") {
      await refreshDetail();
    }
  }

  window.LifeLedger = {
    init,
    loadHome,
    onFinanceChange,
    renderHome: renderHomeWidget,
    onScreenChange,
    navigateBack,
    isLedgerScreen: (s) => s === "detailLedger",
    isBlockingOverlayOpen: () =>
      !!(
        (els.allocSheet && !els.allocSheet.hidden) ||
        (els.addCarSheet && !els.addCarSheet.hidden)
      ),
  };
})();
