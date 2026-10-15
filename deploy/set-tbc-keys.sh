#!/bin/bash
# Put the TBC Business Integration Services keys on a stand. Mika or Kardu
# runs it and types the client id and the client secret here: the secret is
# read without echo, both are written only into the stand's env file (mode
# 600) and passed to curl on its standard input. They never appear in the
# shell history, the process list, the output or any log.
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-tbc-keys.sh
#
# The keys are issued by the company itself in Business Internet Banking
# (tbconline.ge/business → API Integration): an admin user creates the
# integration, links an active internet-bank user to it and gives it one
# permission — «Viewing transaction history and account statements» — and
# confirms with an SMS code. Only the linked user sees the Client ID and the
# Secret on that page afterwards. Book register, item 8 (TBC's answer of
# 15.10.2026); ADR-0026.
#
# EV8 Ops reads TBC's movements with them (B11-03): every five minutes the
# day's, once a night the whole of yesterday, checked against the bank's
# statement. Before writing, the script asks the bank once from this server —
# a token, then the list of movements — and says whether the bank let it in.
# Nothing received is printed. Keys the bank refused are not written. Then the
# stand is restarted to take them, and asked once to read the day's movements:
# what it says is a count or one of our own words for a failure. With --off
# the keys are removed and the stand goes back to files.
#
# The account in lari is asked for too, and written as TBC_ACCOUNT. Enter
# takes the account named in the last TBC statement uploaded to production —
# the bank's own words, read and not printed whole. The number is not a
# secret, but it is not written in the repository either. With --account only
# the account is asked for and written; the keys stay:
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-tbc-keys.sh --account
#
# The test stand is the default. Production is named out loud, with --prod;
# --from-test gives it the keys the test stand already holds, from one env
# file to the other on this server, shown to nobody:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-tbc-keys.sh --prod --from-test
set -euo pipefail

STAND=test
OFF=""
FROM_TEST=""
ONLY_ACCOUNT=""
for arg in "$@"; do
  case "$arg" in
    --prod) STAND=prod ;;
    --off) OFF=yes ;;
    --from-test) FROM_TEST=yes ;;
    --account) ONLY_ACCOUNT=yes ;;
    *) echo "Не понимаю «$arg». Без добавок — тестовый стенд; --prod — боевой; --off — убрать ключи; --from-test (с --prod) — взять ключи тестового стенда; --account — только счёт. Ничего не изменено."; exit 2 ;;
  esac
done
[ -z "$FROM_TEST" ] || [ "$STAND" = prod ] || { echo "--from-test имеет смысл только с --prod. Ничего не изменено."; exit 2; }
[ -z "$FROM_TEST" ] || [ -z "$OFF" ] || { echo "--from-test и --off вместе не бывают. Ничего не изменено."; exit 2; }
[ -z "$ONLY_ACCOUNT" ] || [ -z "$OFF$FROM_TEST" ] || { echo "--account идёт один (можно с --prod). Ничего не изменено."; exit 2; }

TEST_ENV=/srv/ev8-ops/.env.test
if [ "$STAND" = prod ]; then
  DIR=/srv/ev8-prod; PROJECT=ev8-prod; ENV=/srv/ev8-prod/.env.prod; NAME="боевой стенд"; URL=https://ops.ev8.ge; FLAG=" --prod"
else
  DIR=/srv/ev8-ops; PROJECT=ev8-test; ENV=$TEST_ENV; NAME="тестовый стенд"; URL=https://test.ops.ev8.ge; FLAG=""
fi
[ -f "$ENV" ] || { echo "Нет файла $ENV."; exit 1; }
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV" -f "$DIR/docker-compose.prod.yml")

# TBC's production base. Its documentation names the token address for the
# test environment (test-api.tbcbank.ge/oauth/token); production is taken to
# be the same path here, and the first run of this script is what proves it.
BASE=https://api.tbcbank.ge
TOKEN_URL=$BASE/oauth/token

write_env() { # the lines named by $1 out, the new ones (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -Ev "^TBC_($1)=" "$ENV" > "$tmp" || true
  cat >> "$tmp"
  mv "$tmp" "$ENV"
}

# The account as the bank's API takes it: GE, two digits, TB, sixteen digits;
# a statement file may write the currency after it, and that is cut off.
as_account() {
  local a; a=$(printf '%s' "$1" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')
  [[ "$a" =~ ^(GE[0-9]{2}TB[0-9]{16})([A-Z]{3})?$ ]] && printf '%s' "${BASH_REMATCH[1]}"
}

# The account named in the last TBC statement uploaded to production: only
# read, and not printed.
account_from_prod() {
  local db; db=$(docker ps -q --filter label=com.docker.compose.project=ev8-prod --filter label=com.docker.compose.service=db 2>/dev/null < /dev/null) || return 0
  [ -n "$db" ] || return 0
  docker exec "$db" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt -c "select account from statements where bank = '"'"'tbc'"'"' and account is not null order by created_at desc limit 1"' 2>/dev/null < /dev/null || true
}

ask_account() {
  local typed
  read -rp "счёт в лари, GE…TB… (Enter — взять из последней выписки TBC на боевом): " typed
  if [ -n "${typed//[[:space:]]/}" ]; then
    ACCOUNT=$(as_account "$typed") || { echo "Это не похоже на счёт TBC: нужен номер вида GE00TB0000000000000000. Ничего не изменено."; exit 1; }
  else
    ACCOUNT=$(as_account "$(account_from_prod)") || { echo "На боевом нет загруженной выписки TBC со счётом — впишите счёт сами. Ничего не изменено."; exit 1; }
    echo "Счёт взят из последней выписки TBC на боевом: …${ACCOUNT: -4}."
  fi
}

# A stand whose release is older than the module keeps the keys in its env
# file and does nothing with them; it is not restarted for them.
reads_keys() { "${COMPOSE[@]}" exec -T api test -f src/lib/tbc.ts < /dev/null > /dev/null 2>&1; }

restart() {
  echo "Перезапускаю $NAME…"
  "${COMPOSE[@]}" up -d api worker > /dev/null 2>&1 < /dev/null || { echo "Стенд не перезапустился. Смотреть: docker compose -p $PROJECT logs api"; exit 1; }
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$PROJECT-api-1" 2>/dev/null < /dev/null)" = healthy ] && return 0
    sleep 2
  done
  echo "Стенд не поднялся за минуту. Смотреть: docker compose -p $PROJECT logs api"; exit 1
}

# Ask the bank once, through the stand's own pull, and say what came. The
# container reads the worker token from its own environment; what it prints is
# a status, a count and at most one of our own words for a failure.
ask_stand() {
  local answer
  answer=$("${COMPOSE[@]}" exec -T api node --input-type=module -e '
    const r = await fetch("http://127.0.0.1:8080/api/jobs/tbc-today", { method: "POST", headers: { "x-worker-token": process.env.WORKER_TOKEN } });
    const a = r.ok ? await r.json() : { status: "failed", failure: "stand", httpStatus: r.status };
    if (a.status === "ok") console.log("ok", a.listed, a.added);
    else if (a.status === "failed") console.log("failed", a.failure, a.httpStatus ?? "-");
    else console.log(a.status);
  ' 2>/dev/null < /dev/null || echo "failed stand -")
  # shellcheck disable=SC2086 — three plain words, split on purpose
  set -- $answer
  case "${1:-}" in
    ok)   echo "Готово: стенд читает TBC сам. Сегодня операций в банке: ${2:-0}, новых строк в «Разобрать»: ${3:-0}. Дальше — каждые пять минут, и раз в ночь вчерашний день целиком со сверкой по выписке банка ($URL → Деньги → Выписки)." ;;
    busy) echo "Готово: стенд как раз спрашивает банк сам. Через минуту откройте $URL → Деньги → Выписки." ;;
    off)  echo "Стенд не видит ключей. Это нужно показать разработчику."; exit 1 ;;
    *)
      case "${2:-}" in
        no_account) echo "Стенд не знает счёта. Запустите: ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-tbc-keys.sh$FLAG --account" ;;
        not_found) echo "Банк не знает этого счёта в лари (ответ ${3:--}). Проверьте номер счёта: … set-tbc-keys.sh$FLAG --account" ;;
        forbidden) echo "Банк не даёт читать выписки (ответ ${3:--}). У интеграции или у привязанного пользователя нет права «Viewing transaction history and account statements»." ;;
        user_inactive) echo "Пользователь интернет-банка, к которому привязаны ключи, не активен, заблокирован или удалён (ответ ${3:--})." ;;
        unauthorized) echo "Банк не принял ключи (ответ ${3:--}). Выпустите новые в Business Internet Banking → API Integration и запустите скрипт ещё раз." ;;
        network) echo "С сервера не удалось достучаться до банка. Стенд спросит снова через пять минут." ;;
        *) echo "Банк ответил не так, как ожидалось (${2:-?} ${3:--}). Это нужно показать разработчику." ;;
      esac
      exit 1 ;;
  esac
}

if [ -n "$OFF" ]; then
  write_env 'CLIENT_ID|CLIENT_SECRET|ACCOUNT' < /dev/null
  if reads_keys; then restart; fi
  echo "Ключи TBC убраны ($NAME): выписки этого банка снова только файлами."
  exit 0
fi

if [ -n "$ONLY_ACCOUNT" ]; then
  grep -q '^TBC_CLIENT_SECRET=.' "$ENV" || { echo "На этом стенде нет ключей TBC — сначала они: … set-tbc-keys.sh$FLAG. Ничего не изменено."; exit 1; }
  reads_keys || { echo "На этом стенде версия старше той, что читает TBC по API. Ничего не изменено."; exit 1; }
  ask_account
  printf 'TBC_ACCOUNT=%s\n' "$ACCOUNT" | write_env 'ACCOUNT'
  unset ACCOUNT
  restart
  ask_stand
  exit 0
fi

# Letters, digits and the few marks keys are made of — nothing an env file or
# curl's config could read as a quote, a comment or a variable. TBC's test keys
# are 32 and 16 characters long; the production ones are not described.
safe() { [ ${#1} -ge "$2" ] && case "$1" in *[!A-Za-z0-9._~+/=-]*) false ;; esac; }

ACCOUNT=""
if [ -n "$FROM_TEST" ]; then
  ID=$(sed -n 's/^TBC_CLIENT_ID=//p' "$TEST_ENV" | tail -n 1)
  SECRET=$(sed -n 's/^TBC_CLIENT_SECRET=//p' "$TEST_ENV" | tail -n 1)
  ACCOUNT=$(sed -n 's/^TBC_ACCOUNT=//p' "$TEST_ENV" | tail -n 1)
  [ -n "$ID" ] && [ -n "$SECRET" ] || { echo "На тестовом стенде ключей TBC нет — переносить нечего. Ничего не изменено."; exit 1; }
else
  read -rp "client id: " ID
  read -rsp "client secret (вставьте и нажмите Enter; на экране он не виден): " SECRET; echo
  ID=${ID//[[:space:]]/}; SECRET=${SECRET//[[:space:]]/}
fi
safe "$ID" 4 || { echo "Это не похоже на client id: пустой или с лишними символами. Ничего не изменено."; exit 1; }
safe "$SECRET" 12 || { echo "Это не похоже на client secret: короче 12 символов или с лишними символами. Ничего не изменено."; exit 1; }
[ -n "$FROM_TEST" ] || ask_account

# Ask the bank once. curl reads the keys and the token from its config on
# standard input, so none of them is ever an argument of a process. The keys
# go as Basic, with the one scope the account services need.
BODY=$(mktemp); trap 'rm -f "$BODY"' EXIT
CODE=$(printf 'user = "%s:%s"\ndata = "grant_type=client_credentials&scope=bab_accounts"\n' "$ID" "$SECRET" \
  | curl -s -K - -o "$BODY" -w '%{http_code}' --max-time 20 "$TOKEN_URL" 2>/dev/null) || CODE=000
TOKEN=$(sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p' "$BODY")
# A refusal's code — an OAuth word such as invalid_scope or one of the bank's
# codes — is read against a short list; nothing else of the answer is kept.
WHY=$(grep -oE 'invalid_client|invalid_scope|unauthorized_client|USER_IS_[A-Z_]+' "$BODY" | head -n 1 || true)
: > "$BODY"

case "$CODE" in
  200) [ -n "$TOKEN" ] || { echo "Банк ответил 200, но без токена. Ключи не записаны; это нужно показать разработчику."; exit 1; } ;;
  000) echo "С сервера не удалось достучаться до банка. Ключи не записаны — запустите ещё раз позже."; exit 1 ;;
  400|401|403)
    case "$WHY" in
      invalid_scope) echo "Банк узнал ключи, но не дал права читать выписки (ответ $CODE, invalid_scope). У интеграции в Business Internet Banking должно быть включено «Viewing transaction history and account statements». Ничего не изменено." ;;
      USER_IS_*) echo "Пользователь интернет-банка, к которому привязаны ключи, не активен, заблокирован или удалён (ответ $CODE, $WHY). Ничего не изменено." ;;
      *) echo "Банк не принял ключи (ответ $CODE${WHY:+, $WHY}). Проверьте client id и secret на странице API Integration и запустите ещё раз. Ничего не изменено." ;;
    esac
    exit 1 ;;
  *) echo "Банк ответил не так, как ожидалось (ответ $CODE). Ключи не записаны; это нужно показать разработчику."; exit 1 ;;
esac

# One movement of today, of the account when it is known: the answer itself
# carries names and is not kept; only its status, and for a 400 the bank's code.
TODAY=$(TZ=Asia/Tbilisi date +%F)
QUERY="PeriodFrom=$TODAY&PeriodTo=$TODAY&PageIndex=0&PageSize=1"
[ -z "$ACCOUNT" ] || QUERY="AccountNumber=$ACCOUNT&AccountCurrencyCode=GEL&$QUERY"
probe() {
  printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" \
    | curl -s -K - -o "$BODY" -w '%{http_code}' --max-time 20 "$BASE/bab/v1/accounts/movements?$QUERY" 2>/dev/null || echo 000
}
API=$(probe)
case "$API" in 502|503|504) sleep 3; API=$(probe) ;; esac
REFUSED=""
[ "$API" != 400 ] || REFUSED=$(grep -oE 'INVALID_ACCOUNT|INCORRECT_INPUT_DATA|USER_IS_[A-Z_]+' "$BODY" | head -n 1 || true)
: > "$BODY"
unset TOKEN

case "$API:$REFUSED" in
  400:USER_IS_*) echo "Пользователь интернет-банка, к которому привязаны ключи, не активен, заблокирован или удалён ($REFUSED). Ключи не записаны."; exit 1 ;;
esac

# printf is a shell builtin: the keys are not in any process's arguments.
{ printf 'TBC_CLIENT_ID=%s\nTBC_CLIENT_SECRET=%s\n' "$ID" "$SECRET"; [ -z "$ACCOUNT" ] || printf 'TBC_ACCOUNT=%s\n' "$ACCOUNT"; } | write_env 'CLIENT_ID|CLIENT_SECRET|ACCOUNT'
unset ID SECRET ACCOUNT

case "$API:$REFUSED" in
  200:*) echo "Банк принял ключи, список операций отвечает этому серверу. Ключи записаны ($NAME)." ;;
  # The keys were taken (the token came); only the gateway was busy.
  502:*|503:*|504:*) echo "Банк принял ключи, но его шлюз сейчас занят (ответ $API). Ключи записаны ($NAME); стенд будет спрашивать банк сам." ;;
  400:INVALID_ACCOUNT) echo "Ключи записаны ($NAME): банк их принял, но не знает этого счёта в лари. Проверьте номер: ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-tbc-keys.sh$FLAG --account"; exit 1 ;;
  403:*) echo "Ключи записаны ($NAME): банк их принял, но читать выписки не даёт (403). У пользователя, привязанного к интеграции, нет права на просмотр выписок в интернет-банке."; exit 1 ;;
  000:*) echo "Ключи записаны ($NAME): банк их принял, но до списка операций с сервера достучаться не удалось. Это нужно показать разработчику."; exit 1 ;;
  *) echo "Ключи записаны ($NAME): банк их принял, список операций ответил $API${REFUSED:+ ($REFUSED)}. Это нужно показать разработчику."; exit 1 ;;
esac

if ! reads_keys; then
  echo "На этом стенде версия старше той, что читает TBC по API: ключи ждут в env-файле её релиза."
  exit 0
fi
restart

ask_stand
