from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
from pathlib import Path

COMBINED_IMAGE = "routine_radar.png"
SPORT_IMAGE = "sport.png"


def _build_chart_configs(rows: list[dict]) -> tuple[dict, dict, list[float]]:
    labels = [str(r.get("sphere", "")) for r in rows]
    facts = [float(r.get("fact", 0) or 0) for r in rows]
    goals = [float(r.get("goal", 0) or 0) for r in rows]
    progresses = [float(r.get("progress", 0) or 0) for r in rows]
    total_fact = sum(facts)
    total_goal = sum(goals)
    total_progress = round((total_fact / total_goal) * 100) if total_goal > 0 else 0
    done_arc = min(max(total_progress, 0), 100)
    missed_arc = 100 - done_arc

    routine = {
        "type": "doughnut",
        "data": {
            "labels": ["Сделано", "Не сделано"],
            "datasets": [
                {
                    "label": "Routine",
                    "data": [done_arc, missed_arc],
                    "backgroundColor": ["#4e79a7", "#eceff1"],
                    "borderWidth": 0,
                }
            ],
        },
        "options": {
            "plugins": {
                "legend": {"display": True, "position": "bottom"},
                "title": {"display": True, "text": "Routine"},
            },
            "cutout": "70%",
        },
    }
    ratio = [min((f / g), 1) if g > 0 else 0 for f, g in zip(facts, goals, strict=True)]
    radar = {
        "type": "radar",
        "data": {
            "labels": labels,
            "datasets": [
                {
                    "label": "Факт/Цель",
                    "data": ratio,
                    "backgroundColor": "rgba(78,121,167,0.25)",
                    "borderColor": "#4e79a7",
                    "pointBackgroundColor": "#4e79a7",
                },
            ],
        },
        "options": {
            "plugins": {
                "title": {"display": True, "text": "Radar chart"},
                "legend": {"display": True, "position": "bottom"},
            },
            "scales": {
                "r": {
                    "min": 0,
                    "max": 1,
                    "ticks": {"stepSize": 0.2},
                }
            },
        },
    }
    return routine, radar, progresses


async def render_routine_image(rows: list[dict]) -> str:
    from playwright.async_api import async_playwright

    routine_cfg, radar_cfg, progresses = _build_chart_configs(rows)
    out_dir = Path(tempfile.mkdtemp(prefix="routine-charts-"))
    combined_path = out_dir / COMBINED_IMAGE

    html = f"""
<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {{ margin: 0; padding: 16px; background: #f6f7fb; font-family: Arial, sans-serif; }}
    .card {{ background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }}
    .col-routine h3, .col-radar h3 {{ margin-top: 0; }}
    .donut-grid {{
      display: flex;
      flex-wrap: wrap;
      gap: 14px 12px;
      justify-content: flex-start;
      margin-top: 4px;
    }}
    .donut-cell {{ width: 92px; text-align: center; }}
    .donut-cell .donut-canvas-wrap {{
      height: 88px;
      margin: 0 auto 6px;
      position: relative;
    }}
    .donut-cell canvas {{ max-width: 100%; max-height: 100%; }}
    .donut-name {{
      font-size: 12px;
      font-weight: 600;
      color: #333;
      line-height: 1.25;
      word-break: break-word;
    }}
    .donut-stat {{
      font-size: 11px;
      color: #666;
      margin-top: 2px;
    }}
    .radar-chart-host {{
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }}
    .stack {{ display: flex; flex-direction: column; gap: 16px; }}
    #routineWrap {{ width: 760px; }}
    #radarWrap {{ width: 760px; }}
  </style>
</head>
<body>
  <div id="combinedWrap" class="stack">
    <div id="routineWrap" class="card col-routine">
      <h3>Routine</h3>
      <div id="kpi"></div>
      <div id="sphereDonuts" class="donut-grid"></div>
    </div>
    <div id="radarWrap" class="card col-radar">
      <h3>Radar chart</h3>
      <div class="radar-chart-host">
        <canvas id="radarChart"></canvas>
      </div>
    </div>
  </div>
  <script>
    const rows = {json.dumps(rows, ensure_ascii=False)};
    const radarCfg = {json.dumps(radar_cfg, ensure_ascii=False)};
    const progressData = {json.dumps(progresses, ensure_ascii=False)};

    function getProgressColor(p) {{
      if (p >= 100) return "#2e7d32";
      if (p >= 50) return "#f9a825";
      return "#c62828";
    }}

    function donutDataForPercent(progressRaw) {{
      const pr = Number(progressRaw) || 0;
      const arc = Math.min(Math.max(pr, 0), 100);
      const colorKey = pr >= 100 ? 100 : pr;
      const fill = getProgressColor(colorKey);
      const track = "#eceff1";
      return {{
        datasets: [
          {{
            data: arc >= 100 ? [100, 0] : [arc, 100 - arc],
            backgroundColor: [fill, track],
            borderWidth: 0,
            hoverOffset: 0,
          }},
        ],
      }};
    }}

    function miniDonutOptions() {{
      return {{
        type: "doughnut",
        options: {{
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 1,
          cutout: "70%",
          plugins: {{
            legend: {{ display: false }},
            tooltip: {{
              filter: (item) => item.dataIndex === 0,
              callbacks: {{
                label(ctx) {{
                  const v = ctx.raw;
                  return ` ${{Math.round(v * 10) / 10}}%`;
                }},
              }},
            }},
          }},
        }},
      }};
    }}

    function renderRoutine(rows) {{
      const totalFact = rows.reduce((s, r) => s + (Number(r.fact) || 0), 0);
      const totalGoal = rows.reduce((s, r) => s + (Number(r.goal) || 0), 0);
      const totalPercent = totalGoal > 0 ? Math.round((totalFact / totalGoal) * 100) : 0;

      const kpi = document.getElementById("kpi");
      kpi.textContent = `Общий прогресс: ${{totalFact}}/${{totalGoal}} (${{totalPercent}}%)`;
      kpi.style.color = getProgressColor(totalPercent);

      const host = document.getElementById("sphereDonuts");
      host.innerHTML = "";
      rows.forEach((r, idx) => {{
        const pr = Number(progressData[idx]) || 0;
        const cell = document.createElement("div");
        cell.className = "donut-cell";
        const wrap = document.createElement("div");
        wrap.className = "donut-canvas-wrap";
        const cv = document.createElement("canvas");
        wrap.appendChild(cv);
        cell.appendChild(wrap);
        const name = document.createElement("div");
        name.className = "donut-name";
        name.textContent = r.sphere;
        cell.appendChild(name);
        const st = document.createElement("div");
        st.className = "donut-stat";
        st.textContent = `${{r.fact}}/${{r.goal}} (${{Math.round(pr)}}%)`;
        cell.appendChild(st);
        host.appendChild(cell);

        new Chart(cv, {{
          ...miniDonutOptions(),
          data: donutDataForPercent(pr),
        }});
      }});
    }}

    renderRoutine(rows);

    radarCfg.options = {{
      ...radarCfg.options,
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      plugins: {{
        ...radarCfg.options.plugins,
        legend: {{ display: true, position: "bottom", labels: {{ boxWidth: 10, font: {{ size: 11 }} }} }},
      }},
      scales: {{
        r: {{
          min: 0,
          max: 1,
          ticks: {{ stepSize: 0.2, font: {{ size: 10 }} }},
          pointLabels: {{ font: {{ size: 10 }} }},
        }}
      }}
    }};

    new Chart(document.getElementById("radarChart"), radarCfg);
    setTimeout(() => {{ window.__chartsReady = true; }}, 180);
  </script>
</body>
</html>
"""

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 820, "height": 1180})
        await page.set_content(html, wait_until="networkidle")
        await page.wait_for_function("window.__chartsReady === true", timeout=10000)
        await asyncio.sleep(0.08)
        combined_el = await page.query_selector("#combinedWrap")
        if not combined_el:
            await browser.close()
            raise RuntimeError("chart_elements_not_found")
        await combined_el.screenshot(path=str(combined_path))
        await browser.close()

    return str(combined_path)


def cleanup_rendered_image(path: str) -> None:
    parent = Path(path).parent
    if parent.exists():
        shutil.rmtree(parent, ignore_errors=True)


async def render_sport_image(payload: dict) -> str:
    from playwright.async_api import async_playwright

    sport = payload.get("sport", {})
    sport_by_type = payload.get("sportByType", {})
    out_dir = Path(tempfile.mkdtemp(prefix="sport-charts-"))
    sport_path = out_dir / SPORT_IMAGE

    html = f"""
<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {{ margin: 0; padding: 16px; background: #f6f7fb; font-family: Arial, sans-serif; }}
    .card {{ background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }}
    .col-sport h3, .col-sport-type h3 {{ margin-top: 0; }}
    .donut-grid {{
      display: flex;
      flex-wrap: wrap;
      gap: 14px 12px;
      justify-content: flex-start;
      margin-top: 4px;
    }}
    .donut-cell {{ width: 92px; text-align: center; }}
    .donut-cell .donut-canvas-wrap {{
      height: 88px;
      margin: 0 auto 6px;
      position: relative;
    }}
    .donut-cell canvas {{ max-width: 100%; max-height: 100%; }}
    .donut-name {{
      font-size: 12px;
      font-weight: 600;
      color: #333;
      line-height: 1.25;
      word-break: break-word;
    }}
    .donut-stat {{
      font-size: 11px;
      color: #666;
      margin-top: 2px;
    }}
    .type-metric-row {{
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 18px 24px;
      margin-top: 4px;
    }}
    .type-metric-column {{
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }}
    .type-metric-column .donut-cell {{ width: 100px; }}
    .type-metric-column .donut-cell .donut-canvas-wrap {{ height: 96px; }}
    .type-stat-card {{
      min-width: 100px;
      max-width: 140px;
      padding: 12px 14px;
      border-radius: 16px;
      text-align: center;
      background: linear-gradient(145deg, #f8fafc 0%, #eef2f7 100%);
      border: 1px solid #cfd8dc;
      box-shadow: 0 2px 10px rgba(55, 71, 79, 0.08);
    }}
    .type-stat-card .stat-value {{
      font-size: 32px;
      font-weight: 700;
      line-height: 1.1;
      color: #263238;
      letter-spacing: -0.02em;
    }}
    .type-stat-card .stat-label {{
      margin-top: 8px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.35;
      color: #546e7a;
    }}
    .stack {{ display: flex; flex-direction: column; gap: 16px; }}
    #sportMinWrap {{ width: 760px; }}
    #sportTypeWrap {{ width: 760px; }}
  </style>
</head>
<body>
  <div id="combinedWrap" class="stack">
    <div id="sportMinWrap" class="card col-sport">
      <h3>Sport by min</h3>
      <div id="sportKpi"></div>
      <div id="sportDonuts" class="donut-grid"></div>
    </div>
    <div id="sportTypeWrap" class="card col-sport-type">
      <h3>Sport by type</h3>
      <div id="sportTypeRow" class="type-metric-row"></div>
    </div>
  </div>
  <script>
    const sport = {json.dumps(sport, ensure_ascii=False)};
    const sportByType = {json.dumps(sport_by_type, ensure_ascii=False)};

    function getProgressColor(p) {{
      if (p >= 100) return "#2e7d32";
      if (p >= 50) return "#f9a825";
      return "#c62828";
    }}

    function donutDataForPercent(progressRaw) {{
      const pr = Number(progressRaw) || 0;
      const arc = Math.min(Math.max(pr, 0), 100);
      const colorKey = pr >= 100 ? 100 : pr;
      const fill = getProgressColor(colorKey);
      const track = "#eceff1";
      return {{
        datasets: [
          {{
            data: arc >= 100 ? [100, 0] : [arc, 100 - arc],
            backgroundColor: [fill, track],
            borderWidth: 0,
            hoverOffset: 0,
          }},
        ],
      }};
    }}

    function miniDonutOptions() {{
      return {{
        type: "doughnut",
        options: {{
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 1,
          cutout: "70%",
          plugins: {{
            legend: {{ display: false }},
            tooltip: {{
              filter: (item) => item.dataIndex === 0,
              callbacks: {{
                label(ctx) {{
                  const v = ctx.raw;
                  return ` ${{Math.round(v * 10) / 10}}%`;
                }},
              }},
            }},
          }},
        }},
      }};
    }}

    function renderSport(sport) {{
      const kpiEl = document.getElementById("sportKpi");
      const host = document.getElementById("sportDonuts");
      host.innerHTML = "";
      if (!sport || typeof sport.totalMinutes !== "number") {{
        kpiEl.textContent = "Спорт: данных нет";
        return;
      }}

      const goal = Number(sport.goalTotalMinutes != null ? sport.goalTotalMinutes : sport.goalMinutes) || 0;
      const total = Number(sport.totalMinutes) || 0;
      const pTotal = typeof sport.progress === "number" ? sport.progress : (goal > 0 ? Math.round((total / goal) * 1000) / 10 : 0);
      const title = sport.monthTitle || "";
      kpiEl.textContent = `Итог ${{title}}: ${{total}} / ${{goal}} (${{pTotal}}%)`;
      kpiEl.style.color = getProgressColor(pTotal);

      const cols = Array.isArray(sport.byMinColumn) ? sport.byMinColumn : [];
      cols.forEach((c) => {{
        const pr = Number(c.progress) || 0;
        const m = Number(c.minutes) || 0;
        const g = Number(c.goalPart) || 0;
        const short = (c.shortLabel && String(c.shortLabel).trim()) || String(c.label || "").replace(/, min$/i, "").trim();
        const cell = document.createElement("div");
        cell.className = "donut-cell";
        const wrap = document.createElement("div");
        wrap.className = "donut-canvas-wrap";
        const cv = document.createElement("canvas");
        wrap.appendChild(cv);
        cell.appendChild(wrap);
        const name = document.createElement("div");
        name.className = "donut-name";
        name.textContent = short;
        cell.appendChild(name);
        const st = document.createElement("div");
        st.className = "donut-stat";
        st.textContent = `${{m}}/${{g}} мин (${{pr}}%)`;
        cell.appendChild(st);
        host.appendChild(cell);

        new Chart(cv, {{
          ...miniDonutOptions(),
          data: donutDataForPercent(pr),
        }});
      }});
    }}

    function isExcludedTypePill(p) {{
      const label = String(p.label || p.shortLabel || "").toLowerCase();
      const val = String(p.value || "");
      return label.includes("pace") || /^wt\\b/.test(label) || label.includes("вес") || /1899-12-30/.test(val);
    }}

    function formatTypePillValue(p) {{
      let v = p.value != null ? String(p.value).trim() : "";
      if (v === "") return "—";
      if (p.key === "hrCycling" || /cycling.*avr/i.test(p.label || "")) {{
        const n = Number(v);
        if (!isNaN(n)) return String(Math.round(n));
      }}
      return v;
    }}

    function pillMap_(pills) {{
      const list = (pills || []).filter((p) => !isExcludedTypePill(p));
      const map = {{}};
      list.forEach((p) => {{ if (p.key) map[p.key] = p; }});
      const find = (re) => list.find((p) => re.test(String(p.label || p.shortLabel || "")));
      if (!map.hrRunning) {{ const p = find(/heart\\s*rate\\s*running|running.*avr|пульс.*бег/i); if (p) map.hrRunning = p; }}
      if (!map.hrCycling) {{ const p = find(/heart\\s*rate\\s*cycling|cycling.*avr|пульс.*вел/i); if (p) map.hrCycling = p; }}
      return map;
    }}

    function appendTypeStatCard(host, pill) {{
      const label = (pill.shortLabel && String(pill.shortLabel).trim()) || String(pill.label || "").trim();
      const val = formatTypePillValue(pill);
      const card = document.createElement("div");
      card.className = "type-stat-card";
      card.innerHTML = `<div class="stat-value">${{val}}</div><div class="stat-label">${{label}}</div>`;
      host.appendChild(card);
    }}

    function appendTypeColumn(host, item, pill) {{
      const col = document.createElement("div");
      col.className = "type-metric-column";

      const pr = Number(item.progress) || 0;
      const f = Number(item.fact) || 0;
      const g = Number(item.goal) || 0;
      const name = (item.shortLabel && String(item.shortLabel).trim()) || String(item.label || "").trim();

      const cell = document.createElement("div");
      cell.className = "donut-cell";
      const wrap = document.createElement("div");
      wrap.className = "donut-canvas-wrap";
      const cv = document.createElement("canvas");
      wrap.appendChild(cv);
      cell.appendChild(wrap);
      const nameEl = document.createElement("div");
      nameEl.className = "donut-name";
      nameEl.textContent = name;
      cell.appendChild(nameEl);
      const st = document.createElement("div");
      st.className = "donut-stat";
      st.textContent = `${{f}}/${{g}} (${{pr}}%)`;
      cell.appendChild(st);
      col.appendChild(cell);

      new Chart(cv, {{
        ...miniDonutOptions(),
        data: donutDataForPercent(pr),
      }});

      if (pill) appendTypeStatCard(col, pill);
      host.appendChild(col);
    }}

    function renderSportByType(sportByType) {{
      const host = document.getElementById("sportTypeRow");
      host.innerHTML = "";
      if (!sportByType || !Array.isArray(sportByType.byTypeColumn)) return;
      const cols = sportByType.byTypeColumn;
      const pmap = pillMap_(sportByType.statPills);
      if (cols[0]) appendTypeColumn(host, cols[0], pmap.hrRunning);
      if (cols[1]) appendTypeColumn(host, cols[1], pmap.hrCycling);
    }}

    renderSport(sport);
    renderSportByType(sportByType);
    setTimeout(() => {{ window.__chartsReady = true; }}, 180);
  </script>
</body>
</html>
"""

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 820, "height": 1180})
        await page.set_content(html, wait_until="networkidle")
        await page.wait_for_function("window.__chartsReady === true", timeout=10000)
        await asyncio.sleep(0.08)
        combined_el = await page.query_selector("#combinedWrap")
        if not combined_el:
            await browser.close()
            raise RuntimeError("chart_elements_not_found")
        await combined_el.screenshot(path=str(sport_path))
        await browser.close()

    return str(sport_path)
