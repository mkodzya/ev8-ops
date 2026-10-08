#!/bin/bash
# Carry the static part of the test stand to production (Mika, 08.10.2026):
# models, points and customer cards — clients and suppliers — and, when asked
# with --mopeds, the list of mopeds (apps/api/src/copyStatic.ts). Mika runs it:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/copy-static-to-prod.sh
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/copy-static-to-prod.sh --commit
#
# The first line only checks and writes nothing; the second writes. Everything
# is checked first either way, and one problem anywhere means nothing is
# written. It can be run again: a row that is already on production is found
# by its id; while production has no rentals a row that changed on the test
# stand is brought up to date, and once it has them only new rows are added.
#
# What changes by the day is not carried. The mopeds go only with --mopeds,
# and then each arrives "available", with its park and its point but no
# rental: who rides it comes with the rentals (deploy/load-rentals.sh --prod).
# Rentals, money, sales, repairs, the stock, the journal, customers' files and
# people's logins stay where they are.
#
# The rows hold customers' phones and personal numbers. They go from the test
# stand's API container to production's through a pipe on this server and are
# never stored: not a file, not an argument, not a log. The report is counts,
# and a name only where a row is a problem.
#
# Before a write production's database is copied, and the copy is proven to
# restore; a copy that does not restore stops the write before anything
# changes. Both stands have to run a release that knows this command.
#
# A Claude session does not run this script: the owner does.
set -euo pipefail

SELF="ssh root@204.168.149.105 /srv/ev8-ops/deploy/copy-static-to-prod.sh"
COMMIT=""
OWNER=""
MOPEDS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) COMMIT=--commit ;;
    --mopeds) MOPEDS=--mopeds ;;
    --owner)
      [ $# -ge 2 ] || { echo "После --owner нужен e-mail владельца на боевом стенде. Ничего не сделано."; exit 2; }
      OWNER=$2; shift
      # An address and nothing else: it becomes an argument of a command.
      case "$OWNER" in ""|-*|*[!A-Za-z0-9@._+-]*) echo "«$OWNER» не похоже на e-mail. Ничего не сделано."; exit 2;; esac
      ;;
    *) echo "Не понимаю «$1». Без добавок — проверка; --commit — запись; --mopeds — вместе с мопедами; --owner e-mail — от чьего имени. Ничего не сделано."; exit 2 ;;
  esac
  shift
done

FROM=(docker compose -p ev8-test --env-file /srv/ev8-ops/.env.test -f /srv/ev8-ops/docker-compose.prod.yml)
TO=(docker compose -p ev8-prod --env-file /srv/ev8-prod/.env.prod -f /srv/ev8-prod/docker-compose.prod.yml)
[ -f /srv/ev8-ops/.env.test ] && [ -f /srv/ev8-prod/.env.prod ] || { echo "Нет файла настроек одного из стендов. Ничего не сделано."; exit 1; }

for stand in ev8-test ev8-prod; do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$stand-api-1" 2>/dev/null < /dev/null)" = healthy ] \
    || { echo "Стенд $stand сейчас не отвечает. Ничего не сделано. Смотреть: docker compose -p $stand logs api"; exit 1; }
done
"${FROM[@]}" exec -T api test -f src/copyStatic.ts < /dev/null \
  || { echo "На тестовом стенде ещё нет этой команды: на нём старая версия. Ничего не сделано."; exit 1; }
"${TO[@]}" exec -T api test -f src/copyStatic.ts < /dev/null \
  || { echo "На боевом стенде ещё нет этой команды: на нём версия старше той, в которой она появилась. Ничего не сделано."; exit 1; }

echo "С тестового стенда https://test.ops.ev8.ge — на БОЕВОЙ https://ops.ev8.ge"

# Production is copied before it is written to, and the copy is proven to
# restore — the same rule as before a release (deploy-prod.sh).
if [ -n "$COMMIT" ]; then
  echo "Сначала копия боевой базы, с проверкой восстановления…"
  COPY=/tmp/ev8-prod-backup.log
  if ! ( cd /srv/ev8-ops && BACKUP_DIR=/srv/ev8-backups deploy/backup.sh ev8-prod ) > "$COPY" 2>&1 < /dev/null; then
    tail -3 "$COPY"
    echo "Копия боевой базы не снялась или не восстановилась. Ничего не записано."
    exit 1
  fi
  echo "Копия снята и восстанавливается."
fi

# One stand writes its rows out, the other reads them in; between them a pipe.
set +e
# shellcheck disable=SC2086 — a word or none, on purpose
"${FROM[@]}" exec -T api npx tsx src/copyStatic.ts export < /dev/null 2> /dev/null \
  | "${TO[@]}" exec -T api npx tsx src/copyStatic.ts import $COMMIT $MOPEDS ${OWNER:+--owner "$OWNER"}
CODES=("${PIPESTATUS[@]}")
set -e
CODE=${CODES[1]}

echo
if [ "${CODES[0]}" != 0 ]; then
  echo "Тестовый стенд не отдал данные целиком (код ${CODES[0]}); что с ними стало на боевом — в отчёте выше. Это нужно показать разработчику."
  [ "$CODE" != 0 ] && exit "$CODE"
  exit 1
fi
case "$CODE" in
  0)
    if [ -n "$COMMIT" ]; then
      echo "Проверка: https://ops.ev8.ge → «Парк», «Клиенты», «Модели»; точки — в «Настройках»."
    else
      echo "Чтобы записать — та же команда с --commit:"
      echo "  $SELF --commit${MOPEDS:+ $MOPEDS}${OWNER:+ --owner $OWNER}"
    fi
    ;;
  1) echo "Проблемы названы выше: их правят на том стенде, где они есть, и проверку запускают ещё раз." ;;
  2) echo "Перенос не начался — причина выше." ;;
  *) echo "Это нужно показать разработчику (код $CODE)." ;;
esac
exit "$CODE"
