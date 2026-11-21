# TablePlus — подключение к life-dashboard

Таблицы питания живут в **Docker Postgres**, не в SQLite и не в Sheets.

| Параметр | Значение |
|----------|----------|
| Host | `127.0.0.1` |
| Port | `5432` |
| User | `life` |
| Password | `life` |
| Database | `life_dashboard` |

После миграции должны быть: `products`, `nutrition_log`, `nutrition_targets`.

Проверка в терминале:

```bash
docker exec life_dashboard_pg psql -U life -d life_dashboard -c "\dt"
```

Если таблиц нет — применить миграцию:

```bash
docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/001_nutrition.sql
```

В TablePlus: правый клик на схему `public` → **Refresh** (или переподключиться).
