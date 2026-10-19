#!/bin/bash
# Put the Google Drive key on a stand (ADR-0031). Mika runs it from his own
# computer, with the service account's JSON key on its standard input and the
# rentals folder — its link or its id — as the argument:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-drive-key.sh <folder link> < ~/Desktop/ev8-drive-key.json
#
# The key never appears in the shell history, the process list, the output or
# any log: it comes in on standard input and is written, in base64, only into
# the stand's env file (mode 600) as DRIVE_SA_KEY; the folder as DRIVE_ROOT.
# Then the stand is restarted to take them and asked once to read Drive: what
# it prints is counts or one of our own words for a failure, no names.
#
# The account is a Google service account the company made in its own Google
# Cloud project, with the Drive API on, and the rentals folder shared with it
# as a viewer — read only. EV8 Ops writes nothing to Drive.
#
# The test stand is the default. Production is named out loud, with --prod;
# --from-test gives it what the test stand already holds, from one env file to
# the other on this server, shown to nobody:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-drive-key.sh --prod --from-test
#
# With --off the key is removed and the link goes off.
set -euo pipefail

STAND=test
OFF=""
FROM_TEST=""
FOLDER=""
for arg in "$@"; do
  case "$arg" in
    --prod) STAND=prod ;;
    --off) OFF=yes ;;
    --from-test) FROM_TEST=yes ;;
    -*) echo "Не понимаю «$arg». Без добавок — тестовый стенд; --prod — боевой; --off — убрать ключ; --from-test (с --prod) — взять с тестового. Ничего не изменено."; exit 2 ;;
    *) FOLDER="$arg" ;;
  esac
done
[ -z "$FROM_TEST" ] || [ "$STAND" = prod ] || { echo "--from-test имеет смысл только с --prod. Ничего не изменено."; exit 2; }

TEST_ENV=/srv/ev8-ops/.env.test
if [ "$STAND" = prod ]; then
  DIR=/srv/ev8-prod; PROJECT=ev8-prod; ENV=/srv/ev8-prod/.env.prod; NAME="боевой стенд"; URL=https://ops.ev8.ge
else
  DIR=/srv/ev8-ops; PROJECT=ev8-test; ENV=$TEST_ENV; NAME="тестовый стенд"; URL=https://test.ops.ev8.ge
fi
[ -f "$ENV" ] || { echo "Нет файла $ENV."; exit 1; }
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV" -f "$DIR/docker-compose.prod.yml")

write_env() { # DRIVE_ lines out, the new ones (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -Ev '^DRIVE_(SA_KEY|ROOT)=' "$ENV" > "$tmp" || true
  cat >> "$tmp"
  mv "$tmp" "$ENV"
}

reads_drive() { "${COMPOSE[@]}" exec -T api test -f src/lib/drive.ts < /dev/null > /dev/null 2>&1; }

restart() {
  echo "Перезапускаю $NAME…"
  "${COMPOSE[@]}" up -d api worker > /dev/null 2>&1 < /dev/null || { echo "Стенд не перезапустился. Смотреть: docker compose -p $PROJECT logs api"; exit 1; }
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$PROJECT-api-1" 2>/dev/null < /dev/null)" = healthy ] && return 0
    sleep 2
  done
  echo "Стенд не поднялся за минуту. Смотреть: docker compose -p $PROJECT logs api"; exit 1
}

# Read Drive once, through the stand's own job. The container takes the worker
# token from its own environment; it prints a status and counts.
ask_stand() {
  local answer
  answer=$("${COMPOSE[@]}" exec -T api node --input-type=module -e '
    const r = await fetch("http://127.0.0.1:8080/api/jobs/drive-scan", { method: "POST", headers: { "x-worker-token": process.env.WORKER_TOKEN } });
    const a = r.ok ? await r.json() : { status: "failed", failure: "stand", httpStatus: r.status };
    if (a.status === "ok") console.log("ok", a.folders, a.files, a.matched);
    else if (a.status === "failed") console.log("failed", a.failure, a.httpStatus ?? "-");
    else console.log(a.status);
  ' 2>/dev/null < /dev/null || echo "failed stand -")
  # shellcheck disable=SC2086 — plain words, split on purpose
  set -- $answer
  case "${1:-}" in
    ok)   echo "Готово: стенд читает Drive. Папок: ${2:-0}, документов: ${3:-0}, папок со своей арендой: ${4:-0}. Дальше — раз в ночь и по кнопке ($URL → Настройки → Drive)." ;;
    busy) echo "Готово: стенд как раз читает Drive. Через минуту откройте $URL → Настройки → Drive." ;;
    off)  echo "Стенд не видит ключа. Это нужно показать разработчику."; exit 1 ;;
    *)
      case "${2:-}" in
        unauthorized) echo "Google не принял ключ (ответ ${3:--}). Создайте новый ключ JSON у служебного аккаунта и запустите ещё раз." ;;
        forbidden|not_found) echo "Папка не видна служебному аккаунту (ответ ${3:--}). Проверьте, что папка открыта его почте как «Читатель», и ссылку на папку." ;;
        no_sections) echo "В папке не нашлись папки идущих и завершённых аренд. Нужна папка, в которой лежат обе (например, «0Rentals 2026»)." ;;
        network) echo "С сервера не удалось достучаться до Google. Стенд прочитает Drive ночью сам." ;;
        *) echo "Google ответил не так, как ожидалось (${2:-?} ${3:--}). Это нужно показать разработчику." ;;
      esac
      exit 1 ;;
  esac
}

if [ -n "$OFF" ]; then
  write_env < /dev/null
  if reads_drive; then restart; fi
  echo "Ключ Drive убран ($NAME): связь с Drive выключена."
  exit 0
fi

if [ -n "$FROM_TEST" ]; then
  KEY=$(sed -n 's/^DRIVE_SA_KEY=//p' "$TEST_ENV" | tail -n 1)
  ROOT=$(sed -n 's/^DRIVE_ROOT=//p' "$TEST_ENV" | tail -n 1)
  [ -n "$KEY" ] && [ -n "$ROOT" ] || { echo "На тестовом стенде ключа нет — переносить нечего. Ничего не изменено."; exit 1; }
else
  # The folder: a link from the address bar, or the id alone.
  ROOT=$(printf '%s' "$FOLDER" | sed -E 's#.*/folders/([A-Za-z0-9_-]+).*#\1#; s#[?].*##')
  [[ "$ROOT" =~ ^[A-Za-z0-9_-]{10,}$ ]] || { echo "Нужна ссылка на папку аренд в Drive (или её id) после имени скрипта. Ничего не изменено."; exit 1; }
  [ ! -t 0 ] || { echo "Ключ подаётся файлом: … set-drive-key.sh <ссылка> < ~/Desktop/ev8-drive-key.json. Ничего не изменено."; exit 1; }
  JSON=$(cat)
  case "$JSON" in
    *'"service_account"'*'"private_key"'*'"client_email"'*|*'"service_account"'*'"client_email"'*'"private_key"'*) ;;
    *) unset JSON; echo "Это не похоже на ключ служебного аккаунта Google (JSON). Ничего не изменено."; exit 1 ;;
  esac
  KEY=$(printf '%s' "$JSON" | base64 | tr -d '\n')
  unset JSON
fi

printf 'DRIVE_SA_KEY=%s\nDRIVE_ROOT=%s\n' "$KEY" "$ROOT" | write_env
unset KEY
echo "Ключ записан ($NAME)."
reads_drive || { echo "На этом стенде версия старше той, что читает Drive: ключ подождёт её. Готово."; exit 0; }
restart
ask_stand
