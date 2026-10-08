#!/bin/bash
# Say whether a stand writes payment notes into Kommo deals (step 2 of the
# Kommo link, ADR-0013). Mika runs it.
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-kommo-write.sh only 12345678
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-kommo-write.sh off
#
# The test stand is the default, and it talks to the real Kommo account. A
# payment entered there to try the system out must not land in a real
# customer's deal, so the test stand does not write at all unless told, and
# when told it writes to the deals named here and to no other:
# `only <deal> [<deal> …]` — the number at the end of a deal's address in
# Kommo, .../leads/detail/12345678. Make a test deal in Kommo, give a test
# customer on the stand its link, take a payment on that customer's rental,
# and the note appears in the test deal within five minutes. The test stand
# refuses `on`.
#
# Production is named out loud, with --prod, and there `on` means what it
# says: from that minute every rental payment taken in EV8 Ops is written
# into its deal. It is switched on the day the work starts there, on Mika's
# word, and needs a release that carries step 2 — on an older one the script
# says so and writes nothing:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-kommo-write.sh --prod on
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-kommo-write.sh --prod off
#
# A payment made while a stand was not writing is never written, however the
# switch is turned afterwards: every change of it starts the writing from
# that moment. So switching production on does not send Kommo the payments
# the staff had already typed there by hand.
#
# Like deploy-prod.sh, this script is read from the test checkout and works
# on /srv/ev8-prod when told to.
set -euo pipefail

usage() {
  echo "Как запускать: set-kommo-write.sh only <номер сделки> [<номер сделки> …]   — тестовый стенд пишет только в эти сделки"
  echo "               set-kommo-write.sh off                                      — тестовый стенд не пишет в Kommo"
  echo "               set-kommo-write.sh --prod on | --prod off                   — боевой стенд"
  exit 2
}

STAND=test
if [ "${1:-}" = "--prod" ]; then STAND=prod; shift; fi

case "${1:-}" in
  off)
    VALUE=""
    ;;
  on)
    [ "$STAND" = prod ] || { echo "Тестовый стенд подключён к настоящему Kommo: писать во все сделки ему нельзя. Для проверки — only <номер тестовой сделки>. Ничего не изменено."; exit 2; }
    VALUE="on"
    ;;
  only)
    shift
    [ $# -ge 1 ] || usage
    for id in "$@"; do
      case "$id" in ''|*[!0-9]*) echo "«$id» — не номер сделки: нужны только цифры из адреса сделки в Kommo. Ничего не изменено."; exit 2;; esac
    done
    VALUE="only:$(IFS=,; echo "$*")"
    ;;
  *)
    usage
    ;;
esac

if [ "$STAND" = prod ]; then
  DIR=/srv/ev8-prod; PROJECT=ev8-prod; ENV=.env.prod; URL=https://ops.ev8.ge; NAME="боевой стенд"; ON="На боевом стенде"
else
  DIR=/srv/ev8-ops; PROJECT=ev8-test; ENV=.env.test; URL=https://test.ops.ev8.ge; NAME="тестовый стенд"; ON="На тестовом стенде"
fi
cd "$DIR"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV" -f docker-compose.prod.yml)
[ -f "$ENV" ] || { echo "Нет файла $DIR/$ENV."; exit 1; }

if [ -n "$VALUE" ]; then
  # A stand whose release is older than step 2 would take the switch and do
  # nothing with it; a stand with no token has nothing to write with.
  "${COMPOSE[@]}" exec -T api test -f src/lib/kommoNotes.ts < /dev/null \
    || { echo "$ON ещё нет записи заметок: на нём версия старше той, в которой она появилась. Ничего не изменено."; exit 1; }
  grep -q '^KOMMO_TOKEN=.' "$ENV" || { echo "$ON нет токена Kommo — сначала set-kommo-token.sh. Ничего не изменено."; exit 1; }
fi

tmp=$(mktemp "$ENV.XXXXXX")
chmod 600 "$tmp"
grep -v '^KOMMO_WRITE=' "$ENV" > "$tmp" || true
[ -z "$VALUE" ] || printf 'KOMMO_WRITE=%s\n' "$VALUE" >> "$tmp"
mv "$tmp" "$ENV"

echo "Перезапускаю $NAME…"
"${COMPOSE[@]}" up -d api > /dev/null 2>&1 < /dev/null || { echo "Стенд не перезапустился. Смотреть: docker compose -p $PROJECT logs api"; exit 1; }
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$PROJECT-api-1" 2>/dev/null < /dev/null)" = healthy ] && break
  sleep 2
done

case "$VALUE" in
  "")
    echo "Готово: $NAME ничего не пишет в Kommo. Оплаты, принятые, пока запись выключена, в Kommo не уйдут и после включения."
    ;;
  on)
    echo "Готово: с этой минуты оплата аренды, принятая на боевом стенде, сама появляется заметкой в сделке Kommo — в течение пяти минут."
    echo "Оплаты, введённые раньше, в Kommo не уйдут. Сотрудникам: оплату, принятую в EV8 Ops, в Kommo руками больше не писать."
    echo "Что отправлено и что не ушло — $URL/settings/kommo, блок «Заметки об оплатах в Kommo»."
    ;;
  *)
    echo "Готово: $NAME пишет заметки об оплатах только в сделки: ${VALUE#only:}."
    echo "Проверка: оплата по аренде клиента с этой сделкой → в течение пяти минут заметка в сделке Kommo."
    echo "Что отправлено и что не ушло — $URL/settings/kommo, блок «Заметки об оплатах в Kommo»."
    ;;
esac
