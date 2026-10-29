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
# The account in lari is asked for too, and written as BOG_ACCOUNT. Enter
# takes the account named in the last Bank of Georgia statement uploaded to
# production — the bank's own words, read and not printed whole. The number is
# not a secret, but it is not written in the repository either. With
# --account only the account is asked for and written; the keys stay. The
# account written now is shown first, by its last four digits, and replaced
# only on «да»:
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh --account
#
# An account with another currency after it (…USD, …EUR) is refused here: the
# stand reads what this writes as lari, and the company's dollar account
# written here would take the place of the lari one.
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

TOKEN_URL=https://account.bog.ge/auth/realms/bog/protocol/openid-connect/token
API_URL=https://api.businessonline.ge/api/rates/nbg/USD

write_env() { # the lines named by $1 out, the new ones (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -Ev "^BOG_($1)=" "$ENV" > "$tmp" || true
  cat >> "$tmp"
  mv "$tmp" "$ENV"
}

# The account as the bank's API takes it: GE, two digits, BG, sixteen digits.
# A statement file writes the currency after it: GEL is cut off; any other
# currency is refused, with status 2 — this is the account in lari.
as_account() {
  local a iban currency
  a=$(printf '%s' "$1" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')
  [[ "$a" =~ ^(GE[0-9]{2}[A-Z]{2}[0-9]{16})([A-Z]{3})?$ ]] || return 1
  iban=${BASH_REMATCH[1]}; currency=${BASH_REMATCH[2]}
  [ -z "$currency" ] || [ "$currency" = GEL ] || return 2
  printf '%s' "$iban"
}

# The accounts the env file names now, each by its last four digits, into NOW.
# The number is not printed whole; what is not an account is not printed at all.
current_accounts() {
  local line item last4 currency; local -a items=()
  line=$(sed -n 's/^BOG_ACCOUNT=//p' "$ENV" | tail -n 1)
  read -ra items <<< "${line//[,;]/ }"
  NOW=()
  for item in ${items[@]+"${items[@]}"}; do
    item=$(printf '%s' "$item" | tr '[:lower:]' '[:upper:]')
    if [[ "$item" =~ ^GE[0-9]{2}[A-Z]{2}[0-9]{12}([0-9]{4})([A-Z]{3})?$ ]]; then
      last4=${BASH_REMATCH[1]}; currency=${BASH_REMATCH[2]}
      [ "$currency" != GEL ] || currency=""
      NOW+=("…$last4${currency:+ $currency}")
    else
      NOW+=("не номер счёта")
    fi
  done
}

# --account writes one account in place of whatever the env file names: what
# is there is shown first, and replaced only on «да». Nothing named: the stand
# reads the account of the last statement uploaded, and there is nothing to ask.
confirm_replace() {
  local answer joined
  current_accounts
  case ${#NOW[@]} in
    0) echo "Сейчас счёт не записан ($NAME): стенд читает счёт последней загруженной выписки Bank of Georgia."; return 0 ;;
    1) read -rp "Сейчас записан счёт ${NOW[0]} ($NAME). Заменить? да/нет: " answer ;;
    *) joined=$(printf '%s, ' "${NOW[@]}"); read -rp "Сейчас записаны счета ${joined%, } ($NAME); --account оставит один. Заменить? да/нет: " answer ;;
  esac
  case "${answer//[[:space:]]/}" in
    да|Да|ДА|д|Д|yes|Yes|YES|y|Y) ;;
    *) echo "Ничего не изменено."; exit 0 ;;
  esac
}

# The account named in the last Bank of Georgia statement uploaded to
# production: only read, and not printed.
account_from_prod() {
  local db; db=$(docker ps -q --filter label=com.docker.compose.project=ev8-prod --filter label=com.docker.compose.service=db 2>/dev/null < /dev/null) || return 0
  [ -n "$db" ] || return 0
  docker exec "$db" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt -c "select account from statements where bank = '"'"'bog'"'"' and account is not null order by created_at desc limit 1"' 2>/dev/null < /dev/null || true
}

ask_account() {
  local typed
  read -rp "счёт в лари, GE…BG… (Enter — взять из последней выписки Bank of Georgia на боевом): " typed
  if [ -n "${typed//[[:space:]]/}" ]; then
    ACCOUNT=$(as_account "$typed") || case $? in
      2) echo "Это счёт не в лари: после номера стоит другая валюта. Сюда вписывается только счёт в лари — GE00BG0000000000000000 или GE00BG0000000000000000GEL. Счета в долларах и евро подключаются отдельно, после обновления EV8 Ops. Ничего не изменено."; exit 1 ;;
      *) echo "Это не похоже на счёт: нужен номер вида GE00BG0000000000000000. Ничего не изменено."; exit 1 ;;
    esac
  else
    ACCOUNT=$(as_account "$(account_from_prod)") || { echo "На боевом нет загруженной выписки Bank of Georgia со счётом в лари — впишите счёт сами. Ничего не изменено."; exit 1; }
    echo "Счёт взят из последней выписки Bank of Georgia на боевом: …${ACCOUNT: -4}."
  fi
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

# Ask the bank once, through the stand's own pull, and say what came. The
# container reads the worker token from its own environment; what it prints is
# a status, a count and at most one of our own words for a failure.
ask_stand() {
  local answer
  answer=$("${COMPOSE[@]}" exec -T api node --input-type=module -e '
    const r = await fetch("http://127.0.0.1:8080/api/jobs/bog-today", { method: "POST", headers: { "x-worker-token": process.env.WORKER_TOKEN } });
    const a = r.ok ? await r.json() : { status: "failed", failure: "stand", httpStatus: r.status };
    if (a.status === "ok") console.log("ok", a.listed, a.added);
    else if (a.status === "failed") console.log("failed", a.failure, a.httpStatus ?? "-");
    else console.log(a.status);
  ' 2>/dev/null < /dev/null || echo "failed stand -")
  # shellcheck disable=SC2086 — three plain words, split on purpose
  set -- $answer
  case "${1:-}" in
    ok)   echo "Готово: стенд читает Bank of Georgia сам. Сегодня операций в банке: ${2:-0}, новых строк в «Разобрать»: ${3:-0}. Дальше — каждые пять минут, и раз в ночь полная выписка за вчера ($URL → Деньги → Выписки)." ;;
    busy) echo "Готово: стенд как раз спрашивает банк сам. Через минуту откройте $URL → Деньги → Выписки." ;;
    off)  echo "Стенд не видит ключей. Это нужно показать разработчику."; exit 1 ;;
    *)
      case "${2:-}" in
        no_account) echo "Стенд не знает счёта. Запустите: ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh$FLAG --account" ;;
        forbidden|not_found) echo "Банк не даёт читать этот счёт (ответ ${3:--}). Проверьте номер счёта и права пользователя в Business Online." ;;
        unauthorized) echo "Банк не принял ключи (ответ ${3:--}). Выпустите новые в Business Online и запустите скрипт ещё раз." ;;
        network) echo "С сервера не удалось достучаться до банка. Стенд спросит снова через пять минут." ;;
        *) echo "Банк ответил не так, как ожидалось (${2:-?} ${3:--}). Это нужно показать разработчику." ;;
      esac
      exit 1 ;;
  esac
}

if [ -n "$OFF" ]; then
  write_env 'CLIENT_ID|CLIENT_SECRET|ACCOUNT' < /dev/null
  if reads_keys; then restart; fi
  echo "Ключи Bank of Georgia убраны ($NAME): выписки этого банка снова только файлами."
  exit 0
fi

if [ -n "$ONLY_ACCOUNT" ]; then
  grep -q '^BOG_CLIENT_SECRET=.' "$ENV" || { echo "На этом стенде нет ключей Bank of Georgia — сначала они: … set-bog-keys.sh$FLAG. Ничего не изменено."; exit 1; }
  reads_keys || { echo "На этом стенде версия старше той, что читает выписки по API. Ничего не изменено."; exit 1; }
  confirm_replace
  ask_account
  printf 'BOG_ACCOUNT=%s\n' "$ACCOUNT" | write_env 'ACCOUNT'
  unset ACCOUNT
  restart
  ask_stand
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
  ID=${ID//[[:space:]]/}; SECRET=${SECRET//[[:space:]]/}
fi
safe "$ID" 4 || { echo "Это не похоже на client id: пустой или с лишними символами. Ничего не изменено."; exit 1; }
safe "$SECRET" 16 || { echo "Это не похоже на client secret: короче 16 символов или с лишними символами. Ничего не изменено."; exit 1; }
[ -n "$FROM_TEST" ] || ask_account

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

probe() {
  printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" \
    | curl -s -K - -o /dev/null -w '%{http_code}' --max-time 20 "$API_URL" 2>/dev/null || echo 000
}
# The bank's gateway answers 502-504 now and then and a moment later lets the
# same request through (15.10.2026): asked once more after a pause.
API=$(probe)
case "$API" in 502|503|504) sleep 3; API=$(probe) ;; esac
unset TOKEN

# printf is a shell builtin: the keys are not in any process's arguments.
{ printf 'BOG_CLIENT_ID=%s\nBOG_CLIENT_SECRET=%s\n' "$ID" "$SECRET"; [ -z "$ACCOUNT" ] || printf 'BOG_ACCOUNT=%s\n' "$ACCOUNT"; } | write_env 'CLIENT_ID|CLIENT_SECRET|ACCOUNT'
unset ID SECRET ACCOUNT

case "$API" in
  200|429) echo "Банк принял ключи, API отвечает этому серверу. Ключи записаны ($NAME)." ;;
  # The keys were taken (the token came); only the gateway was busy. The stand
  # asks the bank by itself every five minutes and gets through between.
  502|503|504) echo "Банк принял ключи, но его шлюз сейчас занят (ответ $API). Ключи записаны ($NAME); стенд будет спрашивать банк сам." ;;
  401|403) echo "Ключи записаны ($NAME): банк их принял, но API ответил $API. Скорее всего, в Business Online вписан не тот IP (нужен 204.168.149.105) или у выбранного пользователя нет прав на счета." ; exit 1 ;;
  000) echo "Ключи записаны ($NAME): банк их принял, но до API с сервера достучаться не удалось. Это нужно показать разработчику."; exit 1 ;;
  *) echo "Ключи записаны ($NAME): банк их принял, API ответил $API. Это нужно показать разработчику."; exit 1 ;;
esac

if ! reads_keys; then
  echo "На этом стенде версия старше той, что читает выписки по API: ключи ждут в env-файле её релиза."
  exit 0
fi
restart

ask_stand
