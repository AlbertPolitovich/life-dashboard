# Дневник — визуал (контекст UI)

> Mini-app: **`@.cursor/context_bot_miniapp.md`** · Актуальный home: **`@.cursor/context_visualization_miniapp.md`**  
> Финансы (эталон карточки): **`@.cursor/context_visualization_finance.md`**  
> Код: `mini-app/index.html`, `styles.css`, `diary.js`

---

## Статус UI (эта сессия)

| Область | Состояние |
|---------|-----------|
| Home `#diaryZoneBtn` variant A (карточка) | ✅ реализовано |
| Home `#diaryZoneBtn` variant B (компактная) | ✅ реализовано |
| Feature-flag `?diaryHome=a\|b` | ✅ |
| `#flowDiary` — календарь месяца, точки | ✅ реализовано |
| `#flowDiaryEditor` — textarea + CTA | ✅ реализовано |
| Навигация (TG BackButton + ‹) | ✅ реализовано |
| Мок-данные `DIARY_MOCK` | ⛔ не использовать — есть живой API |
| API / бэкенд | ✅ `/diary/*` (см. `context_bot_diary.md`) |

---

## Вариант A — Карточка (как финансы)

### Идея

Зона дневника на home выглядит как карточка финансов: сверху строка-шапка с лейблом и `›` (→ календарь), внутри — небольшой превью последней записи и мини-ряд точек за последние 7 дней. Снизу — inline-CTA «Заполнить дневник», открывающая редактор на сегодня. Пользователь сразу видит, когда последний раз писал, и может за один тап перейти к записи.

### Wireframe · Home (фрагмент: финансы → дневник)

```
  ┌─ ФИНАНСЫ                           › ─┐
  │ Баланс с начала года                   │
  │ 125 400 ₽                    [год]     │
  │ ─────────────────────────────────────  │
  │ ● Ипотека через 5 дн. · 64 000 ₽      │
  │ ─────────────────────────────────────  │
  │ [ − Расход ]    [ + Доход ]            │
  └────────────────────────────────────────┘
                                              ← margin-top: 8px
  ┌─ ДНЕВНИК                           › ─┐  ← diary-zone__head → flowDiary
  │ Последняя запись: 10 июня              │  ← hint 13px, color: --hint
  │ ● ● ○ ● ● ● ○   Пн Вт Ср Чт Пт Сб Вс │  ← 7 dots 6px, --link / var(--border)
  │ [ Заполнить дневник ]                  │  ← cta-btn--inline → flowDiaryEditor
  └────────────────────────────────────────┘
```

### Wireframe · Календарь месяца

```
[‹]  Дневник                                 ← app-header, bg --link
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
╔═══ chrome (--chrome) ══════════════════════╗
║         ‹    Июнь 2026    ›                ║  ← diary-cal-nav
╚════════════════════════════════════════════╝
 Пн   Вт   Ср   Чт   Пт   Сб   Вс
  1    2    3    4    5    6    7
  •              •    •    •
  8    9   10   11   12   13   14
  •    •   [10]                      ← [10] = сегодня, кольцо --link
 15   16   17   18   19   20   21
 22   23   24   25   26   27   28
 29   30
────────────────────────────────────
  Июнь · заполнено 7 из 11           ← diary-cal__summary, 12px --hint
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Wireframe · Редактор дня

```
[‹]  Сегодня · 10.06.2026             ← app-header (headerTitle через DETAIL_TITLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌──────────────────────────────────────────┐
│ Созвон с командой. Вечером прогулка.     │  ← textarea 60vh, font 15px
│                                          │
│ (placeholder: Что было важным сегодня…)  │
│                                          │
└──────────────────────────────────────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ Сохранить ]    sticky cta-bar             ← default / saving / success «Сохранено ✓»
```

### Состав блоков (Вариант A)

| Элемент | Класс / токен | Размер |
|---------|--------------|--------|
| Обёртка зоны | `.diary-zone` | `margin-top: 8px`, `display: block` |
| Внешняя карточка | `.diary-zone__card` | `border-radius: 12px`, `border: 1px solid var(--border)`, `background: var(--card)` |
| Шапка → календарь | `.diary-zone__head` | `display: flex`, `justify-content: space-between`, `padding: 10px 12px 6px`, `min-height: 44px` |
| Лейбл | `.diary-zone__label` | `9px`, `font-weight: 700`, `letter-spacing: 0.07em`, `text-transform: uppercase`, `color: var(--hint)` |
| Шеврон | `.diary-zone__chev` | `14px`, `color: var(--link)` |
| Превью-блок | `.diary-zone__preview` | `padding: 0 12px 8px` |
| Строка-подсказка | `.diary-zone__preview-hint` | `13px`, `color: var(--hint)`, `margin: 0 0 8px` |
| Ряд точек (7 дней) | `.diary-zone__dots` | `display: flex`, `gap: 6px`, `margin-bottom: 8px` |
| Точка | `.diary-zone__dot` | `6×6px`, `border-radius: 50%`, пустая = `var(--border)`, заполненная = `.--filled` → `var(--link)` |
| Точка-сегодня | `.diary-zone__dot--today` | `outline: 2px solid var(--link)`, `outline-offset: 1px` |
| CTA внутри карточки | `.cta-btn.cta-btn--inline` | `margin: 0 12px 10px`, `width: calc(100% - 24px)` |
| Экран календаря | `#flowDiary.flow-screen` | `section`, как другие flow-screen |
| Хром-шапка | `.diary-cal-chrome` | `background: var(--chrome)`, `padding: 12px var(--pad-x)` |
| Навигация месяца | `.diary-cal-nav` | `display: flex`, `align-items: center`, `justify-content: space-between` |
| Кнопки ‹ › | `.diary-cal-nav__btn` | `36×36px`, `font-size: 22px`, `color: var(--link)` |
| Заголовок месяца | `.diary-cal-nav__month` | `15px`, `font-weight: 600` |
| Сетка дней | `.diary-cal__grid` | `display: grid`, `grid-template-columns: repeat(7,1fr)`, `gap: 2px` |
| Ячейка | `.diary-cal__cell` | `min-height: 44px`, `flex-direction: column`, `align-items: center`, `border-radius: 8px` |
| Число дня | `.diary-cal__day` | `15px`, `line-height: 1` |
| Сегодня | `.diary-cal__cell--today .diary-cal__day` | `28×28px`, `border-radius: 50%`, `background: var(--link)`, `color: #fff` |
| Будущие | `.diary-cal__cell--future` | `opacity: 0.5` на числе, кликабельны (можно писать в будущее) |
| Точка под датой | `.diary-cal__dot` | `4×4px`, `border-radius: 50%`, `background: var(--link)`, `margin-top: 3px` |
| Итог под сеткой | `.diary-cal__summary` | `12px`, `color: var(--hint)`, `text-align: center` |
| Экран редактора | `#flowDiaryEditor.flow-screen` | section |
| Textarea | `.diary-editor__textarea` | `min-height: 60vh`, `border: none`, `resize: none`, `font: inherit`, `15px` |
| CTA редактора | `#diaryCtaBar .cta-btn` | sticky, `.is-saving` / `.is-success` как fill |

### Плюсы / минусы (Вариант A)

**Плюс:** пользователь видит последнюю запись и заполненность без открытия calendar — информативно на маленьком экране.  
**Плюс:** CTA «Заполнить дневник» прямо на home — минимум тапов до записи.  
**Плюс:** паттерн идентичен финансам, zero cognitive load.  
**Минус:** высота карточки ~90px — занимает больше места, чем КБЖУ.  
**Минус:** два активных элемента в одной карточке (head + CTA) — чуть сложнее, чем mono-tap.

---

## Вариант B — Компактная строка (как КБЖУ)

### Идея

Вся зона дневника — одна компактная кнопка-строка, аналог `.nutrition-zone`. Слева: лейбл `ДНЕВНИК · СЕГОДНЯ` и строка статуса («сегодня не заполнен» / «заполнен ✓»). Правее — минimalный шеврон `›` для входа в календарь. Тап по основной зоне кнопки открывает редактор сегодня. Идея: дневник — это дополнительный модуль, он должен занимать как можно меньше места на главном экране.

### Wireframe · Home (фрагмент: финансы → дневник)

```
  ┌─ ФИНАНСЫ                           › ─┐
  │ ...                                    │
  └────────────────────────────────────────┘
                                              ← margin-top: 8px
  ┌─ ДНЕВНИК · СЕГОДНЯ ── сегодня не заполнен   › ─┐
  └─────────────────────────────────────────────────┘
  ↑ tap основной области → flowDiaryEditor (сегодня)
                                          ↑ tap › → flowDiary (календарь)
```

*(если заполнен: «заполнен ✓», цвет `--green`)*

### Wireframe · Календарь месяца

```
[‹]  Дневник                                 ← app-header
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
╔═══ chrome ════════════════════════════════╗
║         ‹    Июнь 2026    ›               ║
╚═══════════════════════════════════════════╝
 Пн   Вт   Ср   Чт   Пт   Сб   Вс
  1    2    3    4    5    6    7
  •              •    •    •
  8    9   10   11   12   13   14
  •    •   [10]
 15   16   17   18   19   20   21
 22   23   24   25   26   27   28
 29   30
────────────────────────────────────
  Июнь · заполнено 7 из 11
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

*(Календарь идентичен варианту A — один общий экран)*

### Wireframe · Редактор дня

```
[‹]  Сегодня · 10.06.2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌──────────────────────────────────────────┐
│ Созвон с командой. Вечером прогулка.     │
│                                          │
└──────────────────────────────────────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ Сохранить ]
```

*(Редактор идентичен варианту A — один общий экран)*

### Состав блоков (Вариант B)

| Элемент | Класс / токен | Размер |
|---------|--------------|--------|
| Обёртка | `.diary-zone` | `margin-top: 8px`, `display: block` |
| Строка-кнопка | `.diary-zone__compact` | `display: flex`, `align-items: center`, `padding: 10px 12px`, `background: var(--card)`, `border: 1px solid var(--border)`, `border-radius: 12px`, `min-height: 44px` |
| Контент слева | `.diary-zone__compact-content` | `flex: 1`, `min-width: 0` |
| Лейбл | `.diary-zone__label` | `9px`, `font-weight: 700`, `letter-spacing: 0.07em`, `uppercase`, `color: var(--hint)` |
| Статус-строка | `.diary-zone__compact-status` | `13px`, `margin: 2px 0 0`, пустой = `color: var(--hint)`, заполнен = `.--filled` → `color: var(--green)` |
| Кнопка-шеврон (→ calendar) | `.diary-zone__compact-cal` | `36×36px`, `flex-shrink: 0`, `border: none`, `background: none`, `font-size: 20px`, `color: var(--link)` |

### Плюсы / минусы (Вариант B)

**Плюс:** минимальная высота ~44px — дневник не «крадёт» место на главном экране.  
**Плюс:** zero complexity: тап = действие, паттерн тот же что КБЖУ.  
**Минус:** нет превью последней записи / заполненности — меньше информации без открытия.  
**Минус:** две разные tap-зоны (тело + шеврон) в одной строке — небольшой риск промаха для одноручного использования.

---

## Навигация (общая для обоих вариантов)

```
home
  └─ #diaryZoneBtn
       ├─ tap CTA / tap основная зона (B) ──→ diaryEditor (сегодня)
       └─ tap шапка/шеврон ›              ──→ diaryCalendar

diaryCalendar (#flowDiary)
  ├─ tap дата ──────────────────────────────→ diaryEditor (выбранная дата)
  ├─ ‹ (prev month) / › (next month) ──────→ перерисовка в том же экране
  └─ ‹ BackButton ──────────────────────────→ home

diaryEditor (#flowDiaryEditor)
  ├─ [ Сохранить ] ─────────────────────────→ сохранение + success state
  └─ ‹ BackButton ──────────────────────────→ diaryCalendar
       (если открыт из home-CTA — state.diaryBackScreen = 'home')
       └─ если backScreen = 'home' ──────────→ home
```

**TG BackButton:** скрыт на home, показан на diaryCalendar и diaryEditor.  
**Экран `diaryEditor` хранит `state.diaryBackScreen`** (`'diaryCalendar'` или `'home'`) — чтобы ‹ вёл в правильный экран.

---

## Рекомендация

**Рекомендуется Вариант A (карточка).**

На маленьком экране Telegram основная задача home — мотивировать пользователя заполнить дневник сегодня. Вариант A решает это напрямую: инлайн-CTA в одном тапе, плюс мини-ряд точек сразу показывает «когда последний раз писал». Визуально карточка согласована с блоком финансов, создавая консистентный ритм секций. Дополнительные ~50px высоты оправданы — дневник это ежедневный ритуал, а не вспомогательный виджет.

---

## MVP scope UI (v1 — моки без API)

- [x] Вариант A home-блок (default) + Вариант B за `?diaryHome=b`
- [x] Мок `DIARY_MOCK` — `filledDates[]` + `entries{}` из `localStorage` (fallback к константе)
- [x] Экран `#flowDiary` — сетка Пн–Вс, точки под заполненными датами, кольцо сегодня
- [x] Навигация месяца — кнопки ‹ › (без свайпа в v1)
- [x] Будущие дни — приглушены, **кликабельны** (разрешено писать вперёд)
- [x] Экран `#flowDiaryEditor` — textarea + placeholder + sticky CTA
- [x] CTA states: default → saving (300ms) → success «Сохранено ✓» (1.5s) → default
- [x] Сохранение в `localStorage` ключ `diary_<YYYY-MM-DD>`
- [x] Счётчик «заполнено N из K» — K = прошедшие дни месяца включая сегодня

---

## Очередь бэка (другой чат)

- Таблица `diary_entries (user_id, log_date PK, content TEXT, updated_at)` · `GET /diary?month=` · `POST /diary` · привязка `log_date` к часовому поясу пользователя
