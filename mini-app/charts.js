/** Донаты Chart.js — размеры как index-sql.html (92×88) */

(function () {
  const DONUT_SIZE = 80;
  const chartInstances = [];

  function destroyCharts() {
    while (chartInstances.length) {
      const c = chartInstances.pop();
      try {
        c.destroy();
      } catch {
        /* ignore */
      }
    }
  }

  function progressFillColor(pct) {
    const pr = Number(pct) || 0;
    if (pr >= 100) return "#2e7d32";
    if (pr >= 50) return "#f9a825";
    return "#c62828";
  }

  function donutDataForPercent(progressRaw) {
    const pr = Number(progressRaw) || 0;
    const arc = Math.min(Math.max(pr, 0), 100);
    const colorKey = pr >= 100 ? 100 : pr;
    const fill = progressFillColor(colorKey);
    const track = "#eceff1";
    return {
      datasets: [
        {
          data: arc >= 100 ? [100, 0] : [arc, 100 - arc],
          backgroundColor: [fill, track],
          borderWidth: 0,
          hoverOffset: 0,
        },
      ],
    };
  }

  function miniDonutOptions() {
    return {
      type: "doughnut",
      options: {
        responsive: false,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            filter: (item) => item.dataIndex === 0,
            callbacks: {
              label(ctx) {
                return ` ${Math.round(ctx.raw * 10) / 10}%`;
              },
            },
          },
        },
      },
    };
  }

  function renderSphereDonuts(hostEl, rows, clearChartsFirst = true) {
    if (clearChartsFirst) destroyCharts();
    hostEl.innerHTML = "";

    if (typeof window.Chart === "undefined") {
      hostEl.innerHTML =
        '<p class="donut-fallback">Chart.js не загрузился. Обновите страницу или откройте через http://127.0.0.1:8765/mini-app/</p>';
      return;
    }

    rows.forEach((r) => {
      const pr = Number(r.progress) || 0;
      const name = r.sphere || r.label || "—";
      const cell = document.createElement("div");
      cell.className = "donut-cell";
      const wrap = document.createElement("div");
      wrap.className = "donut-canvas-wrap";
      const cv = document.createElement("canvas");
      cv.width = DONUT_SIZE;
      cv.height = DONUT_SIZE;
      cv.setAttribute("role", "img");
      cv.setAttribute("aria-label", `${name}: ${r.fact}/${r.goal} (${pr}%)`);
      wrap.appendChild(cv);
      cell.appendChild(wrap);
      const nameEl = document.createElement("div");
      nameEl.className = "donut-name";
      nameEl.textContent = name;
      cell.appendChild(nameEl);
      const st = document.createElement("div");
      st.className = "donut-stat";
      st.textContent = `${r.fact}/${r.goal} (${pr}%)`;
      cell.appendChild(st);
      hostEl.appendChild(cell);

      const chart = new window.Chart(cv, {
        ...miniDonutOptions(),
        data: donutDataForPercent(pr),
      });
      chartInstances.push(chart);
    });
  }

  function renderSportDonuts(hostEl, sport) {
    destroyCharts();
    hostEl.innerHTML = "";

    if (typeof window.Chart === "undefined") {
      hostEl.innerHTML =
        '<p class="donut-fallback">Chart.js не загрузился. Обновите страницу или откройте через http://127.0.0.1:8765/mini-app/</p>';
      return;
    }

    if (!sport || typeof sport.totalMinutes !== "number") {
      hostEl.innerHTML = '<p class="donut-fallback">Нет данных по спорту за месяц</p>';
      return;
    }

    const cols = Array.isArray(sport.byMinColumn) ? sport.byMinColumn : [];
    if (!cols.length) {
      hostEl.innerHTML = '<p class="donut-fallback">Категории спорта не настроены</p>';
      return;
    }

    cols.forEach((c) => {
      const pr = Number(c.progress) || 0;
      const m = Number(c.minutes) || 0;
      const gPart = Number(c.goalPart) || 0;
      const short =
        (c.shortLabel && String(c.shortLabel).trim()) ||
        String(c.label || "")
          .replace(/, min$/i, "")
          .trim();

      const cell = document.createElement("div");
      cell.className = "donut-cell";
      const wrap = document.createElement("div");
      wrap.className = "donut-canvas-wrap";
      const cv = document.createElement("canvas");
      cv.width = DONUT_SIZE;
      cv.height = DONUT_SIZE;
      cv.setAttribute("role", "img");
      cv.setAttribute("aria-label", `${short}: ${m}/${gPart} мин (${pr}%)`);
      wrap.appendChild(cv);
      cell.appendChild(wrap);
      const nameEl = document.createElement("div");
      nameEl.className = "donut-name";
      nameEl.textContent = short;
      cell.appendChild(nameEl);
      const st = document.createElement("div");
      st.className = "donut-stat";
      st.textContent = `${m}/${gPart} мин (${pr}%)`;
      cell.appendChild(st);
      hostEl.appendChild(cell);

      const chart = new window.Chart(cv, {
        ...miniDonutOptions(),
        data: donutDataForPercent(pr),
      });
      chartInstances.push(chart);
    });
  }

  function renderProductivityRadar(canvasEl, rows) {
    if (!canvasEl) return;
    if (typeof window.Chart === "undefined") return;

    const labels = rows.map((r) => r.sphere || r.label || "—");
    const ratio = rows.map((r) => {
      const f = Number(r.fact) || 0;
      const g = Number(r.goal) || 0;
      return g > 0 ? Math.min(f / g, 1) : 0;
    });

    const chart = new window.Chart(canvasEl, {
      type: "radar",
      data: {
        labels,
        datasets: [
          {
            label: "Факт/Цель",
            data: ratio,
            fill: true,
            backgroundColor: "rgba(78, 121, 167, 0.2)",
            borderColor: "#4e79a7",
            pointBackgroundColor: "#4e79a7",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { boxWidth: 10, font: { size: 11 }, color: "#666" },
          },
        },
        scales: {
          r: {
            min: 0,
            max: 1,
            ticks: {
              stepSize: 0.2,
              font: { size: 9 },
              backdropColor: "transparent",
            },
            pointLabels: {
              font: { size: 10 },
              padding: 6,
            },
            grid: { color: "rgba(0,0,0,0.08)" },
            angleLines: { color: "rgba(0,0,0,0.08)" },
          },
        },
      },
    });
    chartInstances.push(chart);
  }

  const MACRO_COLORS = {
    protein: "#40d17c",
    carbs: "#26c9dd",
    fat: "#ed3b00",
  };

  /** Донат Б→У→Ж; serving — граммы порции, иначе на 100 г. Легенда в app.js */
  function renderProductMacroDonut(hostEl, product, serving) {
    if (!hostEl) return;
    hostEl.innerHTML = "";

    if (typeof window.Chart === "undefined") {
      hostEl.innerHTML = '<p class="donut-fallback">Chart.js не загрузился</p>';
      return;
    }

    const protein = serving
      ? Number(serving.protein) || 0
      : Number(product.proteinPer100g) || 0;
    const carbs = serving
      ? Number(serving.carbs) || 0
      : Number(product.carbsPer100g) || 0;
    const fat = serving ? Number(serving.fat) || 0 : Number(product.fatPer100g) || 0;
    const sum = protein + carbs + fat;
    const data =
      sum > 0 ? [protein, carbs, fat] : [1, 1, 1];
    const colors =
      sum > 0
        ? [MACRO_COLORS.protein, MACRO_COLORS.carbs, MACRO_COLORS.fat]
        : ["#eceff1", "#eceff1", "#eceff1"];

    const wrap = document.createElement("div");
    wrap.className = "product-macro-donut-wrap";
    const cv = document.createElement("canvas");
    cv.width = 120;
    cv.height = 120;
    cv.setAttribute("role", "img");
    const ariaGrams = serving ? `${serving.grams} г` : "100 г";
    cv.setAttribute("aria-label", `Белок, углеводы, жиры на ${ariaGrams}`);
    wrap.appendChild(cv);
    hostEl.appendChild(wrap);

    const chart = new window.Chart(cv, {
      type: "doughnut",
      data: {
        labels: ["Белок", "Углеводы", "Жиры"],
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 0,
          },
        ],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        cutout: "58%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                return ` ${Math.round(ctx.raw * 10) / 10} г`;
              },
            },
          },
        },
      },
    });
    chartInstances.push(chart);
  }

  function monthLabelDefault(ym) {
    const m = Number(ym?.slice(5, 7)) - 1;
    return Number.isFinite(m) && m >= 0 ? String(m + 1).padStart(2, "0") : ym?.slice(5, 7) || "";
  }

  function renderFinanceBalanceBars(hostEl, bars, monthLabel, opts) {
    if (!hostEl) return "";
    const labelMonth = typeof monthLabel === "function" ? monthLabel : monthLabelDefault;
    const compact = opts?.compact === true;
    const highlightMonth = opts?.highlightMonth || "";
    hostEl.innerHTML = "";
    if (!bars?.length) {
      hostEl.innerHTML = '<span class="finance-empty">Нет данных</span>';
      return "";
    }
    const max = Math.max(...bars.map((b) => Math.abs(Number(b.balance) || 0)), 1);
    const maxBar = compact ? 48 : 56;
    const minBar = compact ? 4 : 8;
    bars.forEach((b) => {
      const v = Number(b.balance) || 0;
      const h = Math.max(minBar, Math.round((Math.abs(v) / max) * maxBar));
      const color = v >= 0 ? "#1f8a65" : "#cf2d56";
      const val = v >= 0 ? `+${Math.round(v / 1000)}К` : `−${Math.round(Math.abs(v) / 1000)}К`;
      const cell = document.createElement("div");
      cell.className = "finance-vbar" + (compact ? " finance-vbar--year" : "");
      if (highlightMonth && b.month === highlightMonth) {
        cell.classList.add("finance-vbar--current");
      }
      cell.innerHTML = `
        <span class="finance-vbar__val">${val}</span>
        <div class="finance-vbar__col" style="height:${h}px;background:${color}"></div>
        <span class="finance-vbar__month">${labelMonth(b.month)}</span>`;
      hostEl.appendChild(cell);
    });
    return "";
  }

  function renderFinanceFoodTrend(hostEl, history, monthLabel, options) {
    if (!hostEl) return;
    const opts = options || {};
    const labelMonth = typeof monthLabel === "function" ? monthLabel : monthLabelDefault;
    const barColor = opts.barColor || "#3685bf";
    const trendColor = opts.trendColor || barColor;
    hostEl.innerHTML = "";
    if (!history?.length) return;
    const max = Math.max(...history.map((h) => Number(h.pct) || 0), 35);
    const wrap = document.createElement("div");
    wrap.className = "finance-chart-wrap";
    const barsRow = document.createElement("div");
    barsRow.className = "finance-mini-bar finance-mini-bar--income";
    history.forEach((h) => {
      const pct = Number(h.pct) || 0;
      const height = Math.max(6, Math.round((pct / max) * 48));
      const cell = document.createElement("div");
      cell.className = "finance-vbar finance-vbar--sm";
      cell.innerHTML = `
        <span class="finance-vbar__val">${Math.round(pct)}%</span>
        <div class="finance-vbar__col" style="height:${height}px;background:${barColor}"></div>
        <span class="finance-vbar__month">${labelMonth(h.month)}</span>`;
      barsRow.appendChild(cell);
    });
    wrap.appendChild(barsRow);
    hostEl.appendChild(wrap);
    requestAnimationFrame(() => drawFinanceIncomeTrendLine(barsRow, trendColor));
  }

  function drawFinanceIncomeTrendLine(barsRow, strokeColor) {
    const cols = barsRow.querySelectorAll(".finance-vbar__col");
    if (cols.length < 2) return;
    const box = barsRow.getBoundingClientRect();
    if (!box.width || !box.height) return;

    const points = Array.from(cols).map((col) => {
      const r = col.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 - box.left,
        y: r.top - box.top,
      };
    });

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "finance-trend-line");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
    );
    if (strokeColor) {
      path.setAttribute("stroke", strokeColor);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-width", "1.5");
    }
    svg.appendChild(path);
    barsRow.appendChild(svg);
  }

  function renderFinanceMonthlyBars(hostEl, monthly, monthLabel, options) {
    if (!hostEl) return;
    const opts = options || {};
    const valueKey = opts.valueKey || "amount";
    const barColor = opts.barColor || "#1f8a65";
    const labelMonth = typeof monthLabel === "function" ? monthLabel : monthLabelDefault;
    const highlightMonth = opts?.highlightMonth || "";
    hostEl.innerHTML = "";
    if (!monthly?.length) return;
    const max = Math.max(...monthly.map((m) => Number(m[valueKey]) || 0), 1);
    const wrap = document.createElement("div");
    wrap.className = "finance-chart-wrap";
    const barsRow = document.createElement("div");
    barsRow.className = "finance-mini-bar finance-mini-bar--income";
    monthly.forEach((m) => {
      const v = Number(m[valueKey]) || 0;
      const h = Math.max(6, Math.round((v / max) * 48));
      const valLabel = v >= 1000 ? `${Math.round(v / 1000)}К` : v > 0 ? String(Math.round(v)) : "0";
      const cell = document.createElement("div");
      cell.className = "finance-vbar finance-vbar--sm";
      if (highlightMonth && m.month === highlightMonth) {
        cell.classList.add("finance-vbar--current");
      }
      cell.innerHTML = `
        <span class="finance-vbar__val">${valLabel}</span>
        <div class="finance-vbar__col" style="height:${h}px;background:${barColor}"></div>
        <span class="finance-vbar__month">${labelMonth(m.month)}</span>`;
      barsRow.appendChild(cell);
    });
    wrap.appendChild(barsRow);
    hostEl.appendChild(wrap);
    requestAnimationFrame(() =>
      drawFinanceIncomeTrendLine(barsRow, opts.trendColor || opts.barColor)
    );
  }

  function renderFinanceIncomeBars(hostEl, monthly, monthLabel) {
    renderFinanceMonthlyBars(hostEl, monthly, monthLabel, {
      barColor: "#1f8a65",
      trendColor: "#1f8a65",
    });
  }

  function renderFinanceFuelBars(hostEl, monthly, monthLabel) {
    renderFinanceMonthlyBars(hostEl, monthly, monthLabel, {
      barColor: "#c45c1a",
      trendColor: "#c45c1a",
    });
  }

  function renderFinanceAssetsBars(hostEl, monthly, monthLabel) {
    const bars = (monthly || []).map((m) => ({
      month: m.month,
      amount: Number(m.actual) || 0,
    }));
    renderFinanceMonthlyBars(hostEl, bars, monthLabel, { barColor: "#3685bf" });
  }

  function renderLedgerYearBars(hostEl, years, opts) {
    if (!hostEl) return;
    const barColor = opts?.barColor || "#e8a030";
    const highlightYear = Number(opts?.highlightYear) || 0;
    hostEl.innerHTML = "";
    if (!years?.length) {
      hostEl.innerHTML = '<span class="finance-empty">Нет данных</span>';
      return;
    }
    const max = Math.max(...years.map((y) => Number(y.total) || 0), 1);
    const maxBar = 56;
    const minBar = 8;
    years.forEach((y) => {
      const v = Number(y.total) || 0;
      const h = Math.max(minBar, Math.round((v / max) * maxBar));
      const val = v >= 1000 ? `${Math.round(v / 1000)}К` : v > 0 ? String(Math.round(v)) : "0";
      const cell = document.createElement("div");
      cell.className = "finance-vbar finance-vbar--year";
      if (highlightYear && Number(y.year) === highlightYear) {
        cell.classList.add("finance-vbar--current");
      }
      cell.innerHTML = `
        <span class="finance-vbar__val">${val}</span>
        <div class="finance-vbar__col" style="height:${h}px;background:${barColor}"></div>
        <span class="finance-vbar__month">${y.year}</span>`;
      hostEl.appendChild(cell);
    });
  }

  function renderLedgerCarYearStackedBars(hostEl, series, opts) {
    if (!hostEl) return;
    const highlightYear = Number(opts?.highlightYear) || 0;
    const consColor = "#3a9e5f";
    const repairColor = "#e8a030";
    hostEl.innerHTML = "";
    if (!series?.length) {
      hostEl.innerHTML = '<span class="finance-empty">Нет данных</span>';
      return;
    }
    const max = Math.max(...series.map((y) => Number(y.total) || 0), 1);
    const maxBar = 56;
    const minBar = 8;
    series.forEach((y) => {
      const total = Number(y.total) || 0;
      const cons = Number(y.consumables) || 0;
      const repair = Number(y.repair) || 0;
      const h = Math.max(minBar, Math.round((total / max) * maxBar));
      const consH = total > 0 ? Math.max(2, Math.round((cons / total) * h)) : 0;
      const repairH = total > 0 ? Math.max(2, h - consH) : 0;
      const val =
        total >= 1000 ? `${Math.round(total / 1000)}К` : total > 0 ? String(Math.round(total)) : "0";
      const cell = document.createElement("div");
      cell.className = "finance-vbar finance-vbar--year";
      if (highlightYear && Number(y.year) === highlightYear) {
        cell.classList.add("finance-vbar--current");
      }
      cell.innerHTML = `
        <span class="finance-vbar__val">${val}</span>
        <div class="finance-vbar__stack" style="height:${h}px">
          <div class="finance-vbar__stack-seg" style="height:${consH}px;background:${consColor}"></div>
          <div class="finance-vbar__stack-seg" style="height:${repairH}px;background:${repairColor}"></div>
        </div>
        <span class="finance-vbar__month">${y.year}</span>`;
      hostEl.appendChild(cell);
    });
  }

  window.LifeCharts = {
    renderSphereDonuts,
    renderSportDonuts,
    renderProductivityRadar,
    renderProductMacroDonut,
    renderFinanceBalanceBars,
    renderFinanceFoodTrend,
    renderFinanceIncomeBars,
    renderFinanceFuelBars,
    renderFinanceAssetsBars,
    renderFinanceMonthlyBars,
    renderLedgerYearBars,
    renderLedgerCarYearStackedBars,
    destroyCharts,
  };
})();
