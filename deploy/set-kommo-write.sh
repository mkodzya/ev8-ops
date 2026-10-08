#!/bin/bash
# Say whether the test stand writes payment notes into Kommo deals (step 2 of
# the Kommo link, ADR-0013). Mika runs it.
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-kommo-write.sh only 12345678
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-kommo-write.sh off
#
# The test stand talks to the real Kommo account. A payment entered here to
# try the system out must not land in a real customer's deal, so this stand
# does not write at all unless told, and when told it writes to the deals
# named here and to no other: `only <deal> [<deal> …]` — the number at the
# end of a deal's address in Kommo, .../leads/detail/12345678. Make a test
# deal in Kommo, give a test customer here its link, take a payment on that
# customer's rental, and the note appears in the test deal within five
# minutes.
#
# There is deliberately no `on` here: writing to every deal belongs to the
# stand the business runs on. Production gets KOMMO_WRITE=on in .env.prod
# with the release that starts the work there, on Mika's word.
#
# Payments entered before writing was first switched on are never written.
set -euo pipefail

cd /srv/ev8-ops
ENV=.env.test
COMPOSE=(docker compose -p ev8-test --env-file "$ENV" -f docker-compose.prod.yml)
[ -f "$ENV" ] || { echo "Нет файла $ENV."; exit 1; }

usage() { echo "Как запускать: set-kommo-write.sh only <номер сделки> [<номер сделки> …]   или   set-kommo-write.sh off"; exit 1; }

case "${1:-}" in
  off)
    VALUE=""
    ;;
  only)
    shift
    [ $# -ge 1 ] || usage
    for id in "$@"; do
      case "$id" in ''|*[!0-9]*) echo "«$id» — не номер сделки: нужны только цифры из адреса сделки в Kommo. Ничего не изменено."; exit 1;; esac
    done
    VALUE="only:$(IFS=,; echo "$*")"
    ;;
  *)
    usage
    ;;
esac

grep -q '^KOMMO_TOKEN=.' "$ENV" || [ -z "$VALUE" ] || { echo "На стенде нет токена Kommo — сначала set-kommo-token.sh. Ничего не изменено."; exit 1; }

tmp=$(mktemp "$ENV.XXXXXX")
chmod 600 "$tmp"
grep -v '^KOMMO_WRITE=' "$ENV" > "$tmp" || true
[ -z "$VALUE" ] || printf 'KOMMO_WRITE=%s\n' "$VALUE" >> "$tmp"
mv "$tmp" "$ENV"

echo "Перезапускаю тестовый стенд…"
"${COMPOSE[@]}" up -d api > /dev/null 2>&1 || { echo "Стенд не перезапустился. Смотреть: docker compose -p ev8-test logs api"; exit 1; }
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' ev8-test-api-1 2>/dev/null)" = healthy ] && break
  sleep 2
done

if [ -z "$VALUE" ]; then
  echo "Готово: тестовый стенд ничего не пишет в Kommo."
else
  echo "Готово: тестовый стенд пишет заметки об оплатах только в сделки: $*."
  echo "Проверка: оплата по аренде клиента с этой сделкой → через пять минут заметка в сделке Kommo."
  echo "Что отправлено и что не ушло — https://test.ops.ev8.ge/settings/kommo, блок «Заметки об оплатах в Kommo»."
fi
