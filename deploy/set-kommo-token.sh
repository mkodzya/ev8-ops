#!/bin/bash
# Switch on the Kommo link (ADR-0012) on the test stand. Mika runs it, and
# pastes the integration's long-lived token here: it is read without echo,
# written only into .env.test (mode 600) and passed to the API container as an
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
# Production is not touched: its token goes into .env.prod with the release
# that carries the link, on Mika's word.
set -euo pipefail

cd /srv/ev8-ops
ENV=.env.test
COMPOSE=(docker compose -p ev8-test --env-file "$ENV" -f docker-compose.prod.yml)
[ -f "$ENV" ] || { echo "Нет файла $ENV."; exit 1; }

write_env() { # the old KOMMO_TOKEN line out, the new one (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -v '^KOMMO_TOKEN=' "$ENV" > "$tmp" || true
  cat >> "$tmp"
  mv "$tmp" "$ENV"
}

restart() {
  echo "Перезапускаю тестовый стенд…"
  "${COMPOSE[@]}" up -d api > /dev/null 2>&1 || { echo "Стенд не перезапустился. Смотреть: docker compose -p ev8-test logs api"; exit 1; }
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' ev8-test-api-1 2>/dev/null)" = healthy ] && return 0
    sleep 2
  done
  echo "Стенд не поднялся за минуту. Смотреть: docker compose -p ev8-test logs api"; exit 1
}

if [ "${1:-}" = "--off" ]; then
  write_env < /dev/null
  restart
  echo "Связь с Kommo выключена: строки в «Сегодня» и списка сверки больше нет."
  exit 0
fi

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
' 2>/dev/null || echo "failed stand -")
# shellcheck disable=SC2086 — three plain words, split on purpose
set -- $ANSWER

case "${1:-}" in
  ok)
    echo "Готово: Kommo принял токен. В этапе аренды сейчас сделок: ${2:-0}."
    [ "${3:-}" = no-names ] && echo "Имена контактов Kommo не отдал — сверка идёт по сделкам, но это стоит показать разработчику."
    echo "Проверка: https://test.ops.ev8.ge → «Сегодня» → строка «Расхождения с Kommo»."
    ;;
  busy)
    echo "Токен записан, опрос Kommo уже идёт. Через минуту откройте «Сегодня» на https://test.ops.ev8.ge."
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
      stand)        echo "Токен записан, но стенд не смог спросить Kommo (ответ ${3:--}): на нём, возможно, ещё нет этой версии. Это нужно показать разработчику." ;;
      *)            echo "Kommo ответил не так, как ожидалось (${2:-?} ${3:--}). Токен записан; это нужно показать разработчику." ;;
    esac
    echo "Выключить связь: … set-kommo-token.sh --off"
    exit 1
    ;;
esac
