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
# Nothing in EV8 Ops reads the keys yet: statements by API (B11-03) are not
# built. So the stand is not restarted and nothing of it changes; the keys wait
# in the env file for that release. Before writing, the script asks the bank
# once from this server — a token, then the National Bank's dollar rate through
# the API — and says whether the bank let it in. Nothing received is printed.
# Keys the bank refused are not written. With --off they are removed.
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
  ENV=/srv/ev8-prod/.env.prod; NAME="боевой стенд"
else
  ENV=$TEST_ENV; NAME="тестовый стенд"
fi
[ -f "$ENV" ] || { echo "Нет файла $ENV."; exit 1; }

TOKEN_URL=https://account.bog.ge/auth/realms/bog/protocol/openid-connect/token
API_URL=https://api.businessonline.ge/api/rates/nbg/USD

write_env() { # the old BOG_CLIENT_* lines out, the new ones (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -Ev '^BOG_CLIENT_(ID|SECRET)=' "$ENV" > "$tmp" || true
  cat >> "$tmp"
  mv "$tmp" "$ENV"
}

if [ -n "$OFF" ]; then
  write_env < /dev/null
  echo "Ключи Bank of Georgia убраны ($NAME)."
  exit 0
fi

# Letters, digits and the few marks keys are made of — nothing an env file or
# curl's config could read as a quote, a comment or a variable.
safe() { [ ${#1} -ge "$2" ] && case "$1" in *[!A-Za-z0-9._~+/=-]*) false ;; esac; }

if [ -n "$FROM_TEST" ]; then
  ID=$(sed -n 's/^BOG_CLIENT_ID=//p' "$TEST_ENV" | tail -n 1)
  SECRET=$(sed -n 's/^BOG_CLIENT_SECRET=//p' "$TEST_ENV" | tail -n 1)
  [ -n "$ID" ] && [ -n "$SECRET" ] || { echo "На тестовом стенде ключей нет — переносить нечего. Ничего не изменено."; exit 1; }
else
  read -rp "client id: " ID
  read -rsp "client secret (вставьте и нажмите Enter; на экране он не виден): " SECRET; echo
  ID=${ID//[[:space:]]/}; SECRET=${SECRET//[[:space:]]/}
fi
safe "$ID" 4 || { echo "Это не похоже на client id: пустой или с лишними символами. Ничего не изменено."; exit 1; }
safe "$SECRET" 16 || { echo "Это не похоже на client secret: короче 16 символов или с лишними символами. Ничего не изменено."; exit 1; }

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
printf 'BOG_CLIENT_ID=%s\nBOG_CLIENT_SECRET=%s\n' "$ID" "$SECRET" | write_env
unset ID SECRET

case "$API" in
  200|429) echo "Готово: банк принял ключи, API отвечает этому серверу. Ключи записаны ($NAME); выписки по ним появятся с релизом, в котором они читаются." ;;
  401|403) echo "Ключи записаны ($NAME): банк их принял, но API ответил $API. Скорее всего, в Business Online вписан не тот IP (нужен 204.168.149.105) или у выбранного пользователя нет прав на счета." ; exit 1 ;;
  000) echo "Ключи записаны ($NAME): банк их принял, но до API с сервера достучаться не удалось. Это нужно показать разработчику."; exit 1 ;;
  *) echo "Ключи записаны ($NAME): банк их принял, API ответил $API. Это нужно показать разработчику."; exit 1 ;;
esac
