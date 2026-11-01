#!/bin/bash
# How far a stand sends the rent reminders through Kommo (issue #20, ADR-0053).
# Mika runs it; it writes one line, REMINDERS_SEND, into the stand's env file
# and restarts the API. Nothing else changes and nothing is sent by the script.
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-reminders.sh test
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-reminders.sh --prod test
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-reminders.sh --prod on
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-reminders.sh --prod off
#
#   off  — decided and written, sent nowhere (the default, as in step 1);
#   test — sent only to the test deals listed in Settings → Reminders;
#   on   — sent to every customer the schedule names.
#
# The test stand is the default and is refused `on`: it holds a copy of
# production's customers (deploy/copy-prod-to-test.sh), and a message from it
# would reach a real person. Production is named out loud, with --prod. An
# owner can also pause sending on any stand from Settings → Reminders; that
# needs no server and is the first thing to reach for when something is wrong.
set -euo pipefail

STAND=test
MODE=""
for arg in "$@"; do
  case "$arg" in
    --prod) STAND=prod ;;
    off|test|on) MODE="$arg" ;;
    *) echo "Не понимаю «$arg». Нужно одно из: off, test, on; --prod — боевой стенд. Ничего не изменено."; exit 2 ;;
  esac
done
[ -n "$MODE" ] || { echo "Скажите, что включить: off, test или on. Ничего не изменено."; exit 2; }

if [ "$STAND" = prod ]; then
  DIR=/srv/ev8-prod; PROJECT=ev8-prod; ENV=.env.prod; URL=https://ops.ev8.ge; NAME="боевой стенд"
else
  DIR=/srv/ev8-ops; PROJECT=ev8-test; ENV=.env.test; URL=https://test.ops.ev8.ge; NAME="тестовый стенд"
  [ "$MODE" != on ] || { echo "На тестовом стенде «on» нельзя: там копия боевых клиентов, сообщение ушло бы настоящему человеку. Для проверки — «test». Ничего не изменено."; exit 1; }
fi
cd "$DIR"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV" -f docker-compose.prod.yml)
[ -f "$ENV" ] || { echo "Нет файла $DIR/$ENV."; exit 1; }

# A release older than step 2 would take the line and do nothing with it.
"${COMPOSE[@]}" exec -T api grep -q REMINDERS_SEND src/lib/reminders.ts < /dev/null \
  || { echo "На этом стенде ($NAME) ещё нет отправки напоминаний: версия старше той, в которой она появилась. Ничего не изменено."; exit 1; }

tmp=$(mktemp "$ENV.XXXXXX")
chmod 600 "$tmp"
grep -v '^REMINDERS_SEND=' "$ENV" > "$tmp" || true
[ "$MODE" = off ] || printf 'REMINDERS_SEND=%s\n' "$MODE" >> "$tmp"
mv "$tmp" "$ENV"

echo "Перезапускаю $NAME…"
"${COMPOSE[@]}" up -d api > /dev/null 2>&1 < /dev/null || { echo "Стенд не перезапустился. Смотреть: docker compose -p $PROJECT logs api"; exit 1; }
for _ in $(seq 1 30); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "$PROJECT-api-1" 2>/dev/null < /dev/null)" = healthy ]; then
    case "$MODE" in
      off)  echo "Готово ($NAME): напоминания решаются и записываются, но не отправляются." ;;
      test) echo "Готово ($NAME): напоминания уходят только на тестовые сделки из «Настройки → Напоминания»." ;;
      on)   echo "Готово ($NAME): напоминания уходят всем клиентам в 12:00 и 18:00." ;;
    esac
    echo "Проверка: $URL → «Настройки → Напоминания». Остановить сразу — кнопка «Поставить на паузу» там же."
    exit 0
  fi
  sleep 2
done
echo "Стенд не поднялся за минуту. Смотреть: docker compose -p $PROJECT logs api"; exit 1
