/**
 * Life Dashboard — Telegram Mini App (MVP)
 * Экраны: home → detail (KPI) | fill (выбор дня + форма)
 *
 * Прод-база (после Selectel, июнь 2026): api-queue2 — без глобальной очереди;
 * nutritionSubmitLock/mealActionLock, abort поиска продуктов, кэш finance/ledger, timeout 15 s.
 * Не возвращать api-queue (глобальная очередь — хуже на телефоне).
 */

const { destroyCharts, renderProductMacroDonut, renderProductivityRadar } = window.LifeCharts || {
  destroyCharts() {},
  renderProductMacroDonut() {},
  renderProductivityRadar() {},
};

const DETAIL_TITLE = {
  detailProductivity: "Продуктивность",
  detailSport: "Спорт",
  detailNutrition: "Питание",
  detailNutritionProducts: "Добавить продукт",
  detailNutritionProduct: "Продукт",
  detailFinance: "Финансы",
  detailLedger: "Ledger",
  diaryCalendar: "Дневник",
  diaryEditor: "Дневник",
};

const MACRO_COLORS = {
  protein: "#40d17c",
  carbs: "#26c9dd",
  fat: "#ed3b00",
};
const MACRO_LEGEND = [
  { key: "protein", label: "Белок", color: MACRO_COLORS.protein },
  { key: "carbs", label: "Углеводы", color: MACRO_COLORS.carbs },
  { key: "fat", label: "Жиры", color: MACRO_COLORS.fat },
];

/** Готовка: вес с весов + cookMode на сервер; учётные граммы считает API. */
const COOK_MODES = [
  { id: "plain", factor: 1 },
  { id: "boil_pasta", factor: 101 / 274 },
  { id: "boil_grain", factor: 1 / 2.7 },
  { id: "boil_legume", factor: 1 / 2.3 },
  { id: "steam_meat", factor: 1.25 },
  { id: "boil_meat", factor: 1.25 },
  { id: "stew_meat", factor: 1 / 0.85 },
  { id: "fry_meat", factor: 1.275 },
  { id: "fry_stew_meat", factor: 1.275 * (1 / 0.85) },
  { id: "steam_veg", factor: 1.1 },
  { id: "boil_veg", factor: 1.05 },
  { id: "fry_veg", factor: 1.2 },
];
/** Матрица замеров: id × имя × cook_mode → factor (first-match). Зеркало cook_factor_rules.py */
const _FB_STEAM = 1.25;
const _FB_FRY = 1.275;
const _FB_STEW = 1 / 0.85;
const _FB_FRY_STEW = _FB_FRY * _FB_STEW;
const _FB_GRAIN = 1 / 2.7;
const _FB_LEGUME = 1 / 2.3;

function isChickenBreastName(name) {
  const s = softenCookNameTypos(name);
  if (/бедр|голен|окороч|индейк/i.test(s)) return false;
  return /грудк|филе.{0,14}курин|курин.{0,14}филе/i.test(s);
}
function isChickenThighName(name) {
  const s = softenCookNameTypos(name);
  if (isChickenBreastName(name) || /индейк/i.test(s)) return false;
  return /бедр|голен|окороч/i.test(s);
}
function isGenericChickenName(name) {
  const s = softenCookNameTypos(name);
  if (isChickenBreastName(name) || isChickenThighName(name) || /индейк/i.test(s)) return false;
  return /курин|куриц|цыпл/i.test(s);
}
function isOtherGrainName(name) {
  const s = softenCookNameTypos(name);
  if (/гречк/i.test(s) || /(?<![а-яёa-z0-9])рис\b|рисовый/i.test(s) || /овсян|геркулес|хлопь/i.test(s)) return false;
  return /крупа|крупы|пшен(?!и)|перлов|ячнев|манк|киноа|булгур|кускус|полб|полента|каша\b/i.test(s);
}
function isGenericFishName(name) {
  const s = softenCookNameTypos(name);
  if (/треск/i.test(s) || /минтай/i.test(s) || /лосос|сёмг|семг|форел/i.test(s)) return false;
  return /рыб[аые]|^рыба\b|хек\b|сельд|селёдк|скумбр|горбуш|тунец|сибас|дорад|палтус|кревет|кальмар|мидии|краб(?!ов)|морепродукт/i.test(s);
}
function nameMatches(re) {
  return (name) => re.test(softenCookNameTypos(name));
}

const COOK_FACTOR_RULES = [
  { id: "A1", modes: ["steam_meat", "boil_meat"], factor: 812 / 538, match: isChickenBreastName },
  { id: "A2", modes: ["fry_meat"], factor: 420 / 350, match: isChickenBreastName },
  { id: "A3", modes: ["fry_stew_meat"], factor: (420 / 350) * _FB_STEW, match: isChickenBreastName },
  { id: "A4", modes: ["steam_meat", "boil_meat"], factor: _FB_STEAM, match: isChickenThighName },
  { id: "A5", modes: ["steam_meat", "boil_meat"], factor: _FB_STEAM, match: nameMatches(/индейк/i) },
  { id: "A5", modes: ["fry_meat"], factor: 554 / 463, match: nameMatches(/индейк/i) },
  { id: "A0", modes: ["steam_meat", "boil_meat"], factor: _FB_STEAM, match: isGenericChickenName },
  { id: "A0", modes: ["fry_meat"], factor: _FB_FRY, match: isGenericChickenName },
  { id: "A0", modes: ["stew_meat"], factor: _FB_STEW, match: isGenericChickenName },
  { id: "A0", modes: ["fry_stew_meat"], factor: _FB_FRY_STEW, match: isGenericChickenName },
  { id: "B1", modes: ["steam_meat", "boil_meat"], factor: _FB_STEAM, match: nameMatches(/свинин/i) },
  { id: "B2", modes: ["fry_meat"], factor: _FB_FRY, match: nameMatches(/свинин/i) },
  { id: "B3", modes: ["stew_meat"], factor: _FB_STEW, match: nameMatches(/свинин/i) },
  { id: "B3", modes: ["fry_stew_meat"], factor: _FB_FRY_STEW, match: nameMatches(/свинин/i) },
  { id: "B4", modes: ["steam_meat", "boil_meat"], factor: _FB_STEAM, match: nameMatches(/говядин|телятин/i) },
  { id: "B5", modes: ["fry_meat"], factor: _FB_FRY, match: nameMatches(/говядин|телятин/i) },
  { id: "B6", modes: ["stew_meat"], factor: _FB_STEW, match: nameMatches(/говядин|телятин/i) },
  { id: "B6", modes: ["fry_stew_meat"], factor: _FB_FRY_STEW, match: nameMatches(/говядин|телятин/i) },
  { id: "B7", modes: ["steam_meat", "boil_meat"], factor: _FB_STEAM, match: nameMatches(/фарш/i) },
  { id: "B7", modes: ["fry_meat"], factor: 500 / 385, match: nameMatches(/фарш/i) },
  { id: "B7", modes: ["stew_meat"], factor: _FB_STEW, match: nameMatches(/фарш/i) },
  { id: "B7", modes: ["fry_stew_meat"], factor: (500 / 385) * _FB_STEW, match: nameMatches(/фарш/i) },
  { id: "C1", modes: ["steam_meat", "boil_meat"], factor: 190 / 120, match: nameMatches(/треск/i) },
  { id: "C4", modes: ["fry_meat"], factor: _FB_FRY, match: nameMatches(/треск/i) },
  { id: "C3", modes: ["steam_meat", "boil_meat"], factor: 150 / 108, match: nameMatches(/минтай/i) },
  { id: "C2", modes: ["steam_meat", "boil_meat"], factor: _FB_STEAM, match: nameMatches(/лосос|сёмг|семг|форел/i) },
  { id: "C0", modes: ["steam_meat", "boil_meat"], factor: _FB_STEAM, match: isGenericFishName },
  { id: "C0", modes: ["fry_meat"], factor: _FB_FRY, match: isGenericFishName },
  { id: "C0", modes: ["stew_meat"], factor: _FB_STEW, match: isGenericFishName },
  { id: "C0", modes: ["fry_stew_meat"], factor: _FB_FRY_STEW, match: isGenericFishName },
  { id: "D_grechka", modes: ["boil_grain"], factor: 55 / 175, match: nameMatches(/гречк/i) },
  { id: "D_rice", modes: ["boil_grain"], factor: _FB_GRAIN, match: nameMatches(/(?<![а-яёa-z0-9])рис\b|рисовый/i) },
  { id: "D_oats", modes: ["boil_grain"], factor: _FB_GRAIN, match: nameMatches(/овсян|геркулес|хлопь/i) },
  { id: "D_grain", modes: ["boil_grain"], factor: _FB_GRAIN, match: isOtherGrainName },
  { id: "D_pasta", modes: ["boil_pasta"], factor: 101 / 274, match: nameMatches(/макарон|спагетт|пенне|вермишел|лапш|фунчоз|ньокк|орзо\b|рожки|спираль|гнёзд|лингвини|тальятелл|паста\b/i) },
  { id: "L_legume", modes: ["boil_legume"], factor: _FB_LEGUME, match: nameMatches(/фасоль|чечевиц|горох\b|нут\b|маш\b|бобы|бобов|эдамаме/i) },
  { id: "V_steam", modes: ["steam_veg"], factor: 1.1, match: nameMatches(/овощ|брокколи|кабачок|цукини|баклажан|морков|свёкл|свекл|шпинат|спаржа|кольраби|патиссон|тыкв|капуст|картофел|картошк|болгарск|помидор|томат(?!н)|огурец|огурц|редис|сельдерей|фенхель|порей|репчат|горошек|стручков|гриб|кукуруз/i) },
  { id: "V_boil", modes: ["boil_veg"], factor: 1.05, match: nameMatches(/овощ|брокколи|кабачок|цукини|баклажан|морков|свёкл|свекл|шпинат|спаржа|кольраби|патиссон|тыкв|капуст|картофел|картошк|болгарск|помидор|томат(?!н)|огурец|огурц|редис|сельдерей|фенхель|порей|репчат|горошек|стручков|гриб|кукуруз/i) },
  { id: "V_fry", modes: ["fry_veg"], factor: 1.2, match: nameMatches(/овощ|брокколи|кабачок|цукини|баклажан|морков|свёкл|свекл|шпинат|спаржа|кольраби|патиссон|тыкв|капуст|картофел|картошк|болгарск|помидор|томат(?!н)|огурец|огурц|редис|сельдерей|фенхель|порей|репчат|горошек|стручков|гриб|кукуруз/i) },
];
/** Подписи по cook_kind — без «· макароны»: продукт уже известен. */
const COOK_UI_BY_KIND = {
  pasta: {
    plain: { label: "Сухой", hint: "Вес сухой пасты — как на упаковке." },
    boil_pasta: { label: "Варёный", hint: "Вес уже сваренных макарон с весов." },
  },
  grain: {
    plain: { label: "Сухой", hint: "Вес сухой крупы или риса." },
    boil_grain: { label: "Варёный", hint: "Вес готовой каши или риса с весов." },
  },
  legume: {
    plain: { label: "Сухой", hint: "Вес сухих бобовых." },
    boil_legume: { label: "Варёный", hint: "Вес варёных бобовых с весов." },
  },
  meat_fish: {
    plain: { label: "Сырой", hint: "Вес сырого мяса или рыбы." },
    steam_meat: {
      label: "Запечённый / на пару",
      hint: "Вес готового куска без жидкости.",
    },
    boil_meat: { label: "Варёный", hint: "Вес варёного мяса или рыбы." },
    stew_meat: {
      label: "Тушёный",
      hint: "Вес готового тушёного. Подливу считай, если ешь.",
    },
    fry_meat: {
      label: "Жареный",
      hint: "Вес уже пожаренного куска. Масло — отдельным полем.",
    },
  },
  veg: {
    plain: { label: "Сырой / замороженный", hint: "Вес сырых или замороженных овощей." },
    steam_veg: {
      label: "На пару / запечённый",
      hint: "Вес готовых овощей без жидкости.",
    },
    boil_veg: { label: "Варёный", hint: "Вес варёных овощей с весов, без отвара." },
    fry_veg: {
      label: "Жареный",
      hint: "Вес уже пожаренных овощей. Масло — отдельным полем.",
    },
  },
};
const COOK_MODE_BY_ID = Object.fromEntries(COOK_MODES.map((m) => [m.id, m]));
/** В блюде: кладёшь сырой/сухой вес; жарка блюда целиком — на шите сборки. */
const DISH_COOK_UI_BY_KIND = {
  pasta: {
    plain: { label: "Сухой", hint: "" },
    boil_pasta: { label: "Варёный", hint: "" },
  },
  grain: {
    plain: { label: "Сухой", hint: "" },
    boil_grain: { label: "Варёный", hint: "" },
  },
  legume: {
    plain: { label: "Сухой", hint: "" },
    boil_legume: { label: "Варёный", hint: "" },
  },
  meat_fish: {
    plain: { label: "Сырой", hint: "" },
    steam_meat: { label: "Запечённый / на пару", hint: "" },
    boil_meat: { label: "Варёный", hint: "" },
    stew_meat: { label: "Тушёный", hint: "" },
  },
  veg: {
    plain: { label: "Сырой / замороженный", hint: "" },
    steam_veg: { label: "На пару / запечённый", hint: "" },
    boil_veg: { label: "Варёный", hint: "" },
    fry_veg: { label: "Жареный", hint: "" },
  },
};
/** Готовка всего блюда — масло только при жарке. */
const DISH_LEVEL_COOK_MODES = [
  { id: "plain", label: "Сырой" },
  { id: "steam_meat", label: "Запечённый / на пару" },
  { id: "boil_meat", label: "Варёный" },
  { id: "stew_meat", label: "Тушёный" },
  { id: "fry_meat", label: "Жареный" },
];
/** Какие режимы показывать по cook_kind с API (NULL → блок скрыт). */
const COOK_MODES_BY_KIND = {
  pasta: ["plain", "boil_pasta"],
  grain: ["plain", "boil_grain"],
  legume: ["plain", "boil_legume"],
  meat_fish: ["plain", "steam_meat", "boil_meat", "stew_meat", "fry_meat"],
  veg: ["plain", "steam_veg", "boil_veg", "fry_veg"],
};
function isFryCookMode(modeId) {
  return modeId === "fry_meat" || modeId === "fry_veg";
}
/** Рамочные помарки в названии (до матча cook_kind). */
const COOK_NAME_TYPO_FIXES = [
  [/крпы/gi, "крупы"],
  [/крпа(?![а-яёa-z0-9])/gi, "крупа"],
  [/круа(?![а-яёa-z0-9])/gi, "крупа"],
  [/гречкк/gi, "гречк"],
  [/говяин/gi, "говядин"],
  [/свиин/gi, "свинин"],
  [/курицц/gi, "куриц"],
  [/индейкк/gi, "индейк"],
  [/лосос(?![а-яёa-z0-9])/gi, "лосось"],
  [/шашл(?![а-яёa-z0-9])/gi, "шашлык"],
];
/**
 * First-match. Паста раньше крупы; мясо раньше круп;
 * стручковая фасоль → veg до бобовых; овощи последними (рис с овощами → grain).
 * JS `\b` не видит кириллицу — границы `(?<![а-яёa-z0-9])`.
 */
const COOK_KIND_FROM_NAME = [
  [
    "pasta",
    /макарон|спагетт|пенне|вермишел|лапш|фунчоз|ньокк|(?<![а-яёa-z0-9])орзо(?![а-яёa-z0-9])|рожки|спираль|гнёзд|лингвини|тальятелл|(?<!томатная )(?<!томатной )(?<!томатные )паста(?![а-яёa-z0-9])/i,
  ],
  [
    "meat_fish",
    /мясо|говядин|свинин|баранин|телятин|курин|куриц|индейк|цыпл|(?<![а-яёa-z0-9])утка(?![а-яёa-z0-9])|(?<![а-яёa-z0-9])гусь(?![а-яёa-z0-9])|кролик|перепел|фарш|стейк|бекон|вырезка|филе|грудк|бедр|голен|эскалоп|шашлык|лосос|сёмг|семг|форел|тунец|минтай|треск|хек|сельдь|селёдк|скумбр|горбуш|сибас|дорад|палтус|кревет|кальмар|мидии|краб(?!ов)|рыб[аые]|морепродукт|(?<![а-яёa-z0-9])рыба(?![а-яёa-z0-9])/i,
  ],
  ["veg", /стручков/i],
  [
    "legume",
    /фасоль|чечевиц|(?<![а-яёa-z0-9])горох(?![а-яёa-z0-9])|(?<![а-яёa-z0-9])нут(?![а-яёa-z0-9])|(?<![а-яёa-z0-9])маш(?![а-яёa-z0-9])|бобы|бобов|эдамаме/i,
  ],
  [
    "grain",
    // пшен(?!и) = пшено, не «пшеничный» хлеб.
    /крупа|крупы|гречк|(?<![а-яёa-z0-9])рис(?![а-яёa-z0-9])|овсян|пшен(?!и)|перлов|ячнев|манк|киноа|булгур|кускус|полб|геркулес|полента|хлопь|мюсли|(?<![а-яёa-z0-9])каша(?![а-яёa-z0-9])/i,
  ],
  [
    "veg",
    /овощ|брокколи|кабачок|цукини|баклажан|морков|свёкл|свекл|шпинат|спаржа|кольраби|патиссон|тыкв|капуст|картофел|картошк|болгарск|помидор|томат(?!н)|огурец|огурц|редис|сельдерей|фенхель|порей|репчат|горошек|гриб|кукуруз/i,
  ],
];
const COOK_PREF_KEY = "lifeDashboard.cookPref";
/** Высота заметки по ключу food:/product:/dish-create — не общая на все карточки. */
const NOTE_HEIGHT_KEY = "kcal28_note_height";
const NOTE_HEIGHT_MIN = 72;
const NOTE_HEIGHT_MAX = 480;

const NUTRITION_MEALS = [
  { id: "breakfast", label: "Завтрак" },
  { id: "lunch", label: "Обед" },
  { id: "dinner", label: "Ужин" },
  { id: "snacks", label: "Снеки" },
];

/** Завтрак 4:00–10:59 · обед 11:00–15:59 · ужин 16:00–3:59 (локальное время). */
function inferMealByTime(now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins >= 4 * 60 && mins <= 10 * 60 + 59) return "breakfast";
  if (mins >= 11 * 60 && mins <= 15 * 60 + 59) return "lunch";
  return "dinner";
}

/** Приём из «+» на карточке приёма; иначе — по времени суток. */
function resolveQuickAddMeal(explicitMeal) {
  if (explicitMeal != null) return explicitMeal;
  if (state.nutritionAddMealExplicit) return state.nutritionAddMeal;
  return inferMealByTime();
}

function isDetailScreen(screen) {
  return screen === "detailProductivity" || screen === "detailSport";
}

function isNutritionScreen(screen) {
  return (
    screen === "detailNutrition" ||
    screen === "detailNutritionProducts" ||
    screen === "detailNutritionProduct"
  );
}

function isFinanceScreen(screen) {
  return window.LifeFinance?.isFinanceScreen?.(screen) || screen === "detailFinance";
}

function isDiaryScreen(screen) {
  return window.LifeDiary?.isDiaryScreen?.(screen) || false;
}

function isLedgerScreen(screen) {
  return window.LifeLedger?.isLedgerScreen?.(screen) || screen === "detailLedger";
}

/** Блоки вкладки Спорт: разминка → растяжка → вело → воркаут → бег. */
const SPORT_BLOCKS = [
  {
    id: "warmup",
    title: "разминка",
    fields: [{ col: 10, label: "Разминка (мин)" }],
  },
  {
    id: "stretching",
    title: "растяжка",
    fields: [{ col: 11, label: "Растяжка (мин)" }],
  },
  {
    id: "cycling",
    title: "вело",
    fields: [
      { col: 19, label: "Cycling (км)" },
      { col: 20, label: "Cycling (мин)" },
      { col: 21, label: "Wt" },
      { col: 22, label: "HR cycling" },
    ],
  },
  {
    id: "workout",
    title: "воркаут",
    fields: [
      { col: 14, label: "Workout (мин)" },
      { col: 12, label: "Pull ups" },
      { col: 13, label: "Push ups" },
    ],
  },
  {
    id: "running",
    title: "бег",
    fields: [
      { col: 15, label: "Бег (км)" },
      { col: 16, label: "Бег (мин)" },
      { col: 17, label: "Pace" },
      { col: 18, label: "HR run" },
    ],
  },
];

const SPORT_FIELDS = SPORT_BLOCKS.flatMap((b) => b.fields);

/** Порядок колонок B..I в API (writeRoutineBatch). */
const ROUTINE_API_COL_ORDER = [2, 3, 4, 5, 6, 7, 8, 9];

/** Сетка 2×4: левый столбец семья→бизнес, правый познание→веселье. */
const ROUTINE_GRID_COL_ORDER = [2, 6, 3, 7, 4, 8, 5, 9];

const FILL_ONBOARDING_KEY = "lifeDashboard.fillOnboardingDone";

const FILL_ONBOARDING_HINTS = {
  1: "Отметьте, что успели вчера по 8 сферам",
  2: "Запишите утреннюю тренировку за сегодня",
  3: "Справа вверху — догнать любой прошлый день",
};

function isFillOnboardingDone() {
  try {
    return localStorage.getItem(FILL_ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

function markFillOnboardingDone() {
  try {
    localStorage.setItem(FILL_ONBOARDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** 4-я KPI-карточка на home: свайп влево/вправо. */
const KPI_SPORT_METRICS = [
  { id: "cycling-km", title: "Cycling", unit: "км", kind: "type", match: /cycling,\s*km/i },
  { id: "run-km", title: "Run", unit: "км", kind: "type", match: /run,\s*km/i },
  { id: "workout-min", title: "Workout", unit: "мин", kind: "min", match: /workout,\s*min/i },
];

function readKpiSportMetricIndex() {
  try {
    const raw = localStorage.getItem("lifeDashboard.kpiSportMetric");
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < KPI_SPORT_METRICS.length) return n;
  } catch {
    /* ignore */
  }
  return 0;
}

/** 3-я KPI-карточка на home: Вчера → Неделя → Месяц. */
const KPI_ROUTINE_PERIODS = [
  { id: "yesterday", title: "Вчера" },
  { id: "week", title: "Неделя" },
  { id: "month", title: "Месяц" },
];

function readKpiRoutinePeriodIndex() {
  try {
    const raw = localStorage.getItem("lifeDashboard.kpiRoutinePeriod");
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < KPI_ROUTINE_PERIODS.length) return n;
  } catch {
    /* ignore */
  }
  return 0;
}

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const MONTH_NAMES_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const MONTH_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** @type {import('telegram-web-app').WebApp | null} */
let tg = null;

function resolveApiBase() {
  const { protocol, hostname, port } = window.location;
  if (protocol === "file:" || port === "8080" || port === "5500") {
    return "http://127.0.0.1:8765";
  }
  if (port === "8765" || hostname === "127.0.0.1" || hostname === "localhost") {
    return "";
  }
  return "";
}

const API_BASE = resolveApiBase();

const state = {
  screen: "home",
  fillMode: "morning",
  routineDate: null,
  sportDate: null,
  selectedDate: null,
  monthKey: todayIso().slice(0, 7),
  monthData: null,
  row1Based: null,
  row1BasedRoutine: null,
  row1BasedSport: null,
  dayExists: false,
  dayExistsRoutine: false,
  dayExistsSport: false,
  routine: [],
  sportValues: new Map(),
  saving: false,
  wheelOpen: false,
  wheel: { day: 1, month: 1, year: new Date().getFullYear() },
  productivityPeriod: "week",
  productivityDetailMonthKey: null,
  sportPeriod: "week",
  sportDetailMonthKey: null,
  sportStats: null,
  productivityStats: null,
  weekAnchorDate: null,
  yesterdayDay: null,
  weekProductivity: null,
  nutritionDay: null,
  nutritionAddMeal: "breakfast",
  nutritionAddMealExplicit: false,
  nutritionViewProduct: null,
  nutritionProductsById: new Map(),
  nutritionFoodById: new Map(),
  nutritionBackScreen: "detailNutrition",
  nutritionQuickAddProductId: null,
  nutritionQuickAddFoodId: null,
  nutritionQuickAddMeal: "breakfast",
  nutritionSheetMode: "add",
  nutritionEditEntryId: null,
  nutritionCookMode: "plain",
  nutritionViewServing: null,
  nutritionViewServingEntry: null,
  nutritionServingUnit: "g",
  nutritionMacroViewMode: "100g",
  nutritionExportPeriod: "7d",
  nutritionDetailDate: null,
  nutritionDeleteTarget: null,
  productDbMode: "recent", // recent | favorites | mine | dishes
  productCreateStep: 1, // 1 name | 2 macros
  dishCreateStep: 1,
  dishItems: [],
  dishItemSeq: 0,
  dishEditKey: null,
  dishEditingId: null,
  dishCookMode: "plain",
  dishOilGrams: "",
  dishCookPickTarget: null, // "dish" | "item"
  kpiSportMetricIndex: readKpiSportMetricIndex(),
  kpiRoutinePeriodIndex: readKpiRoutinePeriodIndex(),
  fillOnboardingStep: 0,
  fillOnboardingAutoDoneTimer: null,
};

const els = {
  headerBack: document.getElementById("headerBack"),
  headerTitle: document.getElementById("headerTitle"),
  appHeader: document.getElementById("appHeader"),
  dashboardZone: document.getElementById("dashboardZone"),
  dashboardError: document.getElementById("dashboardError"),
  monthLabel: document.getElementById("monthLabel"),
  kpiGrid: document.getElementById("kpiGrid"),
  homeFillBtn: document.getElementById("homeFillBtn"),
  nutritionZoneBtn: document.getElementById("nutritionZoneBtn"),
  nutritionBars: document.getElementById("nutritionBars"),
  flowDetailNutrition: document.getElementById("flowDetailNutrition"),
  nutritionDayStrip: document.getElementById("nutritionDayStrip"),
  nutritionProductsBtn: document.getElementById("nutritionProductsBtn"),
  diaryDeleteBtn: document.getElementById("diaryDeleteBtn"),
  nutritionExportBtn: document.getElementById("nutritionExportBtn"),
  nutritionCheatmealBtn: document.getElementById("nutritionCheatmealBtn"),
  nutritionDetailBars: document.getElementById("nutritionDetailBars"),
  nutritionDetailTarget: document.getElementById("nutritionDetailTarget"),
  nutritionMealList: document.getElementById("nutritionMealList"),
  flowNutritionProducts: document.getElementById("flowNutritionProducts"),
  productDbSearch: document.getElementById("productDbSearch"),
  productDbSearchPh: document.getElementById("productDbSearchPh"),
  productDbSearchClear: document.getElementById("productDbSearchClear"),
  productDbList: document.getElementById("productDbList"),
  productDbMode: document.getElementById("productDbMode"),
  productCreateOpenBtn: document.getElementById("productCreateOpenBtn"),
  productCreateSheet: document.getElementById("productCreateSheet"),
  productCreateBackdrop: document.getElementById("productCreateBackdrop"),
  productCreateCloseBtn: document.getElementById("productCreateCloseBtn"),
  productCreateForm: document.getElementById("productCreateForm"),
  productCreateStepName: document.getElementById("productCreateStepName"),
  productCreateStepMacros: document.getElementById("productCreateStepMacros"),
  productCreateNextBtn: document.getElementById("productCreateNextBtn"),
  productCreateSaveAndAddBtn: document.getElementById("productCreateSaveAndAddBtn"),
  productCreateTitle: document.getElementById("productCreateTitle"),
  dishCreateOpenBtn: document.getElementById("dishCreateOpenBtn"),
  dishCreateSheet: document.getElementById("dishCreateSheet"),
  dishCreateBackdrop: document.getElementById("dishCreateBackdrop"),
  dishCreateCloseBtn: document.getElementById("dishCreateCloseBtn"),
  dishCreateTitle: document.getElementById("dishCreateTitle"),
  dishCreateRenameBtn: document.getElementById("dishCreateRenameBtn"),
  dishCreateStepName: document.getElementById("dishCreateStepName"),
  dishCreateStepBuild: document.getElementById("dishCreateStepBuild"),
  dishCreateName: document.getElementById("dishCreateName"),
  dishCreateNextBtn: document.getElementById("dishCreateNextBtn"),
  dishCreateSearch: document.getElementById("dishCreateSearch"),
  dishCreateHits: document.getElementById("dishCreateHits"),
  dishCreateItems: document.getElementById("dishCreateItems"),
  dishCreateYield: document.getElementById("dishCreateYield"),
  dishCreateCookBlock: document.getElementById("dishCreateCookBlock"),
  dishCreateCook: document.getElementById("dishCreateCook"),
  dishCreateOilBlock: document.getElementById("dishCreateOilBlock"),
  dishCreateOil: document.getElementById("dishCreateOil"),
  dishCreatePreview: document.getElementById("dishCreatePreview"),
  dishCreateNote: document.getElementById("dishCreateNote"),
  dishCreateNoteResize: document.getElementById("dishCreateNoteResize"),
  dishCreateError: document.getElementById("dishCreateError"),
  dishCreateSaveBtn: document.getElementById("dishCreateSaveBtn"),
  dishItemSheet: document.getElementById("dishItemSheet"),
  dishItemBackdrop: document.getElementById("dishItemBackdrop"),
  dishItemTitle: document.getElementById("dishItemTitle"),
  dishItemCookBlock: document.getElementById("dishItemCookBlock"),
  dishItemCookBtn: document.getElementById("dishItemCookBtn"),
  dishItemCookHint: document.getElementById("dishItemCookHint"),
  dishItemGramsLabel: document.getElementById("dishItemGramsLabel"),
  dishItemGrams: document.getElementById("dishItemGrams"),
  dishItemOilBlock: document.getElementById("dishItemOilBlock"),
  dishItemOil: document.getElementById("dishItemOil"),
  dishItemDoneBtn: document.getElementById("dishItemDoneBtn"),
  dishCookPickSheet: document.getElementById("dishCookPickSheet"),
  dishCookPickBackdrop: document.getElementById("dishCookPickBackdrop"),
  dishCookPickClose: document.getElementById("dishCookPickClose"),
  dishCookPickTitle: document.getElementById("dishCookPickTitle"),
  dishCookPickOptions: document.getElementById("dishCookPickOptions"),
  flowNutritionProduct: document.getElementById("flowNutritionProduct"),
  productDetailTitle: document.getElementById("productDetailTitle"),
  productDetailDishTag: document.getElementById("productDetailDishTag"),
  productDetailKcal: document.getElementById("productDetailKcal"),
  productDetailBjuLine: document.getElementById("productDetailBjuLine"),
  productDetailBjuScore: document.getElementById("productDetailBjuScore"),
  productDetailBjuTierWord: document.getElementById("productDetailBjuTierWord"),
  productDetailBjuInfo: document.getElementById("productDetailBjuInfo"),
  productDetailFavoriteBtn: document.getElementById("productDetailFavoriteBtn"),
  productNoteBlock: document.getElementById("productNoteBlock"),
  productDetailNote: document.getElementById("productDetailNote"),
  productDetailNoteResize: document.getElementById("productDetailNoteResize"),
  productDetailNoteOk: document.getElementById("productDetailNoteOk"),
  productDishEditBtn: document.getElementById("productDishEditBtn"),
  bjuInfoSheet: document.getElementById("bjuInfoSheet"),
  bjuInfoBackdrop: document.getElementById("bjuInfoBackdrop"),
  bjuInfoClose: document.getElementById("bjuInfoClose"),
  productMacroDonutHost: document.getElementById("productMacroDonutHost"),
  productMacroLegend: document.getElementById("productMacroLegend"),
  productDetailAddBtn: document.getElementById("productDetailAddBtn"),
  productServingCard: document.getElementById("productServingCard"),
  productServingAmountLabel: document.getElementById("productServingAmountLabel"),
  productServingAmount: document.getElementById("productServingAmount"),
  productServingUnit: document.getElementById("productServingUnit"),
  productDishCookBlock: document.getElementById("productDishCookBlock"),
  productDishCookBtn: document.getElementById("productDishCookBtn"),
  productDishOilBlock: document.getElementById("productDishOilBlock"),
  productDishOil: document.getElementById("productDishOil"),
  productMacroViewToggle: document.getElementById("productMacroViewToggle"),
  nutritionSheetGramsLabel: document.getElementById("nutritionSheetGramsLabel"),
  nutritionSheetCookLabel: document.getElementById("nutritionSheetCookLabel"),
  nutritionSheetOilBlock: document.getElementById("nutritionSheetOilBlock"),
  nutritionSheetOil: document.getElementById("nutritionSheetOil"),
  productDetailDeleteBtn: document.getElementById("productDetailDeleteBtn"),
  productDeleteConfirm: document.getElementById("productDeleteConfirm"),
  productDeleteBackdrop: document.getElementById("productDeleteBackdrop"),
  productDeleteNo: document.getElementById("productDeleteNo"),
  productDeleteYes: document.getElementById("productDeleteYes"),
  productEditCard: document.getElementById("productEditCard"),
  productEditForm: document.getElementById("productEditForm"),
  nutritionCtaBar: document.getElementById("nutritionCtaBar"),
  nutritionAddMainBtn: document.getElementById("nutritionAddMainBtn"),
  nutritionQuickAddSheet: document.getElementById("nutritionQuickAddSheet"),
  nutritionSheetBackdrop: document.getElementById("nutritionSheetBackdrop"),
  nutritionSheetProductName: document.getElementById("nutritionSheetProductName"),
  nutritionSheetMeals: document.getElementById("nutritionSheetMeals"),
  nutritionSheetMealBlock: document.getElementById("nutritionSheetMealBlock"),
  nutritionSheetCookBlock: document.getElementById("nutritionSheetCookBlock"),
  nutritionSheetCook: document.getElementById("nutritionSheetCook"),
  nutritionSheetCookHint: document.getElementById("nutritionSheetCookHint"),
  nutritionSheetCookPreview: document.getElementById("nutritionSheetCookPreview"),
  nutritionSheetGrams: document.getElementById("nutritionSheetGrams"),
  nutritionSheetSubmit: document.getElementById("nutritionSheetSubmit"),
  flowDetailProductivity: document.getElementById("flowDetailProductivity"),
  productivityStrip: document.getElementById("productivityStrip"),
  productivityRadarBlock: document.getElementById("productivityRadarBlock"),
  productivityRadarChart: document.getElementById("productivityRadarChart"),
  productivityDetailBlocks: document.getElementById("productivityDetailBlocks"),
  flowDetailSport: document.getElementById("flowDetailSport"),
  sportStrip: document.getElementById("sportStrip"),
  sportDetailBlocks: document.getElementById("sportDetailBlocks"),
  flowFill: document.getElementById("flowFill"),
  fillMorning: document.getElementById("fillMorning"),
  fillOnboarding: document.getElementById("fillOnboarding"),
  fillOnboardingTrack: document.getElementById("fillOnboardingTrack"),
  fillOnboardingHint: document.getElementById("fillOnboardingHint"),
  routineBlock: document.getElementById("routineBlock"),
  sportBlock: document.getElementById("sportBlock"),
  fillDivider: document.getElementById("fillDivider"),
  routineSummaryPreview: document.getElementById("routineSummaryPreview"),
  fillHistory: document.getElementById("fillHistory"),
  fillHistoryDayStrip: document.getElementById("fillHistoryDayStrip"),
  fillHistoryHeaderBtn: document.getElementById("fillHistoryHeaderBtn"),
  fillOtherDayBtn: document.getElementById("fillOtherDayBtn"),
  routineDateLine: document.getElementById("routineDateLine"),
  sportDateLine: document.getElementById("sportDateLine"),
  routineDayBadge: document.getElementById("routineDayBadge"),
  sportDayBadge: document.getElementById("sportDayBadge"),
  customDateChoice: document.getElementById("customDateChoice"),
  dateWheelWrap: document.getElementById("dateWheelWrap"),
  wheelDay: document.getElementById("wheelDay"),
  wheelMonth: document.getElementById("wheelMonth"),
  wheelYear: document.getElementById("wheelYear"),
  wheelDoneBtn: document.getElementById("wheelDoneBtn"),
  errorBadge: document.getElementById("errorBadge"),
  formZoneHistory: document.getElementById("formZoneHistory"),
  routineCounter: document.getElementById("routineCounter"),
  historyRoutineCounter: document.getElementById("historyRoutineCounter"),
  routineGrid: document.getElementById("routineGrid"),
  historyRoutineGrid: document.getElementById("historyRoutineGrid"),
  sportFields: document.getElementById("sportFields"),
  historySportFields: document.getElementById("historySportFields"),
  ctaBar: document.getElementById("ctaBar"),
  saveBtn: document.getElementById("saveBtn"),
  panelRoutine: document.getElementById("panelRoutine"),
  panelSport: document.getElementById("panelSport"),
  diaryZoneBtn: document.getElementById("diaryZoneBtn"),
  flowDiary: document.getElementById("flowDiary"),
  flowDiaryEditor: document.getElementById("flowDiaryEditor"),
  flowDetailLedger: document.getElementById("flowDetailLedger"),
  diaryCtaBar: document.getElementById("diaryCtaBar"),
};

function setElHidden(el, hidden) {
  if (el) el.hidden = hidden;
}

function todayIso() {
  return isoFromDate(new Date());
}

function currentMonthKey() {
  return todayIso().slice(0, 7);
}

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoFromDate(d);
}

function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDdMm(iso) {
  const [, m, d] = iso.split("-");
  return `${d}-${m}`;
}

function shiftIsoByDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return isoFromDate(dt);
}

function shiftMonthKey(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

async function isMonthInDb(monthKey) {
  try {
    const data = await apiGet("/month", { month: monthKey });
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

function apiUrl(path, params = {}) {
  const qp = { ...params };
  let basePath = path;
  const qIdx = String(path).indexOf("?");
  if (qIdx >= 0) {
    const existing = new URLSearchParams(String(path).slice(qIdx + 1));
    for (const [k, v] of existing.entries()) {
      if (qp[k] === undefined) qp[k] = v;
    }
    basePath = String(path).slice(0, qIdx);
  }
  const tgInitData = window.Telegram?.WebApp?.initData;
  if (tgInitData && !qp.tgWebAppData) qp.tgWebAppData = tgInitData;
  const q = new URLSearchParams(qp).toString();
  const suffix = q ? `?${q}` : "";
  return `${API_BASE}${basePath}${suffix}`;
}

/** Скачивание файла с API: без blob (ломается в Telegram WebView и Safari). */
function downloadApiFile(path, params, filename) {
  const url = apiUrl(path, params);
  const tgApp = window.Telegram?.WebApp;
  if (typeof tgApp?.downloadFile === "function") {
    return new Promise((resolve, reject) => {
      tgApp.downloadFile({ url, file_name: filename }, (accepted) => {
        if (accepted) resolve();
        else reject(new Error("Не удалось начать загрузку"));
      });
    });
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return Promise.resolve();
}

const API_FETCH_TIMEOUT_MS = 15_000;
const SILENT_REFRESH_IDLE_MS = 8_000;

let lastUserInteractionAt = 0;
let nutritionDetailSeq = 0;
let homeRefreshSeq = 0;
let productDbAbort = null;
let productDbSeq = 0;
let nutritionSubmitLock = false;
let mealActionLock = false;
let productNoteTimer = null;
let productNoteSeq = 0;
let productNoteOkTimer = null;

function markUserInteraction() {
  lastUserInteractionAt = Date.now();
}

function userFriendlyFetchError(err) {
  const msg = String(err?.message || err || "");
  if (err?.name === "AbortError") return new Error("Нет ответа от сервера");
  if (/load failed|failed to fetch|networkerror/i.test(msg)) return new Error("Нет связи с сервером");
  return err instanceof Error ? err : new Error(msg || "Ошибка сети");
}

async function apiFetch(url, init = {}) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), API_FETCH_TIMEOUT_MS);
  const externalSignal = init.signal;
  const onExternalAbort = () => timeoutController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) timeoutController.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    const { signal: _ignored, ...rest } = init;
    const headers = new Headers(rest.headers || {});
    const tgInitData = window.Telegram?.WebApp?.initData;
    if (tgInitData) headers.set("X-Telegram-Init-Data", tgInitData);
    return await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      ...rest,
      headers,
      signal: timeoutController.signal,
    });
  } catch (err) {
    throw userFriendlyFetchError(err);
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

function hasTelegramInitData() {
  return Boolean(window.Telegram?.WebApp?.initData);
}

function setWebLoginVisible(on) {
  const gate = document.getElementById("webLoginGate");
  if (gate) gate.hidden = !on;
  document.body.classList.toggle("web-login-open", Boolean(on));
}

function setWebLoginError(msg) {
  const el = document.getElementById("webLoginError");
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

async function loginWithAccessToken(token) {
  const key = String(token || "").trim();
  if (!key) throw new Error("Введи ключ");
  const res = await apiFetch(apiUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: key }),
  });
  const data = await apiReadJson(res);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "Неверный ключ");
  }
  return data;
}

async function fetchAuthStatus() {
  try {
    const res = await apiFetch(apiUrl("/auth/status"));
    const data = await apiReadJson(res);
    if (!res.ok) return { ok: false, auth: null };
    return data;
  } catch {
    return { ok: false, auth: null };
  }
}

function stripAccessKeyFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("k")) return;
    url.searchParams.delete("k");
    const q = url.searchParams.toString();
    const next = `${url.pathname}${q ? `?${q}` : ""}${url.hash}`;
    window.history.replaceState({}, "", next);
  } catch {
    /* ignore */
  }
}

/**
 * TG Mini App: initData как раньше.
 * Safari / Домой: cookie-сессия после одноразового ключа (поле или ?k=).
 */
async function ensureWebOrTelegramAccess() {
  if (hasTelegramInitData()) {
    setWebLoginVisible(false);
    return true;
  }

  const urlKey = new URLSearchParams(window.location.search).get("k");
  if (urlKey) {
    try {
      await loginWithAccessToken(urlKey);
      stripAccessKeyFromUrl();
      setWebLoginVisible(false);
      return true;
    } catch (err) {
      stripAccessKeyFromUrl();
      setWebLoginError(String(err?.message || err || "Неверный ключ"));
    }
  }

  const status = await fetchAuthStatus();
  if (status?.auth) {
    setWebLoginVisible(false);
    return true;
  }

  setWebLoginVisible(true);
  return new Promise((resolve) => {
    const input = document.getElementById("webLoginKey");
    const btn = document.getElementById("webLoginSubmit");
    const submit = async () => {
      setWebLoginError("");
      try {
        await loginWithAccessToken(input?.value || "");
        if (input) input.value = "";
        setWebLoginVisible(false);
        resolve(true);
      } catch (err) {
        setWebLoginError(String(err?.message || err || "Неверный ключ"));
      }
    };
    btn?.addEventListener("click", submit);
    input?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        submit();
      }
    });
    input?.focus?.();
  });
}

async function apiReadJson(res) {
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(res.ok ? "Некорректный ответ сервера" : `Ошибка ${res.status}`);
  }
  return data;
}

async function apiGet(path, params, fetchOpts = {}) {
  const res = await apiFetch(apiUrl(path, params), fetchOpts);
  const data = await apiReadJson(res);
  if (!res.ok && data?.error) throw new Error(data.error);
  return data;
}

async function apiPost(body) {
  const res = await apiFetch(apiUrl("/write"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await apiReadJson(res);
  if (!data?.ok) throw new Error(data?.error || "Ошибка записи");
  return data;
}

async function apiPostJson(path, body) {
  const res = await apiFetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await apiReadJson(res);
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Ошибка запроса");
  return data;
}

async function apiPatchJson(path, body) {
  const res = await apiFetch(apiUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await apiReadJson(res);
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Ошибка запроса");
  return data;
}

async function apiPutJson(path, body) {
  const res = await apiFetch(apiUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await apiReadJson(res);
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Ошибка запроса");
  return data;
}

async function apiDelete(path, params = {}) {
  const res = await apiFetch(apiUrl(path, params), { method: "DELETE" });
  const data = await apiReadJson(res);
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Ошибка удаления");
  return data;
}

function progressColor(pct) {
  const p = Number(pct) || 0;
  if (p >= 50) return "var(--green)";
  if (p >= 25) return "var(--yellow)";
  return "var(--red)";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Дневник: короткое имя — без магазина/ООО; с кавычками — до закрывающей. */
function diaryDisplayName(name) {
  let s = String(name || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+(ВкусВилл|Перекресток|Перекрёсток|Перек|Магнит|Лента|Лавка|5ка)\s*$/u, "")
    .replace(/,?\s*Вкусно и точка\s*$/u, "")
    .replace(/,?\s*Швили\s*$/u, "")
    .trim();
  const quoted = s.match(/^([\s\S]*?"[^"]+")/);
  if (quoted) return quoted[1].trim();
  if (s.length > 40) {
    const cut = s.slice(0, 40);
    const sp = cut.lastIndexOf(" ");
    return `${(sp > 16 ? cut.slice(0, sp) : cut).trim()}…`;
  }
  return s;
}

const NUTRITION_BAR_LABELS = {
  calories: "Ккал",
  protein: "Белок",
  fat: "Жиры",
  carbs: "Углеводы",
};

const NUTRITION_HOME_BAR_LABELS = {
  calories: "Ккал",
  protein: "Белок",
  fat: "Жиры",
  carbs: "Углев",
};

function nutritionBarColor(key, pct) {
  if (key === "calories") return "var(--hint)";
  if (key === "protein") return MACRO_COLORS.protein;
  if (key === "carbs") return MACRO_COLORS.carbs;
  if (key === "fat") return MACRO_COLORS.fat;
  return progressColor(pct);
}

function formatNutritionBarAmount(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return v.toFixed(1);
}

function nutritionBarDetailLeft(b) {
  const name = NUTRITION_BAR_LABELS[b.key] || b.key;
  const fact = formatNutritionBarAmount(b.fact);
  const target = formatNutritionBarAmount(b.target);
  if (b.key === "calories") return `${name} — ${fact} / ${target}`;
  return `${name} — ${fact} / ${target} г`;
}

function nutritionBarDetailRight(b) {
  const fact = Number(b.fact) || 0;
  const target = Number(b.target) || 0;
  const unit = b.key === "calories" ? "Ккал" : "г";
  if (fact > target) {
    return `+${formatNutritionBarAmount(fact - target)} ${unit}`;
  }
  return `${formatNutritionBarAmount(target - fact)} ${unit}`;
}

function nutritionBarOverTone(key, overage) {
  const amount = Number(overage) || 0;
  if (amount <= 0 || key === "calories") return null;
  const greenMax = { protein: 15, carbs: 25, fat: 10 }[key];
  const yellowMax = { protein: 30, carbs: 50, fat: 15 }[key];
  if (greenMax == null || yellowMax == null) return null;
  if (amount <= greenMax) return "green";
  if (amount <= yellowMax) return "yellow";
  return "red";
}

function nutritionBarDetailRightClass(b) {
  const fact = Number(b.fact) || 0;
  const target = Number(b.target) || 0;
  const isOver = target > 0 && fact > target;
  const remainder = isOver ? fact - target : target - fact;
  const classes = ["nutrition-bar__right"];
  if (!isOver) {
    if (remainder < 0.05) classes.push("nutrition-bar__right--zero");
    return classes.join(" ");
  }
  if (b.key !== "calories") classes.push("nutrition-bar__right--over");
  const tone = nutritionBarOverTone(b.key, fact - target);
  if (tone) classes.push(`nutrition-bar__right--tone-${tone}`);
  return classes.join(" ");
}

function formatSheetGramsValue(grams) {
  const n = Number(grams);
  if (!n || n <= 0) return "";
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return String(Math.round(n * 10) / 10);
}

function formatMacroFieldValue(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  return String(n);
}

function focusWithoutScroll(el) {
  if (!el?.focus) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

function pinNumericCaretEnd(input) {
  if (!input || document.activeElement !== input) return;
  const len = input.value.length;
  if (!len) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  if (start === 0 && end === 0) {
    try {
      input.setSelectionRange(len, len);
    } catch {
      /* unsupported */
    }
  }
}

function scheduleNumericCaretFix(input) {
  if (!input) return;
  pinNumericCaretEnd(input);
  requestAnimationFrame(() => pinNumericCaretEnd(input));
  setTimeout(() => pinNumericCaretEnd(input), 0);
  setTimeout(() => pinNumericCaretEnd(input), 50);
}

const TEXT_KEYBOARD_SELECTOR = 'input[name="name"], [data-keyboard="text"]';

function wantsTextKeyboard(el) {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el.matches(TEXT_KEYBOARD_SELECTOR)
    : false;
}

function configureInputKeyboard(el) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (el.type === "hidden" || el.type === "checkbox" || el.type === "radio" || el.type === "file") {
    return;
  }

  if (wantsTextKeyboard(el)) {
    el.inputMode = "text";
    el.setAttribute("inputmode", "text");
    el.removeAttribute("pattern");
    el.classList.remove("field-input--numeric");
    if (el.tagName === "INPUT") el.type = el.type === "search" ? "search" : "text";
    return;
  }

  el.type = "text";
  el.inputMode = "decimal";
  el.setAttribute("inputmode", "decimal");
  el.setAttribute("dir", "ltr");
  el.autocomplete = "off";
  el.autocorrect = "off";
  el.spellcheck = false;
  el.classList.add("field-input--numeric");
}

function numericInputsIn(root) {
  if (!root) return [];
  const list = [];
  if (
    (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) &&
    root.classList.contains("field-input--numeric")
  ) {
    list.push(root);
  }
  if (root.querySelectorAll) {
    root.querySelectorAll(".field-input--numeric").forEach((el) => {
      if (!list.includes(el)) list.push(el);
    });
  }
  return list;
}

function bindNumericCaretFix(root) {
  numericInputsIn(root).forEach((input) => {
    if (input.dataset.caretFixBound === "1") return;
    input.dataset.caretFixBound = "1";
    input.addEventListener("focus", () => {
      requestAnimationFrame(() => pinNumericCaretEnd(input));
    });
    input.addEventListener("click", () => {
      requestAnimationFrame(() => pinNumericCaretEnd(input));
    });
  });
}

/** Цифровая клавиатура iOS везде, кроме [data-keyboard="text"] и name="name". */
function syncInputKeyboards(root = document.body) {
  if (!root) return;
  const fields =
    root === document.body || root === document
      ? document.body.querySelectorAll("input, textarea")
      : root.querySelectorAll
        ? root.querySelectorAll("input, textarea")
        : [];
  if (
    (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) &&
    !fields.length
  ) {
    configureInputKeyboard(root);
  } else {
    fields.forEach(configureInputKeyboard);
  }
  bindNumericCaretFix(root === document ? document.body : root);
}

function rememberProductLastGrams(productId, grams) {
  const p = state.nutritionProductsById.get(Number(productId));
  if (p) p.lastServingGrams = grams;
}

function rememberFoodLastGrams(foodId, grams) {
  const p = state.nutritionFoodById.get(Number(foodId));
  if (p) p.lastServingGrams = grams;
}

function cookPrefStorageKey(kind, id) {
  return `${kind}:${id}`;
}

function loadCookPref(kind, id) {
  try {
    const all = JSON.parse(localStorage.getItem(COOK_PREF_KEY) || "{}");
    const key = cookPrefStorageKey(kind, id);
    if (all[key]) return all[key];
    if (kind === "product" && all[String(id)]) return all[String(id)];
    return null;
  } catch {
    return null;
  }
}

function saveCookPref(kind, id, weighedGrams, modeId) {
  try {
    const all = JSON.parse(localStorage.getItem(COOK_PREF_KEY) || "{}");
    all[cookPrefStorageKey(kind, id)] = { grams: weighedGrams, mode: modeId };
    localStorage.setItem(COOK_PREF_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function getCookMode(modeId) {
  return COOK_MODE_BY_ID[modeId] || COOK_MODES[0];
}

function resolveCookFactor(productName, modeId) {
  const mode = modeId || "plain";
  const name = String(productName || "");
  if (name.trim()) {
    for (const rule of COOK_FACTOR_RULES) {
      if (rule.modes.includes(mode) && rule.match(name)) return rule.factor;
    }
  }
  return getCookMode(mode).factor;
}

function cookUiFor(kind, modeId) {
  const byKind = kind && COOK_UI_BY_KIND[kind];
  const ui = byKind?.[modeId] || byKind?.plain;
  if (ui) return ui;
  return { label: modeId === "plain" ? "Как в базе" : "Готовое", hint: "" };
}

function softenCookNameTypos(name) {
  let s = String(name || "").toLowerCase();
  for (const [pat, repl] of COOK_NAME_TYPO_FIXES) {
    s = s.replace(pat, repl);
  }
  return s;
}

/** Яйца/омлет не мясо («яйца куриного» → курин). Шоколадные яйца — обычный матч. */
const EGG_PRODUCT_RE = /яйц|яичниц|омлет/i;
const CHOCOLATE_RE = /шоколад/i;
/** Готовые к еде: без чипов «сырой/варёный» (хлеб ≠ крупа; авокадо ≠ овощ). */
const NO_COOK_PRODUCT_RE =
  /хлеб|батон(?![а-яёa-z0-9])|багет|чиабатт|фокачч|лаваш|лепёшк|лепешк|булк|булочк|круассан|баранк|сухар|гренк|тартин|(?<![а-яёa-z0-9])тост(?![а-яёa-z0-9])|авокадо/i;
const NO_COOK_CATEGORY_SLUGS = new Set([
  "eggs",
  "bread_bakery",
  "fruits_berries",
  "sweets",
  "snacks",
  "drinks",
]);

function isNoCookProductName(name) {
  const s = softenCookNameTypos(name);
  if (!s.trim()) return false;
  if (EGG_PRODUCT_RE.test(s) && !CHOCOLATE_RE.test(s)) return true;
  return NO_COOK_PRODUCT_RE.test(s);
}

function shouldSkipCookKind(name, categorySlug) {
  if (NO_COOK_CATEGORY_SLUGS.has(String(categorySlug || "").toLowerCase())) return true;
  return isNoCookProductName(name);
}

function inferCookKindFromName(name) {
  const s = softenCookNameTypos(name);
  if (!s.trim()) return null;
  if (isNoCookProductName(name)) return null;
  for (const [kind, pat] of COOK_KIND_FROM_NAME) {
    if (pat.test(s)) return kind;
  }
  return null;
}

function productCookKind(product) {
  if (product?.isDish) return null;
  if (shouldSkipCookKind(product?.name || "", product?.categorySlug)) return null;
  const raw = product?.cookKind || null;
  if (raw && COOK_MODES_BY_KIND[raw]) return raw;
  return inferCookKindFromName(product?.name || "") || null;
}

function dishCookUiFor(kind, modeId) {
  const byKind = kind && DISH_COOK_UI_BY_KIND[kind];
  if (byKind?.[modeId]) return byKind[modeId];
  if (modeId === "fry_meat") return { label: "Жареный", hint: "" };
  if (modeId === "fry_veg") return { label: "Жареный", hint: "" };
  if (modeId === "plain") return byKind?.plain || { label: "Как есть", hint: "" };
  return cookUiFor(kind, modeId);
}

function cookModesForProduct(product) {
  if (product?.isDish) return null;
  const kind = productCookKind(product);
  if (!kind || !COOK_MODES_BY_KIND[kind]) return null;
  return COOK_MODES_BY_KIND[kind]
    .map((id) => {
      const base = COOK_MODE_BY_ID[id];
      if (!base) return null;
      const ui = cookUiFor(kind, id);
      return { ...base, label: ui.label, hint: ui.hint };
    })
    .filter(Boolean);
}

/** Вес с весов → учётные граммы (для превью ккал на фронте). */
function cookLogGrams(weighedGrams, modeId, productName) {
  const g = Number(weighedGrams);
  if (!g || g <= 0) return 0;
  const factor = resolveCookFactor(productName, modeId);
  return Math.round(g * factor * 10) / 10;
}

function resolveQuickAddItem() {
  if (state.nutritionQuickAddFoodId != null) {
    return state.nutritionFoodById.get(Number(state.nutritionQuickAddFoodId));
  }
  if (state.nutritionQuickAddProductId != null) {
    return state.nutritionProductsById.get(Number(state.nutritionQuickAddProductId));
  }
  return null;
}

function syncNutritionSheetOilBlock() {
  const fry = isFryCookMode(state.nutritionCookMode);
  if (els.nutritionSheetOilBlock) els.nutritionSheetOilBlock.hidden = !fry;
}

function renderCookModeButtons(product) {
  if (state.nutritionSheetMode === "dish") {
    renderDishCookModeButtons(dishEditItem());
    return;
  }
  if (!els.nutritionSheetCook) return;
  const modes = cookModesForProduct(product) || [];
  if (!modes.length) {
    els.nutritionSheetCook.innerHTML = "";
    syncNutritionSheetOilBlock();
    return;
  }
  const allowed = new Set(modes.map((m) => m.id));
  if (!allowed.has(state.nutritionCookMode)) {
    state.nutritionCookMode = "plain";
  }
  const active = state.nutritionCookMode || "plain";
  els.nutritionSheetCook.innerHTML = modes
    .map(
      (m) =>
        `<button type="button" class="segmented__btn${m.id === active ? " is-active" : ""}" data-cook-mode="${m.id}" role="tab" aria-selected="${m.id === active}">${m.label}</button>`
    )
    .join("");
  els.nutritionSheetCook.querySelectorAll("[data-cook-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.nutritionCookMode = btn.dataset.cookMode || "plain";
      if (!isFryCookMode(state.nutritionCookMode) && els.nutritionSheetOil) {
        els.nutritionSheetOil.value = "";
      }
      renderCookModeButtons(product);
      updateCookSheetMeta();
      if (isFryCookMode(state.nutritionCookMode)) {
        requestAnimationFrame(() => {
          focusWithoutScroll(els.nutritionSheetOil);
          scheduleNumericCaretFix(els.nutritionSheetOil);
        });
      }
    });
  });
  syncNutritionSheetOilBlock();
}

function renderDishCookModeButtons(item) {
  if (!els.nutritionSheetCook) return;
  const modes = cookModesForDishIngredient(item);
  if (!modes.length) {
    els.nutritionSheetCook.innerHTML = "";
    syncNutritionSheetOilBlock();
    return;
  }
  const allowed = new Set(modes.map((m) => m.id));
  if (!allowed.has(state.nutritionCookMode)) {
    state.nutritionCookMode = "plain";
  }
  const active = state.nutritionCookMode || "plain";
  els.nutritionSheetCook.innerHTML = modes
    .map(
      (m) =>
        `<button type="button" class="segmented__btn${m.id === active ? " is-active" : ""}" data-cook-mode="${m.id}" role="tab" aria-selected="${m.id === active}">${escapeHtml(m.label)}</button>`
    )
    .join("");
  els.nutritionSheetCook.querySelectorAll("[data-cook-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.nutritionCookMode = btn.dataset.cookMode || "plain";
      if (!isFryCookMode(state.nutritionCookMode) && els.nutritionSheetOil) {
        els.nutritionSheetOil.value = "";
      }
      renderDishCookModeButtons(item);
      updateCookSheetMeta();
    });
  });
  syncNutritionSheetOilBlock();
}

function updateCookSheetMeta() {
  if (state.nutritionSheetMode === "dish") {
    updateDishCookSheetMeta();
    return;
  }
  const product = resolveQuickAddItem();
  const kind = productCookKind(product);
  const modeId = state.nutritionCookMode || "plain";
  const mode = getCookMode(modeId);
  const ui = cookUiFor(kind, modeId);
  const weighed = Number(String(els.nutritionSheetGrams?.value || "").replace(",", "."));
  syncNutritionSheetOilBlock();
  if (els.nutritionSheetGramsLabel) {
    if (product?.isDish) {
      els.nutritionSheetGramsLabel.textContent = dishLogGramsLabel(product);
    } else if (!kind) {
      els.nutritionSheetGramsLabel.textContent = "Граммы";
    } else {
      els.nutritionSheetGramsLabel.textContent = `Граммы · ${ui.label.toLowerCase()}`;
    }
  }
  if (els.nutritionSheetCookHint) {
    if (ui.hint) {
      els.nutritionSheetCookHint.hidden = false;
      els.nutritionSheetCookHint.textContent = ui.hint;
    } else {
      els.nutritionSheetCookHint.hidden = true;
      els.nutritionSheetCookHint.textContent = "";
    }
  }
  if (!els.nutritionSheetCookPreview) return;
  if (!weighed || weighed <= 0 || !product) {
    els.nutritionSheetCookPreview.textContent = "";
    return;
  }
  const accountG = cookLogGrams(weighed, mode.id, product?.name);
  let kcal = ((Number(product.kcalPer100g) || 0) * accountG) / 100;
  if (isFryCookMode(modeId)) {
    const oil = Number(String(els.nutritionSheetOil?.value || "").replace(",", "."));
    if (oil > 0) kcal += oil * OIL_KCAL_PER_G;
  }
  els.nutritionSheetCookPreview.textContent = `≈ ${Math.round(kcal)} ккал`;
}

function updateDishCookSheetMeta() {
  const item = dishEditItem();
  const kind = dishIngredientKind(item);
  const modeId = state.nutritionCookMode || "plain";
  const weighed = Number(String(els.nutritionSheetGrams?.value || "").replace(",", "."));
  if (els.nutritionSheetCookHint) {
    els.nutritionSheetCookHint.hidden = true;
    els.nutritionSheetCookHint.textContent = "";
  }
  if (els.nutritionSheetGramsLabel) {
    if (kind === "meat_fish" || kind === "veg" || isFryCookMode(modeId)) {
      els.nutritionSheetGramsLabel.textContent = "Вес сырого продукта";
    } else if (kind) {
      els.nutritionSheetGramsLabel.textContent = "Вес сухого продукта";
    } else {
      els.nutritionSheetGramsLabel.textContent = "Граммы";
    }
  }
  syncNutritionSheetOilBlock();
  if (!els.nutritionSheetCookPreview) return;
  if (!item || !weighed || weighed <= 0) {
    els.nutritionSheetCookPreview.textContent = "";
    return;
  }
  const oil = isFryCookMode(modeId) ? String(els.nutritionSheetOil?.value || "") : "";
  const part = dishItemPart({
    ...item,
    grams: String(weighed),
    cookMode: modeId,
    oilGrams: oil,
  });
  els.nutritionSheetCookPreview.textContent = part ? `≈ ${Math.round(part.kcal)} ккал` : "";
}

function formatNutritionTargetLine(data) {
  if (!data?.ok) return "";
  const label = data.sportDayLabel || data.sportDayKind || "";
  if (!label) return "";
  return `Таргет: ${label}`;
}

function nutritionViewDateIso() {
  return state.nutritionDetailDate || todayIso();
}

function nutritionLogDate() {
  if (isNutritionScreen(state.screen)) return nutritionViewDateIso();
  return todayIso();
}

function nutritionDayShortLabel(iso = nutritionViewDateIso()) {
  if (iso === todayIso()) return "сегодня";
  if (iso === yesterdayIso()) return "вчера";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

function nutritionAddToDayLabel() {
  const day = nutritionDayShortLabel();
  if (day === "сегодня" || day === "вчера") {
    return `Добавить · ${day.charAt(0).toUpperCase() + day.slice(1)}`;
  }
  return `Добавить · ${day}`;
}

function dishAddButtonLabel() {
  const name = String(els.dishCreateName?.value || "").trim();
  if (!name) return "Добавить";
  const short = name.length > 28 ? `${name.slice(0, 27)}…` : name;
  return `Добавить · ${short}`;
}

function syncNutritionAddLabels() {
  const mainLabel =
    nutritionViewDateIso() === todayIso()
      ? "Добавить продукт"
      : `Добавить продукт · ${nutritionDayShortLabel()}`;
  if (els.nutritionAddMainBtn) els.nutritionAddMainBtn.textContent = mainLabel;
  if (els.productDetailAddBtn) {
    if (isDishIngredientCardOpen()) {
      els.productDetailAddBtn.textContent = dishAddButtonLabel();
    } else {
      els.productDetailAddBtn.textContent = state.nutritionViewServingEntry?.id
        ? "Сохранить"
        : nutritionAddToDayLabel();
    }
  }
  if (
    els.nutritionSheetSubmit &&
    state.nutritionSheetMode === "add" &&
    els.nutritionQuickAddSheet &&
    !els.nutritionQuickAddSheet.hidden
  ) {
    els.nutritionSheetSubmit.textContent = nutritionAddToDayLabel();
  }
}

function formatNutritionDayLabel(iso) {
  if (iso === todayIso()) return "Сегодня";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = WEEKDAY_SHORT[date.getDay()];
  const month = MONTH_GENITIVE[m - 1];
  return `${weekday}, ${d} ${month}`;
}

/** История fill: сразу вчера (сегодня уже на «Заполнить»). */
function formatFillHistoryDayLabel(iso) {
  if (iso === yesterdayIso()) return "Вчера";
  return formatNutritionDayLabel(iso);
}

function renderNutritionDayStrip(iso) {
  if (!els.nutritionDayStrip) return;
  const label = formatNutritionDayLabel(iso);
  els.nutritionDayStrip.className = "nutrition-day-strip";
  els.nutritionDayStrip.setAttribute(
    "aria-label",
    `${label}. Тап слева или справа — другой день`
  );
  els.nutritionDayStrip.innerHTML = `
    <div class="nutrition-day-nav">
      <button type="button" class="nutrition-day-nav__hit nutrition-day-nav__hit--prev" data-nutrition-day-prev aria-label="Предыдущий день">
        <span class="nutrition-day-nav__chev" aria-hidden="true">‹</span>
      </button>
      <div class="nutrition-day-nav__title">
        <span class="nutrition-day-nav__primary">${escapeHtml(label)}</span>
      </div>
      <button type="button" class="nutrition-day-nav__hit nutrition-day-nav__hit--next" data-nutrition-day-next aria-label="Следующий день">
        <span class="nutrition-day-nav__chev" aria-hidden="true">›</span>
      </button>
      <button type="button" class="fill-block__badge fill-block__badge--btn is-today nutrition-day-nav__products" data-nutrition-products-open>База</button>
    </div>`;
}

function renderDaySwipeStrip(stripEl, iso) {
  if (!stripEl) return;
  const isFillHistory = stripEl === els.fillHistoryDayStrip;
  const label = isFillHistory ? formatFillHistoryDayLabel(iso) : formatNutritionDayLabel(iso);
  stripEl.className = "nutrition-day-strip progress-strip--swipe";
  stripEl.setAttribute(
    "aria-label",
    isFillHistory
      ? `${label}. Стрелки или свайп влево/вправо — другой день`
      : `${label}. Свайп влево или вправо — другой день`
  );
  stripEl.className = isFillHistory ? "nutrition-day-strip" : stripEl.className;
  stripEl.innerHTML = isFillHistory
    ? `
      <div class="nutrition-day-nav">
        <button type="button" class="nutrition-day-nav__hit nutrition-day-nav__hit--prev" data-fill-history-day-prev aria-label="Предыдущий день">
          <span class="nutrition-day-nav__chev" aria-hidden="true">‹</span>
        </button>
        <div class="nutrition-day-nav__title">
          <span class="nutrition-day-nav__primary">${escapeHtml(label)}</span>
        </div>
        <button type="button" class="nutrition-day-nav__hit nutrition-day-nav__hit--next" data-fill-history-day-next aria-label="Следующий день">
          <span class="nutrition-day-nav__chev" aria-hidden="true">›</span>
        </button>
      </div>`
    : `
      <p class="nutrition-day-strip__title">${escapeHtml(label)}</p>
      ${renderKpiSwipeDots(3, 1)}`;
}

function renderFillHistoryDayStrip(iso) {
  renderDaySwipeStrip(els.fillHistoryDayStrip, iso);
}

function renderNutritionDetailTarget(data) {
  if (!els.nutritionDetailTarget) return;
  const line = formatNutritionTargetLine(data);
  if (!line) {
    setElHidden(els.nutritionDetailTarget, true);
    els.nutritionDetailTarget.textContent = "";
    return;
  }
  els.nutritionDetailTarget.textContent = line;
  setElHidden(els.nutritionDetailTarget, false);
}

function syncNutritionCheatmealBtn(data) {
  const btn = els.nutritionCheatmealBtn;
  if (!btn) return;
  const on = Boolean(data?.cheatMeal);
  btn.classList.toggle("is-active", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

async function toggleNutritionCheatmeal() {
  const iso = nutritionViewDateIso();
  const next = !state.nutritionDay?.cheatMeal;
  const data = await apiPutJson("/nutrition/day/cheatmeal", {
    date: iso,
    enabled: next,
  });
  if (!data?.ok) throw new Error(data?.error || "Не удалось переключить читмил");
  state.nutritionDay = data;
  renderNutritionDetailTarget(data);
  renderNutritionBarsInto(els.nutritionDetailBars, data);
  syncNutritionCheatmealBtn(data);
  if (iso === todayIso()) renderNutritionBars(data);
}

function renderNutritionHomeBars(container, data) {
  if (!container) return;
  const bars = data?.bars || [];
  if (!data?.ok || !bars.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = bars
    .map((b) => {
      const pct = Math.min(100, Math.max(0, Number(b.pct) || 0));
      const color = nutritionBarColor(b.key, pct);
      const name = NUTRITION_HOME_BAR_LABELS[b.key] || b.key;
      return `
        <div class="nutrition-bar nutrition-bar--home">
          <div class="nutrition-bar__track" role="progressbar" aria-label="${escapeHtml(name)}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="nutrition-bar__fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="nutrition-bar__home-label">${escapeHtml(name)}</span>
        </div>`;
    })
    .join("");
}

function renderNutritionBarsInto(container, data) {
  if (!container) return;
  const bars = data?.bars || [];
  if (!data?.ok || !bars.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<div class="nutrition-bars nutrition-bars--detail">${bars
    .map((b) => {
      const fact = Number(b.fact) || 0;
      const target = Number(b.target) || 0;
      const isOver = target > 0 && fact > target;
      const pct = isOver ? 100 : Math.min(100, Math.max(0, Number(b.pct) || 0));
      const color = nutritionBarColor(b.key, pct);
      const rightClass = nutritionBarDetailRightClass(b);
      const fillHtml = `<div class="nutrition-bar__fill" style="width:${pct}%;background:${color}"></div>`;
      return `
        <div class="nutrition-bar nutrition-bar--detail${isOver ? " nutrition-bar--over" : ""}">
          <div class="nutrition-bar__labels">
            <span class="nutrition-bar__left">${escapeHtml(nutritionBarDetailLeft(b))}</span>
            <span class="${rightClass}">${escapeHtml(nutritionBarDetailRight(b))}</span>
          </div>
          <div class="nutrition-bar__track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            ${fillHtml}
          </div>
        </div>`;
    })
    .join("")}</div>`;
}

function renderNutritionBars(data) {
  if (!els.nutritionBars || !els.nutritionZoneBtn) return;
  if (!data?.ok) {
    setElHidden(els.nutritionZoneBtn, true);
    return;
  }
  setElHidden(els.nutritionZoneBtn, false);
  renderNutritionHomeBars(els.nutritionBars, data);
}

async function fetchNutritionDay(iso = todayIso()) {
  const data = await apiGet("/nutrition/day", { date: iso });
  if (!data.ok) throw new Error(data.error || "Нет данных питания");
  return data;
}

async function loadNutritionToday(opts = {}) {
  if (state.screen !== "home" || !els.nutritionZoneBtn) return;
  const fresh = Boolean(opts?.fresh);
  if (!fresh && state.nutritionDay?.ok) renderNutritionBars(state.nutritionDay);
  try {
    const data = await fetchNutritionDay(todayIso());
    state.nutritionDay = data;
    renderNutritionBars(data);
  } catch {
    if (!state.nutritionDay?.ok) setElHidden(els.nutritionZoneBtn, true);
  }
}

async function refreshHomeZones(zoneOpts, monthKey, seq) {
  if (seq !== homeRefreshSeq || state.screen !== "home") return;
  await Promise.allSettled([
    loadNutritionToday(zoneOpts),
    loadYesterdayDay(),
    window.LifeFinance?.loadHome?.({ monthKey, ...zoneOpts }),
    window.LifeLedger?.loadHome?.(zoneOpts),
    window.LifeDiary?.renderHome?.(zoneOpts),
  ]);
}

function monthDataForKpi(monthData, monthKey) {
  if (monthData?.ok) return monthData;
  const week = state.weekProductivity;
  if (!week?.ok) return null;
  return {
    ok: true,
    month: monthKey,
    rows: week.rows || [],
    sport: week.sport || {},
    sportByType: week.sportByType || {},
    routineSummary: week.routineSummary || {},
  };
}

function renderHomeKpi(monthData, monthKey) {
  const payload = monthDataForKpi(monthData, monthKey);
  if (payload) renderKpiCards(payload);
}

async function refreshHomeScreen(opts = {}) {
  if (state.screen !== "home") return state.monthData;
  const seq = ++homeRefreshSeq;
  const fresh = Boolean(opts.fresh);
  const skipMonth = Boolean(opts.skipMonth);
  const monthKey = opts.monthKey || currentMonthKey();
  lastHomeFullLoadAt = Date.now();
  state.monthKey = monthKey;
  els.monthLabel.textContent = formatMonthLabel(monthKey);

  const zoneOpts = { fresh };
  let monthTask = Promise.resolve(state.monthData);
  if (!skipMonth) {
    monthTask = apiGet("/month", { month: monthKey }).then((data) => {
      if (seq !== homeRefreshSeq || state.screen !== "home") return data;
      if (data?.ok) state.monthData = data;
      return data;
    });
  }

  const weekTask = loadWeekProductivityForHome();
  const zonesTask = refreshHomeZones(zoneOpts, monthKey, seq);

  if (!fresh) {
    const data = await monthTask;
    if (seq !== homeRefreshSeq) return data;
    await weekTask;
    renderHomeKpi(data, monthKey);
    void zonesTask;
    return data;
  }

  const [data] = await Promise.all([monthTask, weekTask, zonesTask]);
  if (seq !== homeRefreshSeq) return data;
  renderHomeKpi(data, monthKey);
  return data;
}

function mealLabelById(mealId) {
  return NUTRITION_MEALS.find((m) => m.id === mealId)?.label || mealId;
}

function productFromMealEntry(entry) {
  const product = {
    id: entry.foodId || entry.productId,
    name: entry.name,
    kcalPer100g: entry.kcalPer100g,
    proteinPer100g: entry.proteinPer100g,
    fatPer100g: entry.fatPer100g,
    carbsPer100g: entry.carbsPer100g,
    fiberPer100g: entry.fiberPer100g ?? 0,
  };
  if (entry.foodId) {
    product.foodId = entry.foodId;
    product.fromCatalog = true;
  }
  if (entry.cookKind) product.cookKind = entry.cookKind;
  if (entry.isDish) product.isDish = true;
  if (entry.bjuScore != null && entry.bjuTier) {
    product.bjuScore = entry.bjuScore;
    product.bjuTier = entry.bjuTier;
  }
  return product;
}

async function fetchNutritionItemDetail(entry) {
  if (entry.foodId) {
    const data = await apiGet("/catalog/product", { foodId: entry.foodId });
    return data.product;
  }
  const data = await apiGet("/nutrition/product", { productId: entry.productId });
  return data.product;
}

async function openProductDetailFromMealEntry(entry) {
  state.nutritionBackScreen = "detailNutrition";
  let product = productFromMealEntry(entry);
  if (product.kcalPer100g == null) product = await fetchNutritionItemDetail(entry);
  cacheNutritionItem(product);
  openProductDetail(product, "detailNutrition", { serving: entry });
}

async function openProductDetailFromMealName(entry) {
  state.nutritionBackScreen = "detailNutrition";
  let product = productFromMealEntry(entry);
  if (product.kcalPer100g == null) product = await fetchNutritionItemDetail(entry);
  cacheNutritionItem(product);
  openProductDetail(product, "detailNutrition", { serving: entry });
}

async function deleteMealEntry(entryId) {
  if (mealActionLock) return;
  mealActionLock = true;
  try {
    await apiDelete(`/nutrition/log/${entryId}`);
    await refreshNutritionDetail();
    if (state.screen === "home") await loadNutritionToday();
    if (state.screen === "detailNutritionProducts") {
      await reloadProductDbForMode().catch(() => {});
    }
  } finally {
    mealActionLock = false;
  }
}

async function updateMealEntryGrams(entryId, rawGrams, cookMode, oilGrams) {
  if (mealActionLock) throw new Error("Подождите, предыдущее действие ещё выполняется");
  mealActionLock = true;
  try {
    const grams = Number(String(rawGrams).replace(",", "."));
    if (!grams || grams <= 0) throw new Error("Укажите граммы (> 0)");
    const body = { grams };
    if (cookMode) body.cookMode = cookMode;
    if (isFryCookMode(cookMode)) {
      const oil = Number(String(oilGrams ?? "").replace(",", "."));
      body.oilGrams = oil > 0 ? oil : 0;
    } else if (cookMode) {
      body.oilGrams = 0;
    }
    const data = await apiPatchJson(`/nutrition/log/${entryId}`, body);
    if (data.entry?.foodId) {
      rememberFoodLastGrams(data.entry.foodId, grams);
      if (cookMode) saveCookPref("food", data.entry.foodId, grams, cookMode);
    } else if (data.entry?.productId) {
      rememberProductLastGrams(data.entry.productId, grams);
      if (cookMode) saveCookPref("product", data.entry.productId, grams, cookMode);
    }
    await refreshNutritionDetail();
    if (state.screen === "home") await loadNutritionToday();
  } finally {
    mealActionLock = false;
  }
}

async function moveMealEntry(entryId, mealGroup) {
  if (mealActionLock) throw new Error("Подождите, предыдущее действие ещё выполняется");
  mealActionLock = true;
  try {
    await apiPatchJson(`/nutrition/log/${entryId}`, { mealGroup });
    await refreshNutritionDetail();
    if (state.screen === "home") await loadNutritionToday();
  } finally {
    mealActionLock = false;
  }
}

/** @type {null | {
 *   entryId: number,
 *   fromMeal: string,
 *   pointerId: number,
 *   sourceEl: HTMLElement,
 *   ghost: HTMLElement | null,
 *   dropMeal: string | null,
 *   started: boolean,
 *   locked: boolean,
 *   startX: number,
 *   startY: number,
 *   scrollY: number,
 *   holdTimer: ReturnType<typeof setTimeout> | null,
 *   lockTimer: ReturnType<typeof setTimeout> | null,
 * }} */
let mealDrag = null;
let mealDragSuppressClick = false;

function mealDragActive() {
  return Boolean(mealDrag?.started);
}

function clearMealDropHighlights() {
  els.nutritionMealList?.querySelectorAll(".meal-card.is-drop-target").forEach((el) => {
    el.classList.remove("is-drop-target");
  });
}

function lockMealDragScroll(drag) {
  if (!drag || drag.locked) return;
  drag.locked = true;
  drag.scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.dataset.mealDragScrollY = String(drag.scrollY);
  document.body.classList.add("is-meal-dragging");
  document.body.style.position = "fixed";
  document.body.style.top = `-${drag.scrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}

function unlockMealDragScroll(drag) {
  if (!drag?.locked && !document.body.classList.contains("is-meal-dragging")) return;
  const y = Number((drag && drag.scrollY) ?? document.body.dataset.mealDragScrollY ?? 0);
  document.body.classList.remove("is-meal-dragging");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  delete document.body.dataset.mealDragScrollY;
  if (drag) drag.locked = false;
  window.scrollTo(0, y);
}

function onMealDragPointerMove(ev) {
  if (!mealDrag || mealDrag.pointerId !== ev.pointerId) return;
  const dx = ev.clientX - mealDrag.startX;
  const dy = ev.clientY - mealDrag.startY;
  const dist = Math.hypot(dx, dy);

  if (!mealDrag.started) {
    if (dist > 12 && !mealDrag.locked) {
      endMealDrag({ drop: false });
      return;
    }
    if (mealDrag.locked || dist <= 12) ev.preventDefault();
    return;
  }
  ev.preventDefault();
  updateMealDragTarget(ev.clientX, ev.clientY);
}

function onMealDragTouchMove(ev) {
  if (!mealDrag) return;
  if (mealDrag.locked || mealDrag.started) ev.preventDefault();
}

function onMealDragPointerUp(ev) {
  if (!mealDrag || mealDrag.pointerId !== ev.pointerId) return;
  if (!mealDrag.started) {
    endMealDrag({ drop: false });
    return;
  }
  updateMealDragTarget(ev.clientX, ev.clientY);
  endMealDrag({ drop: true });
}

function onMealDragPointerCancel(ev) {
  if (!mealDrag || mealDrag.pointerId !== ev.pointerId) return;
  endMealDrag({ drop: false });
}

function bindMealDragDocumentListeners() {
  document.addEventListener("pointermove", onMealDragPointerMove, { passive: false });
  document.addEventListener("touchmove", onMealDragTouchMove, { passive: false, capture: true });
  document.addEventListener("pointerup", onMealDragPointerUp);
  document.addEventListener("pointercancel", onMealDragPointerCancel);
}

function unbindMealDragDocumentListeners() {
  document.removeEventListener("pointermove", onMealDragPointerMove);
  document.removeEventListener("touchmove", onMealDragTouchMove, true);
  document.removeEventListener("pointerup", onMealDragPointerUp);
  document.removeEventListener("pointercancel", onMealDragPointerCancel);
}

function endMealDrag({ drop = true } = {}) {
  if (!mealDrag) return;
  const drag = mealDrag;
  mealDrag = null;
  unbindMealDragDocumentListeners();
  if (drag.holdTimer) clearTimeout(drag.holdTimer);
  if (drag.lockTimer) clearTimeout(drag.lockTimer);
  drag.sourceEl.classList.remove("is-dragging");
  drag.ghost?.remove();
  unlockMealDragScroll(drag);
  clearMealDropHighlights();
  try {
    drag.sourceEl.releasePointerCapture?.(drag.pointerId);
  } catch (_) {
    /* ignore */
  }

  const toMeal = drop ? drag.dropMeal : null;
  if (drag.started && toMeal && toMeal !== drag.fromMeal) {
    mealDragSuppressClick = true;
    setTimeout(() => {
      mealDragSuppressClick = false;
    }, 50);
    moveMealEntry(drag.entryId, toMeal).catch((err) => alert(String(err.message || err)));
  } else if (drag.started) {
    mealDragSuppressClick = true;
    setTimeout(() => {
      mealDragSuppressClick = false;
    }, 50);
  }
}

function updateMealDragTarget(clientX, clientY) {
  if (!mealDrag?.started || !mealDrag.ghost) return;
  mealDrag.ghost.style.left = `${clientX}px`;
  mealDrag.ghost.style.top = `${clientY}px`;

  mealDrag.ghost.style.visibility = "hidden";
  const under = document.elementFromPoint(clientX, clientY);
  mealDrag.ghost.style.visibility = "";

  const card = under?.closest?.(".meal-card");
  const toMeal = card?.dataset?.meal || null;
  mealDrag.dropMeal = toMeal && toMeal !== mealDrag.fromMeal ? toMeal : null;

  clearMealDropHighlights();
  if (mealDrag.dropMeal && card) card.classList.add("is-drop-target");

  const edge = 56;
  const maxY = window.innerHeight;
  if (clientY < edge || clientY > maxY - edge) {
    const delta = clientY < edge ? -16 : 16;
    const next = Math.max(0, (mealDrag.scrollY || 0) + delta);
    mealDrag.scrollY = next;
    document.body.dataset.mealDragScrollY = String(next);
    document.body.style.top = `-${next}px`;
  }
}

function beginMealDrag(drag) {
  if (!drag || mealDrag !== drag || drag.started) return;
  drag.started = true;
  drag.holdTimer = null;
  if (drag.lockTimer) {
    clearTimeout(drag.lockTimer);
    drag.lockTimer = null;
  }
  lockMealDragScroll(drag);
  drag.sourceEl.classList.add("is-dragging");

  const ghost = document.createElement("div");
  ghost.className = "meal-entry-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const name = drag.sourceEl.querySelector(".meal-entry__name")?.textContent || "Продукт";
  const meta = drag.sourceEl.querySelector(".meal-entry__meta")?.textContent || "";
  ghost.innerHTML = `<span class="meal-entry-ghost__name">${escapeHtml(name)}</span><span class="meal-entry-ghost__meta">${escapeHtml(meta.trim())}</span>`;
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  ghost.style.left = `${drag.startX}px`;
  ghost.style.top = `${drag.startY}px`;

  try {
    drag.sourceEl.setPointerCapture(drag.pointerId);
  } catch (_) {
    /* ignore */
  }
  if (navigator.vibrate) {
    try {
      navigator.vibrate(12);
    } catch (_) {
      /* ignore */
    }
  }
}

function bindMealEntryDrag(entryEl, entry) {
  if (!entryEl || !entry?.id || !entry.mealGroup) return;

  entryEl.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    if (ev.target.closest(".meal-entry__del, .meal-entry__meta-btn, .meal-entry__chev, .meal-card__add")) return;
    if (mealActionLock || mealDrag) return;

    mealDrag = {
      entryId: entry.id,
      fromMeal: entry.mealGroup,
      pointerId: ev.pointerId,
      sourceEl: entryEl,
      ghost: null,
      dropMeal: null,
      started: false,
      locked: false,
      startX: ev.clientX,
      startY: ev.clientY,
      scrollY: window.scrollY || 0,
      lockTimer: setTimeout(() => {
        if (mealDrag) lockMealDragScroll(mealDrag);
      }, 140),
      holdTimer: setTimeout(() => beginMealDrag(mealDrag), 380),
    };
    bindMealDragDocumentListeners();
  });

  entryEl.addEventListener(
    "click",
    (ev) => {
      if (!mealDragSuppressClick && !mealDragActive()) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    },
    true
  );

  entryEl.addEventListener("contextmenu", (ev) => {
    if (mealDragActive() || mealDrag) ev.preventDefault();
  });
}

function renderNutritionMealList(data) {
  if (!els.nutritionMealList) return;
  endMealDrag({ drop: false });
  const meals = data?.meals || [];
  els.nutritionMealList.innerHTML = meals
    .map((meal) => {
      const entries = meal.entries || [];
      const entriesHtml = entries.length
        ? entries
            .map(
              (e) => `
          <div class="meal-entry" data-meal-entry-id="${e.id}" data-meal-from="${escapeHtml(meal.id)}">
            <div class="meal-entry__main">
              <button type="button" class="meal-entry__name" data-meal-entry-name="${e.id}">${escapeHtml(diaryDisplayName(e.name))}</button>
              <span class="meal-entry__meta">
                <span class="meal-entry__grams">${escapeHtml(String(e.grams))} г</span>
                <span class="meal-entry__meta-sep"> · </span>
                <span class="meal-entry__kcal">${Math.round(e.kcal)} ккал</span>
              </span>
            </div>
            <button type="button" class="meal-entry__del" data-meal-entry-del="${e.id}" aria-label="Удалить">×</button>
          </div>`
            )
            .join("")
        : '<p class="meal-card__empty">Пока пусто</p>';
      return `
        <article class="meal-card" data-meal="${escapeHtml(meal.id)}">
          <div class="meal-card__head">
            <div>
              <h3 class="meal-card__title">${escapeHtml(meal.label)}</h3>
              <span class="meal-card__kcal">${Math.round(meal.kcal || 0)} ккал</span>
            </div>
            <button type="button" class="meal-card__add" data-meal-add="${escapeHtml(meal.id)}" aria-label="Добавить в ${escapeHtml(meal.label)}">+</button>
          </div>
          ${entriesHtml}
        </article>`;
    })
    .join("");

  const entryById = new Map();
  meals.forEach((meal) => {
    (meal.entries || []).forEach((e) => entryById.set(e.id, { ...e, mealGroup: meal.id }));
  });

  els.nutritionMealList.querySelectorAll("[data-meal-add]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openNutritionProducts({ mealId: btn.dataset.mealAdd });
    });
  });

  els.nutritionMealList.querySelectorAll(".meal-entry").forEach((row) => {
    const entry = entryById.get(Number(row.dataset.mealEntryId));
    if (entry) bindMealEntryDrag(row, entry);
  });

  els.nutritionMealList.querySelectorAll(".meal-entry").forEach((row) => {
    row.addEventListener("click", (ev) => {
      if (mealDragActive()) return;
      if (ev.target.closest("[data-meal-entry-del]")) return;
      const entry = entryById.get(Number(row.dataset.mealEntryId));
      if (entry) openProductDetailFromMealName(entry).catch((err) => alert(String(err.message || err)));
    });
  });

  els.nutritionMealList.querySelectorAll("[data-meal-entry-del]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (mealDragActive()) return;
      deleteMealEntry(Number(btn.dataset.mealEntryDel)).catch((err) =>
        alert(String(err.message || err))
      );
    });
  });
}

async function refreshNutritionDetail() {
  const seq = ++nutritionDetailSeq;
  const iso = state.nutritionDetailDate || todayIso();
  state.nutritionDetailDate = iso;
  renderNutritionDayStrip(iso);
  const data = await fetchNutritionDay(iso);
  if (seq !== nutritionDetailSeq) return;
  state.nutritionDay = data;
  renderNutritionDetailTarget(data);
  renderNutritionBarsInto(els.nutritionDetailBars, data);
  renderNutritionMealList(data);
  syncNutritionCheatmealBtn(data);
  syncNutritionAddLabels();
  if (state.screen === "home") renderNutritionBars(data);
}

async function cycleNutritionDay(dir) {
  const cur = state.nutritionDetailDate || todayIso();
  state.nutritionDetailDate = shiftIsoByDays(cur, dir);
  if (els.nutritionDetailBars) els.nutritionDetailBars.innerHTML = "";
  if (els.nutritionMealList) {
    els.nutritionMealList.innerHTML = '<p class="meal-card__empty">Загрузка…</p>';
  }
  try {
    await refreshNutritionDetail();
  } catch (err) {
    if (els.nutritionMealList) {
      els.nutritionMealList.innerHTML = `<p class="meal-card__empty">${escapeHtml(String(err.message || err))}</p>`;
    }
  }
}

function setNutritionExportPeriod(period) {
  state.nutritionExportPeriod = period;
  document.querySelectorAll("#flowDetailNutrition [data-export-period]").forEach((btn) => {
    const on = btn.dataset.exportPeriod === period;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

async function downloadNutritionCsv() {
  const period = state.nutritionExportPeriod || "7d";
  const filePeriod = period === "all" ? "365d" : period;
  await downloadApiFile("/nutrition/export.csv", { period }, `kbju-${filePeriod}.csv`);
}

async function openNutritionDetail() {
  state.nutritionDetailDate = todayIso();
  setScreen("detailNutrition");
  renderNutritionDayStrip(state.nutritionDetailDate);
  renderNutritionDetailTarget(null);
  syncNutritionCheatmealBtn(null);
  if (els.nutritionDetailBars) els.nutritionDetailBars.innerHTML = "";
  if (els.nutritionMealList) els.nutritionMealList.innerHTML = '<p class="meal-card__empty">Загрузка…</p>';
  try {
    await refreshNutritionDetail();
  } catch (err) {
    if (els.nutritionMealList) {
      els.nutritionMealList.innerHTML = `<p class="meal-card__empty">${escapeHtml(String(err.message || err))}</p>`;
    }
  }
}

const PRODUCT_DB_RECENT_LIMIT = 30;
const BJU_TIER_LABELS = { high: "высокий", mid: "средний", low: "низкий" };

function normalizeProductDbMode(mode) {
  if (mode === "favorites" || mode === "mine" || mode === "dishes") return mode;
  return "recent";
}

function syncProductDbModeUi() {
  const mode = normalizeProductDbMode(state.productDbMode);
  els.productDbMode?.querySelectorAll("[data-product-db-mode]").forEach((btn) => {
    const on = btn.dataset.productDbMode === mode;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function setProductDbMode(mode) {
  state.productDbMode = normalizeProductDbMode(mode);
  syncProductDbModeUi();
  syncProductDbSearchPlaceholder();
}

function reloadProductDbForMode() {
  const mode = normalizeProductDbMode(state.productDbMode);
  if (mode === "favorites") return loadFavorites();
  if (mode === "mine") return loadMyProducts();
  if (mode === "dishes") return loadMyDishes();
  return loadRecentProducts();
}

function isProductCreateSheetOpen() {
  return Boolean(els.productCreateSheet && !els.productCreateSheet.hidden);
}

function productCreateMacroFields() {
  const form = els.productCreateForm;
  if (!form) return [];
  return ["kcal", "protein", "carbs", "fat"].map((name) => form.elements?.[name]).filter(Boolean);
}

function setProductCreateStep(step) {
  const next = step === 2 ? 2 : 1;
  state.productCreateStep = next;
  const onName = next === 1;
  if (els.productCreateStepName) els.productCreateStepName.hidden = !onName;
  if (els.productCreateStepMacros) els.productCreateStepMacros.hidden = onName;
  const nameInput = els.productCreateForm?.elements?.name;
  if (nameInput) nameInput.required = onName;
  productCreateMacroFields().forEach((el) => {
    el.required = !onName;
  });
  const name = String(nameInput?.value || "").trim();
  if (els.productCreateTitle) {
    els.productCreateTitle.textContent = onName ? "Свой продукт" : name || "Свой продукт";
  }
  els.productCreateSheet?.classList.toggle("is-step-macros", !onName);
  syncTelegramBackButton();
  requestAnimationFrame(() => {
    if (onName) {
      if (nameInput) focusWithoutScroll(nameInput);
    } else {
      const kcal = els.productCreateForm?.elements?.kcal;
      if (kcal) focusWithoutScroll(kcal);
    }
  });
}

function openProductCreateSheet() {
  if (!els.productCreateSheet) return;
  closeDishCreateSheet();
  els.productCreateForm?.reset();
  els.productCreateSheet.hidden = false;
  document.body.classList.add("nutrition-sheet-open");
  setProductCreateStep(1);
}

function closeProductCreateSheet() {
  if (!els.productCreateSheet) return;
  const active = document.activeElement;
  if (active && els.productCreateSheet.contains(active) && typeof active.blur === "function") {
    active.blur();
  }
  els.productCreateSheet.hidden = true;
  document.body.classList.remove("nutrition-sheet-open");
  state.productCreateStep = 1;
  if (els.productCreateStepName) els.productCreateStepName.hidden = false;
  if (els.productCreateStepMacros) els.productCreateStepMacros.hidden = true;
  els.productCreateSheet.classList.remove("is-step-macros");

  if (els.productCreateTitle) els.productCreateTitle.textContent = "Свой продукт";
  syncTelegramBackButton();
}


let dishSearchAbort = null;
let dishSearchSeq = 0;
let dishSearchHits = [];

const OIL_KCAL_PER_G = 9;
let dishSearchTimer = null;

function isDishCreateSheetOpen() {
  return Boolean(els.dishCreateSheet && !els.dishCreateSheet.hidden);
}

function isDishIngredientCardOpen() {
  return Boolean(state.dishEditKey && state.screen === "detailNutritionProduct");
}

function dishIngredientKind(item) {
  if (shouldSkipCookKind(item?.name || "", item?.categorySlug)) return null;
  if (item?.cookKind && COOK_MODES_BY_KIND[item.cookKind]) return item.cookKind;
  return inferCookKindFromName(item?.name || "") || null;
}

function cookModesForDishIngredient(item) {
  const kind = dishIngredientKind(item);
  if (!kind || !COOK_MODES_BY_KIND[kind]) return [];
  return COOK_MODES_BY_KIND[kind]
    .map((id) => {
      const base = COOK_MODE_BY_ID[id];
      if (!base) return null;
      const ui = dishCookUiFor(kind, id);
      return { ...base, label: ui.label, hint: ui.hint };
    })
    .filter(Boolean);
}

function dishItemAsProduct(item) {
  return {
    name: item.name,
    kcalPer100g: item.kcalPer100g,
    proteinPer100g: item.proteinPer100g,
    fatPer100g: item.fatPer100g,
    carbsPer100g: item.carbsPer100g,
    fiberPer100g: item.fiberPer100g,
    fromCatalog: Boolean(item.fromCatalog || item.foodId),
    foodId: item.foodId || null,
    id: item.productId || item.foodId,
    cookKind: item.cookKind || null,
    bjuScore: item.bjuScore ?? null,
    bjuTier: item.bjuTier || null,
  };
}

function hideDishCreateSheetKeepState() {
  if (!els.dishCreateSheet) return;
  els.dishCreateSheet.hidden = true;
  document.body.classList.remove("nutrition-sheet-open");
}

function restoreDishCreateSheet() {
  if (!els.dishCreateSheet) return;
  els.dishCreateSheet.hidden = false;
  document.body.classList.add("nutrition-sheet-open");
  setDishCreateStep(2);
  syncDishCreateCookUi();
  renderDishCreateItems();
  updateDishCreatePreview();
  syncTelegramBackButton();
}

function syncDishIngredientCardChrome() {
  const dish = isDishIngredientCardOpen();
  if (!dish) {
    if (els.productDishCookBlock) els.productDishCookBlock.hidden = true;
    if (els.productDishOilBlock) els.productDishOilBlock.hidden = true;
    if (els.productDetailFavoriteBtn) els.productDetailFavoriteBtn.hidden = false;
    if (els.productNoteBlock) els.productNoteBlock.hidden = false;
    if (els.productServingAmountLabel) els.productServingAmountLabel.textContent = "Количество";
    syncDiaryServingOilBlock();
    syncProductDishEditBtn(state.nutritionViewProduct);
    return;
  }
  const item = dishEditItem();
  const kind = dishIngredientKind(item);
  // Готовка только на шите блюда («Как готовишь блюдо») — на карточке ингредиента нет.
  if (els.productDishCookBlock) els.productDishCookBlock.hidden = true;
  if (els.productDishOilBlock) els.productDishOilBlock.hidden = true;
  if (els.productServingAmountLabel) {
    if (kind === "meat_fish" || kind === "veg") {
      els.productServingAmountLabel.textContent = "Вес сырого продукта";
    } else if (kind) {
      els.productServingAmountLabel.textContent = "Вес сухого продукта";
    } else {
      els.productServingAmountLabel.textContent = "Вес сырого продукта";
    }
  }
  if (els.productDetailFavoriteBtn) els.productDetailFavoriteBtn.hidden = true;
  if (els.productNoteBlock) els.productNoteBlock.hidden = true;
  if (els.productEditCard) els.productEditCard.hidden = true;
  if (els.productDetailDeleteBtn) els.productDetailDeleteBtn.hidden = true;
  if (els.productDishEditBtn) els.productDishEditBtn.hidden = true;
}

function dishEditItem() {
  if (!state.dishEditKey) return null;
  return state.dishItems.find((row) => row.key === state.dishEditKey) || null;
}

function isDishItemSheetOpen() {
  return Boolean(els.dishItemSheet && !els.dishItemSheet.hidden);
}

function isDishCookPickOpen() {
  return Boolean(els.dishCookPickSheet && !els.dishCookPickSheet.hidden);
}

function dishCookShortLabel(_item) {
  // Готовка только на уровне блюда — в строке ингредиента не дублируем.
  return "";
}

function dishItemRowMeta(item) {
  const grams = Number(String(item.grams || "").replace(",", "."));
  const gramsBit = grams > 0 ? `${formatSheetGramsValue(grams)} г` : "— г";
  const part = dishItemPart(item);
  const kcalBit = part ? `${Math.round(part.kcal)} ккал` : "— ккал";
  const cookBit = dishCookShortLabel(item);
  return cookBit ? `${gramsBit} · ${cookBit} · ${kcalBit}` : `${gramsBit} · ${kcalBit}`;
}

function dishItemEffectiveCookMode(_item) {
  return state.dishCookMode || "plain";
}

function dishOilGramsValue() {
  if ((state.dishCookMode || "plain") !== "fry_meat") return 0;
  const raw = state.dishOilGrams !== undefined && state.dishOilGrams !== null
    ? state.dishOilGrams
    : els.dishCreateOil?.value;
  const oil = Number(String(raw || "").replace(",", "."));
  return oil > 0 ? oil : 0;
}

function dishItemPart(item) {
  const grams = Number(String(item.grams || "").replace(",", "."));
  if (!grams || grams <= 0) return null;
  const factor = grams / 100;
  return {
    kcal: (Number(item.kcalPer100g) || 0) * factor,
    protein: (Number(item.proteinPer100g) || 0) * factor,
    fat: (Number(item.fatPer100g) || 0) * factor,
    carbs: (Number(item.carbsPer100g) || 0) * factor,
    fiber: (Number(item.fiberPer100g) || 0) * factor,
  };
}

function dishCookedGrams(rawGrams, modeId, productName) {
  const g = Number(rawGrams);
  if (!g || g <= 0) return 0;
  const factor = resolveCookFactor(productName, modeId);
  if (factor <= 0) return Math.round(g * 10) / 10;
  return Math.round((g / factor) * 10) / 10;
}

function dishItemWeighedMass(item) {
  const grams = Number(String(item.grams || "").replace(",", "."));
  if (!grams || grams <= 0) return 0;
  return dishCookedGrams(grams, dishItemEffectiveCookMode(item), item.name || item.productName);
}

function dishYieldGrams() {
  if (!state.dishItems.length) return null;
  let sum = 0;
  for (const item of state.dishItems) {
    const grams = Number(String(item.grams || "").replace(",", "."));
    if (!grams || grams <= 0) return null;
    sum += dishItemWeighedMass(item);
  }
  sum += dishOilGramsValue();
  return Math.round(sum * 10) / 10;
}

function syncDishYieldFromItems() {
  if (!els.dishCreateYield) return;
  const yieldG = dishYieldGrams();
  els.dishCreateYield.value = yieldG ? String(yieldG) : "";
}

function dishPreviewPer100() {
  const yieldG = dishYieldGrams();
  if (!yieldG || yieldG <= 0) return null;
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
  for (const item of state.dishItems) {
    const part = dishItemPart(item);
    if (!part) return null;
    totals.kcal += part.kcal;
    totals.protein += part.protein;
    totals.fat += part.fat;
    totals.carbs += part.carbs;
    totals.fiber += part.fiber;
  }
  if (!state.dishItems.length) return null;
  const oil = dishOilGramsValue();
  if (oil > 0) {
    totals.kcal += oil * OIL_KCAL_PER_G;
    totals.fat += oil;
  }
  const scale = 100 / yieldG;
  return {
    kcal: Math.round(totals.kcal * scale * 10) / 10,
    protein: Math.round(totals.protein * scale * 10) / 10,
    fat: Math.round(totals.fat * scale * 10) / 10,
    carbs: Math.round(totals.carbs * scale * 10) / 10,
  };
}

function renderDishCreateCookButtons() {
  if (!els.dishCreateCook) return;
  const mode = state.dishCookMode || "plain";
  els.dishCreateCook.innerHTML = DISH_LEVEL_COOK_MODES.map(
    (m) =>
      `<button type="button" class="segmented__btn${m.id === mode ? " is-active" : ""}" data-dish-level-cook="${m.id}" role="tab" aria-selected="${m.id === mode}">${escapeHtml(m.label)}</button>`
  ).join("");
  els.dishCreateCook.querySelectorAll("[data-dish-level-cook]").forEach((btn) => {
    btn.addEventListener("click", () => setDishCookMode(btn.dataset.dishLevelCook));
  });
}

function syncDishCreateOilBlock() {
  const fry = (state.dishCookMode || "plain") === "fry_meat";
  if (els.dishCreateOilBlock) els.dishCreateOilBlock.hidden = !fry;
  if (els.dishCreateOil && document.activeElement !== els.dishCreateOil) {
    els.dishCreateOil.value = fry ? state.dishOilGrams || "" : "";
  }
  if (!fry) state.dishOilGrams = "";
}

function setDishCookMode(modeId) {
  const next = DISH_LEVEL_COOK_MODES.some((m) => m.id === modeId) ? modeId : "plain";
  state.dishCookMode = next;
  if (next !== "fry_meat") state.dishOilGrams = "";
  renderDishCreateCookButtons();
  syncDishCreateOilBlock();
  renderDishCreateItems();
  updateDishCreatePreview();
  if (next === "fry_meat") {
    requestAnimationFrame(() => {
      focusWithoutScroll(els.dishCreateOil);
      scheduleNumericCaretFix(els.dishCreateOil);
    });
  }
}

function syncDishCreateCookUi() {
  renderDishCreateCookButtons();
  syncDishCreateOilBlock();
}

function setDishCreateError(text) {
  if (!els.dishCreateError) return;
  const msg = String(text || "");
  els.dishCreateError.hidden = !msg;
  els.dishCreateError.textContent = msg;
}

function setDishCreateStep(step) {
  const next = step === 2 ? 2 : 1;
  state.dishCreateStep = next;
  if (els.dishCreateStepName) els.dishCreateStepName.hidden = next !== 1;
  if (els.dishCreateStepBuild) els.dishCreateStepBuild.hidden = next !== 2;
  const name = String(els.dishCreateName?.value || "").trim();
  const editing = Boolean(state.dishEditingId);
  const editingName = next === 1 && state.dishItems.length > 0;
  if (els.dishCreateTitle) {
    if (next === 1) {
      els.dishCreateTitle.textContent = editingName
        ? "Название блюда"
        : editing
          ? "Изменить блюдо"
          : "Создать блюдо";
    } else {
      els.dishCreateTitle.textContent = name || (editing ? "Изменить блюдо" : "Создать блюдо");
    }
  }
  if (els.dishCreateRenameBtn) els.dishCreateRenameBtn.hidden = next !== 2;
  if (els.dishCreateNextBtn) {
    els.dishCreateNextBtn.textContent = editingName ? "Готово" : "Далее";
  }
  if (els.dishCreateSaveBtn) {
    els.dishCreateSaveBtn.textContent = editing ? "Сохранить изменения" : "Сохранить в Мои";
  }
  syncTelegramBackButton();
  requestAnimationFrame(() => {
    if (next === 1) {
      focusWithoutScroll(els.dishCreateName);
      if (editingName) els.dishCreateName?.select?.();
      return;
    }
    focusWithoutScroll(els.dishCreateSearch);
  });
}

function openDishCreateRename() {
  if (!isDishCreateSheetOpen() || state.dishCreateStep !== 2) return;
  setDishCreateError("");
  setDishCreateStep(1);
}

function resetDishCreateState() {
  closeDishCookPickSheet();
  closeDishItemSheet();
  state.dishCreateStep = 1;
  state.dishItems = [];
  state.dishItemSeq = 0;
  state.dishEditKey = null;
  state.dishEditingId = null;
  state.dishCookMode = "plain";
  state.dishOilGrams = "";
  state.dishCookPickTarget = null;
  if (els.dishCreateName) els.dishCreateName.value = "";
  if (els.dishCreateSearch) els.dishCreateSearch.value = "";
  if (els.dishCreateYield) els.dishCreateYield.value = "";
  if (els.dishCreateOil) els.dishCreateOil.value = "";
  if (els.dishCreateNote) els.dishCreateNote.value = "";
  dishSearchHits = [];
  if (els.dishCreateHits) {
    els.dishCreateHits.innerHTML = "";
    els.dishCreateHits.hidden = true;
  }
  setDishCreateError("");
  syncDishCreateCookUi();
  renderDishCreateItems();
  updateDishCreatePreview();
  syncDishCreateNoteHeight();
}

function openDishCreateSheet() {
  if (!els.dishCreateSheet) return;
  closeProductCreateSheet();
  resetDishCreateState();
  els.dishCreateSheet.hidden = false;
  document.body.classList.add("nutrition-sheet-open");
  setDishCreateStep(1);
}

function closeDishCreateSheet() {
  if (!els.dishCreateSheet) return;
  const active = document.activeElement;
  if (active && els.dishCreateSheet.contains(active) && typeof active.blur === "function") {
    active.blur();
  }
  els.dishCreateSheet.hidden = true;
  document.body.classList.remove("nutrition-sheet-open");
  // Закрытие без сохранения = откат черновика (create и edit).
  resetDishCreateState();
  if (els.dishCreateTitle) els.dishCreateTitle.textContent = "Создать блюдо";
  if (els.dishCreateSaveBtn) els.dishCreateSaveBtn.textContent = "Сохранить в Мои";
  syncTelegramBackButton();
}

function mapApiDishItemToState(item) {
  state.dishItemSeq += 1;
  const foodId = item.foodId ? Number(item.foodId) : null;
  const productId = foodId ? null : Number(item.productId || item.id);
  const oil = Number(item.oilGrams);
  return {
    key: `d${state.dishItemSeq}`,
    name: item.name,
    foodId,
    productId,
    fromCatalog: Boolean(foodId || item.fromCatalog),
    cookKind: item.cookKind || null,
    kcalPer100g: Number(item.kcalPer100g) || 0,
    proteinPer100g: Number(item.proteinPer100g) || 0,
    fatPer100g: Number(item.fatPer100g) || 0,
    carbsPer100g: Number(item.carbsPer100g) || 0,
    fiberPer100g: Number(item.fiberPer100g) || 0,
    bjuScore: item.bjuScore ?? null,
    bjuTier: item.bjuTier || null,
    grams: formatSheetGramsValue(item.grams) || String(item.grams || ""),
    cookMode: item.cookMode || "plain",
    oilGrams: oil > 0 ? formatSheetGramsValue(oil) || String(oil) : "",
  };
}

async function openDishEditFromCard(product) {
  const target = product || state.nutritionViewProduct;
  if (!target?.isDish || !target.id || !els.dishCreateSheet) return;
  if (isDishIngredientCardOpen()) return;
  const btn = els.productDishEditBtn;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }
  try {
    const res = await apiGet(`/nutrition/dishes/${target.id}`);
    if (!res?.ok) throw new Error(res?.error || "Не удалось загрузить блюдо");
    closeProductCreateSheet();
    resetDishCreateState();
    state.dishEditingId = Number(target.id);
    const name = res.product?.name || target.name || "";
    if (els.dishCreateName) els.dishCreateName.value = name;
    const apiItems = res.items || [];
    let oilSum = 0;
    const modeCounts = new Map();
    for (const row of apiItems) {
      const mode = row.cookMode || "plain";
      modeCounts.set(mode, (modeCounts.get(mode) || 0) + 1);
      const oil = Number(row.oilGrams);
      if (oil > 0) oilSum += oil;
    }
    let dishMode = "plain";
    if (modeCounts.has("fry_meat")) {
      dishMode = "fry_meat";
    } else if (modeCounts.size === 1) {
      dishMode = [...modeCounts.keys()][0];
    } else {
      const nonPlain = [...modeCounts.keys()].filter((m) => m !== "plain");
      dishMode = nonPlain[0] || "plain";
    }
    if (!DISH_LEVEL_COOK_MODES.some((m) => m.id === dishMode)) dishMode = "plain";
    state.dishCookMode = dishMode;
    state.dishOilGrams =
      dishMode === "fry_meat" && oilSum > 0 ? formatSheetGramsValue(oilSum) || String(oilSum) : "";
    state.dishItems = apiItems.map((row) => {
      const mapped = mapApiDishItemToState(row);
      if (dishMode !== "plain") {
        mapped.cookMode = "plain";
        mapped.oilGrams = "";
      } else if (mapped.cookMode === "fry_meat") {
        mapped.cookMode = "plain";
        mapped.oilGrams = "";
      }
      return mapped;
    });
    const note = res.product?.note != null ? String(res.product.note) : (target.note != null ? String(target.note) : "");
    if (els.dishCreateNote) els.dishCreateNote.value = note;
    els.dishCreateSheet.hidden = false;
    document.body.classList.add("nutrition-sheet-open");
    setDishCreateStep(2);
    syncDishCreateCookUi();
    renderDishCreateItems();
    updateDishCreatePreview();
    syncDishCreateNoteHeight();
    syncTelegramBackButton();
  } catch (err) {
    alert(String(err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Изменить состав";
    }
  }
}

function syncProductDishEditBtn(product) {
  if (!els.productDishEditBtn) return;
  const show =
    Boolean(product?.isDish) &&
    !product?.fromCatalog &&
    !product?.foodId &&
    !isDishIngredientCardOpen();
  els.productDishEditBtn.hidden = !show;
}

function advanceDishCreateFromName() {
  const name = String(els.dishCreateName?.value || "").trim();
  if (!name) {
    els.dishCreateName?.reportValidity?.();
    focusWithoutScroll(els.dishCreateName);
    return false;
  }
  els.dishCreateName.value = name;
  setDishCreateStep(2);
  return true;
}

function dishHitKey(p) {
  if (p.fromCatalog || p.foodId) return `food:${Number(p.foodId || p.id)}`;
  return `product:${Number(p.productId || p.id)}`;
}

function lastDiaryGramsForProduct(product) {
  const foodId = product.fromCatalog || product.foodId ? Number(product.foodId || product.id) : null;
  const productId = foodId ? null : Number(product.productId || product.id);
  const prefKind = foodId ? "food" : "product";
  const prefId = foodId || productId;
  const pref = prefId ? loadCookPref(prefKind, prefId) : null;
  const prefG = Number(pref?.grams);
  if (prefG > 0) return prefG;
  const cached = foodId
    ? state.nutritionFoodById.get(foodId)
    : state.nutritionProductsById.get(Number(productId));
  const cachedG = Number(cached?.lastServingGrams);
  if (cachedG > 0) return cachedG;
  const apiG = Number(product.lastServingGrams);
  if (apiG > 0) return apiG;
  const suggestedG = Number(product?.suggestedServingGrams || cached?.suggestedServingGrams);
  if (suggestedG > 0) return suggestedG;
  const yieldG = Number(product?.dishYieldGrams || cached?.dishYieldGrams);
  if (yieldG > 0) return yieldG;
  return 100;
}

function dishYieldGramsOf(product) {
  const cached = product?.id ? state.nutritionProductsById.get(Number(product.id)) : null;
  const n = Number(product?.dishYieldGrams || cached?.dishYieldGrams);
  return n > 0 ? n : 0;
}

function dishLogGramsLabel(product) {
  const y = dishYieldGramsOf(product);
  if (y > 0) return `Граммы · всё блюдо ${formatSheetGramsValue(y)} г`;
  return "Граммы";
}

function addDishIngredient(product) {
  if (product?.isDish) return;
  if (state.dishEditingId && !product.fromCatalog && !product.foodId) {
    if (Number(product.id) === Number(state.dishEditingId)) return;
  }
  const key = dishHitKey(product);
  if (state.dishItems.some((item) => dishHitKey(item) === key)) return;
  const foodId = product.fromCatalog || product.foodId ? Number(product.foodId || product.id) : null;
  const productId = foodId ? null : Number(product.id);
  const cookKind = productCookKind(product);
  state.dishItemSeq += 1;
  state.dishItems.push({
    key: `d${state.dishItemSeq}`,
    name: product.name,
    foodId,
    productId,
    fromCatalog: Boolean(foodId),
    categorySlug: product.categorySlug || null,
    cookKind: cookKind || null,
    kcalPer100g: Number(product.kcalPer100g) || 0,
    proteinPer100g: Number(product.proteinPer100g) || 0,
    fatPer100g: Number(product.fatPer100g) || 0,
    carbsPer100g: Number(product.carbsPer100g) || 0,
    fiberPer100g: Number(product.fiberPer100g) || 0,
    bjuScore: product.bjuScore ?? null,
    bjuTier: product.bjuTier || null,
    grams: formatSheetGramsValue(lastDiaryGramsForProduct(product)) || "100",
    cookMode: "plain",
    oilGrams: "",
  });
  const added = state.dishItems[state.dishItems.length - 1];
  if (els.dishCreateSearch) els.dishCreateSearch.value = "";
  dishSearchHits = [];
  if (els.dishCreateHits) {
    els.dishCreateHits.innerHTML = "";
    els.dishCreateHits.hidden = true;
  }
  renderDishCreateItems();
  updateDishCreatePreview();
  if (added) openDishIngredientCard(added.key);
}

function renderDishCreateItems() {
  if (!els.dishCreateItems) return;
  if (!state.dishItems.length) {
    els.dishCreateItems.innerHTML = '<li class="dish-create__empty">Пока пусто — найдите продукт выше</li>';
    return;
  }
  els.dishCreateItems.innerHTML = state.dishItems
    .map((item) => {
      return `<li class="meal-entry" data-dish-item="${item.key}">
        <div class="meal-entry__main">
          <span class="meal-entry__name">${escapeHtml(diaryDisplayName(item.name))}</span>
          <span class="meal-entry__meta">${escapeHtml(dishItemRowMeta(item))}</span>
        </div>
        <button type="button" class="meal-entry__del" data-dish-remove="${item.key}" aria-label="Убрать">×</button>
      </li>`;
    })
    .join("");
}

function syncDishItemSheet() {
  const item = dishEditItem();
  if (!item) return;
  const kind = dishIngredientKind(item);
  if (els.dishItemTitle) els.dishItemTitle.textContent = diaryDisplayName(item.name);
  if (els.dishItemCookBlock) els.dishItemCookBlock.hidden = true;
  if (els.dishItemOilBlock) els.dishItemOilBlock.hidden = true;
  if (els.dishItemGramsLabel) {
    const rawHint = kind === "meat_fish" || kind === "veg" ? "сырой" : kind ? "сухой" : "";
    els.dishItemGramsLabel.textContent = rawHint ? `Граммы · ${rawHint}` : "Граммы";
  }
  if (els.dishItemGrams && document.activeElement !== els.dishItemGrams) {
    els.dishItemGrams.value = item.grams || "";
  }
}

function openDishIngredientCard(key, opts = {}) {
  const item = state.dishItems.find((row) => row.key === key);
  if (!item) return;
  state.dishEditKey = key;
  if (els.dishItemSheet) els.dishItemSheet.hidden = true;
  hideDishCreateSheetKeepState();
  const product = dishItemAsProduct(item);
  state.nutritionViewProduct = product;
  state.nutritionViewServingEntry = null;
  state.nutritionViewServing = null;
  state.nutritionServingUnit = "g";
  state.nutritionMacroViewMode = "serving";
  state.nutritionBackScreen = "detailNutritionProducts";
  setScreen("detailNutritionProduct");
  if (els.productDetailTitle) els.productDetailTitle.textContent = product.name;
  syncProductDetailDishTag(null);
  if (els.productServingCard) els.productServingCard.hidden = false;
  if (els.productServingAmount) {
    els.productServingAmount.value = formatSheetGramsValue(item.grams) || "100";
  }
  if (els.productServingUnit) els.productServingUnit.value = "g";
  renderProductBjuBadge(product);
  syncDishIngredientCardChrome();
  syncNutritionAddLabels();
  destroyCharts();
  renderProductDetailServingView();
  requestAnimationFrame(() => {
    focusWithoutScroll(els.productServingAmount);
    scheduleNumericCaretFix(els.productServingAmount);
  });
}

function confirmDishIngredientCard() {
  patchDishItemFromCard();
  closeDishIngredientCard();
}

function closeDishIngredientCard() {
  if (
    state.nutritionSheetMode === "dish" &&
    els.nutritionQuickAddSheet &&
    !els.nutritionQuickAddSheet.hidden
  ) {
    closeNutritionQuickAdd();
  }
  closeDishCookPickSheet();
  patchDishItemFromCard();
  destroyCharts();
  state.nutritionViewProduct = null;
  state.nutritionViewServing = null;
  state.nutritionViewServingEntry = null;
  state.dishEditKey = null;
  setScreen("detailNutritionProducts");
  restoreDishCreateSheet();
}

function openDishItemSheet(key, opts = {}) {
  openDishIngredientCard(key, opts);
}

function closeDishItemSheet() {
  closeDishCookPickSheet();
  if (!els.dishItemSheet) return;
  const active = document.activeElement;
  if (active && els.dishItemSheet.contains(active) && typeof active.blur === "function") {
    active.blur();
  }
  els.dishItemSheet.hidden = true;
  state.dishEditKey = null;
  syncTelegramBackButton();
}

function openDishCookPickSheet(target = "item") {
  if (!els.dishCookPickSheet || !els.dishCookPickOptions) return;
  // Готовка блюда целиком — segmented на шите сборки; попап только для ингредиента.
  if (target === "dish") return;
  const item = dishEditItem();
  if (!item) return;
  const modes = cookModesForDishIngredient(item);
  if (!modes.length) return;
  let current = dishItemEffectiveCookMode(item);
  if (current === "fry_meat") current = item.cookMode === "fry_meat" ? "plain" : item.cookMode || "plain";
  state.dishCookPickTarget = "item";
  if (els.dishCookPickTitle) els.dishCookPickTitle.textContent = "Как готовишь";
  els.dishCookPickOptions.innerHTML = modes
    .map(
      (m) =>
        `<button type="button" class="physio-pick-option${m.id === current ? " is-active" : ""}" data-dish-cook-pick="${m.id}" role="option" aria-selected="${m.id === current ? "true" : "false"}">${escapeHtml(m.label)}</button>`
    )
    .join("");
  els.dishCookPickOptions.querySelectorAll("[data-dish-cook-pick]").forEach((btn) => {
    btn.addEventListener("click", () => applyDishCookPick(btn.dataset.dishCookPick));
  });
  els.dishCookPickSheet.hidden = false;
  if (els.dishItemCookBtn) els.dishItemCookBtn.setAttribute("aria-expanded", "true");
  if (els.productDishCookBtn) els.productDishCookBtn.setAttribute("aria-expanded", "true");
}

function closeDishCookPickSheet() {
  if (!els.dishCookPickSheet) return;
  els.dishCookPickSheet.hidden = true;
  if (els.dishCookPickOptions) els.dishCookPickOptions.innerHTML = "";
  state.dishCookPickTarget = null;
  if (els.dishItemCookBtn) els.dishItemCookBtn.setAttribute("aria-expanded", "false");
  if (els.productDishCookBtn) els.productDishCookBtn.setAttribute("aria-expanded", "false");
}

function applyDishCookPick(modeId) {
  const item = dishEditItem();
  if (!item) return;
  item.cookMode = modeId === "fry_meat" ? "plain" : modeId || "plain";
  item.oilGrams = "";
  closeDishCookPickSheet();
  syncDishIngredientCardChrome();
  renderProductDetailServingView();
  renderDishCreateItems();
  updateDishCreatePreview();
  requestAnimationFrame(() => {
    focusWithoutScroll(els.productServingAmount);
    scheduleNumericCaretFix(els.productServingAmount);
  });
}

function patchDishItemFromCard() {
  const item = dishEditItem();
  if (!item) return;
  const raw = String(els.productServingAmount?.value || "").replace(",", ".");
  const amount = Number(raw);
  if (amount > 0) {
    const unit = state.nutritionServingUnit === "100g" ? "100g" : "g";
    const grams = unit === "100g" ? amount * 100 : amount;
    item.grams = formatSheetGramsValue(grams) || String(grams);
  }
  item.oilGrams = "";
}

function patchDishItemFromSheet() {
  const item = dishEditItem();
  if (!item) return;
  if (els.dishItemGrams) item.grams = els.dishItemGrams.value;
  item.oilGrams = "";
  renderDishCreateItems();
  updateDishCreatePreview();
}

function updateDishCreatePreview() {
  syncDishCreateOilBlock();
  syncDishYieldFromItems();
  if (!els.dishCreatePreview) return;
  if (!state.dishItems.length) {
    els.dishCreatePreview.textContent = "Добавьте ингредиенты";
    return;
  }
  const per = dishPreviewPer100();
  if (!per) {
    els.dishCreatePreview.textContent = "Укажите граммы ингредиентов";
    return;
  }
  const oilG = dishOilGramsValue();
  const dishMode = state.dishCookMode || "plain";
  const cookLabel = DISH_LEVEL_COOK_MODES.find((m) => m.id === dishMode)?.label || "";
  const cookBit = dishMode !== "plain" && cookLabel ? ` · ${cookLabel.split(" / ")[0].toLowerCase()}` : "";
  const oilBit = oilG > 0 ? ` · масло ${Math.round(oilG * 10) / 10} г` : "";
  els.dishCreatePreview.textContent = `${per.kcal} ккал · Б ${per.protein} · Ж ${per.fat} · У ${per.carbs} / 100 г${cookBit}${oilBit}`;
}

async function searchDishIngredients(q) {
  const query = String(q || "").trim();
  if (!query) {
    dishSearchHits = [];
    if (els.dishCreateHits) {
      els.dishCreateHits.innerHTML = "";
      els.dishCreateHits.hidden = true;
    }
    return;
  }
  dishSearchSeq += 1;
  const seq = dishSearchSeq;
  if (dishSearchAbort) dishSearchAbort.abort();
  dishSearchAbort = new AbortController();
  const signal = dishSearchAbort.signal;
  let mine = { products: [] };
  let catalog = { products: [] };
  let favorites = { products: [] };
  try {
    try {
      mine = await apiGet("/nutrition/products", { q: query, limit: 40, scope: "mine" }, { signal });
    } catch {
      /* свои могут упасть — каталог всё равно покажем */
    }
    if (seq !== dishSearchSeq || signal.aborted) return;
    try {
      catalog = await apiGet("/catalog/products", { q: query, limit: 40 }, { signal });
    } catch {
      /* каталог опционален */
    }
    if (seq !== dishSearchSeq || signal.aborted) return;
    try {
      favorites = await apiGet("/nutrition/favorites", { limit: 80 }, { signal });
    } catch {
      /* избранное опционально */
    }
    if (seq !== dishSearchSeq || signal.aborted) return;
    const mineProducts = orderMineWithFavoritesFirst(
      mine.products || [],
      favorites.products || [],
      query
    );
    const catalogOrdered = orderCatalogWithFavoritesFirst(
      catalog.products || [],
      favorites.products || [],
      query
    ).map((p) => ({ ...p, fromCatalog: true, foodId: Number(p.foodId || p.id) }));
    renderDishCreateHits(mineProducts, catalogOrdered, "Ничего не нашли");
  } catch (err) {
    if (seq !== dishSearchSeq || signal.aborted) return;
    dishSearchHits = [];
    if (!els.dishCreateHits) return;
    els.dishCreateHits.hidden = false;
    els.dishCreateHits.innerHTML = `<li class="dish-create__empty">${escapeHtml(String(err.message || "Не удалось загрузить"))}</li>`;
  }
}

function dishCreateHitRowHtml(p, index) {
  const fromCatalog = Boolean(p.fromCatalog || p.foodId);
  const tierClass = !fromCatalog && p.bjuTier ? ` product-db-row--tier-${p.bjuTier}` : "";
  const catalogClass = fromCatalog ? " product-db-row--catalog" : "";
  const dot = p.bjuTier
    ? `<span class="product-bju-dot product-bju-dot--${p.bjuTier}" aria-hidden="true"></span>`
    : "";
  const star = p.favorite ? favoriteStarHtml(true) : "";
  const tail = star || dot ? `<span class="product-db-row__tail">${star}${dot}</span>` : "";
  const note = notePreviewHtml(p);
  const sub = fromCatalog
    ? `${p.kcalPer100g ?? "—"} ккал · Б ${p.proteinPer100g ?? "—"} · У ${p.carbsPer100g ?? "—"} · Ж ${p.fatPer100g ?? "—"} / 100 г`
    : macroSubline(p);
  return `
    <li class="product-db-row${tierClass}${catalogClass}">
      <button type="button" class="product-db-row__main" data-dish-hit="${index}">
        <span class="product-db-row__name"><span class="product-db-row__name-text">${escapeHtml(p.name)}</span>${tail}</span>
        <span class="product-db-row__sub">${escapeHtml(sub)}</span>
        ${note}
      </button>
    </li>`;
}

function renderDishCreateHits(products, catalogProducts = [], emptyText = "Ничего не нашли") {
  if (!els.dishCreateHits) return;
  const mine = products || [];
  const catalog = catalogProducts || [];
  const byFavoriteFirst = (a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
  const catalogStores = catalog
    .filter((p) => (p.source || "").toLowerCase() !== "generic")
    .sort(byFavoriteFirst);
  const catalogGeneric = catalog
    .filter((p) => (p.source || "").toLowerCase() === "generic")
    .sort(byFavoriteFirst);
  const ordered = [...mine, ...catalogStores, ...catalogGeneric];
  dishSearchHits = ordered;
  if (!ordered.length) {
    els.dishCreateHits.innerHTML = `<li class="dish-create__empty">${escapeHtml(emptyText)}</li>`;
    els.dishCreateHits.hidden = false;
    return;
  }
  const parts = [];
  let index = 0;
  if (mine.length) {
    for (const p of mine) {
      parts.push(dishCreateHitRowHtml(p, index));
      index += 1;
    }
  }
  if (catalogStores.length) {
    parts.push(
      `<li class="product-db-section">${escapeHtml(`Каталог магазинов · ${catalogStores.length}`)}</li>`
    );
    for (const p of catalogStores) {
      parts.push(dishCreateHitRowHtml(p, index));
      index += 1;
    }
  }
  if (catalogGeneric.length) {
    parts.push(
      `<li class="product-db-section">${escapeHtml(`Готовые продукты · ${catalogGeneric.length}`)}</li>`
    );
    for (const p of catalogGeneric) {
      parts.push(dishCreateHitRowHtml(p, index));
      index += 1;
    }
  }
  els.dishCreateHits.hidden = false;
  els.dishCreateHits.innerHTML = parts.join("");
  cacheNutritionProducts(mine);
  cacheCatalogProducts(catalog);
  els.dishCreateHits.querySelectorAll("[data-dish-hit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hit = dishSearchHits[Number(btn.dataset.dishHit)];
      if (hit) addDishIngredient(hit);
    });
  });
}

async function submitDishCreate() {
  setDishCreateError("");
  const name = String(els.dishCreateName?.value || "").trim();
  const yieldGrams = dishYieldGrams();
  const editingId = state.dishEditingId ? Number(state.dishEditingId) : null;
  if (!name) {
    setDishCreateError("Укажите название блюда");
    setDishCreateStep(1);
    return;
  }
  if (!state.dishItems.length) {
    setDishCreateError("Добавьте хотя бы один ингредиент");
    return;
  }
  if (!yieldGrams || yieldGrams <= 0) {
    setDishCreateError("Укажите граммы ингредиентов");
    return;
  }
  const items = [];
  const dishMode = state.dishCookMode || "plain";
  const dishOil = dishOilGramsValue();
  for (const item of state.dishItems) {
    const grams = Number(String(item.grams || "").replace(",", "."));
    if (!grams || grams <= 0) {
      setDishCreateError(`Укажите граммы: ${item.name}`);
      return;
    }
    if (editingId && item.productId && Number(item.productId) === editingId) {
      setDishCreateError("Блюдо нельзя добавить как ингредиент");
      return;
    }
    const row = { grams, cookMode: dishMode };
    if (item.foodId) row.foodId = item.foodId;
    else row.productId = item.productId;
    items.push(row);
  }
  if (dishMode === "fry_meat" && dishOil > 0 && items.length) {
    items[0].oilGrams = dishOil;
  }
  const btn = els.dishCreateSaveBtn;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }
  try {
    const payload = {
      name,
      yieldGrams,
      items,
      note: String(els.dishCreateNote?.value || ""),
    };
    const res = editingId
      ? await apiPutJson(`/nutrition/dishes/${editingId}`, payload)
      : await apiPostJson("/nutrition/dishes", payload);
    if (!res?.ok) throw new Error(res?.error || "Не удалось сохранить блюдо");
    closeDishCreateSheet();
    cacheNutritionItem(res.product);
    if (editingId) {
      openProductDetail(res.product, state.nutritionBackScreen || "detailNutritionProducts");
    } else {
      setProductDbMode("dishes");
      syncProductDbModeUi();
      await loadProductDatabase();
    }
  } catch (err) {
    setDishCreateError(String(err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = editingId ? "Сохранить изменения" : "Сохранить в Мои";
    }
  }
}


function advanceProductCreateFromName() {
  const nameInput = els.productCreateForm?.elements?.name;
  if (!nameInput) return false;
  const name = String(nameInput.value || "").trim();
  if (!name) {
    nameInput.reportValidity?.();
    focusWithoutScroll(nameInput);
    return false;
  }
  nameInput.value = name;
  setProductCreateStep(2);
  return true;
}

function handleProductCreateSubmit(ev) {
  ev.preventDefault();
  if (state.productCreateStep !== 2) {
    advanceProductCreateFromName();
    return;
  }
  if (!els.productCreateForm?.reportValidity()) return;
  submitNewProduct(els.productCreateForm).catch((err) => alert(String(err.message || err)));
}

function favoriteStarHtml(isFavorite) {
  const on = Boolean(isFavorite);
  return `<span class="product-favorite-mark${on ? " is-on" : ""}" aria-hidden="true">${on ? "★" : "☆"}</span>`;
}

function productMetaBody(product, patch) {
  const body = { ...patch };
  if (product.fromCatalog || product.foodId) {
    body.foodId = Number(product.foodId || product.id);
  } else {
    body.productId = Number(product.id);
  }
  return body;
}

function applyFavoriteToCachedProduct(product, favorite, note) {
  if (!product) return;
  product.favorite = Boolean(favorite);
  if (note !== undefined) product.note = note;
  cacheNutritionItem(product);
  if (state.nutritionViewProduct) {
    const view = state.nutritionViewProduct;
    const sameFood =
      (product.fromCatalog || product.foodId) &&
      (view.fromCatalog || view.foodId) &&
      Number(product.foodId || product.id) === Number(view.foodId || view.id);
    const sameCustom =
      !product.fromCatalog &&
      !product.foodId &&
      !view.fromCatalog &&
      !view.foodId &&
      Number(product.id) === Number(view.id);
    if (sameFood || sameCustom) {
      view.favorite = product.favorite;
      if (note !== undefined) view.note = note;
    }
  }
}

function syncProductDetailFavoriteBtn(product) {
  const btn = els.productDetailFavoriteBtn;
  if (!btn) return;
  const on = Boolean(product?.favorite);
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("aria-label", on ? "Убрать из избранного" : "В избранное");
  btn.textContent = on ? "★" : "☆";
}

function setProductNoteOk(visible) {
  const el = els.productDetailNoteOk;
  if (!el) return;
  el.hidden = !visible;
  el.setAttribute("aria-hidden", visible ? "false" : "true");
}

const PRODUCT_NOTE_PLACEHOLDER = "Например: 1 пряник весит 22 гр.";
const DISH_NOTE_PLACEHOLDER = "Здесь вы можете записать состав и количество ингредиентов вашего блюда";

function loadNoteHeights() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTE_HEIGHT_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveNoteHeightPx(key, px) {
  if (!key) return;
  const h = Math.round(Number(px) || 0);
  if (h < NOTE_HEIGHT_MIN) return;
  const clamped = Math.min(NOTE_HEIGHT_MAX, Math.max(NOTE_HEIGHT_MIN, h));
  const all = loadNoteHeights();
  if (all[key] === clamped) return;
  all[key] = clamped;
  try {
    localStorage.setItem(NOTE_HEIGHT_KEY, JSON.stringify(all));
  } catch {
    /* quota / private mode */
  }
}

function noteHeightKeyForProduct(product) {
  if (!product) return null;
  if (product.fromCatalog || product.foodId) {
    const id = Number(product.foodId || product.id);
    return id > 0 ? `food:${id}` : null;
  }
  const id = Number(product.productId || product.id);
  return id > 0 ? `product:${id}` : null;
}

function noteHeightKeyForDishCreate() {
  const id = Number(state.dishEditingId);
  return id > 0 ? `product:${id}` : "dish-create";
}

function applyNoteHeight(ta, key) {
  if (!ta) return;
  const saved = key ? Number(loadNoteHeights()[key]) : 0;
  if (saved >= NOTE_HEIGHT_MIN) {
    ta.style.height = `${Math.min(NOTE_HEIGHT_MAX, saved)}px`;
  } else {
    ta.style.height = "";
  }
  ta.dataset.noteHeightKey = key || "";
}

function clampNoteHeight(px, minH) {
  const min = Math.max(NOTE_HEIGHT_MIN, Number(minH) || NOTE_HEIGHT_MIN);
  return Math.min(NOTE_HEIGHT_MAX, Math.max(min, Math.round(Number(px) || min)));
}

/** Ручка + ResizeObserver: на iOS CSS resize не работает; высота — per food:/product:. */
function wireNoteResize(ta, grip, getKey, defaultMin) {
  if (!ta) return;
  const minH = Number(defaultMin) || NOTE_HEIGHT_MIN;
  let dragging = false;
  let startY = 0;
  let startH = 0;
  let persistTimer = null;

  const persistNow = () => {
    const key = typeof getKey === "function" ? getKey() : ta.dataset.noteHeightKey;
    if (!key) return;
    saveNoteHeightPx(key, ta.offsetHeight || parseFloat(ta.style.height) || 0);
  };

  const schedulePersist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 120);
  };

  if (typeof ResizeObserver === "function") {
    let skip = false;
    const ro = new ResizeObserver(() => {
      if (skip || dragging) return;
      // только если высота задана явно (CSS resize / наша ручка)
      if (!ta.style.height) return;
      schedulePersist();
    });
    ro.observe(ta);
    ta._noteResizeSkip = (fn) => {
      skip = true;
      try {
        fn();
      } finally {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            skip = false;
          });
        });
      }
    };
  }

  if (!grip) return;

  const onMove = (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    const y = ev.clientY ?? ev.touches?.[0]?.clientY;
    if (y == null) return;
    const next = clampNoteHeight(startH + (y - startY), minH);
    ta.style.height = `${next}px`;
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    persistNow();
  };

  grip.addEventListener("pointerdown", (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    dragging = true;
    grip.classList.add("is-dragging");
    startY = ev.clientY;
    startH = ta.offsetHeight || minH;
    try {
      grip.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}

function syncProductDetailNote(product, { force = false } = {}) {
  const ta = els.productDetailNote;
  if (!ta) return;
  ta.placeholder = product?.isDish ? DISH_NOTE_PLACEHOLDER : PRODUCT_NOTE_PLACEHOLDER;
  const next = product?.note != null ? String(product.note) : "";
  const focused = document.activeElement === ta;
  if (force || !focused) {
    if (ta.value !== next) ta.value = next;
  }
  if (force || !focused) setProductNoteOk(false);
  const key = noteHeightKeyForProduct(product);
  const apply = () => applyNoteHeight(ta, key);
  if (typeof ta._noteResizeSkip === "function") ta._noteResizeSkip(apply);
  else apply();
}

function syncDishCreateNoteHeight() {
  const ta = els.dishCreateNote;
  if (!ta) return;
  const key = noteHeightKeyForDishCreate();
  const apply = () => applyNoteHeight(ta, key);
  if (typeof ta._noteResizeSkip === "function") ta._noteResizeSkip(apply);
  else apply();
}

async function saveProductNoteNow() {
  const product = state.nutritionViewProduct;
  const ta = els.productDetailNote;
  if (!product || !ta) return;
  const note = String(ta.value || "");
  const seq = ++productNoteSeq;
  try {
    const data = await apiPutJson("/nutrition/meta", productMetaBody(product, { note }));
    if (seq !== productNoteSeq) return;
    if (state.nutritionViewProduct !== product) return;
    applyFavoriteToCachedProduct(product, data.favorite, data.note);
    syncProductDetailFavoriteBtn(product);
    setProductNoteOk(true);
    clearTimeout(productNoteOkTimer);
    productNoteOkTimer = setTimeout(() => {
      if (seq === productNoteSeq) setProductNoteOk(false);
    }, 1600);
  } catch (err) {
    if (seq !== productNoteSeq) return;
    setProductNoteOk(false);
    alert(String(err.message || "Не удалось сохранить заметку"));
  }
}

function scheduleProductNoteSave() {
  clearTimeout(productNoteTimer);
  setProductNoteOk(false);
  productNoteTimer = setTimeout(() => {
    saveProductNoteNow().catch(() => {});
  }, 400);
}

async function refreshProductMeta(product) {
  if (!product) return product;
  const params =
    product.fromCatalog || product.foodId
      ? { foodId: Number(product.foodId || product.id) }
      : { productId: Number(product.id) };
  try {
    const data = await apiGet("/nutrition/meta", params);
    applyFavoriteToCachedProduct(product, data.favorite, data.note);
  } catch {
    /* meta опциональна */
  }
  return product;
}

async function toggleProductFavorite() {
  const product = state.nutritionViewProduct;
  if (!product) return;
  const next = !Boolean(product.favorite);
  applyFavoriteToCachedProduct(product, next);
  syncProductDetailFavoriteBtn(product);
  try {
    const data = await apiPutJson("/nutrition/meta", productMetaBody(product, { favorite: next }));
    applyFavoriteToCachedProduct(product, data.favorite, data.note);
    syncProductDetailFavoriteBtn(product);
    if (state.screen === "detailNutritionProducts" && state.productDbMode === "favorites" && !next) {
      await loadFavorites().catch(() => {});
    }
  } catch (err) {
    applyFavoriteToCachedProduct(product, !next);
    syncProductDetailFavoriteBtn(product);
    alert(String(err.message || err));
  }
}

function notePreviewHtml(p) {
  const note = p?.note != null ? String(p.note).trim() : "";
  if (!note) return "";
  const oneLine = note.replace(/\s+/g, " ");
  return `<span class="product-db-row__note">${escapeHtml(oneLine)}</span>`;
}

/** ru↔en транслит для клиентского фильтра (как api/search_text.py). */
const SEARCH_CYR_TO_LAT = [
  ["ще", "sche"],
  ["щё", "schyo"],
  ["щ", "sch"],
  ["ш", "sh"],
  ["ч", "ch"],
  ["ж", "zh"],
  ["ю", "yu"],
  ["я", "ya"],
  ["ё", "yo"],
  ["й", "y"],
  ["ц", "ts"],
  ["х", "kh"],
  ["ъ", ""],
  ["ь", ""],
  ["а", "a"],
  ["б", "b"],
  ["в", "v"],
  ["г", "g"],
  ["д", "d"],
  ["е", "e"],
  ["з", "z"],
  ["и", "i"],
  ["к", "k"],
  ["л", "l"],
  ["м", "m"],
  ["н", "n"],
  ["о", "o"],
  ["п", "p"],
  ["р", "r"],
  ["с", "s"],
  ["т", "t"],
  ["у", "u"],
  ["ф", "f"],
  ["ы", "y"],
  ["э", "e"],
];
const SEARCH_LAT_TO_CYR = [
  ["sche", "ще"],
  ["schyo", "щё"],
  ["sch", "щ"],
  ["yo", "ё"],
  ["yu", "ю"],
  ["ya", "я"],
  ["zh", "ж"],
  ["kh", "х"],
  ["ts", "ц"],
  ["ch", "ч"],
  ["sh", "ш"],
  ["a", "а"],
  ["b", "б"],
  ["v", "в"],
  ["g", "г"],
  ["d", "д"],
  ["e", "е"],
  ["z", "з"],
  ["i", "и"],
  ["y", "й"],
  ["k", "к"],
  ["l", "л"],
  ["m", "м"],
  ["n", "н"],
  ["o", "о"],
  ["p", "п"],
  ["r", "р"],
  ["s", "с"],
  ["t", "т"],
  ["u", "у"],
  ["f", "ф"],
];

function applySearchPairs(text, pairs) {
  let out = String(text || "");
  for (const [src, dst] of pairs) out = out.split(src).join(dst);
  return out;
}

function searchQueryVariants(q) {
  const raw = String(q || "").trim().toLowerCase();
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  const add = (v) => {
    const s = String(v || "").trim().toLowerCase();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  add(raw);
  add(applySearchPairs(raw, SEARCH_CYR_TO_LAT));
  add(applySearchPairs(raw, SEARCH_LAT_TO_CYR));
  return out;
}

function nameMatchesQuery(name, q) {
  const tokens = String(q || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  const hay = String(name || "").toLowerCase();
  const hayLat = applySearchPairs(hay, SEARCH_CYR_TO_LAT);
  const hayCyr = applySearchPairs(hay, SEARCH_LAT_TO_CYR);
  return tokens.every((tok) =>
    searchQueryVariants(tok).some((v) => hay.includes(v) || hayLat.includes(v) || hayCyr.includes(v))
  );
}


function syncProductDbSearchPlaceholder() {
  const input = els.productDbSearch;
  const ph = els.productDbSearchPh;
  if (!input) return;
  const mode = normalizeProductDbMode(state.productDbMode);
  const empty = !String(input.value || "").length;
  if (mode === "favorites") {
    input.placeholder = "";
    input.setAttribute("aria-label", "Найти в избранном");
    if (ph) {
      ph.innerHTML = "Найти в <strong>избранном</strong>";
      ph.hidden = !empty;
    }
  } else if (mode === "mine") {
    input.placeholder = "";
    input.setAttribute("aria-label", "Найти в моих продуктах");
    if (ph) {
      ph.innerHTML = "Найти в <strong>моих продуктах</strong>";
      ph.hidden = !empty;
    }
  } else if (mode === "dishes") {
    input.placeholder = "";
    input.setAttribute("aria-label", "Найти в моих блюдах");
    if (ph) {
      ph.innerHTML = "Найти в <strong>моих блюдах</strong>";
      ph.hidden = !empty;
    }
  } else {
    input.placeholder = "Найти продукт…";
    input.setAttribute("aria-label", "Найти продукт");
    if (ph) ph.hidden = true;
  }
}

function syncProductDbSearchClear() {
  if (!els.productDbSearch || !els.productDbSearchClear) return;
  const hasValue = String(els.productDbSearch.value || "").length > 0;
  els.productDbSearchClear.hidden = !hasValue;
  syncProductDbSearchPlaceholder();
}

function cacheNutritionItem(item) {
  if (!item?.id) return;
  if (item.fromCatalog || item.foodId) {
    const foodId = Number(item.foodId || item.id);
    state.nutritionFoodById.set(foodId, { ...item, foodId, fromCatalog: true });
  } else {
    state.nutritionProductsById.set(item.id, item);
  }
}

function cacheNutritionProducts(products) {
  products.forEach((p) => cacheNutritionItem(p));
}

function productListRowHtml(p) {
  if (p.fromCatalog) return catalogListRowHtml(p);
  const tierClass = p.bjuTier ? ` product-db-row--tier-${p.bjuTier}` : "";
  const dot = p.bjuTier
    ? `<span class="product-bju-dot product-bju-dot--${p.bjuTier}" aria-hidden="true"></span>`
    : "";
  const star = p.favorite ? favoriteStarHtml(true) : "";
  const tail = star || dot ? `<span class="product-db-row__tail">${star}${dot}</span>` : "";
  const note = notePreviewHtml(p);
  return `
    <li class="product-db-row${tierClass}">
      <div class="product-db-preview">
        <button type="button" class="product-db-row__main" data-product-open="${p.id}">
          <span class="product-db-row__name"><span class="product-db-row__name-text">${escapeHtml(p.name)}</span>${dishTagHtml(p)}${tail}</span>
          <span class="product-db-row__sub">${escapeHtml(macroSubline(p))}</span>
          ${note}
        </button>
      </div>
      <button type="button" class="product-db-row__add" data-product-quick-add="${p.id}" aria-label="Добавить ${escapeHtml(p.name)}">+</button>
    </li>`;
}

function dishTagHtml(p) {
  return p?.isDish ? `<span class="product-dish-tag">блюдо</span>` : "";
}

function syncProductDetailDishTag(product) {
  if (!els.productDetailDishTag) return;
  els.productDetailDishTag.hidden = !product?.isDish;
}

function syncDiaryServingOilBlock() {
  if (!els.productDishOilBlock) return;
  if (isDishIngredientCardOpen()) {
    els.productDishOilBlock.hidden = true;
    return;
  }
  const entry = state.nutritionViewServingEntry;
  const fry = Boolean(entry?.id) && isFryCookMode(entry?.cookMode || "plain");
  els.productDishOilBlock.hidden = !fry;
  if (fry && els.productDishOil && document.activeElement !== els.productDishOil) {
    const oil = Number(entry?.oilGrams);
    els.productDishOil.value = oil > 0 ? formatSheetGramsValue(oil) || String(oil) : "";
  }
  if (!fry && els.productDishOil && document.activeElement !== els.productDishOil) {
    els.productDishOil.value = "";
  }
}

function catalogListRowHtml(p) {
  const kcal = p.kcalPer100g ?? "—";
  const protein = p.proteinPer100g ?? "—";
  const carbs = p.carbsPer100g ?? "—";
  const fat = p.fatPer100g ?? "—";
  const dot = p.bjuTier
    ? `<span class="product-bju-dot product-bju-dot--${p.bjuTier}" aria-hidden="true"></span>`
    : "";
  const star = p.favorite ? favoriteStarHtml(true) : "";
  const tail = star || dot ? `<span class="product-db-row__tail">${star}${dot}</span>` : "";
  const note = notePreviewHtml(p);
  return `
    <li class="product-db-row product-db-row--catalog">
      <div class="product-db-preview">
        <button type="button" class="product-db-row__main" data-catalog-open="${p.id}">
          <span class="product-db-row__name"><span class="product-db-row__name-text">${escapeHtml(p.name)}</span>${tail}</span>
          <span class="product-db-row__sub">${escapeHtml(`${kcal} ккал · Б ${protein} · У ${carbs} · Ж ${fat} / 100 г`)}</span>
          ${note}
        </button>
      </div>
      <button type="button" class="product-db-row__add" data-catalog-quick-add="${p.id}" aria-label="Добавить из каталога ${escapeHtml(p.name)}">+</button>
    </li>`;
}

function wireProductListRows(listEl, products) {
  cacheNutritionProducts(products);
  listEl.querySelectorAll("[data-product-open]").forEach((btn) => {
    btn.addEventListener("click", () => openProductDetailById(btn.dataset.productOpen));
  });
  const explicitMeal = state.nutritionAddMealExplicit ? state.nutritionAddMeal : null;
  listEl.querySelectorAll("[data-product-quick-add]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openNutritionQuickAddById(btn.dataset.productQuickAdd, explicitMeal);
    });
  });
}

function wireCatalogListRows(listEl) {
  const explicitMeal = state.nutritionAddMealExplicit ? state.nutritionAddMeal : null;
  listEl.querySelectorAll("[data-catalog-quick-add]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openNutritionQuickAddFoodById(Number(btn.dataset.catalogQuickAdd), explicitMeal);
    });
  });
  listEl.querySelectorAll("[data-catalog-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openCatalogProductDetail(Number(btn.dataset.catalogOpen));
    });
  });
}

function openCatalogProductDetail(foodId) {
  const product = state.nutritionFoodById.get(Number(foodId));
  if (!product) return;
  openProductDetail(product, "detailNutritionProducts");
}

function cacheCatalogProducts(products) {
  (products || []).forEach((p) => cacheNutritionItem({ ...p, fromCatalog: true }));
}

function orderCatalogWithFavoritesFirst(catalogProducts, favoriteProducts, q) {
  const ql = String(q || "").trim().toLowerCase();
  const favById = new Map();
  for (const p of favoriteProducts || []) {
    if (!(p.fromCatalog || p.foodId)) continue;
    if (ql && !nameMatchesQuery(p.name, ql)) continue;
    const id = Number(p.foodId || p.id);
    if (!Number.isFinite(id)) continue;
    favById.set(id, {
      ...p,
      id,
      foodId: id,
      fromCatalog: true,
      favorite: true,
    });
  }
  const favOrdered = [];
  const rest = [];
  const seen = new Set();
  for (const p of catalogProducts || []) {
    const id = Number(p.id);
    if (favById.has(id)) {
      favOrdered.push({ ...p, favorite: true });
      seen.add(id);
    } else {
      rest.push(p);
    }
  }
  for (const [id, p] of favById) {
    if (seen.has(id)) continue;
    favOrdered.push(p);
    seen.add(id);
  }
  return [...favOrdered, ...rest];
}

/** Свои кастомы: избранные по запросу сверху + ★ (как каталог). */
function orderMineWithFavoritesFirst(mineProducts, favoriteProducts, q) {
  const ql = String(q || "").trim().toLowerCase();
  const favById = new Map();
  for (const p of favoriteProducts || []) {
    if (p.fromCatalog || p.foodId || p.isDish) continue;
    if (ql && !nameMatchesQuery(p.name, ql)) continue;
    const id = Number(p.id);
    if (!Number.isFinite(id)) continue;
    favById.set(id, { ...p, favorite: true });
  }
  const favOrdered = [];
  const rest = [];
  const seen = new Set();
  for (const p of mineProducts || []) {
    if (p.isDish || p.fromCatalog) continue;
    const id = Number(p.id);
    if (favById.has(id)) {
      favOrdered.push({ ...p, favorite: true });
      seen.add(id);
    } else {
      rest.push(p);
    }
  }
  for (const [id, p] of favById) {
    if (seen.has(id)) continue;
    favOrdered.push(p);
    seen.add(id);
  }
  return [...favOrdered, ...rest];
}

function renderProductDbList(products, emptyText = "Пусто", catalogProducts = []) {
  if (!els.productDbList) return;
  const mine = products || [];
  const catalog = catalogProducts || [];
  const byFavoriteFirst = (a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
  const catalogStores = catalog
    .filter((p) => (p.source || "").toLowerCase() !== "generic")
    .sort(byFavoriteFirst);
  const catalogGeneric = catalog
    .filter((p) => (p.source || "").toLowerCase() === "generic")
    .sort(byFavoriteFirst);
  if (!mine.length && !catalog.length) {
    els.productDbList.innerHTML = `<li class="meal-card__empty">${escapeHtml(emptyText)}</li>`;
    return;
  }
  const parts = [];
  if (mine.length) {
    parts.push(...mine.map((p) => productListRowHtml(p)));
  }
  if (catalogStores.length) {
    parts.push(
      `<li class="product-db-section">${escapeHtml(`Каталог магазинов · ${catalogStores.length}`)}</li>`
    );
    parts.push(...catalogStores.map((p) => catalogListRowHtml(p)));
  }
  if (catalogGeneric.length) {
    parts.push(
      `<li class="product-db-section">${escapeHtml(`Готовые продукты · ${catalogGeneric.length}`)}</li>`
    );
    parts.push(...catalogGeneric.map((p) => catalogListRowHtml(p)));
  }
  els.productDbList.innerHTML = parts.join("");
  cacheNutritionProducts(mine);
  cacheCatalogProducts(catalog);
  if (mine.some((p) => !p.fromCatalog)) wireProductListRows(els.productDbList, mine.filter((p) => !p.fromCatalog));
  wireCatalogListRows(els.productDbList);
}

async function loadRecentProducts() {
  if (!els.productDbList) return;
  productDbSeq++;
  const seq = productDbSeq;
  if (productDbAbort) productDbAbort.abort();
  productDbAbort = new AbortController();
  const signal = productDbAbort.signal;
  try {
    const data = await apiGet(
      "/nutrition/products",
      { q: "", limit: PRODUCT_DB_RECENT_LIMIT },
      { signal }
    );
    if (seq !== productDbSeq || signal.aborted) return;
    renderProductDbList(
      data.products || [],
      "Пока нет своих продуктов — начните ввод, чтобы искать в каталоге магазинов"
    );
  } catch (err) {
    if (seq !== productDbSeq || signal.aborted) return;
    els.productDbList.innerHTML = `<li class="meal-card__empty">${escapeHtml(String(err.message || "Не удалось загрузить"))}</li>`;
  }
}

async function loadFavorites() {
  if (!els.productDbList) return;
  productDbSeq++;
  const seq = productDbSeq;
  if (productDbAbort) productDbAbort.abort();
  productDbAbort = new AbortController();
  const signal = productDbAbort.signal;
  try {
    const data = await apiGet("/nutrition/favorites", { limit: 80 }, { signal });
    if (seq !== productDbSeq || signal.aborted) return;
    const products = data.products || [];
    cacheNutritionProducts(products);
    renderProductDbList(products, "Пока нет избранного — откройте продукт и нажмите ★");
  } catch (err) {
    if (seq !== productDbSeq || signal.aborted) return;
    els.productDbList.innerHTML = `<li class="meal-card__empty">${escapeHtml(String(err.message || "Не удалось загрузить"))}</li>`;
  }
}

async function loadMyProducts() {
  if (!els.productDbList) return;
  productDbSeq++;
  const seq = productDbSeq;
  if (productDbAbort) productDbAbort.abort();
  productDbAbort = new AbortController();
  const signal = productDbAbort.signal;
  try {
    const data = await apiGet(
      "/nutrition/products",
      { q: "", limit: 200, scope: "mine" },
      { signal }
    );
    if (seq !== productDbSeq || signal.aborted) return;
    renderProductDbList(data.products || [], "Пока нет своих продуктов — нажмите «Добавить продукт»");
  } catch (err) {
    if (seq !== productDbSeq || signal.aborted) return;
    els.productDbList.innerHTML = `<li class="meal-card__empty">${escapeHtml(String(err.message || "Не удалось загрузить"))}</li>`;
  }
}

async function loadMyDishes() {
  if (!els.productDbList) return;
  productDbSeq++;
  const seq = productDbSeq;
  if (productDbAbort) productDbAbort.abort();
  productDbAbort = new AbortController();
  const signal = productDbAbort.signal;
  try {
    const data = await apiGet(
      "/nutrition/products",
      { q: "", limit: 200, scope: "dishes" },
      { signal }
    );
    if (seq !== productDbSeq || signal.aborted) return;
    renderProductDbList(data.products || [], "Пока нет своих блюд — нажмите «Создать блюдо»");
  } catch (err) {
    if (seq !== productDbSeq || signal.aborted) return;
    els.productDbList.innerHTML = `<li class="meal-card__empty">${escapeHtml(String(err.message || "Не удалось загрузить"))}</li>`;
  }
}

async function loadProductDatabase() {
  markUserInteraction();
  const q = String(els.productDbSearch?.value || "").trim();
  syncProductDbModeUi();
  if (!q) {
    await reloadProductDbForMode();
    return;
  }
  productDbSeq++;
  const seq = productDbSeq;
  if (productDbAbort) productDbAbort.abort();
  productDbAbort = new AbortController();
  const signal = productDbAbort.signal;
  const mode = normalizeProductDbMode(state.productDbMode);
  try {
    if (mode === "favorites") {
      const data = await apiGet("/nutrition/favorites", { limit: 80 }, { signal });
      if (seq !== productDbSeq || signal.aborted) return;
      const products = (data.products || []).filter((p) => nameMatchesQuery(p.name, q));
      cacheNutritionProducts(products);
      renderProductDbList(products, "Ничего не найдено в избранном");
      return;
    }
    if (mode === "mine") {
      const mine = await apiGet("/nutrition/products", { q, limit: 80, scope: "mine" }, { signal });
      if (seq !== productDbSeq || signal.aborted) return;
      renderProductDbList(mine.products || [], "Ничего не найдено в моих продуктах");
      return;
    }
    if (mode === "dishes") {
      const dishes = await apiGet("/nutrition/products", { q, limit: 80, scope: "dishes" }, { signal });
      if (seq !== productDbSeq || signal.aborted) return;
      renderProductDbList(dishes.products || [], "Ничего не найдено в моих блюдах");
      return;
    }
    let mine = { products: [] };
    let catalog = { products: [] };
    let favorites = { products: [] };
    try {
      mine = await apiGet("/nutrition/products", { q, limit: 40 }, { signal });
    } catch {
      /* свои могут упасть — каталог всё равно покажем */
    }
    if (seq !== productDbSeq || signal.aborted) return;
    try {
      catalog = await apiGet("/catalog/products", { q, limit: 40 }, { signal });
    } catch {
      /* каталог опционален */
    }
    if (seq !== productDbSeq || signal.aborted) return;
    try {
      favorites = await apiGet("/nutrition/favorites", { limit: 80 }, { signal });
    } catch {
      /* избранное опционально — без него просто каталог как раньше */
    }
    if (seq !== productDbSeq || signal.aborted) return;
    const catalogOrdered = orderCatalogWithFavoritesFirst(
      catalog.products || [],
      favorites.products || [],
      q
    );
    renderProductDbList(mine.products || [], "Ничего не найдено", catalogOrdered);
  } catch (err) {
    if (seq !== productDbSeq || signal.aborted) return;
    if (els.productDbList) {
      els.productDbList.innerHTML = `<li class="meal-card__empty">${escapeHtml(String(err.message || "Не удалось загрузить"))}</li>`;
    }
  }
}

function closeProductCreateCard() {
  closeProductCreateSheet();
}

function resetProductDbSearch() {
  if (els.productDbSearch) els.productDbSearch.value = "";
  syncProductDbSearchClear();
  syncProductDbModeUi();
  reloadProductDbForMode().catch(() => {});
}

function openNutritionProducts(opts = {}) {
  state.nutritionBackScreen = opts.backScreen ?? "detailNutrition";
  state.nutritionAddMealExplicit = Boolean(opts.mealId);
  state.nutritionAddMeal = opts.mealId || inferMealByTime();
  setProductDbMode("recent");
  setScreen("detailNutritionProducts");
  resetProductDbSearch();
  closeProductCreateSheet();
  closeDishCreateSheet();
}

function setNutritionSheetMeal(mealId) {
  state.nutritionQuickAddMeal = mealId;
  if (!els.nutritionSheetMeals) return;
  els.nutritionSheetMeals.querySelectorAll("[data-meal-sheet]").forEach((btn) => {
    const on = btn.dataset.mealSheet === mealId;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function renderNutritionSheetMeals(selectedMeal) {
  if (!els.nutritionSheetMeals) return;
  els.nutritionSheetMeals.innerHTML = NUTRITION_MEALS.map(
    (m) => `
    <button type="button" class="segmented__btn${m.id === selectedMeal ? " is-active" : ""}"
      data-meal-sheet="${m.id}" role="tab" aria-selected="${m.id === selectedMeal}">${m.label}</button>`
  ).join("");
  els.nutritionSheetMeals.querySelectorAll("[data-meal-sheet]").forEach((btn) => {
    btn.addEventListener("click", () => setNutritionSheetMeal(btn.dataset.mealSheet));
  });
}

function closeNutritionQuickAdd() {
  if (els.nutritionQuickAddSheet) els.nutritionQuickAddSheet.hidden = true;
  document.body.classList.remove("nutrition-sheet-open");
  state.nutritionQuickAddProductId = null;
  state.nutritionQuickAddFoodId = null;
  state.nutritionSheetMode = "add";
  state.nutritionEditEntryId = null;
  state.nutritionCookMode = "plain";
  if (els.nutritionSheetMealBlock) els.nutritionSheetMealBlock.hidden = false;
  if (els.nutritionSheetCookBlock) els.nutritionSheetCookBlock.hidden = false;
  if (els.nutritionSheetCookLabel) els.nutritionSheetCookLabel.textContent = "Как взвешиваешь";
  if (els.nutritionSheetCook) els.nutritionSheetCook.setAttribute("aria-label", "Как взвешиваешь");
  if (els.nutritionSheetOilBlock) els.nutritionSheetOilBlock.hidden = true;
  if (els.nutritionSheetOil) els.nutritionSheetOil.value = "";
  if (els.nutritionSheetGramsLabel) els.nutritionSheetGramsLabel.textContent = "Граммы";
  if (els.nutritionSheetSubmit) els.nutritionSheetSubmit.textContent = nutritionAddToDayLabel();
  if (isDishIngredientCardOpen()) {
    syncTelegramBackButton();
  }
}

function openNutritionQuickAdd(product, explicitMeal) {
  if (!product?.id || !els.nutritionQuickAddSheet) return;
  const meal = resolveQuickAddMeal(explicitMeal);
  const isFood = Boolean(product.fromCatalog || product.foodId);
  state.nutritionSheetMode = "add";
  state.nutritionEditEntryId = null;
  if (isFood) {
    const foodId = Number(product.foodId || product.id);
    state.nutritionQuickAddFoodId = foodId;
    state.nutritionQuickAddProductId = null;
    state.nutritionFoodById.set(foodId, product);
  } else {
    state.nutritionQuickAddProductId = product.id;
    state.nutritionQuickAddFoodId = null;
    state.nutritionProductsById.set(product.id, product);
  }
  state.nutritionQuickAddMeal = meal;
  if (els.nutritionSheetProductName) els.nutritionSheetProductName.textContent = product.name;
  if (els.nutritionSheetMealBlock) els.nutritionSheetMealBlock.hidden = false;
  if (els.nutritionSheetCookLabel) els.nutritionSheetCookLabel.textContent = "Как взвешиваешь";
  if (els.nutritionSheetCook) els.nutritionSheetCook.setAttribute("aria-label", "Как взвешиваешь");
  if (els.nutritionSheetOil) els.nutritionSheetOil.value = "";
  const cookModes = cookModesForProduct(product);
  if (els.nutritionSheetCookBlock) els.nutritionSheetCookBlock.hidden = !cookModes;
  if (els.nutritionSheetSubmit) els.nutritionSheetSubmit.textContent = nutritionAddToDayLabel();
  const prefKind = isFood ? "food" : "product";
  const prefId = isFood ? Number(product.foodId || product.id) : product.id;
  const pref = loadCookPref(prefKind, prefId);
  const prefOk =
    pref?.mode && cookModes && cookModes.some((m) => m.id === pref.mode);
  state.nutritionCookMode = product.isDish ? "plain" : prefOk ? pref.mode : "plain";
  if (els.nutritionSheetGrams) {
    els.nutritionSheetGrams.value = formatSheetGramsValue(lastDiaryGramsForProduct(product));
  }
  if (els.nutritionSheetGramsLabel) {
    els.nutritionSheetGramsLabel.textContent = product.isDish
      ? dishLogGramsLabel(product)
      : "Граммы";
  }
  renderNutritionSheetMeals(meal);
  renderCookModeButtons(product);
  updateCookSheetMeta();
  els.nutritionQuickAddSheet.hidden = false;
  document.body.classList.add("nutrition-sheet-open");
  requestAnimationFrame(() => {
    if (isFryCookMode(state.nutritionCookMode)) {
      focusWithoutScroll(els.nutritionSheetOil);
      scheduleNumericCaretFix(els.nutritionSheetOil);
    } else {
      focusWithoutScroll(els.nutritionSheetGrams);
    }
  });
}

function openNutritionEditGrams(entry) {
  if (!entry?.id || !els.nutritionQuickAddSheet) return;
  state.nutritionSheetMode = "edit";
  state.nutritionEditEntryId = entry.id;
  const product = productFromMealEntry(entry);
  if (entry.foodId) {
    state.nutritionQuickAddFoodId = entry.foodId;
    state.nutritionQuickAddProductId = null;
    state.nutritionFoodById.set(Number(entry.foodId), product);
  } else {
    state.nutritionQuickAddProductId = entry.productId || null;
    state.nutritionQuickAddFoodId = null;
    if (entry.productId) state.nutritionProductsById.set(Number(entry.productId), product);
  }
  const cookModes = cookModesForProduct(product);
  const modeOk =
    entry.cookMode && cookModes && cookModes.some((m) => m.id === entry.cookMode);
  state.nutritionCookMode = modeOk ? entry.cookMode : "plain";
  if (els.nutritionSheetProductName) els.nutritionSheetProductName.textContent = entry.name;
  if (els.nutritionSheetMealBlock) els.nutritionSheetMealBlock.hidden = true;
  if (els.nutritionSheetCookLabel) els.nutritionSheetCookLabel.textContent = "Как взвешиваешь";
  if (els.nutritionSheetCook) els.nutritionSheetCook.setAttribute("aria-label", "Как взвешиваешь");
  const oilVal = Number(entry.oilGrams);
  if (els.nutritionSheetOil) {
    els.nutritionSheetOil.value =
      modeOk && isFryCookMode(state.nutritionCookMode) && oilVal > 0
        ? formatSheetGramsValue(oilVal) || String(oilVal)
        : "";
  }
  if (els.nutritionSheetCookBlock) els.nutritionSheetCookBlock.hidden = !cookModes;
  if (els.nutritionSheetSubmit) els.nutritionSheetSubmit.textContent = "Сохранить";
  if (els.nutritionSheetGrams) els.nutritionSheetGrams.value = formatSheetGramsValue(entry.grams);
  renderCookModeButtons(product);
  updateCookSheetMeta();
  els.nutritionQuickAddSheet.hidden = false;
  document.body.classList.add("nutrition-sheet-open");
  requestAnimationFrame(() => focusWithoutScroll(els.nutritionSheetGrams));
}

function openNutritionQuickAddById(productId, explicitMeal) {
  const p = state.nutritionProductsById.get(Number(productId));
  if (p) openNutritionQuickAdd(p, explicitMeal);
}

function openNutritionQuickAddFoodById(foodId, explicitMeal) {
  const p = state.nutritionFoodById.get(Number(foodId));
  if (p) openNutritionQuickAdd(p, explicitMeal);
}

/** После записи в дневник — экран «Питание» с актуальными барами и приёмами. */
async function finishNutritionLogAdd() {
  closeNutritionQuickAdd();
  state.nutritionAddMealExplicit = false;
  state.nutritionAddMeal = inferMealByTime();
  setScreen("detailNutrition");
  if (els.nutritionDetailBars) els.nutritionDetailBars.innerHTML = "";
  if (els.nutritionMealList) {
    els.nutritionMealList.innerHTML = '<p class="meal-card__empty">Загрузка…</p>';
  }
  await refreshNutritionDetail();
}

async function submitNutritionQuickAdd() {
  if (nutritionSubmitLock) return;
  const weighed = Number(String(els.nutritionSheetGrams?.value || "").replace(",", "."));
  if (!weighed || weighed <= 0) throw new Error("Укажите граммы");

  const modeId = state.nutritionCookMode || "plain";

  if (state.nutritionSheetMode === "dish") {
    const item = dishEditItem();
    if (!item) throw new Error("Ингредиент не выбран");
    item.grams = formatSheetGramsValue(weighed) || String(weighed);
    item.cookMode = modeId;
    item.oilGrams =
      isFryCookMode(modeId) ? String(els.nutritionSheetOil?.value || "").trim() : "";
    closeNutritionQuickAdd();
    closeDishIngredientCard();
    return;
  }

  if (state.nutritionSheetMode === "edit") {
    if (!state.nutritionEditEntryId) throw new Error("Запись не выбрана");
    const oil =
      isFryCookMode(modeId) ? String(els.nutritionSheetOil?.value || "").trim() : "0";
    await updateMealEntryGrams(state.nutritionEditEntryId, weighed, modeId, oil);
    closeNutritionQuickAdd();
    return;
  }

  if (!state.nutritionQuickAddProductId && !state.nutritionQuickAddFoodId) {
    throw new Error("Продукт не выбран");
  }
  nutritionSubmitLock = true;
  const submitBtn = els.nutritionSheetSubmit;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add("is-saving");
  }
  try {
    const body = {
      date: nutritionLogDate(),
      mealGroup: state.nutritionQuickAddMeal,
      grams: weighed,
      cookMode: modeId,
    };
    if (isFryCookMode(modeId)) {
      const oil = Number(String(els.nutritionSheetOil?.value || "").replace(",", "."));
      body.oilGrams = oil > 0 ? oil : 0;
    }
    if (state.nutritionQuickAddFoodId != null) {
      body.foodId = state.nutritionQuickAddFoodId;
      const data = await apiPostJson("/nutrition/log", body);
      const g = Number(data.lastServingGrams) || weighed;
      saveCookPref("food", state.nutritionQuickAddFoodId, g, modeId);
      rememberFoodLastGrams(state.nutritionQuickAddFoodId, g);
    } else {
      body.productId = state.nutritionQuickAddProductId;
      const data = await apiPostJson("/nutrition/log", body);
      const g = Number(data.lastServingGrams) || weighed;
      saveCookPref("product", state.nutritionQuickAddProductId, g, modeId);
      rememberProductLastGrams(state.nutritionQuickAddProductId, g);
    }
    await finishNutritionLogAdd();
  } finally {
    nutritionSubmitLock = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove("is-saving");
    }
  }
}

function macroSubline(p) {
  return `${p.kcalPer100g} ккал · Б ${p.proteinPer100g} · У ${p.carbsPer100g} · Ж ${p.fatPer100g} / 100 г`;
}

function renderProductMacroLegend(product, serving) {
  if (!els.productMacroLegend) return;
  els.productMacroLegend.innerHTML = MACRO_LEGEND.map((m) => {
    const grams = serving
      ? Math.round(Number(serving[m.key]) * 10) / 10
      : Math.round(Number(product[`${m.key}Per100g`]) * 10) / 10;
    return `
      <li class="product-macro-legend__item">
        <span class="product-macro-legend__dot" style="background:${m.color}"></span>
        <span class="product-macro-legend__label">${m.label}</span>
        <span class="product-macro-legend__grams">${grams} г</span>
      </li>`;
  }).join("");
}

function servingMacrosFromEntry(entry) {
  return {
    grams: entry.grams,
    kcal: entry.kcal,
    protein: entry.protein,
    carbs: entry.carbs,
    fat: entry.fat,
  };
}

function fillProductEditForm(product) {
  if (!els.productEditForm || !product) return;
  const active = document.activeElement;
  if (active && els.productEditForm.contains(active) && active.matches("input, textarea")) return;
  const form = els.productEditForm;
  form.elements.name.value = product.name;
  form.elements.kcal.value = formatMacroFieldValue(product.kcalPer100g);
  form.elements.protein.value = formatMacroFieldValue(product.proteinPer100g);
  form.elements.carbs.value = formatMacroFieldValue(product.carbsPer100g);
  form.elements.fat.value = formatMacroFieldValue(product.fatPer100g);
  form.elements.fiber.value = formatMacroFieldValue(product.fiberPer100g ?? 0);
}

function renderProductBjuBadge(product) {
  const line = els.productDetailBjuLine;
  const scoreEl = els.productDetailBjuScore;
  const tierWord = els.productDetailBjuTierWord;
  if (!line || !scoreEl || !tierWord) return;
  const score = product?.bjuScore;
  const tier = product?.bjuTier;
  const label = tier ? BJU_TIER_LABELS[tier] : null;
  if (score == null || !tier || !label) {
    line.hidden = true;
    line.className = "product-bju-line";
    return;
  }
  line.hidden = false;
  line.className = `product-bju-line product-bju-line--${tier}`;
  scoreEl.textContent = String(score);
  tierWord.textContent = label;
}

function openBjuInfoSheet() {
  if (!els.bjuInfoSheet) return;
  els.bjuInfoSheet.hidden = false;
  if (els.productDetailBjuInfo) els.productDetailBjuInfo.setAttribute("aria-expanded", "true");
}

function closeBjuInfoSheet() {
  if (!els.bjuInfoSheet) return;
  els.bjuInfoSheet.hidden = true;
  if (els.productDetailBjuInfo) els.productDetailBjuInfo.setAttribute("aria-expanded", "false");
}

function servingFromControls(product) {
  const raw = String(els.productServingAmount?.value || "").replace(",", ".");
  const amount = Number(raw);
  if (!amount || amount <= 0 || !product) return null;
  const unit = state.nutritionServingUnit === "100g" ? "100g" : "g";
  const weighed = unit === "100g" ? amount * 100 : amount;
  if (isDishIngredientCardOpen()) {
    const item = dishEditItem();
    if (!item) return null;
    item.grams = formatSheetGramsValue(weighed) || String(weighed);
    const part = dishItemPart(item);
    if (!part) {
      return {
        grams: Math.round(weighed * 10) / 10,
        kcal: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
      };
    }
    return {
      grams: Math.round(weighed * 10) / 10,
      kcal: Math.round(part.kcal * 10) / 10,
      protein: Math.round(part.protein * 10) / 10,
      carbs: Math.round(part.carbs * 10) / 10,
      fat: Math.round(part.fat * 10) / 10,
      fiber: Math.round(part.fiber * 10) / 10,
    };
  }
  const cookMode = state.nutritionViewServingEntry?.cookMode || "plain";
  const accountGrams = cookLogGrams(weighed, cookMode, product?.name);
  const factor = accountGrams / 100;
  let kcal = (Number(product.kcalPer100g) || 0) * factor;
  let fat = (Number(product.fatPer100g) || 0) * factor;
  if (isFryCookMode(cookMode)) {
    const oil = Number(String(els.productDishOil?.value || state.nutritionViewServingEntry?.oilGrams || "").replace(",", "."));
    if (oil > 0) {
      kcal += oil * OIL_KCAL_PER_G;
      fat += oil;
    }
  }
  return {
    grams: Math.round(weighed * 10) / 10,
    kcal: Math.round(kcal * 10) / 10,
    protein: Math.round((Number(product.proteinPer100g) || 0) * factor * 10) / 10,
    carbs: Math.round((Number(product.carbsPer100g) || 0) * factor * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    fiber: Math.round((Number(product.fiberPer100g) || 0) * factor * 10) / 10,
  };
}

function cookModeToggleSuffix(product) {
  if (isDishIngredientCardOpen()) {
    const item = dishEditItem();
    const kind = dishIngredientKind(item);
    if (!kind) return "";
    const modeId = item?.cookMode || "plain";
    const label = dishCookUiFor(kind, modeId).label;
    if (!label || modeId === "plain") return "";
    return ` (${label.toLowerCase()})`;
  }
  const kind =
    productCookKind(product) ||
    productCookKind(state.nutritionViewServingEntry) ||
    null;
  if (!kind || !COOK_UI_BY_KIND[kind]) return "";
  const modeId = state.nutritionViewServingEntry?.cookMode || "plain";
  const label = cookUiFor(kind, modeId).label;
  if (!label) return "";
  return ` (${label.toLowerCase()})`;
}

function syncProductMacroViewToggle() {
  if (!els.productMacroViewToggle) return;
  const serving = state.nutritionViewServing;
  const gramsLabel = serving?.grams
    ? String(Math.round(Number(serving.grams) * 10) / 10)
    : "порцию";
  const suffix = cookModeToggleSuffix(state.nutritionViewProduct);
  if (state.nutritionMacroViewMode === "100g") {
    els.productMacroViewToggle.textContent = `Показать на ${gramsLabel} г${suffix}`;
  } else {
    els.productMacroViewToggle.textContent = `Показать на 100 г${suffix}`;
  }
}

function renderProductDetailServingView() {
  const product = state.nutritionViewProduct;
  if (!product) return;
  const serving = servingFromControls(product);
  state.nutritionViewServing = serving;
  const mode = state.nutritionMacroViewMode === "100g" ? "100g" : "serving";
  if (els.productDetailKcal) {
    if (mode === "100g" || !serving) {
      const kcal100 = Math.round(Number(product.kcalPer100g) * 10) / 10;
      els.productDetailKcal.textContent = `${kcal100} ккал на 100 г`;
    } else {
      let line = `${Math.round(serving.kcal)} ккал · ${serving.grams} г`;
      if (isDishIngredientCardOpen()) {
        const item = dishEditItem();
        const oil = Number(String(item?.oilGrams || "").replace(",", "."));
        if (isFryCookMode(item?.cookMode || "plain") && oil > 0) {
          line += ` · масло ${Math.round(oil * 10) / 10} г`;
        }
      } else {
        const entry = state.nutritionViewServingEntry;
        const oil = Number(String(els.productDishOil?.value || entry?.oilGrams || "").replace(",", "."));
        if (isFryCookMode(entry?.cookMode || "plain") && oil > 0) {
          line += ` · масло ${Math.round(oil * 10) / 10} г`;
        }
      }
      els.productDetailKcal.textContent = line;
    }
  }
  syncProductMacroViewToggle();
  const chartServing = mode === "serving" ? serving : null;
  renderProductMacroDonut(els.productMacroDonutHost, product, chartServing);
  renderProductMacroLegend(product, chartServing);
}

async function saveServingFromProductCard() {
  const entry = state.nutritionViewServingEntry;
  if (!entry?.id) return;
  const serving = servingFromControls(state.nutritionViewProduct);
  if (!serving || serving.grams <= 0) throw new Error("Укажите количество (> 0)");
  const btn = els.productDetailAddBtn;
  if (btn) {
    btn.disabled = true;
    btn.classList.add("is-saving");
  }
  try {
    const oil =
      isFryCookMode(entry.cookMode || "plain")
        ? String(els.productDishOil?.value || entry.oilGrams || "").trim()
        : "0";
    await updateMealEntryGrams(entry.id, serving.grams, entry.cookMode || "plain", oil);
    const oilN = Number(String(oil).replace(",", "."));
    state.nutritionViewServingEntry = {
      ...entry,
      grams: serving.grams,
      oilGrams: isFryCookMode(entry.cookMode || "plain") && oilN > 0 ? oilN : undefined,
    };
    renderProductDetailServingView();
    setScreen("detailNutrition");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("is-saving");
    }
  }
}

function openProductDetail(product, backScreen, opts = {}) {
  if (backScreen) state.nutritionBackScreen = backScreen;
  state.nutritionViewProduct = product;
  const serving = opts.serving ? servingMacrosFromEntry(opts.serving) : null;
  state.nutritionViewServingEntry = opts.serving ? { ...opts.serving } : null;
  state.nutritionViewServing = serving;
  state.nutritionServingUnit = "g";
  state.nutritionMacroViewMode = serving ? "serving" : "100g";
  setScreen("detailNutritionProduct");
  if (els.productDetailTitle) els.productDetailTitle.textContent = product.name;
  syncProductDetailDishTag(product);
  if (els.productServingCard) els.productServingCard.hidden = !serving;
  if (els.productServingAmount) {
    els.productServingAmount.value = serving ? formatSheetGramsValue(serving.grams) : "100";
  }
  if (els.productServingUnit) els.productServingUnit.value = "g";
  syncNutritionAddLabels();
  const isCatalog = Boolean(product.fromCatalog || product.foodId);
  if (els.productDetailDeleteBtn) {
    els.productDetailDeleteBtn.hidden = isCatalog;
    els.productDetailDeleteBtn.textContent = product.isDish ? "Удалить блюдо" : "Удалить продукт";
  }
  if (els.productEditCard) {
    els.productEditCard.hidden = Boolean(product.isDish);
    els.productEditCard.open = false;
  }
  syncProductDishEditBtn(product);
  renderProductBjuBadge(product);
  syncProductDetailFavoriteBtn(product);
  clearTimeout(productNoteTimer);
  productNoteSeq += 1;
  syncProductDetailNote(product, { force: true });
  if (!product.isDish) fillProductEditForm(product);
  destroyCharts();
  syncDishIngredientCardChrome();
  renderProductDetailServingView();
  refreshProductMeta(product).then((p) => {
    if (state.nutritionViewProduct !== product) return;
    syncProductDetailFavoriteBtn(p);
    syncProductDetailNote(p);
    syncProductDetailDishTag(p);
  }).catch(() => {});
}

function openProductDeleteConfirm(product) {
  const target = product || state.nutritionViewProduct;
  if (!target?.id) return;
  if (target.fromCatalog || target.foodId) return;
  state.nutritionDeleteTarget = target;
  const textEl = document.getElementById("productDeleteConfirmText");
  if (textEl) {
    textEl.textContent = target.isDish ? "Удалить блюдо из базы?" : "Удалить продукт из базы?";
  }
  if (els.productDeleteConfirm) els.productDeleteConfirm.hidden = false;
}

function closeProductDeleteConfirm() {
  state.nutritionDeleteTarget = null;
  if (els.productDeleteConfirm) els.productDeleteConfirm.hidden = true;
}

async function confirmDeleteProduct() {
  const product = state.nutritionDeleteTarget || state.nutritionViewProduct;
  if (!product?.id) {
    closeProductDeleteConfirm();
    throw new Error("Продукт не выбран");
  }
  if (product.fromCatalog || product.foodId) {
    closeProductDeleteConfirm();
    throw new Error("Продукт каталога нельзя удалить");
  }
  await apiDelete(`/nutrition/products/${product.id}`);
  closeProductDeleteConfirm();
  state.nutritionProductsById.delete(product.id);
  const onDetailCard =
    state.screen === "detailNutritionProduct" && state.nutritionViewProduct?.id === product.id;
  if (onDetailCard) {
    state.nutritionViewProduct = null;
    state.nutritionViewServing = null;
    destroyCharts();
    const back = state.nutritionBackScreen || "detailNutritionProducts";
    setScreen(back);
  }
  if (state.screen === "detailNutritionProducts") {
    await loadProductDatabase();
  }
  if (state.screen === "detailNutrition" || onDetailCard) {
    await refreshNutritionDetail();
  }
  if (state.screen === "home") await loadNutritionToday();
}

async function submitProductEdit(form) {
  const current = state.nutritionViewProduct;
  if (!current?.id) throw new Error("Продукт не выбран");
  const payload = readNewProductPayload(form);
  const isCatalog = Boolean(current.fromCatalog || current.foodId);
  let product;
  if (isCatalog) {
    const foodId = Number(current.foodId || current.id);
    const res = await apiPostJson("/nutrition/products/adopt-catalog", {
      ...payload,
      foodId,
    });
    if (!res.product) throw new Error(res.error || "Не удалось сохранить");
    product = res.product;
    state.nutritionProductsById.delete(foodId);
  } else {
    const res = await apiPatchJson(`/nutrition/products/${current.id}`, payload);
    if (!res.product) throw new Error(res.error || "Не удалось сохранить");
    product = res.product;
  }
  state.nutritionProductsById.set(product.id, product);
  openProductDetail(product);
  if (els.productEditCard) els.productEditCard.open = false;
  if (isNutritionScreen(state.screen)) {
    await refreshNutritionDetail();
  }
  if (state.screen === "home") await loadNutritionToday();
}

function openProductDetailById(productId) {
  const p = state.nutritionProductsById.get(Number(productId));
  if (p) openProductDetail(p, "detailNutritionProducts");
}

function openNutritionProductsFromDiary(opts = {}) {
  openNutritionProducts({ backScreen: "detailNutrition", ...opts });
}

function readNewProductPayload(form) {
  const fd = new FormData(form);
  const name = String(fd.get("name") || "").trim();
  if (!name) throw new Error("Укажите название");
  return {
    name,
    kcalPer100g: fd.get("kcal"),
    proteinPer100g: fd.get("protein"),
    fatPer100g: fd.get("fat"),
    carbsPer100g: fd.get("carbs"),
    fiberPer100g: fd.get("fiber") || 0,
  };
}

async function createProductFromForm(form) {
  const res = await apiPostJson("/nutrition/products", readNewProductPayload(form));
  if (!res.product) throw new Error(res.error || "Не удалось сохранить продукт");
  state.nutritionProductsById.set(res.product.id, res.product);
  return res.product;
}

async function afterNewProductSaved(form) {
  form.reset();
  closeProductCreateCard();
  resetProductDbSearch();
}

async function submitNewProduct(form) {
  await createProductFromForm(form);
  await afterNewProductSaved(form);
}

async function submitNewProductAndAddToMeal(form) {
  const product = await createProductFromForm(form);
  await afterNewProductSaved(form);
  openNutritionQuickAdd(product);
}

const SPORT_BLOCK_COLORS = {
  "warmup-stretch": "#16a085",
  cycling: "#3685bf",
  workout: "#e67e22",
  running: "#1f8a65",
};

function sportBlockColor(blockId) {
  return SPORT_BLOCK_COLORS[blockId] || "#7f8c8d";
}

function formatSportDetailValue(row) {
  const n = Number(row.fact) || 0;
  if (row.unit === "км") {
    return n % 1 === 0 ? String(Math.round(n)) : String(Math.round(n * 100) / 100);
  }
  if (row.agg === "avg") return String(Math.round(n));
  return n % 1 === 0 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function renderSportDetailBarRow(row, blockColor) {
  const label = row.displayLabel || row.label || "—";
  const factStr = formatSportDetailValue(row);
  const goal = Number(row.goal) || 0;
  const hasGoal = goal > 0;
  const unit = row.unit ? ` ${row.unit}` : "";

  if (!hasGoal) {
    return `
      <div class="sport-metric__row sport-metric__row--stat">
        <span class="sport-metric__name">${escapeHtml(label)}</span>
        <span class="sport-metric__nums">${escapeHtml(factStr)}${unit ? escapeHtml(unit) : ""}</span>
      </div>`;
  }

  const pct = Math.min(100, Math.max(0, Number(row.progress) || 0));
  const goalStr = formatSportDetailValue({ ...row, fact: goal });
  return `
    <div class="sport-metric__row">
      <span class="sport-metric__name">${escapeHtml(label)}</span>
      <div class="sport-metric__bar-wrap">
        <div class="finance-plan-row__bars" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(label)}">
          <div class="finance-plan-row__plan" style="width:100%"></div>
          <div class="finance-plan-row__fact" style="width:${pct}%;background:${blockColor}"></div>
        </div>
      </div>
      <div class="sport-metric__pct">
        <span class="sport-metric__pct-val">${pct}%</span>
        <span class="sport-metric__pct-sub">${escapeHtml(factStr)} / ${escapeHtml(goalStr)}${escapeHtml(unit)}</span>
      </div>
    </div>`;
}

function sportDetailPayload(data) {
  if (!data?.ok) return null;
  return {
    sport: data.sport,
    sportByType: data.sportByType,
    weekLabel: data.weekLabel,
    daysOverlap: data.daysOverlap,
    sportDays: data.sportDays,
  };
}

function renderSportDetailBlocks(hostEl, payload) {
  if (!hostEl) return;
  const blocks = payload?.sportByType?.blocks;
  if (!Array.isArray(blocks) || !blocks.length) {
    hostEl.innerHTML = '<p class="donut-fallback">Нет данных по спорту</p>';
    return;
  }

  hostEl.innerHTML = blocks
    .map((block) => {
      const accent = sportBlockColor(block.id);
      return `
      <section class="sport-metric" data-sport-block="${escapeHtml(block.id || "")}" style="--sport-accent:${accent}">
        <p class="section-counter">${escapeHtml(block.title || "")}</p>
        ${(block.rows || []).map((row) => renderSportDetailBarRow(row, accent)).join("")}
      </section>`;
    })
    .join("");
}

function detailStripSwipeHint(period) {
  return period === "week"
    ? "Свайп влево или вправо — другая неделя"
    : "Свайп влево или вправо — другой месяц";
}

function renderDetailSwipeStrip(el, opts) {
  const pctRaw = Number(opts.pct) || 0;
  const pctShow = Math.round(pctRaw * 10) / 10;
  const barW = Math.min(100, Math.max(0, pctRaw));
  const color = progressColor(barW);

  el.className = "progress-strip progress-strip--swipe";
  el.dataset.detailStripSwipe = opts.period || "";
  el.setAttribute(
    "aria-label",
    `${opts.title}: ${opts.factLabel}. ${detailStripSwipeHint(opts.period)}`
  );

  el.innerHTML = `
    <div class="progress-strip__head">
      <span class="progress-strip__title">${escapeHtml(opts.title)}</span>
      <div class="progress-strip__pct-wrap">
        <span class="progress-strip__pct" style="color:${color}">${pctShow}%</span>
        <span class="progress-strip__pct-sub">${escapeHtml(opts.subLabel)}</span>
      </div>
    </div>
    <div class="progress-strip__track" role="progressbar" aria-valuenow="${barW}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-strip__fill" style="width:${barW}%;background:${color}"></div>
    </div>
    <div class="progress-strip__meta">
      <span>${escapeHtml(opts.factLabel)}</span>
      <span>${escapeHtml(opts.remainLabel)}</span>
    </div>
    ${renderKpiSwipeDots(3, 1)}`;
}

function renderSportProgressStrip(el, payload, period) {
  const sport = payload?.sport;
  if (!sport || typeof sport.totalMinutes !== "number") {
    el.className = "progress-strip";
    el.removeAttribute("data-detail-strip-swipe");
    el.innerHTML = '<p class="donut-fallback">Нет данных по спорту</p>';
    return;
  }

  const { total, goal, pct } = monthSportStats(sport);
  const goalR = Math.round(goal);
  const remain = Math.max(0, Math.round(goal - total));
  const isWeek = period === "week";
  const monthKey = state.sportDetailMonthKey || state.monthKey;
  const title = isWeek
    ? payload.weekLabel || "Неделя"
    : formatMonthLabel(monthKey);

  renderDetailSwipeStrip(el, {
    title,
    pct,
    subLabel: isWeek ? `неделя · ${payload.sportDays || payload.daysOverlap || 7} дн.` : "спорт",
    factLabel: `${total} / ${goalR} мин`,
    remainLabel: remain > 0 ? `ост. ${remain} мин` : "цель выполнена",
    period,
  });
}

function productivityDetailPayload(data, rows) {
  if (!data?.ok || !Array.isArray(rows)) return null;
  const stats = monthProductivityStats(rows);
  return {
    rows,
    weekLabel: data.weekLabel,
    daysOverlap: data.daysOverlap,
    stats,
  };
}

function renderProductivityRadarSection(rows) {
  const block = els.productivityRadarBlock;
  const canvas = els.productivityRadarChart;
  if (!block || !canvas) return;
  if (!Array.isArray(rows) || !rows.length) {
    setElHidden(block, true);
    return;
  }
  setElHidden(block, false);
  renderProductivityRadar(canvas, rows);
}

function renderProductivityDetailBlocks(hostEl, rows) {
  if (!hostEl) return;
  if (!Array.isArray(rows) || !rows.length) {
    hostEl.innerHTML = '<p class="donut-fallback">Нет данных по продуктивности</p>';
    return;
  }

  hostEl.innerHTML = `
    <section class="sport-metric sport-metric--plain">
      ${rows
        .map((r) =>
          renderSportDetailBarRow(
            {
              displayLabel: r.sphere || r.label || "—",
              fact: r.fact,
              goal: r.goal,
              progress: r.progress,
              unit: "",
            },
            "var(--link)"
          )
        )
        .join("")}
    </section>`;
}

function renderProductivityProgressStrip(el, payload, period) {
  const stats = payload?.stats;
  if (!stats) {
    el.className = "progress-strip";
    el.removeAttribute("data-detail-strip-swipe");
    el.innerHTML = '<p class="donut-fallback">Нет данных по продуктивности</p>';
    return;
  }

  const { totalFact, totalGoal, pct } = stats;
  const remain = Math.max(0, totalGoal - totalFact);
  const isWeek = period === "week";
  const monthKey = state.productivityDetailMonthKey || state.monthKey;
  const title = isWeek
    ? payload.weekLabel || "Неделя"
    : formatMonthLabel(monthKey);

  renderDetailSwipeStrip(el, {
    title,
    pct,
    subLabel: isWeek ? `неделя · ${payload.daysOverlap || 7} дн.` : "продуктивность",
    factLabel: `${totalFact}/${totalGoal}`,
    remainLabel: remain > 0 ? `ост. ${remain}` : "план выполнен",
    period,
  });
}

function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split("-");
  const idx = parseInt(m, 10) - 1;
  const name = MONTH_NAMES[idx] || m;
  return `${name} ${y}`;
}

function formatDateLine(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = WEEKDAY_SHORT[dt.getDay()];
  const monthName = MONTH_NAMES[m - 1]?.toLowerCase() || "";
  return `${wd}, ${d} ${monthName}`;
}

function routineDoneCount() {
  return state.routine.filter((r) => r.on).length;
}

function telegramPrefersWindowed() {
  const platform = String(tg?.platform || window.Telegram?.WebApp?.platform || "").toLowerCase();
  return platform === "tdesktop" || platform === "macos" || platform === "web" || platform === "weba";
}

function initTelegram() {
  const w = window.Telegram?.WebApp;
  // Вне Telegram объект WebApp иногда есть, но без initData — не трогаем (ломает Safari).
  if (!w || !w.initData) return;
  tg = w;
  try {
    tg.ready();
    tg.expand();
    if (typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes();
    if (telegramPrefersWindowed()) {
      if (tg.isFullscreen && typeof tg.exitFullscreen === "function") {
        try {
          tg.exitFullscreen();
        } catch {
          /* optional Bot API 8.0+ */
        }
      }
    } else if (tg.isVersionAtLeast?.("8.0") && typeof tg.requestFullscreen === "function") {
      try {
        tg.requestFullscreen();
      } catch {
        /* optional Bot API 8.0+ */
      }
    }
    applyThemeFromTelegram();
    applyTelegramSafeArea();
    tg.onEvent?.("themeChanged", applyThemeFromTelegram);
    tg.onEvent?.("safeAreaChanged", applyTelegramSafeArea);
    tg.onEvent?.("contentSafeAreaChanged", applyTelegramSafeArea);
    tg.onEvent?.("fullscreenChanged", applyTelegramSafeArea);
    if (tg.BackButton?.onClick) tg.BackButton.onClick(navigateBack);
    syncTelegramBackButton();
  } catch {
    /* Safari / битый WebApp stub — продолжаем cookie-входом */
    tg = null;
  }
}

function applyTelegramSafeArea() {
  if (!tg) return;
  const isFullscreen = Boolean(tg.isFullscreen);
  document.body.classList.toggle("tg-fullscreen", isFullscreen);
  const root = document.documentElement;
  const device = tg.safeAreaInset || {};
  const content = tg.contentSafeAreaInset || {};
  for (const side of ["top", "bottom", "left", "right"]) {
    const devicePx = typeof device[side] === "number" ? device[side] : 0;
    const contentPx = typeof content[side] === "number" ? content[side] : 0;
    root.style.setProperty(`--tg-safe-${side}`, `${devicePx}px`);
    root.style.setProperty(`--tg-content-safe-${side}`, `${contentPx}px`);
  }
  const deviceTop = typeof device.top === "number" ? device.top : 0;
  const contentTop = typeof content.top === "number" ? content.top : 0;
  const tgChromeH = deviceTop + contentTop;
  root.style.setProperty(
    "--header-bar-h",
    isFullscreen ? `${Math.max(72, tgChromeH)}px` : "60px"
  );
}

function applyThemeFromTelegram() {
  if (!tg?.themeParams) return;
  const p = tg.themeParams;
  const root = document.documentElement;
  const map = {
    bg_color: "--bg",
    text_color: "--text",
    hint_color: "--hint",
    link_color: "--link",
    button_color: "--btn",
    button_text_color: "--btn-text",
    secondary_bg_color: "--secondary",
  };
  for (const [key, cssVar] of Object.entries(map)) {
    if (p[key]) root.style.setProperty(cssVar, p[key]);
  }
  const header = document.getElementById("appHeader");
  if (header && p.button_color) {
    header.style.background = p.button_color;
  }
  if (p.button_color && tg.setHeaderColor) {
    try {
      tg.setHeaderColor(p.button_color);
    } catch {
      /* optional */
    }
  }
  if (p.bg_color && tg.setBackgroundColor) {
    try {
      tg.setBackgroundColor(p.bg_color);
    } catch {
      /* optional */
    }
  }
}

function syncTelegramBackButton() {
  if (!tg?.BackButton) return;
  if (isDishCreateSheetOpen() || isDishItemSheetOpen() || isDishCookPickOpen() || isProductCreateSheetOpen()) {
    tg.BackButton.show();
    return;
  }
  if (state.screen === "home") tg.BackButton.hide();
  else tg.BackButton.show();
}

function edgeBackAvailable() {
  if (isDishCreateSheetOpen() || isDishItemSheetOpen() || isDishCookPickOpen()) return true;
  if (isProductCreateSheetOpen()) return true;
  if (els.bjuInfoSheet && !els.bjuInfoSheet.hidden) return true;
  if (state.screen !== "home") return true;
  if (els.productDeleteConfirm && !els.productDeleteConfirm.hidden) return true;
  if (els.nutritionQuickAddSheet && !els.nutritionQuickAddSheet.hidden) return true;
  return false;
}

function navigateBack() {
  if (els.bjuInfoSheet && !els.bjuInfoSheet.hidden) {
    closeBjuInfoSheet();
    return;
  }
  if (els.productDeleteConfirm && !els.productDeleteConfirm.hidden) {
    closeProductDeleteConfirm();
    return;
  }
  if (isDishCookPickOpen()) {
    closeDishCookPickSheet();
    return;
  }
  if (isDishIngredientCardOpen()) {
    closeDishIngredientCard();
    return;
  }
  if (isDishItemSheetOpen()) {
    closeDishItemSheet();
    return;
  }
  if (isDishCreateSheetOpen()) {
    if (state.dishCreateStep === 2) {
      setDishCreateStep(1);
      return;
    }
    closeDishCreateSheet();
    return;
  }
  if (isProductCreateSheetOpen()) {
    if (state.productCreateStep === 2) {
      setProductCreateStep(1);
      return;
    }
    closeProductCreateSheet();
    return;
  }
  if (window.LifeFinance?.navigateBack?.()) {
    return;
  }
  if (window.LifeDiary?.navigateBack?.()) {
    return;
  }
  if (window.LifeLedger?.navigateBack?.()) {
    return;
  }
  if (els.nutritionQuickAddSheet && !els.nutritionQuickAddSheet.hidden) {
    closeNutritionQuickAdd();
    return;
  }
  if (state.screen === "dayForm") {
    if (state.fillMode === "history") {
      setFillMode("morning");
      loadMorningData()
        .then(() => applyFillOnboardingUi())
        .catch((err) => setDayError(String(err.message || err)));
      return;
    }
    closeWheel();
    clearFillOnboardingTimer();
    state.selectedDate = null;
    state.fillMode = "morning";
    setScreen("home");
    return;
  }
  if (state.screen === "detailNutritionProduct") {
    destroyCharts();
    state.nutritionViewServing = null;
    setScreen(state.nutritionBackScreen || "detailNutrition");
    return;
  }
  if (state.screen === "detailNutritionProducts") {
    setScreen("detailNutrition");
    return;
  }
  if (state.screen === "detailNutrition") {
    setScreen("home");
    return;
  }
  if (isDetailScreen(state.screen)) {
    destroyCharts();
    setScreen("home");
  }
}

function setScreen(screen, opts = {}) {
  const prevScreen = state.screen;
  const homeFresh = Boolean(opts.homeFresh ?? (screen === "home" && prevScreen !== "home"));
  state.screen = screen;
  const isHome = screen === "home";
  const isFill = screen === "dayForm";
  const isDetailProd = screen === "detailProductivity";
  const isDetailSport = screen === "detailSport";
  const isDetailNutrition = screen === "detailNutrition";
  const isDetailNutritionProducts = screen === "detailNutritionProducts";
  const isDetailNutritionProduct = screen === "detailNutritionProduct";
  const isDetailFinance = screen === "detailFinance";
  const isDetail = isDetailProd || isDetailSport;
  const isNutrition = isNutritionScreen(screen);
  const isFinance = isFinanceScreen(screen);
  const isDiary = isDiaryScreen(screen);
  const isLedger = isLedgerScreen(screen);

  setElHidden(els.dashboardZone, !isHome);
  setElHidden(els.nutritionZoneBtn, !isHome);
  window.LifeFinance?.onScreenChange?.(screen, { homeFresh });
  window.LifeLedger?.onScreenChange?.(screen, { homeFresh });
  setElHidden(els.flowDetailProductivity, !isDetailProd);
  setElHidden(els.flowDetailSport, !isDetailSport);
  setElHidden(els.flowDetailNutrition, !isDetailNutrition);
  setElHidden(els.flowNutritionProducts, !isDetailNutritionProducts);
  setElHidden(els.flowNutritionProduct, !isDetailNutritionProduct);
  setElHidden(els.flowFill, !isFill);
  setElHidden(els.flowDetailLedger, !isLedger);

  setElHidden(els.headerBack, isHome);
  els.appHeader?.classList.toggle("app-header--home", isHome);
  setElHidden(els.nutritionProductsBtn, !isDetailNutrition);
  if (els.nutritionProductsBtn) {
    els.nutritionProductsBtn.setAttribute(
      "aria-label",
      isDetailNutrition ? "База продуктов" : ""
    );
  }
  setElHidden(els.diaryDeleteBtn, screen !== "diaryEditor");
  updateFillHeaderAction();

  if (isHome) {
    els.headerTitle.textContent = "tim710";
  } else if (isFill) {
    els.headerTitle.textContent = state.fillMode === "history" ? "Другой день" : "Заполнить";
  } else if (screen === "detailNutritionProduct" && state.nutritionViewProduct?.name) {
    els.headerTitle.textContent = state.nutritionViewProduct.name;
  } else if (screen === "detailNutritionProducts") {
    els.headerTitle.textContent =
      nutritionViewDateIso() === todayIso()
        ? DETAIL_TITLE.detailNutritionProducts
        : nutritionAddToDayLabel();
  } else if (DETAIL_TITLE[screen]) {
    els.headerTitle.textContent = DETAIL_TITLE[screen];
  } else {
    els.headerTitle.textContent = "Детали";
  }

  window.LifeDiary?.onScreenChange?.(screen, { homeFresh });
  updateCtaForScreen();
  syncTelegramBackButton();

  if (screen === "home" && homeFresh) {
    state.monthKey = currentMonthKey();
    void refreshHomeScreen({ fresh: true });
  }
}

function updateCtaForScreen() {
  const isHome = state.screen === "home";
  const isFill = state.screen === "dayForm";
  const isNutritionDiary = state.screen === "detailNutrition";
  const isDiaryEditor = state.screen === "diaryEditor";

  if (els.homeFillBtn) els.homeFillBtn.hidden = !isHome;
  if (els.ctaBar) els.ctaBar.hidden = !isFill;
  if (els.nutritionCtaBar) els.nutritionCtaBar.hidden = !isNutritionDiary;
  if (els.diaryCtaBar) els.diaryCtaBar.hidden = !isDiaryEditor;
  if (isNutritionDiary) syncNutritionAddLabels();
  document.body.classList.toggle("has-cta", isFill || isDiaryEditor);
  document.body.classList.toggle("has-nutrition-cta", isNutritionDiary);

  const btn = els.saveBtn;
  if (!btn) return;
  btn.classList.remove("is-saving", "is-success", "is-error", "is-ghost");
  btn.disabled = false;
  if (isFill) {
    btn.textContent = fillCtaLabel();
  }
}

function fillCtaLabel() {
  if (state.fillMode === "history") return "Сохранить день";
  if (state.fillOnboardingStep === 1) return "Далее →";
  if (state.fillOnboardingStep === 3) return "Понятно";
  return "Сохранить";
}

function isFillOnboardingActive() {
  return (
    state.screen === "dayForm" &&
    state.fillMode === "morning" &&
    state.fillOnboardingStep > 0 &&
    state.fillOnboardingStep < 4
  );
}

function showFillHistoryHeaderBtn() {
  return (
    state.screen === "dayForm" &&
    state.fillMode === "morning" &&
    state.fillOnboardingStep !== 1 &&
    state.fillOnboardingStep !== 2
  );
}

function openFillOtherDay() {
  if (state.fillOnboardingStep === 3) completeFillOnboarding();
  // Сегодня уже на «Заполнить» (спорт). История — сразу вчера.
  openHistoryFill(yesterdayIso());
}

function updateFillHeaderAction() {
  const show = showFillHistoryHeaderBtn();
  setElHidden(els.fillHistoryHeaderBtn, !show);
  if (els.fillHistoryHeaderBtn) {
    els.fillHistoryHeaderBtn.classList.toggle(
      "app-header__action--onboarding-hint",
      show && state.fillOnboardingStep === 3
    );
  }
  setElHidden(els.fillOtherDayBtn, !show);
  if (els.fillOtherDayBtn) {
    els.fillOtherDayBtn.classList.toggle(
      "fill-block__badge--onboarding-hint",
      show && state.fillOnboardingStep === 3
    );
  }
}

function clearFillOnboardingTimer() {
  if (state.fillOnboardingAutoDoneTimer) {
    clearTimeout(state.fillOnboardingAutoDoneTimer);
    state.fillOnboardingAutoDoneTimer = null;
  }
}

function renderRoutineSummaryPreview() {
  if (!els.routineSummaryPreview) return;
  const checked = sortRoutineForGrid(state.routine).filter((r) => r.on);
  if (!checked.length) {
    els.routineSummaryPreview.innerHTML =
      '<span class="fill-routine-summary__empty">Ничего не отмечено</span>';
    return;
  }
  els.routineSummaryPreview.innerHTML = checked
    .map((r) => `<span class="fill-routine-summary__chip">${escapeHtml(r.name)}</span>`)
    .join("");
}

function updateFillOnboardingTrack() {
  if (!els.fillOnboardingTrack) return;
  const step = state.fillOnboardingStep;
  els.fillOnboardingTrack.querySelectorAll("[data-onb-step]").forEach((el) => {
    const n = Number(el.dataset.onbStep);
    el.classList.toggle("is-active", n === step);
    el.classList.toggle("is-done", n < step);
  });
}

function applyFillOnboardingUi() {
  const active = isFillOnboardingActive();
  setElHidden(els.fillOnboarding, !active || state.fillOnboardingStep === 3);

  if (els.fillOnboardingHint) {
    els.fillOnboardingHint.textContent = active
      ? FILL_ONBOARDING_HINTS[state.fillOnboardingStep] || ""
      : "";
  }

  if (els.fillMorning) {
    els.fillMorning.classList.toggle("fill-morning--onboarding", active);
    if (active) {
      els.fillMorning.dataset.onboardingStep = String(state.fillOnboardingStep);
    } else {
      delete els.fillMorning.dataset.onboardingStep;
    }
  }

  updateFillOnboardingTrack();
  setElHidden(els.routineSummaryPreview, !active || state.fillOnboardingStep !== 3);

  if (state.fillOnboardingStep === 3) {
    renderRoutineSummaryPreview();
    renderSportFields({ filledOnly: true, preview: true });
  }

  updateFillHeaderAction();
  updateCtaForScreen();
}

function scrollToFillEl(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function goToFillOnboardingStep(step) {
  state.fillOnboardingStep = step;
  applyFillOnboardingUi();

  if (step === 2) {
    scrollToFillEl(els.sportBlock);
  } else if (step === 3) {
    renderRoutineSummaryPreview();
    renderSportFields({ filledOnly: true, preview: true });
    clearFillOnboardingTimer();
    state.fillOnboardingAutoDoneTimer = setTimeout(() => {
      if (state.fillOnboardingStep === 3) completeFillOnboarding();
    }, 5000);
    updateFillHeaderAction();
  }
}

function completeFillOnboarding() {
  if (state.fillOnboardingStep === 0) return;
  clearFillOnboardingTimer();
  markFillOnboardingDone();
  state.fillOnboardingStep = 0;
  setElHidden(els.routineSummaryPreview, true);
  if (els.fillMorning) {
    els.fillMorning.classList.remove("fill-morning--onboarding");
    delete els.fillMorning.dataset.onboardingStep;
  }
  setElHidden(els.fillOnboarding, true);
  renderRoutineGrid();
  renderSportFields();
  updateFillHeaderAction();
  updateCtaForScreen();
}

function initFillOnboardingOnOpen() {
  if (isFillOnboardingDone()) {
    state.fillOnboardingStep = 0;
    return;
  }
  state.fillOnboardingStep = 1;
}

function setCtaMode(mode) {
  const btn = els.saveBtn;
  btn.classList.remove("is-saving", "is-success", "is-error", "is-ghost");
  btn.disabled = false;

  if (state.screen !== "dayForm") return;

  if (mode === "saving") {
    btn.textContent = "Сохраняем...";
    btn.disabled = true;
    btn.classList.add("is-saving");
  } else if (mode === "success") {
    btn.textContent = state.fillMode === "history" ? "День сохранён ✓" : "Сохранено ✓";
    btn.classList.add("is-success");
    btn.disabled = true;
  } else if (mode === "error") {
    btn.textContent = "Повторить попытку";
    btn.classList.add("is-error");
  } else {
    btn.textContent = fillCtaLabel();
  }
}

function setDashboardError(msg) {
  if (!msg) {
    els.dashboardError.hidden = true;
    els.dashboardError.textContent = "";
    return;
  }
  els.dashboardError.hidden = false;
  els.dashboardError.textContent = msg;
}

function setDayError(msg) {
  setElHidden(els.errorBadge, !msg);
}

function monthProductivityStats(rows) {
  const totalFact = rows.reduce((s, r) => s + (Number(r.fact) || 0), 0);
  const totalGoal = rows.reduce((s, r) => s + (Number(r.goal) || 0), 0);
  const pct = totalGoal > 0 ? Math.round((totalFact / totalGoal) * 100) : 0;
  return { totalFact, totalGoal, pct };
}

function dayRoutineStats(dayData) {
  const routine = dayData?.routine || [];
  const total = routine.length || 8;
  const done = routine.filter((r) => Number(r.value) === 1).length;
  const saved = Boolean(dayData?.hasRoutine || dayData?.hasSport);
  return { done, total, saved };
}

function formatKm(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v - Math.round(v)) < 0.05) return String(Math.round(v));
  return v.toFixed(1).replace(".", ",");
}

function pickSportMetricColumn(cols, match) {
  return cols.find((c) => match.test(c.label || c.shortLabel || ""));
}

function sportMetricDataForKpi(monthData) {
  const week = state.weekProductivity;
  if (week?.ok && week.sportByType) {
    return {
      sport: week.sport || monthData?.sport,
      sportByType: week.sportByType,
    };
  }
  return monthData;
}

function monthSportMetricStats(monthData, metric) {
  let fact = 0;
  let goal = 0;
  let pct = 0;
  if (metric.kind === "type") {
    const col = pickSportMetricColumn(monthData?.sportByType?.byTypeColumn || [], metric.match);
    fact = Number(col?.fact) || 0;
    goal = Number(col?.goal) || 0;
    pct = Number(col?.progress);
  } else {
    const col = pickSportMetricColumn(monthData?.sport?.byMinColumn || [], metric.match);
    fact = Number(col?.minutes) || 0;
    goal = Number(col?.goalPart) || 0;
    pct = Number(col?.progress);
  }
  if (!Number.isFinite(pct)) {
    pct = goal > 0 ? Math.round((fact / goal) * 100) : 0;
  }
  return { fact, goal, pct, hasGoal: goal > 0 };
}

function formatSportMetricSub(stats, unit) {
  if (!stats.hasGoal) return "цель не задана";
  if (unit === "км") {
    return `${formatKm(stats.fact)} / ${formatKm(stats.goal)} км`;
  }
  return `${Math.round(stats.fact)} / ${Math.round(stats.goal)} мин`;
}

function cycleKpiSportMetric(dir) {
  const n = KPI_SPORT_METRICS.length;
  state.kpiSportMetricIndex = (state.kpiSportMetricIndex + dir + n) % n;
  try {
    localStorage.setItem("lifeDashboard.kpiSportMetric", String(state.kpiSportMetricIndex));
  } catch {
    /* ignore */
  }
  if (state.monthData) renderKpiCards(state.monthData);
}

function cycleKpiRoutinePeriod(dir) {
  const n = KPI_ROUTINE_PERIODS.length;
  state.kpiRoutinePeriodIndex = (state.kpiRoutinePeriodIndex + dir + n) % n;
  try {
    localStorage.setItem("lifeDashboard.kpiRoutinePeriod", String(state.kpiRoutinePeriodIndex));
  } catch {
    /* ignore */
  }
  if (state.monthData) renderKpiCards(state.monthData);
}

function renderKpiSwipeDots(count, activeIndex) {
  return `<div class="kpi-card__swipe-dots" aria-hidden="true">${Array.from(
    { length: count },
    (_, i) =>
      `<span class="kpi-card__swipe-dot${i === activeIndex ? " is-active" : ""}"></span>`
  ).join("")}</div>`;
}

function buildRoutinePeriodKpiCard(monthData) {
  const period = KPI_ROUTINE_PERIODS[state.kpiRoutinePeriodIndex] || KPI_ROUTINE_PERIODS[0];

  if (period.id === "yesterday") {
    const st = dayRoutineStats(state.yesterdayDay);
    const pct = st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;
    return {
      id: "routine-period",
      value: `${st.done}/${st.total}`,
      title: period.title,
      sub: st.saved ? "сохранено" : "не заполнено",
      subColor: st.saved ? "var(--green)" : "var(--hint)",
      pct,
      muted: !st.saved,
      routineSwipe: true,
      swipeDotsCount: KPI_ROUTINE_PERIODS.length,
      swipeDotsIndex: state.kpiRoutinePeriodIndex,
    };
  }

  if (period.id === "week") {
    const week = state.weekProductivity;
    const rows = week?.ok && week.rows?.length ? week.rows : [];
    const st = monthProductivityStats(rows);
    const saved =
      (week?.routineSummary?.savedDays || 0) > 0 || st.totalFact > 0;
    const weekLabel = week?.weekLabel || "";
    const hasGoal = st.totalGoal > 0;
    return {
      id: "routine-period",
      value: hasGoal ? `${st.totalFact}/${st.totalGoal}` : "—",
      title: period.title,
      sub: !hasGoal ? "цель не задана" : saved ? weekLabel || "сохранено" : "не заполнено",
      subColor: saved && hasGoal ? "var(--green)" : "var(--hint)",
      pct: hasGoal ? st.pct : 0,
      muted: !hasGoal || !saved,
      routineSwipe: true,
      swipeDotsCount: KPI_ROUTINE_PERIODS.length,
      swipeDotsIndex: state.kpiRoutinePeriodIndex,
    };
  }

  const rows = monthData?.rows || [];
  const st = monthProductivityStats(rows);
  const saved =
    (monthData?.routineSummary?.savedDays || 0) > 0 || st.totalFact > 0;
  const monthKey = monthData?.month || state.monthKey;
  const hasGoal = st.totalGoal > 0;
  return {
    id: "routine-period",
    value: hasGoal ? `${st.totalFact}/${st.totalGoal}` : "—",
    title: period.title,
    sub: !hasGoal ? "цель не задана" : saved ? formatMonthLabel(monthKey) : "не заполнено",
    subColor: saved && hasGoal ? "var(--green)" : "var(--hint)",
    pct: hasGoal ? st.pct : 0,
    muted: !hasGoal || !saved,
    routineSwipe: true,
    swipeDotsCount: KPI_ROUTINE_PERIODS.length,
    swipeDotsIndex: state.kpiRoutinePeriodIndex,
  };
}

const SWIPE_MIN_DX = 20;

/** @type {null | { y: number }} */
let pageScrollGestureLock = null;

function onPageScrollLockTouchMove(ev) {
  if (pageScrollGestureLock) ev.preventDefault();
}

function lockPageScrollForGesture() {
  if (pageScrollGestureLock) return;
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  pageScrollGestureLock = { y };
  document.body.dataset.pageScrollLockY = String(y);
  document.body.classList.add("is-page-scroll-locked");
  document.body.style.position = "fixed";
  document.body.style.top = `-${y}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
  document.addEventListener("touchmove", onPageScrollLockTouchMove, {
    passive: false,
    capture: true,
  });
}

function unlockPageScrollForGesture() {
  if (!pageScrollGestureLock && !document.body.classList.contains("is-page-scroll-locked")) {
    return;
  }
  const y = Number(
    pageScrollGestureLock?.y ?? document.body.dataset.pageScrollLockY ?? 0
  );
  document.body.classList.remove("is-page-scroll-locked");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  delete document.body.dataset.pageScrollLockY;
  document.removeEventListener("touchmove", onPageScrollLockTouchMove, true);
  pageScrollGestureLock = null;
  window.scrollTo(0, y);
}

window.LifePageScrollLock = {
  lock: lockPageScrollForGesture,
  unlock: unlockPageScrollForGesture,
};

function bindKpiSwipe() {
  if (!els.kpiGrid || els.kpiGrid.dataset.kpiSwipeBound) return;
  els.kpiGrid.dataset.kpiSwipeBound = "1";

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let locked = false;
  let swipeKind = null;

  const resetTracking = () => {
    if (locked) unlockPageScrollForGesture();
    tracking = false;
    locked = false;
    swipeKind = null;
  };

  const trySwipe = (clientX, clientY) => {
    if (!tracking || !swipeKind) return;
    const kind = swipeKind;
    const dx = clientX - startX;
    const dy = clientY - startY;
    resetTracking();
    if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy)) return;
    const dir = dx < 0 ? 1 : -1;
    if (kind === "sport") cycleKpiSportMetric(dir);
    else if (kind === "routine") cycleKpiRoutinePeriod(dir);
  };

  els.kpiGrid.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("[data-sport-metric-swipe]")) swipeKind = "sport";
    else if (ev.target.closest("[data-routine-period-swipe]")) swipeKind = "routine";
    else return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    tracking = true;
    locked = false;
    startX = ev.clientX;
    startY = ev.clientY;
  });

  document.addEventListener(
    "pointermove",
    (ev) => {
      if (!tracking || !swipeKind) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!locked) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
          resetTracking();
          return;
        }
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          lockPageScrollForGesture();
          locked = true;
        }
      }
      if (locked) ev.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener("pointerup", (ev) => {
    trySwipe(ev.clientX, ev.clientY);
  });

  document.addEventListener("pointercancel", resetTracking);
}

function bindDetailStripSwipe() {
  if (document.body.dataset.detailStripSwipeBound) return;
  document.body.dataset.detailStripSwipeBound = "1";

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let locked = false;
  let activeStrip = null;

  const resetTracking = () => {
    if (locked) unlockPageScrollForGesture();
    tracking = false;
    locked = false;
    activeStrip = null;
  };

  const trySwipe = async (clientX, clientY) => {
    if (!tracking || !activeStrip) return;
    const strip = activeStrip;
    const dx = clientX - startX;
    const dy = clientY - startY;
    resetTracking();
    if (!strip.classList.contains("progress-strip--swipe")) return;
    if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy)) return;
    const dir = dx < 0 ? 1 : -1;
    try {
      if (strip === els.sportStrip) {
        if (state.sportPeriod === "week") await cycleSportWeek(dir);
        else await cycleSportMonth(dir);
      } else if (strip === els.productivityStrip) {
        if (state.productivityPeriod === "week") await cycleProductivityWeek(dir);
        else await cycleProductivityMonth(dir);
      } else if (strip === els.fillHistoryDayStrip) {
        await cycleFillHistoryDay(dir);
      }
    } catch (err) {
      if (strip === els.nutritionDayStrip) {
        renderNutritionDayStrip(state.nutritionDetailDate || todayIso());
      } else if (strip === els.fillHistoryDayStrip) {
        renderFillHistoryDayStrip(state.selectedDate || yesterdayIso());
      } else {
        strip.innerHTML = `<p class="donut-fallback">${escapeHtml(String(err.message || err))}</p>`;
        strip.className = "progress-strip";
      }
    }
  };

  const onPointerDown = (ev) => {
    const strip = ev.currentTarget;
    if (!strip.classList.contains("progress-strip--swipe")) return;
    if (
      ev.target.closest(
        "[data-nutrition-day-prev], [data-nutrition-day-next], [data-nutrition-products-open], [data-fill-history-day-prev], [data-fill-history-day-next]"
      )
    ) return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    tracking = true;
    locked = false;
    activeStrip = strip;
    startX = ev.clientX;
    startY = ev.clientY;
  };

  els.sportStrip?.addEventListener("pointerdown", onPointerDown);
  els.productivityStrip?.addEventListener("pointerdown", onPointerDown);
  // nutrition day-nav: tap hit zones only (no horizontal swipe — conflicts with meal DnD / TG)
  els.fillHistoryDayStrip?.addEventListener("pointerdown", onPointerDown);

  document.addEventListener(
    "pointermove",
    (ev) => {
      if (!tracking || !activeStrip) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!locked) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
          resetTracking();
          return;
        }
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          lockPageScrollForGesture();
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

function bindNutritionDayNav() {
  const host = els.nutritionDayStrip;
  if (!host || host.dataset.nutritionNavBound) return;
  host.dataset.nutritionNavBound = "1";
  host.addEventListener("click", (ev) => {
    if (state.screen !== "detailNutrition") return;
    if (ev.target.closest("[data-nutrition-day-prev]")) {
      cycleNutritionDay(-1).catch(() => {});
      return;
    }
    if (ev.target.closest("[data-nutrition-day-next]")) {
      cycleNutritionDay(1).catch(() => {});
      return;
    }
    if (ev.target.closest("[data-nutrition-products-open]")) {
      openNutritionProductsFromDiary();
    }
  });
}

function bindFillHistoryDayNav() {
  const host = els.fillHistoryDayStrip;
  if (!host || host.dataset.fillHistoryNavBound) return;
  host.dataset.fillHistoryNavBound = "1";
  host.addEventListener("click", (ev) => {
    if (state.screen !== "dayForm" || state.fillMode !== "history") return;
    if (ev.target.closest("[data-fill-history-day-prev]")) {
      cycleFillHistoryDay(-1).catch(() => {});
      return;
    }
    if (ev.target.closest("[data-fill-history-day-next]")) {
      cycleFillHistoryDay(1).catch(() => {});
    }
  });
}

const EDGE_BACK_ZONE_PX = 32;
const EDGE_BACK_MIN_DX = 52;
const EDGE_BACK_COMMIT_DX = 10;

function isEdgeBackBlockedTarget(el) {
  return Boolean(
    el?.closest?.(
      "#appHeader, .progress-strip--swipe, .kpi-card--swipe, [data-sport-metric-swipe], [data-routine-period-swipe], [data-nutrition-day-prev], [data-nutrition-day-next], [data-nutrition-products-open]"
    )
  );
}

function bindEdgeBackSwipe() {
  if (document.body.dataset.edgeBackSwipeBound) return;
  document.body.dataset.edgeBackSwipeBound = "1";

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let committed = false;
  let locked = false;
  let pointerId = null;

  const resetEdgeBack = () => {
    if (locked) unlockPageScrollForGesture();
    tracking = false;
    committed = false;
    locked = false;
    pointerId = null;
    document.body.classList.remove("edge-back-active");
  };

  document.addEventListener(
    "pointerdown",
    (ev) => {
      if (!edgeBackAvailable()) return;
      if (ev.clientX > EDGE_BACK_ZONE_PX) return;
      if (isEdgeBackBlockedTarget(ev.target)) return;
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      tracking = true;
      committed = false;
      locked = false;
      pointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
    },
    { capture: true }
  );

  document.addEventListener(
    "pointermove",
    (ev) => {
      if (!tracking || ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!committed) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
          resetEdgeBack();
          return;
        }
        if (dx >= EDGE_BACK_COMMIT_DX && dx > Math.abs(dy)) {
          committed = true;
          locked = true;
          document.body.classList.add("edge-back-active");
          lockPageScrollForGesture();
        }
        return;
      }
      if (dx > 0) ev.preventDefault();
    },
    { capture: true, passive: false }
  );

  document.addEventListener(
    "pointerup",
    (ev) => {
      if (!tracking || ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const wasCommitted = committed;
      resetEdgeBack();
      if (!wasCommitted) return;
      if (dx < EDGE_BACK_MIN_DX || dx <= Math.abs(dy)) return;
      tg?.HapticFeedback?.impactOccurred?.("light");
      navigateBack();
    },
    { capture: true }
  );

  document.addEventListener("pointercancel", resetEdgeBack, { capture: true });
}

async function cycleProductivityWeek(dir) {
  const nextAnchor = shiftIsoByDays(
    state.weekAnchorDate || defaultWeekAnchor(),
    dir * 7
  );
  if (!(await isMonthInDb(nextAnchor.slice(0, 7)))) return;
  state.weekAnchorDate = nextAnchor;
  await refreshProductivityDetail();
}

async function cycleProductivityMonth(dir) {
  const cur = state.productivityDetailMonthKey || state.monthKey;
  const next = shiftMonthKey(cur, dir);
  if (!(await isMonthInDb(next))) return;
  state.productivityDetailMonthKey = next;
  await refreshProductivityDetail();
}

async function cycleSportWeek(dir) {
  const nextAnchor = shiftIsoByDays(
    state.weekAnchorDate || defaultWeekAnchor(),
    dir * 7
  );
  if (!(await isMonthInDb(nextAnchor.slice(0, 7)))) return;
  state.weekAnchorDate = nextAnchor;
  await refreshSportDetail();
}

async function cycleSportMonth(dir) {
  const cur = state.sportDetailMonthKey || state.monthKey;
  const next = shiftMonthKey(cur, dir);
  if (!(await isMonthInDb(next))) return;
  state.sportDetailMonthKey = next;
  await refreshSportDetail();
}

async function loadYesterdayDay() {
  const iso = yesterdayIso();
  try {
    const data = await apiGet("/day", { date: iso });
    if (data.ok) {
      state.yesterdayDay = data;
      return data;
    }
  } catch {
    /* ignore */
  }
  state.yesterdayDay = null;
  return null;
}

async function loadWeekProductivityForHome() {
  const anchor = todayIso();
  const monthForWeek = anchor.slice(0, 7);
  try {
    const data = await apiGet("/week", { date: anchor, month: monthForWeek });
    if (data.ok) {
      state.weekProductivity = data;
      return data;
    }
  } catch {
    /* ignore */
  }
  state.weekProductivity = null;
  return null;
}

function monthSportStats(sport) {
  const goal = Number(sport?.goalTotalMinutes ?? sport?.goalMinutes) || 0;
  const total = Number(sport?.totalMinutes) || 0;
  let pct = Number(sport?.progress);
  if (!Number.isFinite(pct)) {
    pct = goal > 0 ? Math.round((total / goal) * 1000) / 10 : 0;
  } else {
    pct = Math.round(pct);
  }
  return { total, goal, pct };
}

function renderKpiCards(monthData) {
  const monthRows = monthData?.rows || [];
  const sport = monthData?.sport || {};
  const week = state.weekProductivity;
  const prodRows = week?.ok && week.rows?.length ? week.rows : monthRows;
  const prod = monthProductivityStats(prodRows);
  const prodSub = `${prod.totalFact}/${prod.totalGoal}`;
  const weekSport =
    week?.ok && week.sport && typeof week.sport.totalMinutes === "number"
      ? week.sport
      : null;
  const sportForKpi = weekSport || sport;
  const sportSt = monthSportStats(sportForKpi);
  const sportHasData = typeof sportForKpi.totalMinutes === "number";
  const sportSub = `${Math.round(sportSt.total)}/${Math.round(sportSt.goal)} мин`;

  const sportMetric = KPI_SPORT_METRICS[state.kpiSportMetricIndex] || KPI_SPORT_METRICS[0];
  const sportMetricSource = sportMetricDataForKpi(monthData);
  const sportMetricStats = monthSportMetricStats(sportMetricSource, sportMetric);

  const cards = [
    {
      id: "productivity",
      value: `${prod.pct}%`,
      title: "Продуктивность",
      sub: prodSub,
      pct: prod.pct,
      drillable: true,
    },
    {
      id: "sport",
      value: `${sportSt.pct}%`,
      title: "Спорт",
      sub: sportSub,
      pct: sportSt.pct,
      drillable: sportHasData,
    },
    buildRoutinePeriodKpiCard(monthData),
    {
      id: "sport-metric",
      value: sportMetricStats.hasGoal ? `${sportMetricStats.pct}%` : "—",
      title: sportMetric.title,
      sub: formatSportMetricSub(sportMetricStats, sportMetric.unit),
      pct: sportMetricStats.pct,
      muted: !sportMetricStats.hasGoal,
      drillable: false,
      sportSwipe: true,
      swipeDotsCount: KPI_SPORT_METRICS.length,
      swipeDotsIndex: state.kpiSportMetricIndex,
    },
  ];

  els.kpiGrid.innerHTML = cards
    .map((c) => {
      const color = c.muted ? "var(--hint)" : progressColor(c.pct);
      const barW = c.muted ? 0 : Math.min(100, Math.max(0, c.pct));
      const tag = c.drillable ? "button" : "div";
      let extraClass = c.drillable ? " kpi-card--drill" : " kpi-card--static";
      const attrs = c.drillable
        ? `type="button" data-kpi="${c.id}" aria-label="${c.title}: ${c.sub}"`
        : c.sportSwipe
          ? `data-sport-metric-swipe="" aria-label="${c.title}: ${c.sub}. Свайп влево или вправо — другая метрика."`
          : c.routineSwipe
            ? `data-routine-period-swipe="" aria-label="${c.title}: ${c.sub}. Свайп влево или вправо — другой период."`
            : "";
      if (c.sportSwipe || c.routineSwipe) extraClass += " kpi-card--swipe";
      const subStyle = c.subColor ? ` style="color:${c.subColor}"` : "";
      const topRight = c.drillable ? '<span class="kpi-card__chev" aria-hidden="true">›</span>' : "";
      const valueStyle = !c.muted ? ` style="color:${color}"` : "";
      const swipeIndicators =
        c.swipeDotsCount > 0
          ? renderKpiSwipeDots(c.swipeDotsCount, c.swipeDotsIndex)
          : "";
      return `
        <${tag} class="kpi-card${extraClass}" ${attrs}>
          <div class="kpi-card__top">
            <div class="kpi-card__value"${valueStyle}>${c.value}</div>
            ${topRight}
          </div>
          <div class="kpi-card__title">${c.title}</div>
          <div class="kpi-card__sub"${subStyle}>${c.sub}</div>
          <div class="mini-bar" aria-hidden="true">
            <div class="mini-bar__fill" style="width:${barW}%;background:${color}"></div>
          </div>
          ${swipeIndicators}
        </${tag}>`;
    })
    .join("");

  els.kpiGrid.querySelectorAll("[data-kpi]").forEach((btn) => {
    btn.addEventListener("click", () => openKpiDetail(btn.dataset.kpi));
  });

  bindKpiSwipe();

  if (state.screen === "home") updateCtaForScreen();
}

function weekAnchorForMonth(monthKey) {
  const t = todayIso();
  if (t.startsWith(`${monthKey}-`)) return t;
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

function defaultWeekAnchor() {
  if (state.screen === "home") return todayIso();
  return weekAnchorForMonth(state.monthKey);
}

function setProductivityPeriod(period) {
  state.productivityPeriod = period;
  document
    .querySelectorAll("#flowDetailProductivity [data-period]")
    .forEach((btn) => {
      const active = btn.dataset.period === period;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
}

async function refreshProductivityDetail() {
  const isWeek = state.productivityPeriod === "week";
  state.weekAnchorDate = state.weekAnchorDate || defaultWeekAnchor();

  let payload;

  if (isWeek) {
    const anchor = state.weekAnchorDate || defaultWeekAnchor();
    const monthForWeek = anchor.slice(0, 7);
    const data = await apiGet("/week", {
      date: anchor,
      month: monthForWeek,
    });
    if (!data.ok || !Array.isArray(data.rows)) {
      throw new Error(data.error || "Нет данных недели");
    }
    state.productivityStats = data;
    payload = productivityDetailPayload(data, data.rows);
  } else {
    const monthKey = state.productivityDetailMonthKey || state.monthKey;
    const data = await apiGet("/month", { month: monthKey });
    if (!data.ok) throw new Error(data.error || "Нет данных месяца");
    const rows = data.rows || [];
    if (!rows.length) throw new Error("Нет данных месяца");
    state.productivityStats = { period: "month", ...data };
    payload = productivityDetailPayload(data, rows);
  }

  destroyCharts();
  renderProductivityProgressStrip(
    els.productivityStrip,
    payload,
    state.productivityPeriod
  );
  renderProductivityRadarSection(payload?.rows);
  renderProductivityDetailBlocks(els.productivityDetailBlocks, payload?.rows);
}

async function openProductivityDetail() {
  state.productivityPeriod = "week";
  setProductivityPeriod("week");
  state.productivityDetailMonthKey = currentMonthKey();
  state.weekAnchorDate = todayIso();
  setScreen("detailProductivity");
  els.productivityStrip.innerHTML = '<p class="donut-fallback">Загрузка…</p>';
  if (els.productivityDetailBlocks) els.productivityDetailBlocks.innerHTML = "";
  setElHidden(els.productivityRadarBlock, true);
  try {
    await refreshProductivityDetail();
  } catch (err) {
    els.productivityStrip.innerHTML = `<p class="donut-fallback">${escapeHtml(String(err.message || err))}</p>`;
    if (els.productivityDetailBlocks) els.productivityDetailBlocks.innerHTML = "";
    setElHidden(els.productivityRadarBlock, true);
  }
}

function openKpiDetail(id) {
  if (id === "productivity") openProductivityDetail();
  else if (id === "sport") openSportDetail();
}

function setFillMode(mode) {
  state.fillMode = mode;
  setElHidden(els.fillMorning, mode !== "morning");
  setElHidden(els.fillHistory, mode !== "history");
  if (state.screen === "dayForm") {
    els.headerTitle.textContent = mode === "history" ? "Другой день" : "Заполнить";
    updateFillHeaderAction();
    updateCtaForScreen();
  }
}

function openDatePick() {
  return openMorningFill();
}

async function fetchDayData(iso) {
  const data = await apiGet("/day", { date: iso });
  if (!data.ok) throw new Error(data.error || "Ошибка дня");
  return data;
}

function routineItemsFromDay(data) {
  return (data.routine || []).map((r) => ({
    col: r.col,
    name: r.name,
    on: Number(r.value) === 1,
  }));
}

function sortRoutineForGrid(routine) {
  const byCol = new Map(routine.map((r) => [r.col, r]));
  return ROUTINE_GRID_COL_ORDER.map((col) => byCol.get(col)).filter(Boolean);
}

function applyRoutineData(data) {
  state.routine = routineItemsFromDay(data);
}

function applySportData(data) {
  state.sportValues.clear();
  for (const item of data.sport || []) {
    state.sportValues.set(item.col, item.value ?? "");
  }
  for (const def of SPORT_FIELDS) {
    if (!state.sportValues.has(def.col)) state.sportValues.set(def.col, "");
  }
}

function renderMorningHeaders() {
  if (els.routineDateLine) els.routineDateLine.textContent = formatDateLine(state.routineDate);
  if (els.sportDateLine) els.sportDateLine.textContent = formatDateLine(state.sportDate);

  if (els.routineDayBadge) {
    if (state.routineDate === yesterdayIso()) {
      els.routineDayBadge.textContent = "Вчера";
      els.routineDayBadge.classList.add("is-yesterday");
    } else {
      els.routineDayBadge.textContent = formatDdMm(state.routineDate);
      els.routineDayBadge.classList.remove("is-yesterday");
    }
  }

  if (els.sportDayBadge) {
    if (state.sportDate === todayIso()) {
      els.sportDayBadge.textContent = "Сегодня";
      els.sportDayBadge.classList.add("is-today");
    } else {
      els.sportDayBadge.textContent = formatDdMm(state.sportDate);
      els.sportDayBadge.classList.remove("is-today");
    }
  }
}

async function loadMorningData() {
  const [routineData, sportData] = await Promise.all([
    fetchDayData(state.routineDate),
    fetchDayData(state.sportDate),
  ]);

  state.row1BasedRoutine = routineData.row1Based ?? null;
  state.dayExistsRoutine = Boolean(routineData.exists);
  applyRoutineData(routineData);

  state.row1BasedSport = sportData.row1Based ?? null;
  state.dayExistsSport = Boolean(sportData.exists);
  applySportData(sportData);

  renderMorningHeaders();
  renderRoutineGrid();
  renderSportFields();
  updateRoutineCounter();
  setDayError(null);
  if (state.fillOnboardingStep === 3) {
    renderRoutineSummaryPreview();
    renderSportFields({ filledOnly: true, preview: true });
  }
  applyFillOnboardingUi();
}

async function loadHistoryDay() {
  if (!state.selectedDate) return;
  const data = await fetchDayData(state.selectedDate);

  state.monthKey = data.month || state.selectedDate.slice(0, 7);
  state.row1Based = data.row1Based ?? null;
  state.dayExists = Boolean(data.exists);
  applyRoutineData(data);
  applySportData(data);

  renderFillHistoryDayStrip(state.selectedDate);
  renderRoutineGrid();
  renderSportFields();
  updateRoutineCounter();
  setDayError(null);
}

async function cycleFillHistoryDay(dir) {
  const cur = state.selectedDate || yesterdayIso();
  state.selectedDate = shiftIsoByDays(cur, dir);
  renderFillHistoryDayStrip(state.selectedDate);
  try {
    await loadHistoryDay();
  } catch (err) {
    setDayError(String(err.message || err));
  }
}

async function openHistoryFill(iso = yesterdayIso()) {
  state.fillMode = "history";
  state.selectedDate = iso;
  setFillMode("history");
  setActiveTab("routine");
  renderFillHistoryDayStrip(iso);
  els.formZoneHistory?.classList.remove("is-locked");

  try {
    await loadHistoryDay();
  } catch (err) {
    setDayError(String(err.message || err));
    return;
  }
  loadMonth(state.monthKey).catch(() => {});
}

async function openMorningFill() {
  destroyCharts();
  clearFillOnboardingTimer();
  state.fillMode = "morning";
  state.routineDate = yesterdayIso();
  state.sportDate = todayIso();
  closeWheel();
  setDayError(null);
  initFillOnboardingOnOpen();
  setScreen("dayForm");
  setFillMode("morning");
  els.fillMorning?.classList.remove("is-locked");

  try {
    await loadMorningData();
  } catch (err) {
    setDayError(String(err.message || err));
    return;
  }
  applyFillOnboardingUi();
  loadMonth(state.routineDate.slice(0, 7)).catch(() => {});
}

function setSportPeriod(period) {
  state.sportPeriod = period;
  document.querySelectorAll("#flowDetailSport [data-sport-period]").forEach((btn) => {
    const active = btn.dataset.sportPeriod === period;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
}

async function refreshSportDetail() {
  const isWeek = state.sportPeriod === "week";
  state.weekAnchorDate = state.weekAnchorDate || defaultWeekAnchor();

  let payload;
  if (isWeek) {
    const anchor = state.weekAnchorDate || defaultWeekAnchor();
    const monthForWeek = anchor.slice(0, 7);
    const data = await apiGet("/week", {
      date: anchor,
      month: monthForWeek,
    });
    if (!data.ok || !data.sport) {
      throw new Error(data.error || "Нет данных недели по спорту");
    }
    state.sportStats = data;
    payload = sportDetailPayload(data);
  } else {
    const monthKey = state.sportDetailMonthKey || state.monthKey;
    const data = await apiGet("/month", { month: monthKey });
    if (!data.ok) throw new Error(data.error || "Нет данных месяца");
    const sport = data.sport;
    if (!sport || typeof sport.totalMinutes !== "number") {
      throw new Error("Нет данных месяца по спорту");
    }
    state.sportStats = { period: "month", ...data };
    payload = sportDetailPayload(data);
  }

  renderSportProgressStrip(els.sportStrip, payload, state.sportPeriod);
  renderSportDetailBlocks(els.sportDetailBlocks, payload);
}

async function openSportDetail() {
  state.sportPeriod = "week";
  setSportPeriod("week");
  state.sportDetailMonthKey = currentMonthKey();
  state.weekAnchorDate = todayIso();
  setScreen("detailSport");
  els.sportStrip.innerHTML = '<p class="donut-fallback">Загрузка…</p>';
  els.sportDetailBlocks.innerHTML = "";
  try {
    await refreshSportDetail();
  } catch (err) {
    els.sportStrip.innerHTML = `<p class="donut-fallback">${escapeHtml(String(err.message || err))}</p>`;
    els.sportDetailBlocks.innerHTML = "";
  }
}

async function loadMonth(monthKey) {
  if (state.screen === "home") {
    return refreshHomeScreen({ fresh: false, monthKey: monthKey || currentMonthKey() });
  }
  const resolved = monthKey || state.monthKey;
  state.monthKey = resolved;
  const data = await apiGet("/month", { month: resolved });
  if (!data.ok) throw new Error(data.error || "Нет данных месяца");
  state.monthData = data;
  els.monthLabel.textContent = formatMonthLabel(resolved);
  if (state.screen === "detailProductivity") refreshProductivityDetail().catch(() => {});
  if (state.screen === "detailSport") refreshSportDetail().catch(() => {});
  return data;
}

async function reloadFillData() {
  if (state.fillMode === "morning") {
    await loadMorningData();
    return;
  }
  await loadHistoryDay();
}

function routineGridEl() {
  return state.fillMode === "morning" ? els.routineGrid : els.historyRoutineGrid;
}

function sportFieldsEl() {
  return state.fillMode === "morning" ? els.sportFields : els.historySportFields;
}

function renderRoutineGrid() {
  const container = routineGridEl();
  if (!container) return;

  const items = sortRoutineForGrid(state.routine);
  container.innerHTML = items
    .map((r, i) => {
      const onClass = r.on ? "is-on" : "";
      return `
        <button type="button" class="routine-row ${onClass}" data-idx="${i}" aria-pressed="${r.on}">
          <span class="routine-dot"></span>
          <span class="routine-row__label">${r.name}</span>
        </button>`;
    })
    .join("");

  container.querySelectorAll(".routine-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.saving) return;
      const idx = Number(btn.dataset.idx);
      const item = items[idx];
      if (!item) return;
      item.on = !item.on;
      btn.classList.toggle("is-on", item.on);
      btn.setAttribute("aria-pressed", String(item.on));
      updateRoutineCounter();
    });
  });
}

function sportInputHtml(def, idPrefix) {
  const val = state.sportValues.get(def.col) ?? "";
  const id = `${idPrefix}-${def.col}`;
  return `
    <label class="sport-row" for="${id}">
      <span class="sport-row__label">${def.label}</span>
      <input class="sport-row__input" id="${id}" type="text" inputmode="decimal"
        placeholder="—" data-col="${def.col}" value="${escapeAttr(val)}" />
    </label>`;
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function bindSportInputs(container) {
  container.querySelectorAll(".sport-row__input").forEach((input) => {
    input.addEventListener("input", () => {
      const col = Number(input.dataset.col);
      state.sportValues.set(col, input.value.trim());
    });
  });
}

function sportFieldFilled(def) {
  return Boolean((state.sportValues.get(def.col) ?? "").trim());
}

function sportBlockFilledFields(block) {
  return block.fields.filter(sportFieldFilled);
}

function sportPreviewRowHtml(def) {
  const val = state.sportValues.get(def.col) ?? "";
  return `
    <div class="sport-row sport-row--preview">
      <span class="sport-row__label">${def.label}</span>
      <span class="sport-row__value">${escapeHtml(val)}</span>
    </div>`;
}

function renderSportFields(opts = {}) {
  const container = sportFieldsEl();
  if (!container) return;
  const { filledOnly = false, preview = false } = opts;
  const idPrefix = state.fillMode === "morning" ? "sport" : "sport-hist";

  container.innerHTML = SPORT_BLOCKS.map((block, i) => {
    const filled = sportBlockFilledFields(block);
    if (filledOnly && !filled.length) return "";

    const divider = i > 0 ? " sport-block--divider" : "";
    const hasFillClass = filled.length ? " sport-block--has-fill" : "";
    const fieldsHtml = preview
      ? filled.map(sportPreviewRowHtml).join("")
      : block.fields.map((d) => sportInputHtml(d, idPrefix)).join("");

    return `
      <section class="sport-block${divider}${hasFillClass}" data-sport-block="${block.id}">
        <div class="sport-block__head">
          <span class="sport-block__rule" aria-hidden="true"></span>
          <h3 class="sport-block__title">${block.title}</h3>
        </div>
        <div class="sport-block__fields">${fieldsHtml}</div>
      </section>`;
  }).join("");

  if (!preview) bindSportInputs(container);
  syncInputKeyboards(container);
  setSportInputsDisabled(state.saving);
}

function setSportInputsDisabled(disabled) {
  document.querySelectorAll(".sport-row__input").forEach((el) => {
    el.disabled = disabled;
  });
  document.querySelectorAll(".routine-row").forEach((el) => {
    el.disabled = disabled;
  });
}

function updateRoutineCounter() {
  const n = routineDoneCount();
  const text = `ПРОДУКТИВНОСТЬ · ${n}/8`;
  if (els.routineCounter) els.routineCounter.textContent = text;
  if (els.historyRoutineCounter) els.historyRoutineCounter.textContent = text;
}

function setActiveTab(tab) {
  const isRoutine = tab === "routine";
  document.querySelectorAll("#formZoneHistory .segmented__btn").forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  setElHidden(els.panelRoutine, !isRoutine);
  els.panelRoutine?.classList.toggle("is-active", isRoutine);
  setElHidden(els.panelSport, isRoutine);
  els.panelSport?.classList.toggle("is-active", !isRoutine);
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function clampWheelDay() {
  const max = daysInMonth(state.wheel.year, state.wheel.month);
  if (state.wheel.day > max) state.wheel.day = max;
  if (state.wheel.day < 1) state.wheel.day = 1;
}

function wheelIsoFromState() {
  clampWheelDay();
  const y = state.wheel.year;
  const m = String(state.wheel.month).padStart(2, "0");
  const d = String(state.wheel.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

let wheelScrollLocked = false;
let wheelScrollUnlockTimer = null;
const wheelColumnAbort = { day: null, month: null, year: null };

function lockWheelScroll(ms = 200) {
  wheelScrollLocked = true;
  clearTimeout(wheelScrollUnlockTimer);
  wheelScrollUnlockTimer = setTimeout(() => {
    wheelScrollLocked = false;
  }, ms);
}

function scrollColumnToValue(colEl, value) {
  const item = colEl.querySelector(`.wheel-item[data-value="${Number(value)}"]`);
  if (!item) return;
  colEl.scrollTop = item.offsetTop - colEl.clientHeight / 2 + item.offsetHeight / 2;
  colEl.querySelectorAll(".wheel-item").forEach((el) => {
    el.classList.toggle("is-selected", el === item);
  });
}

function buildWheelColumn(colEl, values, selectedValue, onSelect, abortKey) {
  if (!colEl) return;
  if (abortKey && wheelColumnAbort[abortKey]) {
    wheelColumnAbort[abortKey].abort();
  }
  const abort =
    abortKey != null ? new AbortController() : null;
  if (abortKey && abort) wheelColumnAbort[abortKey] = abort;

  colEl.replaceChildren();

  const top = document.createElement("div");
  top.className = "wheel-spacer";
  const bottom = document.createElement("div");
  bottom.className = "wheel-spacer";
  colEl.appendChild(top);

  const items = [];
  const selectedNum = Number(selectedValue);

  for (const v of values) {
    const el = document.createElement("div");
    el.className = "wheel-item";
    el.dataset.value = String(v.value);
    el.textContent = v.label;
    if (Number(v.value) === selectedNum) el.classList.add("is-selected");
    el.addEventListener("click", () => {
      lockWheelScroll(320);
      scrollColumnToValue(colEl, v.value);
      onSelect(Number(v.value));
    });
    colEl.appendChild(el);
    items.push({ el, value: Number(v.value) });
  }

  colEl.appendChild(bottom);

  let scrollTimer = null;
  colEl.addEventListener(
    "scroll",
    () => {
      if (wheelScrollLocked) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        if (wheelScrollLocked) return;
        const center = colEl.scrollTop + colEl.clientHeight / 2;
        let best = items[0];
        let bestDist = Infinity;
        for (const item of items) {
          const mid = item.el.offsetTop + item.el.offsetHeight / 2;
          const dist = Math.abs(mid - center);
          if (dist < bestDist) {
            bestDist = dist;
            best = item;
          }
        }
        if (!best) return;
        items.forEach((i) => i.el.classList.toggle("is-selected", i === best));
        onSelect(best.value);
      }, 80);
    },
    { passive: true, signal: abort?.signal }
  );
}

function setWheelToToday() {
  const now = new Date();
  state.wheel = {
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

function wheelDayValues() {
  const maxDay = daysInMonth(state.wheel.year, state.wheel.month);
  const days = [];
  for (let d = 1; d <= maxDay; d += 1) {
    days.push({ value: d, label: String(d) });
  }
  return days;
}

function wheelMonthValues() {
  return MONTH_NAMES.map((name, i) => ({
    value: i + 1,
    label: name,
  }));
}

function wheelYearValues() {
  const years = [];
  const yNow = new Date().getFullYear();
  for (let y = yNow; y >= yNow - 2; y -= 1) {
    years.push({ value: y, label: String(y) });
  }
  return years;
}

function renderWheelDayColumn() {
  clampWheelDay();
  buildWheelColumn(
    els.wheelDay,
    wheelDayValues(),
    state.wheel.day,
    (v) => {
      state.wheel.day = v;
    },
    "day"
  );
}

function renderWheelMonthColumn() {
  buildWheelColumn(els.wheelMonth, wheelMonthValues(), state.wheel.month, (v) => {
    if (state.wheel.month === v) return;
    state.wheel.month = v;
    clampWheelDay();
    lockWheelScroll(200);
    renderWheelDayColumn();
    scrollColumnToValue(els.wheelDay, state.wheel.day);
  }, "month");
}

function renderWheelYearColumn() {
  buildWheelColumn(els.wheelYear, wheelYearValues(), state.wheel.year, (v) => {
    if (state.wheel.year === v) return;
    state.wheel.year = v;
    clampWheelDay();
    lockWheelScroll(200);
    renderWheelDayColumn();
    scrollColumnToValue(els.wheelDay, state.wheel.day);
  }, "year");
}

function scrollWheelsToState() {
  lockWheelScroll(280);
  scrollColumnToValue(els.wheelDay, state.wheel.day);
  scrollColumnToValue(els.wheelMonth, state.wheel.month);
  scrollColumnToValue(els.wheelYear, state.wheel.year);
}

function renderDateWheel() {
  if (!els.wheelDay || !els.wheelMonth || !els.wheelYear) return;
  clampWheelDay();
  renderWheelDayColumn();
  renderWheelMonthColumn();
  renderWheelYearColumn();
}

function initDateWheel() {
  if (!els.wheelDay) return;
  setWheelToToday();
  renderDateWheel();
}

function openWheel() {
  if (!els.dateWheelWrap || !els.wheelDay) return;
  state.wheelOpen = true;
  els.dateWheelWrap.hidden = false;
  els.customDateChoice.classList.add("is-open");
  els.customDateChoice.setAttribute("aria-expanded", "true");
  setWheelToToday();
  lockWheelScroll(450);
  renderDateWheel();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => scrollWheelsToState());
  });
}

function closeWheel() {
  state.wheelOpen = false;
  if (els.dateWheelWrap) els.dateWheelWrap.hidden = true;
  if (els.customDateChoice) {
    els.customDateChoice.classList.remove("is-open");
    els.customDateChoice.setAttribute("aria-expanded", "false");
  }
}


function collectSportCells() {
  const cells = [];
  for (const def of SPORT_FIELDS) {
    const raw = (state.sportValues.get(def.col) ?? "").trim();
    if (!raw) continue;
    cells.push({ col1Based: def.col, value: raw });
  }
  return cells;
}

function collectRoutineValues() {
  const byCol = new Map(state.routine.map((r) => [r.col, r]));
  return ROUTINE_API_COL_ORDER.map((col) => (byCol.get(col)?.on ? 1 : 0));
}

async function ensureDayRow(date, rowKey) {
  if (state[rowKey]) return state[rowKey];
  const prep = await apiPost({ action: "prepareDay", date });
  state[rowKey] = prep.row1Based;
  return prep.row1Based;
}

async function writeRoutineForDate(date, rowKey) {
  const row = await ensureDayRow(date, rowKey);
  await apiPost({
    action: "writeRoutineBatch",
    date,
    row1Based: row,
    values: collectRoutineValues(),
  });
}

async function writeSportForDate(date, rowKey) {
  const cells = collectSportCells();
  const hasExistingRow = Boolean(state[rowKey]);
  if (!cells.length && !hasExistingRow) return;
  const row = await ensureDayRow(date, rowKey);
  await apiPost({
    action: "writeSportBatch",
    date,
    row1Based: row,
    cells,
  });
}

async function refreshMonthsAfterSave(dates) {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  for (const monthKey of months) {
    await apiGet("/month", { month: monthKey });
  }
  if (state.screen === "home") {
    await refreshHomeScreen({ fresh: true });
  }
}

function unlockFillForm() {
  els.fillMorning?.classList.remove("is-locked");
  els.formZoneHistory?.classList.remove("is-locked");
  setSportInputsDisabled(false);
}

function lockFillForm() {
  els.fillMorning?.classList.add("is-locked");
  els.formZoneHistory?.classList.add("is-locked");
  setSportInputsDisabled(true);
}

async function saveMorningFill() {
  await writeRoutineForDate(state.routineDate, "row1BasedRoutine");
  await writeSportForDate(state.sportDate, "row1BasedSport");
  await refreshMonthsAfterSave([state.routineDate, state.sportDate]);
}

async function saveHistoryFill() {
  if (!state.row1Based) {
    await ensureDayRow(state.selectedDate, "row1Based");
    state.dayExists = true;
  }
  const row = state.row1Based;
  await apiPost({
    action: "writeRoutineBatch",
    date: state.selectedDate,
    row1Based: row,
    values: collectRoutineValues(),
  });
  const cells = collectSportCells();
  await apiPost({
    action: "writeSportBatch",
    date: state.selectedDate,
    row1Based: row,
    cells,
  });
  await refreshMonthsAfterSave([state.selectedDate]);
}

async function saveDay() {
  if (state.saving || state.screen !== "dayForm") return;
  state.saving = true;
  setDayError(null);
  setCtaMode("saving");
  lockFillForm();

  try {
    if (state.fillMode === "morning") {
      await saveMorningFill();
    } else {
      await saveHistoryFill();
    }

    setCtaMode("success");

    const onboardingStepAfterSave = state.fillOnboardingStep;

    setTimeout(async () => {
      unlockFillForm();
      try {
        await reloadFillData();
        if (state.fillMode === "history" && state.selectedDate) {
          renderFillHistoryDayStrip(state.selectedDate);
        }
      } catch {
        /* остаёмся на экране; данные подтянутся при смене дня */
      }

      if (onboardingStepAfterSave === 2) {
        goToFillOnboardingStep(3);
        setCtaMode("default");
        return;
      }

      setCtaMode("default");
    }, 1600);
  } catch (err) {
    setDayError(String(err.message || err));
    setCtaMode("error");
    unlockFillForm();
  } finally {
    state.saving = false;
  }
}

const SILENT_REFRESH_MS = 45_000;
const HOME_REFRESH_COOLDOWN_MS = 12_000;
let silentRefreshInFlight = false;
let lastHomeFullLoadAt = 0;

function isBlockingOverlayOpen() {
  if (els.nutritionQuickAddSheet && !els.nutritionQuickAddSheet.hidden) return true;
  if (els.productDeleteConfirm && !els.productDeleteConfirm.hidden) return true;
  const financeSheet = document.getElementById("financeTxnSheet");
  if (financeSheet && !financeSheet.hidden) return true;
  const financeExport = document.getElementById("financeExportSheet");
  if (financeExport && !financeExport.hidden) return true;
  const diaryDelete = document.getElementById("diaryDeleteConfirm");
  if (diaryDelete && !diaryDelete.hidden) return true;
  if (window.LifeLedger?.isBlockingOverlayOpen?.()) return true;
  return false;
}

function canSilentRefresh() {
  if (document.hidden) return false;
  if (state.saving) return false;
  if (isBlockingOverlayOpen()) return false;
  if (Date.now() - lastUserInteractionAt < SILENT_REFRESH_IDLE_MS) return false;
  const s = state.screen;
  if (s === "dayForm" || s === "diaryEditor") return false;
  if (s === "detailFinance" || s === "detailLedger") return false;
  if (s === "detailNutritionProducts" || s === "detailNutritionProduct") return false;
  if (s === "detailNutrition") return false;
  return true;
}

async function silentRefreshCurrentScreen(opts = {}) {
  if (!canSilentRefresh() || silentRefreshInFlight) return;
  silentRefreshInFlight = true;
  try {
    const s = state.screen;
    const force = Boolean(opts.force);
    if (s === "home") {
      if (!force && Date.now() - lastHomeFullLoadAt < HOME_REFRESH_COOLDOWN_MS) return;
      await refreshHomeScreen({ fresh: true });
    } else if (s === "detailLedger") {
      await window.LifeLedger?.loadHome?.();
    } else if (s === "detailProductivity") {
      await refreshProductivityDetail();
    } else if (s === "detailSport") {
      await refreshSportDetail();
    } else if (s === "detailNutrition") {
      await refreshNutritionDetail();
    } else if (s === "diaryCalendar") {
      await window.LifeDiary?.renderCalendar?.();
    }
  } catch {
    /* фоновое обновление — без индикаторов */
  } finally {
    silentRefreshInFlight = false;
  }
}

function startSilentRefresh() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) silentRefreshCurrentScreen({ force: false });
  });
  try {
    window.Telegram?.WebApp?.onEvent?.("activated", () =>
      silentRefreshCurrentScreen({ force: false })
    );
  } catch {
    /* optional Telegram hook */
  }
  setInterval(() => silentRefreshCurrentScreen({ force: false }), SILENT_REFRESH_MS);
}

async function bootstrap() {
  initTelegram();
  const allowed = await ensureWebOrTelegramAccess();
  if (!allowed) return;
  syncInputKeyboards(document.body);
  window.LifeInputKeyboards = { sync: syncInputKeyboards, focus: focusWithoutScroll };
  if (window.LifeFinance) {
    window.LifeFinance.init({
      apiGet,
      apiUrl,
      downloadApiFile,
      apiPostJson,
      apiPatchJson,
      apiDelete,
      escapeHtml,
      todayIso,
      monthNames: MONTH_NAMES,
      monthNamesShort: MONTH_NAMES_SHORT,
      setElHidden,
      setScreen,
    });
  }
  if (window.LifeDiary) {
    window.LifeDiary.init({
      setElHidden,
      setScreen,
      apiGet,
      apiPostJson,
      apiDelete,
    });
  }
    if (window.LifeLedger) {
    window.LifeLedger.init({
      apiGet,
      apiPostJson,
      apiPatchJson,
      apiPutJson,
      escapeHtml,
      todayIso,
      monthNames: MONTH_NAMES,
      monthNamesShort: MONTH_NAMES_SHORT,
      setElHidden,
      setScreen,
    });
  }
  setScreen("home");
  document.addEventListener("pointerdown", markUserInteraction, { passive: true });
  bindKpiSwipe();
  bindDetailStripSwipe();
  bindNutritionDayNav();
  bindFillHistoryDayNav();
  bindEdgeBackSwipe();

  els.headerBack.addEventListener("click", navigateBack);

  if (els.homeFillBtn) {
    els.homeFillBtn.addEventListener("click", () => {
      if (state.screen === "home") openDatePick();
    });
  }

  if (els.nutritionZoneBtn) {
    els.nutritionZoneBtn.addEventListener("click", () => {
      if (state.screen === "home") openNutritionDetail();
    });
  }

  if (els.nutritionProductsBtn) {
    els.nutritionProductsBtn.addEventListener("click", () => openNutritionProductsFromDiary());
  }

  document.querySelectorAll("#flowDetailNutrition [data-export-period]").forEach((btn) => {
    btn.addEventListener("click", () => setNutritionExportPeriod(btn.dataset.exportPeriod));
  });

  if (els.nutritionExportBtn) {
    els.nutritionExportBtn.addEventListener("click", () => {
      downloadNutritionCsv().catch((err) => alert(String(err.message || err)));
    });
  }

  if (els.nutritionCheatmealBtn) {
    els.nutritionCheatmealBtn.addEventListener("click", () => {
      toggleNutritionCheatmeal().catch((err) => alert(String(err.message || err)));
    });
  }

  if (els.nutritionAddMainBtn) {
    els.nutritionAddMainBtn.addEventListener("click", () => {
      if (state.screen === "detailNutrition") openNutritionProductsFromDiary();
    });
  }

  let productDbTimer = null;
  els.productDbMode?.querySelectorAll("[data-product-db-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = normalizeProductDbMode(btn.dataset.productDbMode);
      setProductDbMode(mode);
      syncProductDbModeUi();
      // Keep typed query across chips — re-run scoped search.
      loadProductDatabase().catch((err) => alert(String(err.message || err)));
    });
  });
  els.productCreateOpenBtn?.addEventListener("click", () => openProductCreateSheet());
  els.dishCreateOpenBtn?.addEventListener("click", () => openDishCreateSheet());
  els.productDishEditBtn?.addEventListener("click", () => {
    openDishEditFromCard().catch(() => {});
  });
  els.dishCreateBackdrop?.addEventListener("click", () => closeDishCreateSheet());
  els.dishCreateCloseBtn?.addEventListener("click", () => closeDishCreateSheet());
  els.dishCreateRenameBtn?.addEventListener("click", () => openDishCreateRename());
  els.dishCreateNextBtn?.addEventListener("click", () => advanceDishCreateFromName());
  els.dishCreateName?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    advanceDishCreateFromName();
  });
  els.dishCreateSearch?.addEventListener("input", () => {
    clearTimeout(dishSearchTimer);
    dishSearchTimer = setTimeout(() => {
      searchDishIngredients(els.dishCreateSearch.value).catch((err) => setDishCreateError(String(err.message || err)));
    }, 220);
  });
  els.dishCreateSaveBtn?.addEventListener("click", () => submitDishCreate().catch((err) => setDishCreateError(String(err.message || err))));
  els.dishItemBackdrop?.addEventListener("click", () => closeDishItemSheet());
  els.dishItemDoneBtn?.addEventListener("click", () => closeDishItemSheet());
  els.dishItemCookBtn?.addEventListener("click", () => openDishCookPickSheet("item"));
  els.dishCookPickBackdrop?.addEventListener("click", () => closeDishCookPickSheet());
  els.dishCookPickClose?.addEventListener("click", () => closeDishCookPickSheet());
  els.dishItemGrams?.addEventListener("input", () => {
    patchDishItemFromSheet();
    scheduleNumericCaretFix(els.dishItemGrams);
  });
  els.dishCreateOil?.addEventListener("input", () => {
    state.dishOilGrams = els.dishCreateOil.value;
    if ((state.dishCookMode || "plain") !== "fry_meat") state.dishOilGrams = "";
    updateDishCreatePreview();
    scheduleNumericCaretFix(els.dishCreateOil);
  });
  els.productDishCookBtn?.addEventListener("click", () => openDishCookPickSheet("item"));
  els.productDishOil?.addEventListener("input", () => {
    renderProductDetailServingView();
    scheduleNumericCaretFix(els.productDishOil);
  });
  if (els.dishCreateItems && !els.dishCreateItems.dataset.bound) {
    els.dishCreateItems.dataset.bound = "1";
    els.dishCreateItems.addEventListener("click", (ev) => {
      const remove = ev.target.closest("[data-dish-remove]");
      if (remove) {
        const key = remove.dataset.dishRemove;
        if (state.dishEditKey === key) closeDishItemSheet();
        state.dishItems = state.dishItems.filter((item) => item.key !== key);
        renderDishCreateItems();
        updateDishCreatePreview();
        return;
      }
      const row = ev.target.closest("[data-dish-item]");
      if (row?.dataset.dishItem) openDishItemSheet(row.dataset.dishItem);
    });
  }
  els.productCreateBackdrop?.addEventListener("click", () => closeProductCreateSheet());
  els.productCreateCloseBtn?.addEventListener("click", () => closeProductCreateSheet());
  if (els.productDbSearch) {
    els.productDbSearch.addEventListener("input", () => {
      markUserInteraction();
      syncProductDbSearchClear();
      clearTimeout(productDbTimer);
      productDbTimer = setTimeout(() => loadProductDatabase().catch(() => {}), 220);
    });
  }
  els.productDbSearchClear?.addEventListener("click", () => {
    if (!els.productDbSearch) return;
    els.productDbSearch.value = "";
    syncProductDbSearchClear();
    focusWithoutScroll(els.productDbSearch);
    clearTimeout(productDbTimer);
    productDbTimer = setTimeout(() => loadProductDatabase().catch(() => {}), 0);
  });

  if (els.productCreateForm) {
    els.productCreateForm.addEventListener("submit", handleProductCreateSubmit);
    els.productCreateForm.elements?.name?.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      advanceProductCreateFromName();
    });
  }
  els.productCreateNextBtn?.addEventListener("click", () => {
    advanceProductCreateFromName();
  });

  if (els.productCreateSaveAndAddBtn && els.productCreateForm) {
    els.productCreateSaveAndAddBtn.addEventListener("click", () => {
      if (state.productCreateStep !== 2) {
        advanceProductCreateFromName();
        return;
      }
      if (!els.productCreateForm.reportValidity()) return;
      submitNewProductAndAddToMeal(els.productCreateForm)
        .catch((err) => alert(String(err.message || err)));
    });
  }

  if (els.productDetailAddBtn) {
    els.productDetailAddBtn.addEventListener("click", () => {
      if (isDishIngredientCardOpen()) {
        confirmDishIngredientCard();
        return;
      }
      if (state.nutritionViewServingEntry?.id) {
        saveServingFromProductCard().catch((err) => alert(String(err.message || err)));
        return;
      }
      const p = state.nutritionViewProduct;
      if (p) openNutritionQuickAdd(p);
    });
  }
  els.productServingAmount?.addEventListener("input", () => {
    renderProductDetailServingView();
    scheduleNumericCaretFix(els.productServingAmount);
  });
  els.productServingUnit?.addEventListener("change", () => {
    state.nutritionServingUnit = els.productServingUnit?.value === "100g" ? "100g" : "g";
    renderProductDetailServingView();
  });
  els.productMacroViewToggle?.addEventListener("click", () => {
    state.nutritionMacroViewMode =
      state.nutritionMacroViewMode === "100g" ? "serving" : "100g";
    renderProductDetailServingView();
  });
  els.productDetailFavoriteBtn?.addEventListener("click", () => {
    toggleProductFavorite().catch((err) => alert(String(err.message || err)));
  });
  els.productDetailNote?.addEventListener("input", () => scheduleProductNoteSave());
  els.productDetailNote?.addEventListener("blur", () => {
    clearTimeout(productNoteTimer);
    saveProductNoteNow().catch(() => {});
  });
  wireNoteResize(
    els.productDetailNote,
    els.productDetailNoteResize,
    () => noteHeightKeyForProduct(state.nutritionViewProduct),
    NOTE_HEIGHT_MIN
  );
  wireNoteResize(
    els.dishCreateNote,
    els.dishCreateNoteResize,
    () => noteHeightKeyForDishCreate(),
    88
  );
  els.productDetailBjuInfo?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openBjuInfoSheet();
  });
  els.bjuInfoBackdrop?.addEventListener("click", closeBjuInfoSheet);
  els.bjuInfoClose?.addEventListener("click", closeBjuInfoSheet);
  syncProductDbModeUi();

  if (els.productDetailDeleteBtn) {
    els.productDetailDeleteBtn.addEventListener("click", () => openProductDeleteConfirm());
  }
  if (els.productDeleteBackdrop) {
    els.productDeleteBackdrop.addEventListener("click", closeProductDeleteConfirm);
  }
  if (els.productDeleteNo) {
    els.productDeleteNo.addEventListener("click", closeProductDeleteConfirm);
  }
  if (els.productDeleteYes) {
    els.productDeleteYes.addEventListener("click", () => {
      confirmDeleteProduct().catch((err) => alert(String(err.message || err)));
    });
  }

  if (els.productEditForm) {
    els.productEditForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      submitProductEdit(ev.target)
        .catch((err) => alert(String(err.message || err)));
    });
  }

  if (els.nutritionSheetBackdrop) {
    els.nutritionSheetBackdrop.addEventListener("click", closeNutritionQuickAdd);
  }
  if (els.nutritionSheetSubmit) {
    els.nutritionSheetSubmit.addEventListener("click", () => {
      submitNutritionQuickAdd().catch((err) => alert(String(err.message || err)));
    });
  }
  els.nutritionSheetGrams?.addEventListener("input", () => {
    updateCookSheetMeta();
    scheduleNumericCaretFix(els.nutritionSheetGrams);
  });
  els.nutritionSheetOil?.addEventListener("input", () => {
    updateCookSheetMeta();
    scheduleNumericCaretFix(els.nutritionSheetOil);
  });

  if (els.saveBtn) {
    els.saveBtn.addEventListener("click", () => {
      if (state.screen !== "dayForm") return;
      if (state.fillOnboardingStep === 1) {
        goToFillOnboardingStep(2);
        return;
      }
      if (state.fillOnboardingStep === 3) {
        completeFillOnboarding();
        return;
      }
      if (els.saveBtn.classList.contains("is-error")) {
        setCtaMode("default");
        saveDay();
        return;
      }
      saveDay();
    });
  }

  if (els.fillHistoryHeaderBtn) {
    els.fillHistoryHeaderBtn.addEventListener("click", openFillOtherDay);
  }
  if (els.fillOtherDayBtn) {
    els.fillOtherDayBtn.addEventListener("click", openFillOtherDay);
  }

  document.querySelectorAll("#formZoneHistory .segmented__btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  document.querySelectorAll("#flowDetailProductivity [data-period]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const period = btn.dataset.period;
      if (period === state.productivityPeriod) return;
      setProductivityPeriod(period);
      els.productivityStrip.innerHTML = '<p class="donut-fallback">Загрузка…</p>';
      if (els.productivityDetailBlocks) els.productivityDetailBlocks.innerHTML = "";
      setElHidden(els.productivityRadarBlock, true);
      try {
        await refreshProductivityDetail();
      } catch (err) {
        els.productivityStrip.innerHTML = `<p class="donut-fallback">${escapeHtml(String(err.message || err))}</p>`;
        if (els.productivityDetailBlocks) els.productivityDetailBlocks.innerHTML = "";
        setElHidden(els.productivityRadarBlock, true);
      }
    });
  });

  document.querySelectorAll("#flowDetailSport [data-sport-period]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const period = btn.dataset.sportPeriod;
      if (period === state.sportPeriod) return;
      setSportPeriod(period);
      els.sportStrip.innerHTML = '<p class="donut-fallback">Загрузка…</p>';
      try {
        await refreshSportDetail();
      } catch (err) {
        els.sportStrip.innerHTML = `<p class="donut-fallback">${escapeHtml(String(err.message || err))}</p>`;
      }
    });
  });

  if (els.errorBadge) {
    els.errorBadge.addEventListener("click", async () => {
      setDayError(null);
      try {
        await reloadFillData();
      } catch (err) {
        setDayError(String(err.message || err));
      }
    });
  }

  try {
    setDashboardError(null);
    await loadMonth(todayIso().slice(0, 7));
  } catch (err) {
    setDashboardError(String(err.message || err));
  }

  startSilentRefresh();
}

bootstrap();
