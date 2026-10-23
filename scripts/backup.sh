#!/usr/bin/env bash
# Linux 本地数据库备份。配置优先级：环境变量 > backend/.env > 默认值。
# 依赖 mysqldump、gzip；默认保留 30 天。恢复操作由管理员按备份和停机计划单独执行。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
read_env() {
  local key value
  [ -f "$PROJECT_ROOT/backend/.env" ] || return 0
  while IFS='=' read -r key value; do
    if [ "$key" = "$1" ]; then
      value="${value%$'\r'}"
      if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; fi
      printf '%s' "$value"
      return 0
    fi
  done < "$PROJECT_ROOT/backend/.env"
}

DB_DATABASE="${DB_DATABASE:-$(read_env DB_DATABASE)}"
DB_DATABASE="${DB_DATABASE:-app_starter}"
DB_HOST="${DB_HOST:-$(read_env DB_HOST)}"
DB_PORT="${DB_PORT:-$(read_env DB_PORT)}"
DB_USERNAME="${DB_USERNAME:-$(read_env DB_USERNAME)}"
DB_PASSWORD="${DB_PASSWORD:-$(read_env DB_PASSWORD)}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-mysqldump}"

[[ "$DB_DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || { echo '数据库名只能包含字母、数字和下划线' >&2; exit 1; }
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || { echo 'KEEP_DAYS 必须为非负整数' >&2; exit 1; }
command -v "$MYSQLDUMP_BIN" >/dev/null || { echo '请安装 mysqldump 或配置 MYSQLDUMP_BIN' >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
umask 077
file="$BACKUP_DIR/$DB_DATABASE-$(date '+%Y%m%d-%H%M%S').sql.gz"
temp="$(mktemp "$BACKUP_DIR/.backup-XXXXXX")"
trap 'rm -f -- "$temp"' EXIT

# 密码通过子进程环境传递，避免放在命令行参数中。
MYSQL_PWD="$DB_PASSWORD" "$MYSQLDUMP_BIN" \
  --host="${DB_HOST:-localhost}" --port="${DB_PORT:-3306}" --user="${DB_USERNAME:-root}" \
  --single-transaction --routines --triggers "$DB_DATABASE" | gzip > "$temp"
gzip -t "$temp"
mv -- "$temp" "$file"
find "$BACKUP_DIR" -maxdepth 1 -type f -name "$DB_DATABASE-*.sql.gz" -mtime +"$KEEP_DAYS" -delete
printf '备份完成：%s\n' "$(basename "$file")"
