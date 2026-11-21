/**
 * Дневник — home-виджет, flowDiary (календарь), flowDiaryEditor.
 * API: GET/POST/DELETE /diary/*
 */
(function () {
  const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  /** «Что было важным …» — в/во + вин. п. по Date.getDay() (0=вс). */
  const WEEKDAY_IN = [
    "в воскресенье",
    "в понедельник",
    "во вторник",
    "в среду",
    "в четверг",
    "в пятницу",
    "в субботу",
  ];
  /** Obsidian Calendar — подписи как в плагине (EN). */
  const WEEKDAYS_OBS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const MONTH_SHORT_EN = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const MONTH_NAMES_RU = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];
  const MONTH_NAMES_GEN = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];

  const STORAGE_PREFIX = "diary_";
  const WIKI_LINKS_KEY = "lifeDashboard.diaryWikiLinks";
  const HASHTAGS_KEY = "lifeDashboard.diaryHashtags";
  const WIKI_LINKS_MAX = 80;
  const HASHTAGS_MAX = 120;
  /** Держим в предложке, если встречались в дневнике за это окно. Архивной таблицы нет — дальше удаляем. */
  const SUGGEST_KEEP_DAYS = 40;
  const SAVE_DELAY = 300;
  const SUCCESS_DURATION = 1500;

  /** Вариант home-виджета: 'a' или 'b'. */
  const diaryHomeVariant =
    new URLSearchParams(location.search).get("diaryHome") || "a";

  let setElHidden = (el, v) => { if (el) el.hidden = v; };
  let setScreen = () => {};
  let apiGet = async () => ({ ok: false });
  let apiPostJson = async () => ({ ok: false });
  let apiDelete = async () => ({ ok: false });

  const monthCaches = new Map();

  /** Состояние модуля. */
  const diary = {
    calYear: 0,
    calMonth: 0,
    selectedDateIso: "",
    editorDateIso: "",
    editorHasEntry: false,
    editorBackScreen: "diaryCalendar",
    saveTimer: null,
  };

  // ─── DOM refs ─────────────────────────────────────────────────────────────

  let diaryZoneBtn, diaryZoneA, diaryZoneB,
    diaryZonePreview, diaryZoneTodayStatus, diaryZoneStatus,
    diaryZoneCalBtn, diaryZoneFillBtnA, diaryZoneFillBtnB, diaryZoneCalBtnB,
    diaryCalPrev, diaryCalNext, diaryCalMonthShort, diaryCalYear, diaryCalWrap,
    diaryEditorTextarea, diaryEditorSaveBtn, diaryCtaBar,
    diaryDeleteBtn, diaryDeleteConfirm, diaryDeleteBackdrop,
    diaryDeleteNo, diaryDeleteYes,
    flowDiary, flowDiaryEditor, diaryWikiSuggest;

  function bindEls() {
    diaryZoneBtn       = document.getElementById("diaryZoneBtn");
    diaryZoneA         = document.getElementById("diaryZoneA");
    diaryZoneB         = document.getElementById("diaryZoneB");
    diaryZonePreview   = document.getElementById("diaryZonePreview");
    diaryZoneTodayStatus = document.getElementById("diaryZoneTodayStatus");
    diaryZoneStatus    = document.getElementById("diaryZoneStatus");
    diaryZoneCalBtn    = document.getElementById("diaryZoneCalBtn");
    diaryZoneFillBtnA  = document.getElementById("diaryZoneFillBtnA");
    diaryZoneFillBtnB  = document.getElementById("diaryZoneFillBtnB");
    diaryZoneCalBtnB   = document.getElementById("diaryZoneCalBtnB");
    diaryCalPrev       = document.getElementById("diaryCalPrev");
    diaryCalNext       = document.getElementById("diaryCalNext");
    diaryCalMonthShort = document.getElementById("diaryCalMonthShort");
    diaryCalYear       = document.getElementById("diaryCalYear");
    diaryCalWrap       = document.getElementById("diaryCalWrap");
    diaryEditorTextarea = document.getElementById("diaryEditorTextarea");
    diaryEditorSaveBtn  = document.getElementById("diaryEditorSaveBtn");
    diaryCtaBar         = document.getElementById("diaryCtaBar");
    diaryDeleteBtn      = document.getElementById("diaryDeleteBtn");
    diaryDeleteConfirm  = document.getElementById("diaryDeleteConfirm");
    diaryDeleteBackdrop = document.getElementById("diaryDeleteBackdrop");
    diaryDeleteNo       = document.getElementById("diaryDeleteNo");
    diaryDeleteYes      = document.getElementById("diaryDeleteYes");
    flowDiary           = document.getElementById("flowDiary");
    flowDiaryEditor     = document.getElementById("flowDiaryEditor");
    diaryWikiSuggest    = document.getElementById("diaryWikiSuggest");
  }

  function bindEvents() {
    // Variant A: head → calendar, CTA → editor today
    if (diaryZoneCalBtn)   diaryZoneCalBtn.addEventListener("click", openCalendarFromHome);
    if (diaryZoneFillBtnA) diaryZoneFillBtnA.addEventListener("click", openEditorFromHome);

    // Variant B: body → editor today, chevron → calendar
    if (diaryZoneFillBtnB) diaryZoneFillBtnB.addEventListener("click", openEditorFromHome);
    if (diaryZoneCalBtnB)  diaryZoneCalBtnB.addEventListener("click", openCalendarFromHome);

    // Calendar navigation
    if (diaryCalPrev) diaryCalPrev.addEventListener("click", () => {
      diary.calMonth -= 1;
      if (diary.calMonth < 0) { diary.calMonth = 11; diary.calYear -= 1; }
      renderCalendar().catch((err) => console.error(err));
    });
    if (diaryCalNext) diaryCalNext.addEventListener("click", () => {
      diary.calMonth += 1;
      if (diary.calMonth > 11) { diary.calMonth = 0; diary.calYear += 1; }
      renderCalendar().catch((err) => console.error(err));
    });
    // Editor save / delete
    if (diaryEditorSaveBtn) diaryEditorSaveBtn.addEventListener("click", saveEntry);
    if (diaryDeleteBtn) diaryDeleteBtn.addEventListener("click", openDeleteConfirm);
    if (diaryDeleteBackdrop) diaryDeleteBackdrop.addEventListener("click", closeDeleteConfirm);
    if (diaryDeleteNo) diaryDeleteNo.addEventListener("click", closeDeleteConfirm);
    if (diaryDeleteYes) diaryDeleteYes.addEventListener("click", () => {
      deleteEntry().catch((err) => {
        console.error(err);
        closeDeleteConfirm();
      });
    });
  }

  // ─── Редактор: [[…]], #теги, () ─────────────────────────────────────────

  let wikiBracketStart = -1;
  let hashtagStart = -1;
  let suggestMode = null; // "wiki" | "hashtag" | null
  const HAS_BEFORE_INPUT =
    typeof InputEvent !== "undefined" && "inputType" in InputEvent.prototype;
  const HASHTAG_RE = /#([^\s#.,;:!?)\[\]{}<>"']+)/g;

  function isoDateOnly(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function suggestCutoffIso() {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (SUGGEST_KEEP_DAYS - 1));
    return isoDateOnly(d);
  }

  function normalizeSuggestEntries(raw) {
    if (!Array.isArray(raw)) return [];
    const fallback = isoDateOnly(new Date());
    const out = [];
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) {
        // Старый формат (массив строк) — даём окно с сегодняшнего дня.
        out.push({ t: item.trim(), u: fallback });
        continue;
      }
      if (item && typeof item === "object") {
        const text = String(item.t || item.text || "").trim();
        if (!text) continue;
        const uRaw = String(item.u || item.lastUsed || "").trim();
        const u = /^\d{4}-\d{2}-\d{2}$/.test(uRaw) ? uRaw : fallback;
        out.push({ t: text, u });
      }
    }
    return out;
  }

  function pruneSuggestEntries(entries) {
    const cutoff = suggestCutoffIso();
    return entries.filter((e) => e.u >= cutoff);
  }

  function sortSuggestEntries(entries) {
    return [...entries].sort((a, b) => {
      if (a.u !== b.u) return b.u.localeCompare(a.u);
      return a.t.localeCompare(b.t, "ru");
    });
  }

  function loadSuggestEntries(key) {
    try {
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      const normalized = normalizeSuggestEntries(arr);
      const active = pruneSuggestEntries(normalized);
      if (active.length !== normalized.length || (Array.isArray(arr) && arr.some((x) => typeof x === "string"))) {
        saveSuggestEntries(key, active, key === HASHTAGS_KEY ? HASHTAGS_MAX : WIKI_LINKS_MAX);
      }
      return sortSuggestEntries(active);
    } catch {
      return [];
    }
  }

  function saveSuggestEntries(key, entries, max) {
    try {
      const active = sortSuggestEntries(pruneSuggestEntries(entries)).slice(0, max);
      localStorage.setItem(key, JSON.stringify(active));
    } catch {
      /* ignore */
    }
  }

  function suggestLabels(entries) {
    return entries.map((e) => e.t);
  }

  function mergeSuggestUsage(entries, labels, usedOnIso) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(usedOnIso || "")
      ? usedOnIso
      : isoDateOnly(new Date());
    const byKey = new Map();
    for (const e of entries) {
      byKey.set(e.t.toLowerCase(), { t: e.t, u: e.u });
    }
    for (const label of labels) {
      const text = String(label || "").trim();
      if (!text) continue;
      const key = text.toLowerCase();
      const prev = byKey.get(key);
      if (!prev || day >= prev.u) {
        byKey.set(key, { t: text, u: day });
      }
    }
    return sortSuggestEntries([...byKey.values()]);
  }

  function replaceSuggestHistory(key, apiItems, max) {
    const mapped = normalizeSuggestEntries(
      (apiItems || []).map((item) => ({
        t: item.text || item.t,
        u: item.lastUsed || item.u,
      }))
    );
    saveSuggestEntries(key, mapped, max);
  }

  async function refreshSuggestHistoryFromApi() {
    try {
      const data = await apiGet("/diary/suggest-tokens", { days: SUGGEST_KEEP_DAYS });
      if (!data?.ok) return;
      replaceSuggestHistory(WIKI_LINKS_KEY, data.wikiLinks || [], WIKI_LINKS_MAX);
      replaceSuggestHistory(HASHTAGS_KEY, data.hashtags || [], HASHTAGS_MAX);
    } catch (err) {
      console.warn("diary suggest-tokens", err);
    }
  }

  function loadWikiLinkHistory() {
    return suggestLabels(loadSuggestEntries(WIKI_LINKS_KEY));
  }

  function loadHashtagHistory() {
    return suggestLabels(loadSuggestEntries(HASHTAGS_KEY));
  }

  function extractWikiLinks(text) {
    if (!text) return [];
    const out = [];
    const re = /\[\[([^\]|#^]+)\]\]/g;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > 0 && text[m.index - 1] === "!") continue;
      const label = m[1].trim();
      if (label) out.push(label);
    }
    return out;
  }

  function rememberWikiLinksFromText(text, usedOnIso) {
    const found = extractWikiLinks(text);
    if (!found.length) return;
    const next = mergeSuggestUsage(loadSuggestEntries(WIKI_LINKS_KEY), found, usedOnIso);
    saveSuggestEntries(WIKI_LINKS_KEY, next, WIKI_LINKS_MAX);
  }

  function extractHashtags(text) {
    if (!text) return [];
    const out = [];
    const re = new RegExp(HASHTAG_RE.source, "g");
    let m;
    while ((m = re.exec(text))) {
      if (m.index > 0 && text[m.index - 1] === "#") continue;
      const tag = m[1].trim();
      if (tag) out.push(tag);
    }
    return out;
  }

  function rememberHashtagsFromText(text, usedOnIso) {
    const found = extractHashtags(text);
    if (!found.length) return;
    const next = mergeSuggestUsage(loadSuggestEntries(HASHTAGS_KEY), found, usedOnIso);
    saveSuggestEntries(HASHTAGS_KEY, next, HASHTAGS_MAX);
  }

  function rememberEditorTokensFromText(text, usedOnIso) {
    const day = usedOnIso || diary.editorDateIso || isoDateOnly(new Date());
    rememberWikiLinksFromText(text, day);
    rememberHashtagsFromText(text, day);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function findOpenWikiLink(ta) {
    if (!ta) return null;
    const pos = ta.selectionStart;
    const text = ta.value;
    const before = text.slice(0, pos);
    const openIdx = before.lastIndexOf("[[");
    if (openIdx < 0) return null;
    if (before.indexOf("]]", openIdx) >= 0) return null;
    if (openIdx > 0 && text[openIdx - 1] === "!") return null;
    return { start: openIdx, partial: before.slice(openIdx + 2) };
  }

  function findOpenHashtag(ta) {
    if (!ta) return null;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const hashIdx = before.lastIndexOf("#");
    if (hashIdx < 0) return null;
    if (hashIdx > 0 && before[hashIdx - 1] === "#") return null;
    const partial = before.slice(hashIdx + 1);
    if (/\s/.test(partial)) return null;
    return { start: hashIdx, partial };
  }

  function hideEditorSuggest() {
    suggestMode = null;
    wikiBracketStart = -1;
    hashtagStart = -1;
    if (!diaryWikiSuggest) return;
    diaryWikiSuggest.hidden = true;
    diaryWikiSuggest.innerHTML = "";
  }

  function hideWikiSuggest() {
    hideEditorSuggest();
  }

  function renderSuggestList(items, mode, onPick) {
    if (!diaryWikiSuggest) return;
    if (!items.length) {
      hideEditorSuggest();
      return;
    }
    suggestMode = mode;
    diaryWikiSuggest.hidden = false;
    diaryWikiSuggest.setAttribute(
      "aria-label",
      mode === "hashtag" ? "Недавние хештеги" : "Недавние ссылки"
    );
    diaryWikiSuggest.innerHTML = items
      .slice(0, 12)
      .map((label) => {
        const text = mode === "hashtag" ? `#${label}` : label;
        return `<button type="button" class="diary-wiki-suggest__item" role="option">${escapeHtml(text)}</button>`;
      })
      .join("");
    diaryWikiSuggest.querySelectorAll(".diary-wiki-suggest__item").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => onPick(btn.textContent));
    });
  }

  function showWikiSuggest(filter = "") {
    const q = filter.trim().toLowerCase();
    const history = loadWikiLinkHistory();
    const items = q
      ? history.filter((s) => s.toLowerCase().includes(q))
      : history;
    renderSuggestList(items, "wiki", applyWikiSuggestion);
  }

  function showHashtagSuggest(filter = "") {
    const q = filter.trim().toLowerCase();
    const history = loadHashtagHistory();
    const items = q
      ? history.filter((s) => s.toLowerCase().includes(q))
      : history;
    renderSuggestList(items, "hashtag", applyHashtagSuggestion);
  }

  function wikiLinkReplaceRange(text, openStart, cursor) {
    const closeIdx = text.indexOf("]]", openStart + 2);
    if (closeIdx >= 0) {
      return { start: openStart, end: closeIdx + 2 };
    }
    return { start: openStart, end: cursor };
  }

  function applyHashtagSuggestion(rawLabel) {
    const ta = diaryEditorTextarea;
    if (!ta || !rawLabel) return;
    const label = String(rawLabel).replace(/^#+/, "").trim();
    if (!label) return;
    const info = findOpenHashtag(ta);
    const start = info ? info.start : hashtagStart >= 0 ? hashtagStart : ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const insert = `#${label}`;
    ta.value = before + insert + after;
    const pos = start + insert.length;
    ta.setSelectionRange(pos, pos);
    hideEditorSuggest();
    rememberEditorTokensFromText(ta.value);
    updateDeleteBtn();
  }

  function applyWikiSuggestion(label) {
    const ta = diaryEditorTextarea;
    if (!ta || !label) return;
    const info = findOpenWikiLink(ta);
    const start = info ? info.start : wikiBracketStart >= 0 ? wikiBracketStart : ta.selectionStart;
    const { end } = wikiLinkReplaceRange(ta.value, start, ta.selectionEnd);
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const insert = `[[${label}]]`;
    ta.value = before + insert + after;
    const pos = start + insert.length;
    ta.setSelectionRange(pos, pos);
    hideEditorSuggest();
    rememberEditorTokensFromText(ta.value);
    updateDeleteBtn();
  }

  function insertParenthesisPair() {
    const ta = diaryEditorTextarea;
    if (!ta || flowDiaryEditor?.hidden) return false;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);

    if (start !== end) {
      const selected = ta.value.slice(start, end);
      ta.value = before + `(${selected})` + after;
      ta.setSelectionRange(start + 1, start + 1 + selected.length);
      updateDeleteBtn();
      return true;
    }

    ta.value = before + "()" + after;
    ta.setSelectionRange(start + 1, start + 1);
    updateDeleteBtn();
    return true;
  }

  function insertQuotePair() {
    const ta = diaryEditorTextarea;
    if (!ta || flowDiaryEditor?.hidden) return false;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);

    if (start !== end) {
      const selected = ta.value.slice(start, end);
      ta.value = before + `"${selected}"` + after;
      ta.setSelectionRange(start + 1, start + 1 + selected.length);
      updateDeleteBtn();
      return true;
    }

    ta.value = before + "\"\"" + after;
    ta.setSelectionRange(start + 1, start + 1);
    updateDeleteBtn();
    return true;
  }

  function insertStarPair() {
    const ta = diaryEditorTextarea;
    if (!ta || flowDiaryEditor?.hidden) return false;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);

    if (start !== end) {
      const selected = ta.value.slice(start, end);
      ta.value = before + `**${selected}**` + after;
      ta.setSelectionRange(start + 2, start + 2 + selected.length);
      updateDeleteBtn();
      return true;
    }

    ta.value = before + "****" + after;
    ta.setSelectionRange(start + 2, start + 2);
    updateDeleteBtn();
    return true;
  }

  function indentSelectionWithTab() {
    const ta = diaryEditorTextarea;
    if (!ta || flowDiaryEditor?.hidden) return false;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = ta.value;
    const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIdx = text.indexOf("\n", end);
    const lineEnd = lineEndIdx >= 0 ? lineEndIdx : text.length;

    let blockStart = lineStart;
    let blockEnd = lineEnd;
    if (start === end) {
      while (blockStart > 0) {
        const prevBreak = text.lastIndexOf("\n", Math.max(0, blockStart - 2));
        const prevStart = prevBreak + 1;
        const prevLine = text.slice(prevStart, blockStart - 1);
        if (!prevLine.trim()) break;
        blockStart = prevStart;
      }
      while (blockEnd < text.length) {
        const nextStart = blockEnd + 1;
        const nextBreak = text.indexOf("\n", nextStart);
        const nextEnd = nextBreak >= 0 ? nextBreak : text.length;
        const nextLine = text.slice(nextStart, nextEnd);
        if (!nextLine.trim()) break;
        blockEnd = nextEnd;
        if (nextBreak < 0) break;
      }
    }

    const block = text.slice(blockStart, blockEnd);
    const lines = block.split("\n");
    const indented = lines.map((line) => `\t${line}`).join("\n");
    ta.value = text.slice(0, blockStart) + indented + text.slice(blockEnd);
    ta.setSelectionRange(blockStart, blockStart + indented.length);
    updateDeleteBtn();
    return true;
  }

  function outdentSelectionTab() {
    const ta = diaryEditorTextarea;
    if (!ta || flowDiaryEditor?.hidden) return false;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = ta.value;
    const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIdx = text.indexOf("\n", end);
    const lineEnd = lineEndIdx >= 0 ? lineEndIdx : text.length;

    let blockStart = lineStart;
    let blockEnd = lineEnd;
    if (start === end) {
      while (blockStart > 0) {
        const prevBreak = text.lastIndexOf("\n", Math.max(0, blockStart - 2));
        const prevStart = prevBreak + 1;
        const prevLine = text.slice(prevStart, blockStart - 1);
        if (!prevLine.trim()) break;
        blockStart = prevStart;
      }
      while (blockEnd < text.length) {
        const nextStart = blockEnd + 1;
        const nextBreak = text.indexOf("\n", nextStart);
        const nextEnd = nextBreak >= 0 ? nextBreak : text.length;
        const nextLine = text.slice(nextStart, nextEnd);
        if (!nextLine.trim()) break;
        blockEnd = nextEnd;
        if (nextBreak < 0) break;
      }
    }

    const block = text.slice(blockStart, blockEnd);
    const lines = block.split("\n");
    let removed = 0;
    const outdented = lines
      .map((line) => {
        if (line.startsWith("\t")) {
          removed += 1;
          return line.slice(1);
        }
        if (line.startsWith("    ")) {
          removed += 4;
          return line.slice(4);
        }
        return line;
      })
      .join("\n");
    ta.value = text.slice(0, blockStart) + outdented + text.slice(blockEnd);
    if (start === end) {
      const cursor = Math.max(blockStart, start - (removed > 0 ? 1 : 0));
      ta.setSelectionRange(cursor, cursor);
    } else {
      const anchorShift = text.slice(lineStart, start).startsWith("\t") ? 1 : 0;
      const newStart = Math.max(blockStart, start - anchorShift);
      ta.setSelectionRange(newStart, blockStart + outdented.length);
    }
    updateDeleteBtn();
    return true;
  }

  function insertWikiOpenBracket() {
    const ta = diaryEditorTextarea;
    if (!ta || flowDiaryEditor?.hidden) return false;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const prev = before.slice(-1);

    if (prev === "[") return false;

    if (start !== end) {
      const selected = ta.value.slice(start, end);
      ta.value = before + `[[${selected}]]` + after;
      wikiBracketStart = start;
      ta.setSelectionRange(start + selected.length + 4, start + selected.length + 4);
      hideEditorSuggest();
      rememberEditorTokensFromText(ta.value);
      updateDeleteBtn();
      return true;
    }

    ta.value = before + "[[]]" + after;
    wikiBracketStart = start;
    ta.setSelectionRange(start + 2, start + 2);
    showWikiSuggest("");
    updateDeleteBtn();
    return true;
  }

  function onEditorBeforeInput(e) {
    if (tryDeleteAutoPair(e)) return;
    if (e.inputType !== "insertText" || !e.data) return;
    if (e.data === "[") {
      if (insertWikiOpenBracket()) e.preventDefault();
      return;
    }
    if (e.data === "(") {
      if (insertParenthesisPair()) e.preventDefault();
      return;
    }
    if (e.data === "\"") {
      if (insertQuotePair()) e.preventDefault();
      return;
    }
    if (e.data === "*") {
      if (insertStarPair()) e.preventDefault();
    }
  }

  function onEditorInput() {
    const ta = diaryEditorTextarea;
    const wiki = findOpenWikiLink(ta);
    if (wiki) {
      showWikiSuggest(wiki.partial);
      return;
    }
    const tag = findOpenHashtag(ta);
    if (tag) {
      hashtagStart = tag.start;
      showHashtagSuggest(tag.partial);
      return;
    }
    hideEditorSuggest();
  }

  function tryDeleteAutoPair(e) {
    const ta = diaryEditorTextarea;
    if (!ta || flowDiaryEditor?.hidden) return false;
    if (ta.selectionStart !== ta.selectionEnd) return false;
    const pos = ta.selectionStart;
    const text = ta.value;
    const isBackward =
      e.inputType === "deleteContentBackward" || e.key === "Backspace";
    const isForward =
      e.inputType === "deleteContentForward" || e.key === "Delete";
    if (!isBackward && !isForward) return false;

    if (text.slice(Math.max(0, pos - 1), pos) === "(" && text.slice(pos, pos + 1) === ")") {
      ta.value = text.slice(0, pos - 1) + text.slice(pos + 1);
      ta.setSelectionRange(pos - 1, pos - 1);
      hideEditorSuggest();
      updateDeleteBtn();
      e.preventDefault();
      return true;
    }

    if (text.slice(Math.max(0, pos - 2), pos) === "**" && text.slice(pos, pos + 2) === "**") {
      ta.value = text.slice(0, pos - 2) + text.slice(pos + 2);
      ta.setSelectionRange(pos - 2, pos - 2);
      hideEditorSuggest();
      updateDeleteBtn();
      e.preventDefault();
      return true;
    }

    if (text.slice(Math.max(0, pos - 1), pos) === "*" && text.slice(pos, pos + 1) === "*") {
      ta.value = text.slice(0, pos - 1) + text.slice(pos + 1);
      ta.setSelectionRange(pos - 1, pos - 1);
      hideEditorSuggest();
      updateDeleteBtn();
      e.preventDefault();
      return true;
    }

    if (text.slice(Math.max(0, pos - 1), pos) === "\"" && text.slice(pos, pos + 1) === "\"") {
      ta.value = text.slice(0, pos - 1) + text.slice(pos + 1);
      ta.setSelectionRange(pos - 1, pos - 1);
      hideEditorSuggest();
      updateDeleteBtn();
      e.preventDefault();
      return true;
    }

    if (text.slice(Math.max(0, pos - 2), pos) === "[[" && text.slice(pos, pos + 2) === "]]") {
      ta.value = text.slice(0, pos - 2) + text.slice(pos + 2);
      ta.setSelectionRange(pos - 2, pos - 2);
      hideEditorSuggest();
      updateDeleteBtn();
      e.preventDefault();
      return true;
    }

    return false;
  }

  function onEditorKeyDown(e) {
    if (tryDeleteAutoPair(e)) return;
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) outdentSelectionTab();
      else indentSelectionWithTab();
      return;
    }
    if (e.key === "Escape") {
      hideEditorSuggest();
      return;
    }
    if (HAS_BEFORE_INPUT) return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "[") {
      if (insertWikiOpenBracket()) e.preventDefault();
      return;
    }
    if (e.key === "(") {
      if (insertParenthesisPair()) e.preventDefault();
      return;
    }
    if (e.key === "\"") {
      if (insertQuotePair()) e.preventDefault();
      return;
    }
    if (e.key === "*") {
      if (insertStarPair()) e.preventDefault();
    }
  }

  function bindWikiEditor() {
    if (!diaryEditorTextarea) return;
    if (HAS_BEFORE_INPUT) {
      diaryEditorTextarea.addEventListener("beforeinput", onEditorBeforeInput);
    }
    diaryEditorTextarea.addEventListener("keydown", onEditorKeyDown);
    diaryEditorTextarea.addEventListener("blur", () => {
      setTimeout(hideEditorSuggest, 180);
    });
  }

  // ─── API / cache ──────────────────────────────────────────────────────────

  function storageKey(iso) {
    return STORAGE_PREFIX + iso;
  }

  function clearLegacyLocal(iso) {
    localStorage.removeItem(storageKey(iso));
  }

  function isFilledDate(iso) {
    return monthCaches.get(iso.slice(0, 7))?.has(iso) ?? false;
  }

  function monthKeyFromParts(year, monthIndex) {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  }

  function adjacentMonthKeys(year, monthIndex) {
    const keys = [monthKeyFromParts(year, monthIndex)];
    if (monthIndex === 0) keys.push(`${year - 1}-12`);
    else keys.push(monthKeyFromParts(year, monthIndex - 1));
    if (monthIndex === 11) keys.push(`${year + 1}-01`);
    else keys.push(monthKeyFromParts(year, monthIndex + 1));
    return keys;
  }

  function monthKeysBetween(startIso, endIso) {
    const keys = new Set();
    const cursor = new Date(startIso + "T12:00:00");
    const end = new Date(endIso + "T12:00:00");
    while (cursor <= end) {
      keys.add(isoFromDate(cursor).slice(0, 7));
      cursor.setDate(cursor.getDate() + 1);
    }
    return [...keys];
  }

  function dotStripMonthKeys() {
    const todayDate = new Date();
    const start = new Date(todayDate);
    start.setDate(start.getDate() - 6);
    return monthKeysBetween(isoFromDate(start), todayIso());
  }

  function hasDotStripCache() {
    return dotStripMonthKeys().every((mk) => monthCaches.has(mk));
  }

  function homeCacheMonthKeys() {
    const keys = new Set(dotStripMonthKeys());
    keys.add(todayIso().slice(0, 7));
    return [...keys];
  }

  function hasHomeMonthCache() {
    return homeCacheMonthKeys().every((mk) => monthCaches.has(mk));
  }

  /** Первый незаполненный день текущего месяца (1-е … вчера). Сегодня не входит. */
  function firstUnfilledIsoThisMonth() {
    const monthKey = todayIso().slice(0, 7);
    const yesterday = yesterdayIso();
    const start = new Date(`${monthKey}-01T12:00:00`);
    const end = new Date(`${yesterday}T12:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return null;
    }
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = isoFromDate(d);
      if (iso.slice(0, 7) !== monthKey) continue;
      if (!isFilledDate(iso)) return iso;
    }
    return null;
  }

  function homeEditorIso() {
    return firstUnfilledIsoThisMonth() || yesterdayIso();
  }

  async function loadMonthCache(monthKey, force = false) {
    if (!force && monthCaches.has(monthKey)) return;
    try {
      const data = await apiGet("/diary/month", { month: monthKey });
      if (data?.ok) {
        monthCaches.set(monthKey, new Set(data.filledDates || []));
      }
    } catch (err) {
      console.warn("diary month load", err);
    }
  }

  async function ensureMonthCaches(monthKeys, force = false) {
    await Promise.all(monthKeys.map((mk) => loadMonthCache(mk, force)));
  }

  function setFilled(iso, filled) {
    const monthKey = iso.slice(0, 7);
    if (!monthCaches.has(monthKey)) monthCaches.set(monthKey, new Set());
    const bucket = monthCaches.get(monthKey);
    if (filled) bucket.add(iso);
    else bucket.delete(iso);
  }

  function invalidateMonthCache(iso) {
    monthCaches.delete(iso.slice(0, 7));
  }

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function yesterdayIso() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // ─── Home widget ──────────────────────────────────────────────────────────

  async function renderHome(opts = {}) {
    const fresh = Boolean(opts?.fresh);
    if (!diaryZoneBtn) return;

    setElHidden(diaryZoneBtn, false);
    if (!fresh && hasHomeMonthCache()) {
      if (diaryHomeVariant === "b") {
        setElHidden(diaryZoneA, true);
        setElHidden(diaryZoneB, false);
        renderHomeVariantB();
      } else {
        setElHidden(diaryZoneA, false);
        setElHidden(diaryZoneB, true);
        renderHomeVariantA();
      }
    }

    await ensureMonthCaches(homeCacheMonthKeys(), fresh);

    if (diaryHomeVariant === "b") {
      setElHidden(diaryZoneA, true);
      setElHidden(diaryZoneB, false);
      renderHomeVariantB();
    } else {
      setElHidden(diaryZoneA, false);
      setElHidden(diaryZoneB, true);
      renderHomeVariantA();
    }
  }

  function renderMonthFillStatus(el, classBase) {
    if (!el) return;
    const filled = !firstUnfilledIsoThisMonth();
    el.hidden = false;
    el.textContent = filled ? "Заполнен" : "Не заполнен";
    el.className =
      `${classBase}` + (filled ? ` ${classBase}--filled` : ` ${classBase}--empty`);
  }

  function renderHomeVariantA() {
    const todayDate = new Date();
    const focusIso = homeEditorIso();

    renderMonthFillStatus(diaryZoneTodayStatus, "diary-zone__today-status");

    if (!diaryZonePreview) return;

    const dots = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() - i);
      const iso = isoFromDate(d);
      dots.push({ iso, isFocus: iso === focusIso, filled: isFilledDate(iso) });
    }

    const dotsHtml = dots
      .map(
        ({ filled, isFocus }) =>
          `<span class="diary-zone__dot${filled ? " diary-zone__dot--filled" : ""}${isFocus ? " diary-zone__dot--today" : ""}"></span>`
      )
      .join("");

    const wdLabels = dots
      .map(({ iso }) => {
        const d = new Date(iso + "T00:00:00");
        return WEEKDAYS_SHORT[(d.getDay() + 6) % 7];
      })
      .join(" ");

    diaryZonePreview.innerHTML =
      `<div class="diary-zone__dots" aria-label="${wdLabels}">${dotsHtml}</div>`;
  }

  function renderHomeVariantB() {
    if (!diaryZoneStatus) return;
    renderMonthFillStatus(diaryZoneStatus, "diary-zone__compact-status");
  }

  // ─── Calendar ─────────────────────────────────────────────────────────────

  async function openCalendarFromHome() {
    const d = new Date();
    diary.calYear = d.getFullYear();
    diary.calMonth = d.getMonth();
    diary.selectedDateIso = todayIso();
    setScreen("diaryCalendar");
    await ensureMonthCaches(adjacentMonthKeys(diary.calYear, diary.calMonth));
    renderCalendar();
  }

  function isoWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  function buildCalendarWeeks(year, month) {
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(start.getDate() - ((first.getDay() + 6) % 7));

    const weeks = [];
    const cursor = new Date(start);
    for (let w = 0; w < 6; w++) {
      const weekStart = new Date(cursor);
      const days = [];
      for (let i = 0; i < 7; i++) {
        days.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push({ weekNum: isoWeekNumber(weekStart), days });
    }
    return weeks;
  }

  async function renderCalendar() {
    if (!diaryCalWrap) return;

    const year = diary.calYear;
    const month = diary.calMonth;
    await ensureMonthCaches(adjacentMonthKeys(year, month));
    const today = todayIso();
    const selected = diary.selectedDateIso || today;

    if (diaryCalMonthShort) diaryCalMonthShort.textContent = MONTH_SHORT_EN[month];
    if (diaryCalYear) diaryCalYear.textContent = String(year);

    const weekdaysHead = WEEKDAYS_OBS.map(
      (wd) => `<span class="diary-cal__weekday">${wd}</span>`
    ).join("");

    const weeks = buildCalendarWeeks(year, month);
    let rowsHtml = "";

    weeks.forEach(({ weekNum, days }) => {
      let daysHtml = "";
      days.forEach((d) => {
        const iso = isoFromDate(d);
        const inMonth = d.getMonth() === month;
        const isToday = iso === today;
        const isSelected = iso === selected;
        const filled = isFilledDate(iso);

        let cls = "diary-cal__cell";
        if (!inMonth) cls += " diary-cal__cell--outside";
        if (isSelected) cls += " diary-cal__cell--selected";
        else if (isToday) cls += " diary-cal__cell--today";

        const dot = filled ? `<span class="diary-cal__dot" aria-hidden="true"></span>` : "";
        const dayNum = d.getDate();

        daysHtml +=
          `<button type="button" class="${cls}" data-date="${iso}"` +
          ` aria-label="${dayNum}${filled ? ", запись есть" : ""}">` +
          `<span class="diary-cal__day-wrap">` +
          `<span class="diary-cal__day">${dayNum}</span>${dot}</span></button>`;
      });

      rowsHtml +=
        `<div class="diary-cal__row">` +
        `<span class="diary-cal__week-num">${weekNum}</span>` +
        `<div class="diary-cal__week-days">${daysHtml}</div></div>`;
    });

    diaryCalWrap.innerHTML =
      `<div class="diary-cal__table">` +
      `<div class="diary-cal__row diary-cal__row--head">` +
      `<span class="diary-cal__week-label">W</span>` +
      `<div class="diary-cal__weekdays">${weekdaysHead}</div></div>` +
      rowsHtml +
      `</div>`;

    diaryCalWrap.querySelectorAll(".diary-cal__cell[data-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        const iso = cell.dataset.date;
        if (!iso) return;
        diary.selectedDateIso = iso;
        openEditor(iso, "diaryCalendar");
      });
    });
  }

  // ─── Editor ───────────────────────────────────────────────────────────────

  function openEditorFromHome() {
    openEditor(homeEditorIso(), "home");
  }

  function openEditor(iso, backScreen) {
    diary.editorDateIso = iso;
    diary.selectedDateIso = iso;
    diary.editorBackScreen = backScreen || "diaryCalendar";
    setScreen("diaryEditor");
    renderEditor(iso).catch((err) => console.error(err));
  }

  function weekdayInPhrase(iso) {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "в этот день";
    return WEEKDAY_IN[d.getDay()] || "в этот день";
  }

  function syncEditorPlaceholder(iso) {
    if (!diaryEditorTextarea) return;
    diaryEditorTextarea.placeholder = `Что было важным ${weekdayInPhrase(iso)}…`;
  }

  async function renderEditor(iso) {
    if (!diaryEditorTextarea) return;
    diaryEditorTextarea.value = "";
    diary.editorHasEntry = false;
    syncEditorPlaceholder(iso);
    updateDeleteBtn();

    await refreshSuggestHistoryFromApi();

    try {
      const data = await apiGet("/diary/day", { date: iso });
      if (data?.ok) {
        diaryEditorTextarea.value = data.body || "";
        diary.editorHasEntry = Boolean(data.hasEntry);
        rememberEditorTokensFromText(diaryEditorTextarea.value, iso);
      }
    } catch (err) {
      console.warn("diary day load", err);
    }

    resetSaveBtn();
    updateDeleteBtn();
    requestAnimationFrame(() => {
      window.LifeInputKeyboards?.focus?.(diaryEditorTextarea) ?? diaryEditorTextarea?.focus();
    });
  }

  function updateDeleteBtn() {
    if (!diaryDeleteBtn) return;
    const hasText = Boolean(diaryEditorTextarea?.value.trim());
    const show = diary.editorHasEntry || hasText;
    setElHidden(diaryDeleteBtn, !show);
  }

  function openDeleteConfirm() {
    if (diaryDeleteConfirm) diaryDeleteConfirm.hidden = false;
  }

  function closeDeleteConfirm() {
    if (diaryDeleteConfirm) diaryDeleteConfirm.hidden = true;
  }

  async function deleteEntry() {
    const iso = diary.editorDateIso;
    if (!iso) return;

    closeDeleteConfirm();
    if (diaryEditorSaveBtn) {
      diaryEditorSaveBtn.disabled = true;
      diaryEditorSaveBtn.classList.add("is-saving");
    }

    try {
      await apiDelete("/diary/day", { date: iso });
      clearLegacyLocal(iso);
      setFilled(iso, false);
      invalidateMonthCache(iso);

      diary.editorDateIso = "";
      diary.editorHasEntry = false;
      if (diaryEditorTextarea) diaryEditorTextarea.value = "";

      const back = diary.editorBackScreen;
      if (back === "home") {
        setScreen("home");
      } else {
        setScreen("diaryCalendar");
      }
    } catch (err) {
      console.error(err);
      if (diaryEditorSaveBtn) {
        diaryEditorSaveBtn.classList.remove("is-saving");
        diaryEditorSaveBtn.classList.add("is-error");
        diaryEditorSaveBtn.textContent = "Ошибка";
        diaryEditorSaveBtn.disabled = false;
      }
    }
  }

  function saveEntry() {
    if (!diaryEditorSaveBtn || !diaryEditorTextarea) return;
    const iso = diary.editorDateIso;
    if (!iso) return;

    const btn = diaryEditorSaveBtn;
    btn.textContent = "Сохранение…";
    btn.classList.add("is-saving");
    btn.disabled = true;

    if (diary.saveTimer) clearTimeout(diary.saveTimer);
    diary.saveTimer = setTimeout(() => {
      apiPostJson("/diary/day", { date: iso, body: diaryEditorTextarea.value })
        .then((data) => {
          if (!data?.ok) throw new Error(data?.error || "Ошибка сохранения");
          clearLegacyLocal(iso);
          rememberEditorTokensFromText(diaryEditorTextarea.value, iso);
          refreshSuggestHistoryFromApi().catch(() => {});
          const hasEntry = Boolean(data.hasEntry);
          setFilled(iso, hasEntry);
          diary.editorHasEntry = hasEntry;
          diary.selectedDateIso = iso;
          invalidateMonthCache(iso);
          updateDeleteBtn();
          btn.textContent = "Сохранено ✓";
          btn.classList.remove("is-saving");
          btn.classList.add("is-success");
          btn.disabled = false;
          diary.saveTimer = setTimeout(() => resetSaveBtn(), SUCCESS_DURATION);
        })
        .catch((err) => {
          console.error(err);
          btn.textContent = "Повторить";
          btn.classList.remove("is-saving");
          btn.classList.add("is-error");
          btn.disabled = false;
        });
    }, SAVE_DELAY);
  }

  function resetSaveBtn() {
    if (!diaryEditorSaveBtn) return;
    diaryEditorSaveBtn.textContent = "Сохранить";
    diaryEditorSaveBtn.classList.remove("is-saving", "is-success", "is-error");
    diaryEditorSaveBtn.disabled = false;
  }

  // ─── Screen management ────────────────────────────────────────────────────

  function onScreenChange(screen) {
    const isHome   = screen === "home";
    const isCal    = screen === "diaryCalendar";
    const isEditor = screen === "diaryEditor";

    setElHidden(flowDiary, !isCal);
    setElHidden(flowDiaryEditor, !isEditor);
    setElHidden(diaryCtaBar, !isEditor);

    if (isCal) {
      renderCalendar();
    }

    if (isEditor) {
      updateEditorHeader();
      updateDeleteBtn();
    }

    if (!isEditor) {
      closeDeleteConfirm();
      hideWikiSuggest();
    }
  }

  function updateEditorHeader() {
    const iso = diary.editorDateIso;
    if (!iso) return;
    const headerTitle = document.getElementById("headerTitle");
    if (!headerTitle) return;
    const [y, m, d] = iso.split("-").map(Number);
    const today = todayIso();
    const yesterday = yesterdayIso();
    const prefix =
      iso === today ? "Сегодня" : iso === yesterday ? "Вчера" : `${d} ${MONTH_NAMES_GEN[m - 1]}`;
    const dateStr = `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
    headerTitle.textContent = `${prefix} · ${dateStr}`;
  }

  /** Обрабатывает навигацию назад для дневника.
   *  Возвращает true если событие обработано. */
  function navigateBack() {
    if (diary.editorDateIso && isActiveScreen("diaryEditor")) {
      const back = diary.editorBackScreen;
      diary.editorDateIso = "";
      if (back === "home") {
        setScreen("home");
      } else {
        setScreen("diaryCalendar");
      }
      return true;
    }
    if (isActiveScreen("diaryCalendar")) {
      setScreen("home");
      return true;
    }
    return false;
  }

  function isActiveScreen(screen) {
    if (screen === "diaryCalendar") return flowDiary && !flowDiary.hidden;
    if (screen === "diaryEditor")   return flowDiaryEditor && !flowDiaryEditor.hidden;
    return false;
  }

  function isDiaryScreen(screen) {
    return screen === "diaryCalendar" || screen === "diaryEditor";
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function isoFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init(deps) {
    setElHidden = deps.setElHidden || setElHidden;
    setScreen   = deps.setScreen   || setScreen;
    apiGet      = deps.apiGet      || apiGet;
    apiPostJson = deps.apiPostJson || apiPostJson;
    apiDelete   = deps.apiDelete   || apiDelete;
    bindEls();
    bindEvents();
    bindWikiEditor();
    if (diaryEditorTextarea) {
      diaryEditorTextarea.addEventListener("input", () => {
        updateDeleteBtn();
        onEditorInput();
      });
    }
  }

  window.LifeDiary = {
    init,
    onScreenChange,
    navigateBack,
    isDiaryScreen,
    renderHome,
    renderCalendar,
    openCalendarFromHome,
    openEditorFromHome,
    openEditorToday: openEditorFromHome,
  };
})();
