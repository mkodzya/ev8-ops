#!/bin/bash
# Bring running rentals over to the test stand from a list (layer 3 of the
# move; apps/api/src/loadRentals.ts). Mika runs it from his own machine. The
# list stays on that machine and comes here on standard input, over ssh:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/load-rentals.sh < rentals-to-load.json
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/load-rentals.sh --commit < rentals-to-load.json
#
# The first line only checks the list and writes nothing; the second writes.
# The list is checked whole either way, and one problem anywhere means nothing
# is written. A rental that is already on the stand is skipped, so the same
# list — or the same list with rows added — can be run again.
#
# The list names customers' deals and where their mopeds stand at night, so it
# is piped straight into the API container and is never stored on this server:
# it is not a file, not an argument of any command and not in any log. What
# comes back is a report with the row's label, the end of the VIN and the
# customer's name as the stand has it — no phone, personal number or address.
#
# The rentals are written in the name of this stand's own owner (OWNER_EMAIL
# in .env.test), through the same function the hand-over wizard calls.
#
# A Claude session does not run this script: it prepares the list, the owner
# brings the rentals over. Production is not touched: its rentals come over
# on Mika's word, with a script of its own.
set -euo pipefail

cd /srv/ev8-ops
ENV=.env.test
COMPOSE=(docker compose -p ev8-test --env-file "$ENV" -f docker-compose.prod.yml)
[ -f "$ENV" ] || { echo "Нет файла $ENV."; exit 1; }

COMMIT=""
case "${1:-}" in
  "") ;;
  --commit) COMMIT=--commit ;;
  *) echo "Не понимаю «$1». Без добавок — проверка списка, с --commit — запись. Ничего не сделано."; exit 2 ;;
esac
[ $# -le 1 ] || { echo "Лишние слова после «$1». Ничего не сделано."; exit 2; }

# The list is whatever comes on standard input; a terminal there means no list.
if [ -t 0 ]; then
  echo "Список не передан. Он приходит из файла на вашем компьютере:"
  echo "  ssh root@204.168.149.105 /srv/ev8-ops/deploy/load-rentals.sh < путь/к/списку.json"
  exit 2
fi

OWNER=$(sed -n 's/^OWNER_EMAIL=//p' "$ENV" | tail -n 1 | tr -d "\"'[:space:]")
[ -n "$OWNER" ] || { echo "В $ENV нет OWNER_EMAIL: не от чьего имени писать. Ничего не сделано."; exit 1; }

# Every command before the loader reads from /dev/null: anything that read
# standard input here would swallow the list.
[ "$(docker inspect -f '{{.State.Health.Status}}' ev8-test-api-1 2>/dev/null < /dev/null)" = healthy ] \
  || { echo "Тестовый стенд сейчас не отвечает. Ничего не сделано. Смотреть: docker compose -p ev8-test logs api"; exit 1; }
"${COMPOSE[@]}" exec -T api test -f src/loadRentals.ts < /dev/null \
  || { echo "На тестовом стенде ещё нет загрузчика: на нём старая версия. Ничего не сделано; это нужно показать разработчику."; exit 1; }

echo "Тестовый стенд https://test.ops.ev8.ge"
set +e
# shellcheck disable=SC2086 — one word or none, on purpose
"${COMPOSE[@]}" exec -T api npx tsx src/loadRentals.ts --owner "$OWNER" $COMMIT
CODE=$?
set -e

echo
case "$CODE" in
  0)
    if [ -n "$COMMIT" ]; then
      echo "Проверка: https://test.ops.ev8.ge → «Аренды». В «Сегодня» строка «Расхождения с Kommo» уменьшается на число записанных аренд, чьи сделки стоят в Kommo в этапе аренды."
    else
      echo "Чтобы записать — та же команда с --commit:"
      echo "  ssh root@204.168.149.105 /srv/ev8-ops/deploy/load-rentals.sh --commit < тот же файл"
    fi
    ;;
  1) echo "Поправьте список и запустите проверку ещё раз." ;;
  2) echo "Загрузчик не начал работу — причина выше." ;;
  *) echo "Это нужно показать разработчику (код $CODE)." ;;
esac
exit "$CODE"
