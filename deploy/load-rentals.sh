#!/bin/bash
# Bring running rentals over to a stand from a list (layer 3 of the move;
# apps/api/src/loadRentals.ts). Mika runs it from his own machine. The list
# stays on that machine and comes here on standard input, over ssh:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/load-rentals.sh < rentals-to-load.json
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/load-rentals.sh --commit < rentals-to-load.json
#
# The first line only checks the list and writes nothing; the second writes.
# The list is checked whole either way, and one problem anywhere means nothing
# is written. A rental that is already on the stand is skipped, so the same
# list — or the same list with rows added — can be run again.
#
# The test stand is the default. Production is named out loud, with --prod:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/load-rentals.sh --prod < rentals-to-load.json
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/load-rentals.sh --prod --commit < rentals-to-load.json
#
# Before a write to production its database is copied, with the same restore
# check as the nightly copy; a copy that does not restore stops the write
# before anything changes. Like deploy-prod.sh, this script is read from the
# test checkout and works on /srv/ev8-prod when told to.
#
# The list names customers' deals and where their mopeds stand at night, so it
# is piped straight into the API container and is never stored on this server:
# it is not a file, not an argument of any command and not in any log. What
# comes back is a report with the row's label, the end of the VIN and the
# customer's name as the stand has it — no phone, personal number or address.
#
# The rentals are written in the name of the stand's owner, through the same
# function the hand-over wizard calls. While the stand has one owner nobody
# needs naming; once it has several, `--owner <e-mail>` says which. The env
# file's OWNER_EMAIL is not asked: it only seeds the first login of an empty
# database, and on the test stand it holds a placeholder.
#
# A Claude session does not run this script, on either stand: it prepares the
# list, the owner brings the rentals over.
set -euo pipefail

SELF="ssh root@204.168.149.105 /srv/ev8-ops/deploy/load-rentals.sh"
STAND=test
COMMIT=""
OWNER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prod) STAND=prod ;;
    --commit) COMMIT=--commit ;;
    --owner)
      [ $# -ge 2 ] || { echo "После --owner нужен e-mail владельца. Ничего не сделано."; exit 2; }
      OWNER=$2; shift
      # An address and nothing else: it becomes an argument of a command.
      case "$OWNER" in ""|-*|*[!A-Za-z0-9@._+-]*) echo "«$OWNER» не похоже на e-mail. Ничего не сделано."; exit 2;; esac
      ;;
    *) echo "Не понимаю «$1». Без добавок — проверка списка на тестовом стенде, --commit — запись, --prod — боевой стенд. Ничего не сделано."; exit 2 ;;
  esac
  shift
done

if [ "$STAND" = prod ]; then
  DIR=/srv/ev8-prod; PROJECT=ev8-prod; ENV=.env.prod; URL=https://ops.ev8.ge
  NAME="БОЕВОЙ стенд"; ON="На боевом стенде"; FLAG=" --prod"
else
  DIR=/srv/ev8-ops; PROJECT=ev8-test; ENV=.env.test; URL=https://test.ops.ev8.ge
  NAME="Тестовый стенд"; ON="На тестовом стенде"; FLAG=""
fi
cd "$DIR"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV" -f docker-compose.prod.yml)
[ -f "$ENV" ] || { echo "Нет файла $DIR/$ENV. Ничего не сделано."; exit 1; }

# The list is whatever comes on standard input; a terminal there means no list.
if [ -t 0 ]; then
  echo "Список не передан. Он приходит из файла на вашем компьютере:"
  echo "  $SELF$FLAG < путь/к/списку.json"
  exit 2
fi

# Every command before the loader reads from /dev/null: anything that read
# standard input here would swallow the list.
[ "$(docker inspect -f '{{.State.Health.Status}}' "$PROJECT-api-1" 2>/dev/null < /dev/null)" = healthy ] \
  || { echo "$NAME сейчас не отвечает. Ничего не сделано. Смотреть: docker compose -p $PROJECT logs api"; exit 1; }
"${COMPOSE[@]}" exec -T api test -f src/loadRentals.ts < /dev/null \
  || { echo "$ON ещё нет загрузчика: на нём версия старше той, в которой он появился. Ничего не сделано."; exit 1; }

echo "$NAME $URL"

# Production is copied before it is written to, and the copy is proven to
# restore — the same rule as before a release (deploy-prod.sh).
if [ "$STAND" = prod ] && [ -n "$COMMIT" ]; then
  echo "Сначала копия боевой базы, с проверкой восстановления…"
  COPY=/tmp/ev8-prod-backup.log
  if ! ( cd /srv/ev8-ops && BACKUP_DIR=/srv/ev8-backups deploy/backup.sh ev8-prod ) > "$COPY" 2>&1 < /dev/null; then
    tail -3 "$COPY"
    echo "Копия боевой базы не снялась или не восстановилась. Ничего не записано."
    exit 1
  fi
  echo "Копия снята и восстанавливается."
fi

set +e
# shellcheck disable=SC2086 — one word or none, on purpose
"${COMPOSE[@]}" exec -T api npx tsx src/loadRentals.ts $COMMIT ${OWNER:+--owner "$OWNER"}
CODE=$?
set -e

echo
case "$CODE" in
  0)
    if [ -n "$COMMIT" ]; then
      echo "Проверка: $URL → «Аренды». В «Сегодня» строка «Расхождения с Kommo» уменьшается на число записанных аренд, чьи сделки стоят в Kommo в этапе аренды."
    else
      echo "Чтобы записать — та же команда с --commit:"
      echo "  $SELF$FLAG --commit${OWNER:+ --owner $OWNER} < тот же файл"
    fi
    ;;
  1) echo "Поправьте список и запустите проверку ещё раз." ;;
  2) echo "Загрузчик не начал работу — причина выше." ;;
  *) echo "Это нужно показать разработчику (код $CODE)." ;;
esac
exit "$CODE"
