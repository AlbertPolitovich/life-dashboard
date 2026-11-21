#!/usr/bin/env bash
# Weekly life_dashboard dump on Selectel. Keep last KEEP dumps (~1 month if weekly).
# Install on VPS:
#   install -m 755 deploy/backup_life_dashboard.sh /opt/life-dashboard/scripts/backup_life_dashboard.sh
#   echo '20 3 * * 1 root /opt/life-dashboard/scripts/backup_life_dashboard.sh >> /var/log/life-dashboard-backup.log 2>&1' \
#     > /etc/cron.d/life-dashboard-backup
set -euo pipefail

CONTAINER="${LIFE_PG_CONTAINER:-life_dashboard_pg}"
DB_USER="${LIFE_PG_USER:-lifeapp}"
DB_NAME="${LIFE_PG_DB:-life_dashboard}"
BACKUP_DIR="${LIFE_BACKUP_DIR:-/opt/backups/life_dashboard}"
KEEP="${LIFE_BACKUP_KEEP:-5}"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/life_dashboard_${STAMP}.dump"
LOG_TAG="life-dashboard-backup"

mkdir -p "$BACKUP_DIR"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  logger -t "$LOG_TAG" "FAIL: container $CONTAINER not found"
  echo "container $CONTAINER not found" >&2
  exit 1
fi

# Custom format (-Fc): compressed, restorable with pg_restore
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc --no-owner --no-acl "$DB_NAME" > "$OUT.tmp"
mv -f "$OUT.tmp" "$OUT"
chmod 600 "$OUT"

# prune old dumps, keep newest KEEP
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/life_dashboard_*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" || true)
for f in "${OLD[@]:-}"; do
  [[ -n "$f" ]] || continue
  rm -f -- "$f"
done

SIZE="$(du -h "$OUT" | awk '{print $1}')"
COUNT="$(ls -1 "$BACKUP_DIR"/life_dashboard_*.dump 2>/dev/null | wc -l | tr -d ' ')"
logger -t "$LOG_TAG" "OK $OUT size=$SIZE keep=$COUNT/$KEEP"
echo "OK $OUT size=$SIZE files=$COUNT (keep $KEEP)"
