#!/bin/bash
# Switch on the Kommo link (ADR-0012) on a stand. Mika runs it, and pastes the
# integration's long-lived token here: it is read without echo, written only
# into the stand's env file (mode 600) and passed to the API container as an
# environment variable. It never appears in the shell history, the process
# list, the output or any log, and it is never an argument of any command.
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-kommo-token.sh
#
# The token is issued in Kommo by an administrator: Settings → Integrations →
# the private integration "EV8 Ops" → Keys and scopes → Generate long-lived
# token. Kommo shows it once. It gives that integration an administrator's
# reach into the account for as long as it is valid (up to five years), so it
# is kept nowhere but here; a token that leaked is revoked in the same place
# by generating a new one.
#
# After writing it the script asks Kommo once, through the stand itself, and
# says whether Kommo let it in and how many deals stand in the rented stage.
# What comes back is a count and one word — no names.
# With --off the token is removed and the link goes quiet: no row in "Today",
# no list, no requests to Kommo.
#
# The test stand is the default. Production is named out loud, with --prod,
# and needs a release that carries the link (1.3.0 or later) — on an older
# one the script says so and writes nothing:
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-kommo-token.sh --prod
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-kommo-token.sh --prod --from-test
#
# --from-test gives production the token the test stand already holds: the
# line goes from one env file to the other on this server and is shown to
# nobody, so nothing has to be issued in Kommo or pasted. Like deploy-prod.sh,
# this script is read from the test checkout and works on /srv/ev8-prod when
# told to.
set -euo pipefail

STAND=test
OFF=""
FROM_TEST=""
for arg in "$@"; do
  case "$arg" in
    --prod) STAND=prod ;;
    --off) OFF=yes ;;
    --from-test) FROM_TEST=yes ;;
    *) echo "Не понимаю «$arg». Без добавок — тестовый стенд; --prod — боевой; --off — выключить связь; --from-test (с --prod) — взять токен тестового стенда. Ничего не изменено."; exit 2 ;;
  esac
done
[ -z "$FROM_TEST" ] || [ "$STAND" = prod ] || { echo "--from-test имеет смысл только с --prod. Ничего не изменено."; exit 2; }
[ -z "$FROM_TEST" ] || [ -z "$OFF" ] || { echo "--from-test и --off вместе не бывают. Ничего не изменено."; exit 2; }

TEST_ENV=/srv/ev8-ops/.env.test
if [ "$STAND" = prod ]; then
  DIR=/srv/ev8-prod; PROJECT=ev8-prod; ENV=.env.prod; URL=https://ops.ev8.ge
  NAME="боевой стенд"; ON="На боевом стенде"; FLAG=" --prod"
else
  DIR=/srv/ev8-ops; PROJECT=ev8-test; ENV=.env.test; URL=https://test.ops.ev8.ge
  NAME="тестовый стенд"; ON="На тестовом стенде"; FLAG=""
fi
cd "$DIR"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV" -f docker-compose.prod.yml)
[ -f "$ENV" ] || { echo "Нет файла $DIR/$ENV."; exit 1; }

write_env() { # the old KOMMO_TOKEN line out, the new one (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -v '^KOMMO_TOKEN=' "$ENV" > "$tmp" || true
  cat >> "$tmp"
  mv "$tmp" "$ENV"
}

restart() {
  echo "Перезапускаю $NAME…"
  "${COMPOSE[@]}" up -d api > /dev/null 2>&1 < /dev/null || { echo "Стенд не перезапустился. Смотреть: docker compose -p $PROJECT logs api"; exit 1; }
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$PROJECT-api-1" 2>/dev/null < /dev/null)" = healthy ] && return 0
    sleep 2
  done
  echo "Стенд не поднялся за минуту. Смотреть: docker compose -p $PROJECT logs api"; exit 1
}

if [ -n "$OFF" ]; then
  write_env < /dev/null
  restart
  echo "Связь с Kommo выключена ($NAME): строки в «Сегодня» и списка сверки больше нет."
  exit 0
fi

# A stand whose release is older than the link would take the token and do
# nothing with it: say so before anything is asked or written.
"${COMPOSE[@]}" exec -T api test -f src/lib/kommo.ts < /dev/null \
  || { echo "$ON ещё нет связи с Kommo: на нём версия старше той, в которой она появилась. Токен не записан, ничего не изменено."; exit 1; }

if [ -n "$FROM_TEST" ]; then
  # From one env file to the other; the line passes through a pipe and no screen.
  grep -Eq '^KOMMO_TOKEN=[A-Za-z0-9._~+/=-]{100,}$' "$TEST_ENV" \
    || { echo "На тестовом стенде токена нет — переносить нечего. Ничего не изменено."; exit 1; }
  grep '^KOMMO_TOKEN=' "$TEST_ENV" | tail -n 1 | write_env
else
  # -s: the token is not shown as it is pasted. A long-lived token is one line
  # of about a thousand characters with no spaces in it.
  read -rsp "Долгосрочный токен Kommo (вставьте и нажмите Enter; на экране он не виден): " T; echo
  T=${T//[[:space:]]/}
  [ ${#T} -ge 100 ] || { echo "Это не похоже на токен: в нём ${#T} символов, а должно быть около тысячи. Ничего не изменено."; exit 1; }
  # Letters, digits and what base64 adds — nothing an env file could read as
  # a quote, a comment or a variable.
  case "$T" in *[!A-Za-z0-9._~+/=-]*) echo "В токене есть лишние символы: похоже, скопировалось что-то ещё. Ничего не изменено."; exit 1;; esac

  # printf is a shell builtin: the token is not in any process's arguments.
  printf 'KOMMO_TOKEN=%s\n' "$T" | write_env
  unset T
fi

restart

# Ask Kommo once, through the stand's own poll. The container reads the
# worker token from its own environment; what it prints is a status, a count
# and at most one of our own words for a failure.
ANSWER=$("${COMPOSE[@]}" exec -T api node --input-type=module -e '
  const r = await fetch("http://127.0.0.1:8080/api/jobs/kommo-sync", { method: "POST", headers: { "x-worker-token": process.env.WORKER_TOKEN } });
  const a = r.ok ? await r.json() : { status: "failed", failure: "stand", httpStatus: r.status };
  if (a.status === "ok") console.log("ok", a.leads, a.contactsRead === false ? "no-names" : "names");
  else if (a.status === "failed") console.log("failed", a.failure, a.httpStatus ?? "-");
  else console.log(a.status);
' 2>/dev/null < /dev/null || echo "failed stand -")
# shellcheck disable=SC2086 — three plain words, split on purpose
set -- $ANSWER

case "${1:-}" in
  ok)
    echo "Готово: Kommo принял токен ($NAME). В этапе аренды сейчас сделок: ${2:-0}."
    [ "${3:-}" = no-names ] && echo "Имена контактов Kommo не отдал — сверка идёт по сделкам, но это стоит показать разработчику."
    echo "Проверка: $URL → «Сегодня» → строка «Расхождения с Kommo»."
    ;;
  busy)
    echo "Токен записан, опрос Kommo уже идёт. Через минуту откройте «Сегодня» на $URL."
    ;;
  off)
    echo "Токен записан, но стенд его не видит. Это нужно показать разработчику."
    exit 1
    ;;
  *)
    case "${2:-}" in
      unauthorized) echo "Kommo не принял токен (ответ ${3:-401}). Сгенерируйте новый в Kommo и запустите этот скрипт ещё раз." ;;
      rate_limited) echo "Kommo ответил «слишком много запросов». Токен записан; стенд спросит снова в течение пяти минут." ;;
      network)      echo "С сервера не удалось достучаться до Kommo. Токен записан; стенд спросит снова в течение пяти минут." ;;
      stand)        echo "Токен записан, но стенд не смог спросить Kommo (ответ ${3:--}). Это нужно показать разработчику." ;;
      *)            echo "Kommo ответил не так, как ожидалось (${2:-?} ${3:--}). Токен записан; это нужно показать разработчику." ;;
    esac
    echo "Выключить связь: … set-kommo-token.sh$FLAG --off"
    exit 1
    ;;
esac
