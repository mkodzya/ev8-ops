#!/bin/bash
# Put the Bank of Georgia Business Online API keys on a stand. Mika runs it and
# types the client id and the client secret here: the secret is read without
# echo, both are written only into the stand's env file (mode 600) and passed
# to curl on its standard input. They never appear in the shell history, the
# process list, the output or any log.
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh
#
# The keys are issued by the company itself in Business Online, at
# bonline.bog.ge/admin/api (first issued 14.10.2026): Client Credentials Flow,
# an internet-bank user whose rights the keys get — whatever that user may do
# in the bank, the keys may do too — and this server's address,
# 204.168.149.105, as the only one allowed. Book register, item 8.
#
# EV8 Ops reads Bank of Georgia's operations with them (B11-03): every five
# minutes the day's, once a night the full statement of the day before. Before
# writing, the script asks the bank once from this server — a token, then the
# National Bank's dollar rate through the API — and says whether the bank let
# it in. Nothing received is printed. Keys the bank refused are not written.
# Then the stand is restarted to take them, and asked once to read the day's
# operations: what it says is a count or one of our own words for a failure.
# With --off the keys are removed and the stand goes back to files.
#
# The account in lari is asked for too, and written as BOG_ACCOUNT: Enter
# leaves it blank, and the stand then asks about the account named in the
# last Bank of Georgia statement uploaded to it. The number is not a secret,
# but it is not written in the repository either.
#
# The test stand is the default. Production is named out loud, with --prod;
# --from-test gives it the keys the test stand already holds, from one env
# file to the other on this server, shown to nobody:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh --prod --from-test
set -euo pipefail

STAND=test
OFF=""
FROM_TEST=""
for arg in "$@"; do
  case "$arg" in
    --prod) STAND=prod ;;
    --off) OFF=yes ;;
    --from-test) FROM_TEST=yes ;;
    *) echo "Не понимаю «$arg». Без добавок — тестовый стенд; --prod — боевой; --off — убрать ключи; --from-test (с --prod) — взять ключи тестового стенда. Ничего не изменено."; exit 2 ;;
  esac
done
[ -z "$FROM_TEST" ] || [ "$STAND" = prod ] || { echo "--from-test имеет смысл только с --prod. Ничего не изменено."; exit 2; }
[ -z "$FROM_TEST" ] || [ -z "$OFF" ] || { echo "--from-test и --off вместе не бывают. Ничего не изменено."; exit 2; }

TEST_ENV=/srv/ev8-ops/.env.test
if [ "$STAND" = prod ]; then
  DIR=/srv/ev8-prod; PROJECT=ev8-prod; ENV=/srv/ev8-prod/.env.prod; NAME="боевой стенд"; URL=https://ops.ev8.ge
else
  DIR=/srv/ev8-ops; PROJECT=ev8-test; ENV=$TEST_ENV; NAME="тестовый стенд"; URL=https://test.ops.ev8.ge
fi
[ -f "$ENV" ] || { echo "Нет файла $ENV."; exit 1; }
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV" -f "$DIR/docker-compose.prod.yml")

TOKEN_URL=https://account.bog.ge/auth/realms/bog/protocol/openid-connect/token
API_URL=https://api.businessonline.ge/api/rates/nbg/USD

write_env() { # the old BOG_CLIENT_* and BOG_ACCOUNT lines out, the new ones (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -Ev '^BOG_(CLIENT_ID|CLIENT_SECRET|ACCOUNT)=' "$ENV" > "$tmp" || true
  cat >> "$tmp"
  mv "$tmp" "$ENV"
}

# A stand whose release is older than the module keeps the keys in its env
# file and does nothing with them; it is not restarted for them.
reads_keys() { "${COMPOSE[@]}" exec -T api test -f src/lib/bog.ts < /dev/null > /dev/null 2>&1; }

restart() {
  echo "Перезапускаю $NAME…"
  "${COMPOSE[@]}" up -d api worker > /dev/null 2>&1 < /dev/null || { echo "Стенд не перезапустился. Смотреть: docker compose -p $PROJECT logs api"; exit 1; }
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$PROJECT-api-1" 2>/dev/null < /dev/null)" = healthy ] && return 0
    sleep 2
  done
  echo "Стенд не поднялся за минуту. Смотреть: docker compose -p $PROJECT logs api"; exit 1
}

if [ -n "$OFF" ]; then
  write_env < /dev/null
  if reads_keys; then restart; fi
  echo "Ключи Bank of Georgia убраны ($NAME): выписки этого банка снова только файлами."
  exit 0
fi

# Letters, digits and the few marks keys are made of — nothing an env file or
# curl's config could read as a quote, a comment or a variable.
safe() { [ ${#1} -ge "$2" ] && case "$1" in *[!A-Za-z0-9._~+/=-]*) false ;; esac; }

if [ -n "$FROM_TEST" ]; then
  ID=$(sed -n 's/^BOG_CLIENT_ID=//p' "$TEST_ENV" | tail -n 1)
  SECRET=$(sed -n 's/^BOG_CLIENT_SECRET=//p' "$TEST_ENV" | tail -n 1)
  ACCOUNT=$(sed -n 's/^BOG_ACCOUNT=//p' "$TEST_ENV" | tail -n 1)
  [ -n "$ID" ] && [ -n "$SECRET" ] || { echo "На тестовом стенде ключей нет — переносить нечего. Ничего не изменено."; exit 1; }
else
  read -rp "client id: " ID
  read -rsp "client secret (вставьте и нажмите Enter; на экране он не виден): " SECRET; echo
  read -rp "счёт в лари, GE…BG… (Enter — взять из последней загруженной выписки Bank of Georgia): " ACCOUNT
  ID=${ID//[[:space:]]/}; SECRET=${SECRET//[[:space:]]/}; ACCOUNT=${ACCOUNT//[[:space:]]/}
fi
safe "$ID" 4 || { echo "Это не похоже на client id: пустой или с лишними символами. Ничего не изменено."; exit 1; }
safe "$SECRET" 16 || { echo "Это не похоже на client secret: короче 16 символов или с лишними символами. Ничего не изменено."; exit 1; }
ACCOUNT=$(printf '%s' "$ACCOUNT" | tr '[:lower:]' '[:upper:]')
[ -z "$ACCOUNT" ] || [[ "$ACCOUNT" =~ ^GE[0-9]{2}[A-Z]{2}[0-9]{16}([A-Z]{3})?$ ]] \
  || { echo "Это не похоже на счёт: нужен номер вида GE00BG0000000000000000. Ничего не изменено."; exit 1; }

# Ask the bank once. curl reads the keys and the token from its config on
# standard input, so none of them is ever an argument of a process. The keys
# go both as Basic and in the body, as the bank's own example has them.
BODY=$(mktemp); trap 'rm -f "$BODY"' EXIT
CODE=$(printf 'user = "%s:%s"\ndata = "grant_type=client_credentials"\ndata-urlencode = "client_id=%s"\ndata-urlencode = "client_secret=%s"\n' "$ID" "$SECRET" "$ID" "$SECRET" \
  | curl -s -K - -o "$BODY" -w '%{http_code}' --max-time 20 "$TOKEN_URL" 2>/dev/null) || CODE=000
TOKEN=$(sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p' "$BODY")
: > "$BODY"

case "$CODE" in
  200) [ -n "$TOKEN" ] || { echo "Банк ответил 200, но без токена. Ключи не записаны; это нужно показать разработчику."; exit 1; } ;;
  000) echo "С сервера не удалось достучаться до банка. Ключи не записаны — запустите ещё раз позже."; exit 1 ;;
  400|401) echo "Банк не принял ключи (ответ $CODE). Проверьте client id и secret в Business Online и запустите ещё раз. Ничего не изменено."; exit 1 ;;
  *) echo "Банк ответил не так, как ожидалось (ответ $CODE). Ключи не записаны; это нужно показать разработчику."; exit 1 ;;
esac

API=$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" \
  | curl -s -K - -o /dev/null -w '%{http_code}' --max-time 20 "$API_URL" 2>/dev/null) || API=000
unset TOKEN

# printf is a shell builtin: the keys are not in any process's arguments.
{ printf 'BOG_CLIENT_ID=%s\nBOG_CLIENT_SECRET=%s\n' "$ID" "$SECRET"; [ -z "$ACCOUNT" ] || printf 'BOG_ACCOUNT=%s\n' "$ACCOUNT"; } | write_env
unset ID SECRET ACCOUNT

case "$API" in
  200|429) echo "Банк принял ключи, API отвечает этому серверу. Ключи записаны ($NAME)." ;;
  401|403) echo "Ключи записаны ($NAME): банк их принял, но API ответил $API. Скорее всего, в Business Online вписан не тот IP (нужен 204.168.149.105) или у выбранного пользователя нет прав на счета." ; exit 1 ;;
  000) echo "Ключи записаны ($NAME): банк их принял, но до API с сервера достучаться не удалось. Это нужно показать разработчику."; exit 1 ;;
  *) echo "Ключи записаны ($NAME): банк их принял, API ответил $API. Это нужно показать разработчику."; exit 1 ;;
esac

if ! reads_keys; then
  echo "На этом стенде версия старше той, что читает выписки по API: ключи ждут в env-файле её релиза."
  exit 0
fi
restart

# Ask the bank once, through the stand's own pull. The container reads the
# worker token from its own environment; what it prints is a status, a count
# and at most one of our own words for a failure.
ANSWER=$("${COMPOSE[@]}" exec -T api node --input-type=module -e '
  const r = await fetch("http://127.0.0.1:8080/api/jobs/bog-today", { method: "POST", headers: { "x-worker-token": process.env.WORKER_TOKEN } });
  const a = r.ok ? await r.json() : { status: "failed", failure: "stand", httpStatus: r.status };
  if (a.status === "ok") console.log("ok", a.listed, a.added);
  else if (a.status === "failed") console.log("failed", a.failure, a.httpStatus ?? "-");
  else console.log(a.status);
' 2>/dev/null < /dev/null || echo "failed stand -")
# shellcheck disable=SC2086 — three plain words, split on purpose
set -- $ANSWER

case "${1:-}" in
  ok)   echo "Готово: стенд читает Bank of Georgia сам. Сегодня операций в банке: ${2:-0}, новых строк в «Разобрать»: ${3:-0}. Дальше — каждые пять минут, и раз в ночь полная выписка за вчера ($URL → Деньги → Выписки)." ;;
  busy) echo "Готово: стенд как раз спрашивает банк сам. Через минуту откройте $URL → Деньги → Выписки." ;;
  off)  echo "Ключи записаны, но стенд их не видит. Это нужно показать разработчику."; exit 1 ;;
  *)
    case "${2:-}" in
      no_account) echo "Ключи записаны, но стенд не знает счёта: в env-файле его нет и выписки Bank of Georgia в EV8 Ops не загружали. Запустите скрипт ещё раз и впишите счёт." ;;
      forbidden|not_found) echo "Ключи записаны, но банк не даёт читать этот счёт (ответ ${3:--}). Проверьте номер счёта и права пользователя в Business Online." ;;
      network) echo "Ключи записаны; с сервера не удалось достучаться до банка. Стенд спросит снова через пять минут." ;;
      *) echo "Ключи записаны; банк ответил не так, как ожидалось (${2:-?} ${3:--}). Это нужно показать разработчику." ;;
    esac
    exit 1 ;;
esac
