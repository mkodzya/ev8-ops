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
# operations: what it says is a count or one of our own words for a failure,
# for each account when it reads more than the one in lari.
# With --off the keys are removed and the stand goes back to files.
#
# The accounts it reads are BOG_ACCOUNT in the env file: a list, apart by
# commas, of each account as the bank writes it in a statement file — bare for
# lari, with USD or EUR after it for an account in dollars or euros (ADR-0051).
# The numbers are not secrets, but they are not written in the repository
# either, and this script never prints one whole: an account is «··NNNN» and
# its currency.
#
# The first run asks for the account in lari. Enter takes the account named in
# the last Bank of Georgia statement uploaded to production — the bank's own
# words, read and not printed whole. A run with new keys keeps the list the
# env file names already. With --account only the account in lari is asked for
# and written, in place of the whole list; the keys stay. What is written now
# is shown first, and replaced only on «да»:
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh --account
#
# With --add-account an account in dollars or euros joins the list, and what
# is there stays. Enter takes the number of the account in lari — the bank may
# keep another currency on the same IBAN — then the currency: USD on Enter, or
# EUR. Before anything is written the bank is asked about the new pair through
# the stand, with the stand's own keys (POST /api/jobs/bank-probe): a pair it
# does not answer about is not written. Then the stand is restarted and says
# what it read of each account:
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh --add-account
#
# The test stand is the default. Production is named out loud, with --prod;
# --from-test gives it the keys and the list of accounts the test stand
# already holds, from one env file to the other on this server, shown to
# nobody:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh --prod --from-test
set -euo pipefail

STAND=test
OFF=""
FROM_TEST=""
ONLY_ACCOUNT=""
ADD_ACCOUNT=""
for arg in "$@"; do
  case "$arg" in
    --prod) STAND=prod ;;
    --off) OFF=yes ;;
    --from-test) FROM_TEST=yes ;;
    --account) ONLY_ACCOUNT=yes ;;
    --add-account) ADD_ACCOUNT=yes ;;
    *) echo "Не понимаю «${arg}». Без добавок — тестовый стенд; --prod — боевой; --off — убрать ключи; --from-test (с --prod) — взять ключи и счета тестового стенда; --account — только счёт в лари; --add-account — добавить счёт в долларах или евро. Ничего не изменено."; exit 2 ;;
  esac
done
[ -z "$FROM_TEST" ] || [ "$STAND" = prod ] || { echo "--from-test имеет смысл только с --prod. Ничего не изменено."; exit 2; }
[ -z "$FROM_TEST" ] || [ -z "$OFF" ] || { echo "--from-test и --off вместе не бывают. Ничего не изменено."; exit 2; }
[ -z "$ONLY_ACCOUNT" ] || [ -z "$OFF$FROM_TEST$ADD_ACCOUNT" ] || { echo "--account идёт один (можно с --prod). Ничего не изменено."; exit 2; }
[ -z "$ADD_ACCOUNT" ] || [ -z "$OFF$FROM_TEST" ] || { echo "--add-account идёт один (можно с --prod). Ничего не изменено."; exit 2; }

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

# An account and the currency written after it, as «IBAN CUR»; CUR is empty
# when none is written. Status 1: not an account.
split_account() {
  local a
  a=$(printf '%s' "$1" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')
  [[ "$a" =~ ^(GE[0-9]{2}[A-Z]{2}[0-9]{16})([A-Z]{3})?$ ]] || return 1
  printf '%s %s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
}

# The pairs of account and currency a list names, one by one, into IBANS and
# CURS — GEL where no currency is written. NOW holds them as they may be shown,
# «··NNNN CUR», never the whole number; what is not an account is not printed
# at all. BAD is set when any is not an account in GEL, USD or EUR: the stand
# then reads none of them.
pairs_of() {
  local item iban currency; local -a items=()
  read -ra items <<< "${1//[,;]/ }"
  IBANS=(); CURS=(); NOW=(); BAD=""
  for item in ${items[@]+"${items[@]}"}; do
    item=$(printf '%s' "$item" | tr '[:lower:]' '[:upper:]')
    if [[ "$item" =~ ^(GE[0-9]{2}[A-Z]{2}[0-9]{16})([A-Z]{3})?$ ]]; then
      iban=${BASH_REMATCH[1]}; currency=${BASH_REMATCH[2]:-GEL}
      case "$currency" in GEL|USD|EUR) ;; *) BAD=yes ;; esac
      IBANS+=("$iban"); CURS+=("$currency"); NOW+=("··${iban: -4} $currency")
    else
      BAD=yes; NOW+=("не номер счёта")
    fi
  done
}

# The pairs the env file names now.
current_accounts() { pairs_of "$(sed -n 's/^BOG_ACCOUNT=//p' "$ENV" | tail -n 1)"; }

# The pairs as they are shown, in one line.
shown() { local joined; joined=$(printf '%s, ' ${NOW[@]+"${NOW[@]}"}); printf '%s' "${joined%, }"; }

# The pairs as the env file takes them: one line, apart by commas, with an
# account in lari bare, as every stand had it before the dollars.
list_of() {
  local i=0 item list=""
  while [ "$i" -lt ${#IBANS[@]} ]; do
    item=${IBANS[$i]}
    [ "${CURS[$i]}" = GEL ] || item=$item${CURS[$i]}
    list=${list:+$list,}$item
    i=$((i + 1))
  done
  printf '%s' "$list"
}

# --account writes one account in place of whatever the env file names: what
# is there is shown first, and replaced only on «да». Nothing named: the stand
# reads the account of the last statement uploaded, and there is nothing to ask.
confirm_replace() {
  local answer
  current_accounts
  case ${#NOW[@]} in
    0) echo "Сейчас счёт не записан ($NAME): стенд читает счёт последней загруженной выписки Bank of Georgia."; return 0 ;;
    1) read -rp "Сейчас записан счёт ${NOW[0]} ($NAME). Заменить? да/нет: " answer ;;
    *) read -rp "Сейчас записаны счета $(shown) ($NAME); --account оставит один, в лари, — счета в валюте уйдут из списка. Заменить? да/нет: " answer ;;
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

# With no account named, a stand reads the account of the last statement in
# lari uploaded to it (accountsFor, apps/api/src/lib/bog.ts): that one, only
# read, and not printed.
account_on_stand() {
  # shellcheck disable=SC2016 # the variables are the database container's own
  "${COMPOSE[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt -c "select account from statements where bank = '"'"'bog'"'"' and source = '"'"'file'"'"' and currency = '"'"'GEL'"'"' and account is not null order by created_at desc limit 1"' 2>/dev/null < /dev/null || true
}

ask_account() {
  local typed
  read -rp "счёт в лари, GE…BG… (Enter — взять из последней выписки Bank of Georgia на боевом): " typed
  if [ -n "${typed//[[:space:]]/}" ]; then
    ACCOUNT=$(as_account "$typed") || case $? in
      2) echo "Это счёт не в лари: после номера стоит другая валюта. Сюда вписывается только счёт в лари — GE00BG0000000000000000 или GE00BG0000000000000000GEL. Счёт в долларах или евро добавляется к списку так: ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh$FLAG --add-account. Ничего не изменено."; exit 1 ;;
      *) echo "Это не похоже на счёт: нужен номер вида GE00BG0000000000000000. Ничего не изменено."; exit 1 ;;
    esac
  else
    ACCOUNT=$(as_account "$(account_from_prod)") || { echo "На боевом нет загруженной выписки Bank of Georgia со счётом в лари — впишите счёт сами. Ничего не изменено."; exit 1; }
    echo "Счёт взят из последней выписки Bank of Georgia на боевом: …${ACCOUNT: -4}."
  fi
}

# New keys need not mean new accounts: a list the env file names already stays
# as it is, the accounts in dollars and euros with it, and is shown. With none,
# the account in lari is asked for, as before.
keep_or_ask() {
  current_accounts
  if [ ${#IBANS[@]} -gt 0 ] && [ -z "$BAD" ]; then
    LIST=$(list_of)
    echo "Счета остаются, как записаны ($NAME): $(shown). Заменить счёт в лари — --account, добавить счёт в валюте — --add-account."
  else
    [ -z "$BAD" ] || echo "В списке счетов ($NAME) есть запись, которая не похожа на счёт в GEL, USD или EUR: $(shown). Её место займёт счёт в лари."
    ask_account
    LIST=$ACCOUNT
  fi
}

# A stand whose release is older than the module keeps the keys in its env
# file and does nothing with them; it is not restarted for them.
reads_keys() { "${COMPOSE[@]}" exec -T api test -f src/lib/bog.ts < /dev/null > /dev/null 2>&1; }

# One older than the accounts in dollars cannot ask the bank about an account
# before it is written.
asks_pairs() { "${COMPOSE[@]}" exec -T api grep -q bank-probe src/routes/jobs.ts < /dev/null > /dev/null 2>&1; }

restart() {
  echo "Перезапускаю ${NAME}…"
  "${COMPOSE[@]}" up -d api worker > /dev/null 2>&1 < /dev/null || { echo "Стенд не перезапустился. Смотреть: docker compose -p $PROJECT logs api"; exit 1; }
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$PROJECT-api-1" 2>/dev/null < /dev/null)" = healthy ] && return 0
    sleep 2
  done
  echo "Стенд не поднялся за минуту. Смотреть: docker compose -p $PROJECT logs api"; exit 1
}

# Our words for why the bank gave nothing about one account.
pair_why() {
  case "$1" in
    forbidden|not_found) echo "банк не даёт читать этот счёт в этой валюте (ответ $2). Проверьте номер и права пользователя в Business Online" ;;
    unauthorized) echo "банк не принял ключи (ответ $2)" ;;
    rate_limited) echo "банк просит подождать (ответ $2); стенд спросит снова через пять минут" ;;
    network) echo "с сервера не удалось достучаться до банка; стенд спросит снова через пять минут" ;;
    http) echo "банк ответил $2; стенд спросит снова через пять минут" ;;
    *) echo "банк ответил не так, как ожидалось ($1 $2). Это нужно показать разработчику" ;;
  esac
}

# Ask the bank once, through the stand's own pull, and say what came. The
# container reads the worker token from its own environment; what it prints is
# a status, a count and at most one of our own words for a failure — and,
# when the stand reads more than the one account in lari, the same for each
# account, by its last four digits. A stand just restarted asks the bank by
# itself first: while it is busy, it is asked again, for a minute.
ask_stand() {
  local answer first pairs last4 currency listed added failure status refused="" i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    answer=$("${COMPOSE[@]}" exec -T api node --input-type=module -e '
      const r = await fetch("http://127.0.0.1:8080/api/jobs/bog-today", { method: "POST", headers: { "x-worker-token": process.env.WORKER_TOKEN } });
      const a = r.ok ? await r.json() : { status: "failed", failure: "stand", httpStatus: r.status };
      if (a.status === "ok") console.log("ok", a.listed, a.added);
      else if (a.status === "failed") console.log("failed", a.failure, a.httpStatus ?? "-");
      else console.log(a.status);
      const each = a.status === "ok" ? (a.accounts ?? []) : [];
      if (each.length > 1 || each.some((p) => p.currency !== "GEL"))
        for (const p of each) console.log("pair", p.last4, p.currency, p.listed, p.added, p.failure ?? "-", p.httpStatus ?? "-");
    ' 2>/dev/null < /dev/null || echo "failed stand -")
    [ "$answer" = busy ] || break
    [ "$i" -lt 12 ] || break
    sleep 5
  done
  first=${answer%%$'\n'*}
  pairs=$(printf '%s\n' "$answer" | grep '^pair ' || true)
  # shellcheck disable=SC2086 # three plain words, split on purpose
  set -- $first
  case "${1:-}" in
    ok)
      if [ -z "$pairs" ]; then
        echo "Готово: стенд читает Bank of Georgia сам. Сегодня операций в банке: ${2:-0}, новых строк в «Разобрать»: ${3:-0}. Дальше — каждые пять минут, и раз в ночь полная выписка за вчера ($URL → Деньги → Выписки)."
        return 0
      fi
      echo "Стенд читает Bank of Georgia сам, каждый счёт отдельно. Сегодня:"
      while read -r _ last4 currency listed added failure status; do
        if [ "$failure" != - ]; then
          refused=yes
          echo "  ··$last4 $currency — $(pair_why "$failure" "$status")."
        elif [ "$currency" = GEL ]; then
          echo "  ··$last4 $currency — операций в банке: $listed, новых строк в «Разобрать»: $added."
        else
          echo "  ··$last4 $currency — операций в банке: $listed, новых строк: $added; они в блоке «Операции в валюте», вне итогов в ₾."
        fi
      done <<< "$pairs"
      [ -z "$refused" ] || { echo "Счета, по которым банк ответил, стенд читает; остальные — нет, пока банк о них не ответит ($URL → Деньги → Выписки)."; exit 1; }
      echo "Готово. Дальше — каждые пять минут, и раз в ночь полная выписка за вчера по каждому счёту ($URL → Деньги → Выписки)." ;;
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

# Ask the bank about one pair through the stand, with the stand's own keys:
# they never leave its container. The account goes in on standard input, not
# as an argument of any process; what comes back is our word and a status
# code, such as «forbidden 403», and nothing of the bank's answer.
probe_pair() {
  printf '{"bank":"bog","account":"%s","currency":"%s"}' "$1" "$2" | docker exec -i "$PROJECT-api-1" node --input-type=module -e '
    let body = "";
    for await (const chunk of process.stdin) body += chunk;
    const r = await fetch("http://127.0.0.1:8080/api/jobs/bank-probe", { method: "POST", headers: { "x-worker-token": process.env.WORKER_TOKEN, "content-type": "application/json" }, body });
    const a = r.ok ? await r.json() : { code: "stand", httpStatus: r.status };
    console.log(a.code, a.httpStatus ?? "-");
  ' 2>/dev/null || echo "stand -"
}

# --add-account: one more pair of account and currency at the end of the
# list, the pairs written so far kept as they are, into LIST. The bank is
# asked about the new pair before anything is written.
add_account() {
  local lari="" typed parts iban currency choice answer i
  current_accounts
  [ -z "$BAD" ] || { echo "В списке счетов ($NAME) есть запись, которая не похожа на счёт в GEL, USD или EUR: $(shown). Стенд сейчас не читает Bank of Georgia вовсе. Сначала счёт в лари: ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh$FLAG --account. Ничего не изменено."; exit 1; }
  if [ ${#IBANS[@]} -eq 0 ]; then
    # Nothing named: the stand reads the account of its last statement in
    # lari. It goes into the list first, so that the lari are read as now.
    lari=$(as_account "$(account_on_stand)") || { echo "Стенд не знает счёта в лари: в env-файле его нет, выписок Bank of Georgia в лари на стенд не загружено. Сначала он: ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh$FLAG --account. Ничего не изменено."; exit 1; }
    IBANS=("$lari"); CURS=(GEL); NOW=("··${lari: -4} GEL")
    echo "Сейчас счёт не записан ($NAME): стенд читает счёт последней загруженной выписки, ··${lari: -4} GEL. Он встанет в список первым, чтобы лари читались, как сейчас."
  else
    echo "Сейчас стенд читает ($NAME): $(shown)."
    i=0
    while [ "$i" -lt ${#IBANS[@]} ]; do
      if [ "${CURS[$i]}" = GEL ]; then lari=${IBANS[$i]}; break; fi
      i=$((i + 1))
    done
  fi

  if [ -n "$lari" ]; then
    read -rp "Счёт в долларах или евро, GE…BG… (Enter — тот же номер, что у счёта в лари, ··${lari: -4}): " typed
  else
    read -rp "Счёт в долларах или евро, GE…BG…: " typed
  fi
  if [ -z "${typed//[[:space:]]/}" ]; then
    [ -n "$lari" ] || { echo "Нужен номер счёта. Ничего не изменено."; exit 1; }
    iban=$lari; currency=""
  else
    parts=$(split_account "$typed") || { echo "Это не похоже на счёт: нужен номер вида GE00BG0000000000000000. Ничего не изменено."; exit 1; }
    iban=${parts%% *}; currency=${parts#* }
  fi
  case "$currency" in
    "")
      echo "Валюта счёта: 1 — доллары (USD), 2 — евро (EUR)."
      read -rp "1 или 2 (Enter — USD): " choice
      case "$(printf '%s' "$choice" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')" in
        ""|1|USD) currency=USD ;;
        2|EUR) currency=EUR ;;
        *) echo "Не понимаю «${choice}»: нужно 1 или 2. Ничего не изменено."; exit 1 ;;
      esac ;;
    USD|EUR) ;;
    GEL) echo "Это счёт в лари, а --add-account добавляет счёт в долларах или евро. Счёт в лари меняет: ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh$FLAG --account. Ничего не изменено."; exit 1 ;;
    *) echo "Стенд читает счета в GEL, USD и EUR, а не в $currency. Ничего не изменено."; exit 1 ;;
  esac
  i=0
  while [ "$i" -lt ${#IBANS[@]} ]; do
    if [ "${IBANS[$i]}" = "$iban" ] && [ "${CURS[$i]}" = "$currency" ]; then echo "Счёт ··${iban: -4} $currency уже в списке ($NAME): стенд его читает. Ничего не изменено."; exit 0; fi
    i=$((i + 1))
  done

  echo "Спрашиваю банк о счёте ··${iban: -4} $currency — со стенда, его ключами…"
  answer=$(probe_pair "$iban" "$currency")
  # shellcheck disable=SC2086 # two plain words, split on purpose
  set -- $answer
  case "${1:-}" in
    ok) echo "Банк отвечает по счёту ··${iban: -4} $currency." ;;
    no_currency) echo "Банк знает счёт ··${iban: -4} в лари, но не в $currency (ответ ${2:--}): у счёта в $currency, похоже, свой номер. Запустите ещё раз и впишите его. Ничего не изменено."; exit 1 ;;
    not_found) echo "Банк не знает счёта ··${iban: -4} в $currency (ответ ${2:--}). Проверьте номер в Business Online. Ничего не изменено."; exit 1 ;;
    forbidden) echo "Банк не даёт ключам стенда читать счёт ··${iban: -4} в $currency (ответ ${2:--}). В Business Online дайте пользователю, на которого выпущены ключи, право смотреть этот счёт, и запустите ещё раз. Ничего не изменено."; exit 1 ;;
    unauthorized) echo "Банк не принял ключи стенда (ответ ${2:--}). Выпустите новые в Business Online и положите их: ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-bog-keys.sh$FLAG. Ничего не изменено."; exit 1 ;;
    rate_limited) echo "Банк просит подождать (ответ ${2:--}). Запустите ещё раз через несколько минут. Ничего не изменено."; exit 1 ;;
    network) echo "С сервера не удалось достучаться до банка. Запустите ещё раз позже. Ничего не изменено."; exit 1 ;;
    off) echo "Стенд не видит ключей Bank of Georgia. Это нужно показать разработчику. Ничего не изменено."; exit 1 ;;
    http)
      case "${2:-}" in 5??) echo "Шлюз банка сейчас занят (ответ $2). Запустите ещё раз через несколько минут. Ничего не изменено."; exit 1 ;; esac
      echo "Банк ответил ${2:--}. Это нужно показать разработчику. Ничего не изменено."; exit 1 ;;
    *) echo "Ответ не тот, что ожидался (${1:-?} ${2:--}). Это нужно показать разработчику. Ничего не изменено."; exit 1 ;;
  esac

  IBANS+=("$iban"); CURS+=("$currency"); NOW+=("··${iban: -4} $currency")
  LIST=$(list_of)
  echo "Записываю ($NAME): $(shown)."
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

if [ -n "$ADD_ACCOUNT" ]; then
  grep -q '^BOG_CLIENT_SECRET=.' "$ENV" || { echo "На этом стенде нет ключей Bank of Georgia — сначала они: … set-bog-keys.sh$FLAG. Ничего не изменено."; exit 1; }
  asks_pairs || { echo "На этом стенде версия старше той, что читает счета в долларах и евро. Ничего не изменено."; exit 1; }
  add_account
  printf 'BOG_ACCOUNT=%s\n' "$LIST" | write_env 'ACCOUNT'
  unset LIST
  restart
  ask_stand
  echo "Операции нового счёта за прошлые дни, до 31 дня назад, стенд дочитает сам в течение часа: они — в блоке «Операции в валюте» на $URL → Деньги → Выписки, вне итогов в ₾."
  exit 0
fi

# Letters, digits and the few marks keys are made of — nothing an env file or
# curl's config could read as a quote, a comment or a variable.
safe() { [ ${#1} -ge "$2" ] && case "$1" in *[!A-Za-z0-9._~+/=-]*) false ;; esac; }

LIST=""
if [ -n "$FROM_TEST" ]; then
  ID=$(sed -n 's/^BOG_CLIENT_ID=//p' "$TEST_ENV" | tail -n 1)
  SECRET=$(sed -n 's/^BOG_CLIENT_SECRET=//p' "$TEST_ENV" | tail -n 1)
  LIST=$(sed -n 's/^BOG_ACCOUNT=//p' "$TEST_ENV" | tail -n 1)
  [ -n "$ID" ] && [ -n "$SECRET" ] || { echo "На тестовом стенде ключей нет — переносить нечего. Ничего не изменено."; exit 1; }
else
  read -rp "client id: " ID
  read -rsp "client secret (вставьте и нажмите Enter; на экране он не виден): " SECRET; echo
  ID=${ID//[[:space:]]/}; SECRET=${SECRET//[[:space:]]/}
fi
safe "$ID" 4 || { echo "Это не похоже на client id: пустой или с лишними символами. Ничего не изменено."; exit 1; }
safe "$SECRET" 16 || { echo "Это не похоже на client secret: короче 16 символов или с лишними символами. Ничего не изменено."; exit 1; }
if [ -n "$FROM_TEST" ]; then
  # The list goes over as the test stand reads it, every account with it.
  pairs_of "$LIST"
  if [ ${#NOW[@]} -eq 0 ]; then echo "Счёт на тестовом стенде не записан: боевой будет читать счёт последней загруженной на него выписки."; else echo "Счета с тестового стенда: $(shown)."; fi
else
  keep_or_ask
fi

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
{ printf 'BOG_CLIENT_ID=%s\nBOG_CLIENT_SECRET=%s\n' "$ID" "$SECRET"; [ -z "$LIST" ] || printf 'BOG_ACCOUNT=%s\n' "$LIST"; } | write_env 'CLIENT_ID|CLIENT_SECRET|ACCOUNT'
unset ID SECRET LIST

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
