#!/bin/bash
# Switch on the translation of typed texts (ADR-0042) on a stand. Mika runs it,
# and pastes the key of his own Anthropic account here: it is read without
# echo, written only into the stand's env file (mode 600) and passed to the
# API container as an environment variable. It never appears in the shell
# history, the process list, the output or any log, and it is never an
# argument of any command.
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-anthropic-key.sh
#
# The key is created in the Anthropic Console (Settings → API keys) and shown
# once; a key that leaked is deleted there and this script is run again. What
# it pays for is set in the Console too: the translator asks Claude Haiku 5.5
# (Mika, 21.10.2026), one note per request, at most 500 notes a day per stand.
#
# What is sent is only what is typed about mopeds and repairs — the reasons
# of a state change, what happened, a mechanic's works, notes and refusals,
# the reasons a part or a battery moved, the notes of a moped, a point, a
# workshop. Texts about customers, rentals, payments, deposits, the bank,
# sales and purchases are never sent (answer A, packages/shared/src/typed.ts).
#
# After writing it the script restarts the API and asks the translator ONE
# fixed, invented note through the stand's own door. What it prints is a
# status word and the tokens that note took — never the key or the service's
# answer. With --off the key is removed: nothing is sent, the texts wait and
# every screen shows the originals.
#
# The test stand is the default. It is a copy of production
# (copy-prod-to-test.sh): with a key there, the real notes of production go
# to the translator too, so the script says so and asks before it asks for
# the key. Production is named out loud, with --prod, and needs a release that
# carries the translation — on an older one the script says so and writes
# nothing:
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-anthropic-key.sh --prod
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-anthropic-key.sh --prod --from-test
#
# --from-test gives production the key the test stand already holds: the line
# goes from one env file to the other on this server and is shown to nobody.
# Like deploy-prod.sh, this script is read from the test checkout and works on
# /srv/ev8-prod when told to.
set -euo pipefail

STAND=test
OFF=""
FROM_TEST=""
for arg in "$@"; do
  case "$arg" in
    --prod) STAND=prod ;;
    --off) OFF=yes ;;
    --from-test) FROM_TEST=yes ;;
    *) echo "Не понимаю «$arg». Без добавок — тестовый стенд; --prod — боевой; --off — выключить перевод; --from-test (с --prod) — взять ключ тестового стенда. Ничего не изменено."; exit 2 ;;
  esac
done
[ -z "$FROM_TEST" ] || [ "$STAND" = prod ] || { echo "--from-test имеет смысл только с --prod. Ничего не изменено."; exit 2; }
[ -z "$FROM_TEST" ] || [ -z "$OFF" ] || { echo "--from-test и --off вместе не бывают. Ничего не изменено."; exit 2; }

TEST_ENV=/srv/ev8-ops/.env.test
if [ "$STAND" = prod ]; then
  DIR=/srv/ev8-prod; PROJECT=ev8-prod; ENV=.env.prod
  NAME="боевой стенд"; ON="На боевом стенде"; FLAG=" --prod"
else
  DIR=/srv/ev8-ops; PROJECT=ev8-test; ENV=.env.test
  NAME="тестовый стенд"; ON="На тестовом стенде"; FLAG=""
fi
cd "$DIR"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV" -f docker-compose.prod.yml)
[ -f "$ENV" ] || { echo "Нет файла $DIR/$ENV."; exit 1; }

write_env() { # the old ANTHROPIC_API_KEY line out, the new one (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -v '^ANTHROPIC_API_KEY=' "$ENV" > "$tmp" || true
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
  echo "Перевод выключен ($NAME): переводчику ничего не уходит, на экранах — тексты как написаны."
  exit 0
fi

# A stand whose release is older than the translation would take the key and
# do nothing with it: say so before anything is asked or written.
"${COMPOSE[@]}" exec -T api test -f src/translateProbe.ts < /dev/null \
  || { echo "$ON ещё нет перевода текстов: на нём версия старше той, в которой он появился. Ничего не записано, ничего не изменено."; exit 1; }

if [ -n "$FROM_TEST" ]; then
  # From one env file to the other; the line passes through a pipe and no screen.
  grep -Eq '^ANTHROPIC_API_KEY=sk-ant-[A-Za-z0-9_-]{20,}$' "$TEST_ENV" \
    || { echo "На тестовом стенде ключа нет — переносить нечего. Ничего не изменено."; exit 1; }
  grep -E '^ANTHROPIC_API_KEY=' "$TEST_ENV" | tail -n 1 | write_env
else
  if [ "$STAND" = test ]; then
    echo "Тестовый стенд — копия боевой базы: с ключом настоящие заметки о мопедах и ремонтах уйдут переводчику (не больше 500 в день)."
    echo "Тексты о клиентах, арендах, деньгах, продажах и закупках не уходят никогда."
    read -rp "Продолжить — Enter, отменить — Ctrl+C. " _
  fi
  # -s: the key is not shown as it is pasted.
  read -rsp "Ключ Anthropic API из Console (вставьте и нажмите Enter; на экране он не виден): " K; echo
  K=${K//[[:space:]]/}
  # sk-ant-, then letters, digits, - and _: nothing an env file could read as a
  # quote, a comment or a variable.
  [[ "$K" =~ ^sk-ant-[A-Za-z0-9_-]{20,}$ ]] || { echo "Это не похоже на ключ Anthropic API: он начинается с sk-ant- и дальше длинная строка букв и цифр. Ничего не изменено."; exit 1; }
  # printf is a shell builtin: the key is in no process's arguments.
  printf 'ANTHROPIC_API_KEY=%s\n' "$K" | write_env
  unset K
fi

restart

# Through the stand's own door: is the key one, and does the model translate
# one invented note. The container reads the key from its own environment;
# what it prints is a status and the tokens, or one of our own words.
ANSWER=$("${COMPOSE[@]}" exec -T api npx tsx src/translateProbe.ts 2>/dev/null < /dev/null || echo "failed stand -")
# shellcheck disable=SC2086 — three plain words, split on purpose
set -- $ANSWER

case "${1:-}" in
  ok)
    echo "Готово ($NAME): ключ принят, проверочная заметка переведена (${2:-?} токенов на входе, ${3:-?} на выходе)."
    echo "Переводы появятся на экранах в течение минуты-двух. Сколько ушло за день — в логе worker:"
    echo "  docker compose -p $PROJECT logs worker | grep -i translat"
    ;;
  off)
    echo "Записано, но стенд не видит ключа. Это нужно показать разработчику."
    exit 1
    ;;
  *)
    case "${2:-}" in
      unauthorized) echo "Anthropic не принял ключ (ответ ${3:-401}). Создайте ключ в Console заново и запустите этот скрипт снова." ;;
      billing)      echo "На счёте Anthropic нет денег для запросов (ответ ${3:--}). Пополните баланс в Console → Billing; ключ записан, перевод пойдёт сам." ;;
      no_model)     echo "Этому ключу недоступна модель переводчика (ответ ${3:-404}). Это нужно показать разработчику." ;;
      rate_limited) echo "Anthropic просит подождать. Ключ записан; перевод пойдёт сам через минуту." ;;
      overloaded)   echo "Anthropic сейчас перегружен. Ключ записан; перевод пойдёт сам, когда сервис ответит." ;;
      network)      echo "С сервера не удалось достучаться до Anthropic. Ключ записан; перевод пойдёт, когда связь появится." ;;
      refused|too_long|bad_answer) echo "Модель не перевела проверочную заметку (${2}). Ключ записан; это нужно показать разработчику." ;;
      stand)        echo "Записано, но стенд не смог спросить переводчика. Это нужно показать разработчику." ;;
      *)            echo "Anthropic ответил не так, как ожидалось (${2:-?} ${3:--}). Ключ записан; это нужно показать разработчику." ;;
    esac
    echo "Выключить перевод: … set-anthropic-key.sh$FLAG --off"
    exit 1
    ;;
esac
