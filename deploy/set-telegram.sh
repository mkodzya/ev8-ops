#!/bin/bash
# Switch on the notices to the workshop's Telegram group (ADR-0038 §6–7) on a
# stand. Mika runs it, and pastes the bot's token and the group's id here: both
# are read without echo, written only into the stand's env file (mode 600) and
# passed to the API container as environment variables. They never appear in
# the shell history, the process list, the output or any log, and neither is
# ever an argument of any command. The script writes the stand's own address
# beside them, for the link under each notice.
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-telegram.sh
#
# The bot is the owner's own (Mika, 21.10.2026: «новый бот, который я заведу
# сам, и одна группа мастерской»): made with @BotFather, which gives the token
# once; a token that leaked is replaced there (/revoke) and this script is run
# again. The bot is added to the workshop's group; the group's id is a
# negative number (a supergroup's starts with -100) — @BotFather does not show
# it, a bot such as @RawDataBot added to the group for a moment does.
#
# EV8 Ops only sends: it asks Telegram who the bot is and sends messages, and
# never asks for updates — it does not disturb another program the same bot
# may answer through a webhook.
#
# After writing them the script restarts the API, asks Telegram whether the
# token is a bot's and sends ONE test message to the group, through the
# stand's own client. What it prints is a status word — never the token, the
# group or Telegram's answer. With --off the three lines are removed and the
# notices go quiet: they are still written, and a notice a day old when the
# link comes back is given up rather than sent late.
#
# The test stand is the default. Production is named out loud, with --prod,
# and needs a release that carries the notices — on an older one the script
# says so and writes nothing:
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-telegram.sh --prod
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/set-telegram.sh --prod --from-test
#
# --from-test gives production the token and the group the test stand already
# holds: the two lines go from one env file to the other on this server and
# are shown to nobody. Production's own address is written for its links.
# Both stands then write to the same group — the test stand is switched off
# with --off once production is on, or given a group of its own. Like
# deploy-prod.sh, this script is read from the test checkout and works on
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
    *) echo "Не понимаю «$arg». Без добавок — тестовый стенд; --prod — боевой; --off — выключить уведомления; --from-test (с --prod) — взять бота и группу тестового стенда. Ничего не изменено."; exit 2 ;;
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

write_env() { # the old TELEGRAM_* and PUBLIC_URL lines out, the new ones (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -Ev '^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|PUBLIC_URL)=' "$ENV" > "$tmp" || true
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
  echo "Уведомления в Telegram выключены ($NAME): в группу ничего не уходит."
  exit 0
fi

# A stand whose release is older than the notices would take the token and do
# nothing with it: say so before anything is asked or written.
"${COMPOSE[@]}" exec -T api test -f src/telegramProbe.ts < /dev/null \
  || { echo "$ON ещё нет уведомлений в Telegram: на нём версия старше той, в которой они появились. Ничего не записано, ничего не изменено."; exit 1; }

if [ -n "$FROM_TEST" ]; then
  # From one env file to the other; the lines pass through a pipe and no screen.
  grep -Eq '^TELEGRAM_BOT_TOKEN=[0-9]+:[A-Za-z0-9_-]{30,}$' "$TEST_ENV" && grep -Eq '^TELEGRAM_CHAT_ID=-?[0-9]+$' "$TEST_ENV" \
    || { echo "На тестовом стенде бота или группы нет — переносить нечего. Ничего не изменено."; exit 1; }
  { grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=' "$TEST_ENV" | tail -n 2; printf 'PUBLIC_URL=%s\n' "$URL"; } | write_env
else
  # -s: neither is shown as it is pasted.
  read -rsp "Токен бота от @BotFather (вставьте и нажмите Enter; на экране он не виден): " T; echo
  T=${T//[[:space:]]/}
  # The bot's number, a colon and the secret: nothing an env file could read
  # as a quote, a comment or a variable.
  [[ "$T" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || { echo "Это не похоже на токен бота: он выглядит как число, двоеточие и длинная строка букв. Ничего не изменено."; exit 1; }
  read -rsp "Номер группы мастерской (отрицательное число, например -100…; на экране не виден): " C; echo
  C=${C//[[:space:]]/}
  [[ "$C" =~ ^-?[0-9]+$ ]] || { echo "Номер группы — это число (у группы оно отрицательное). Ничего не изменено."; exit 1; }

  # printf is a shell builtin: neither value is in any process's arguments.
  printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\nPUBLIC_URL=%s\n' "$T" "$C" "$URL" | write_env
  unset T C
fi

restart

# Through the stand's own client: is the token a bot's, and does the group
# take one test message. The container reads both from its own environment;
# what it prints is a status and at most one of our own words for a failure.
ANSWER=$("${COMPOSE[@]}" exec -T api npx tsx src/telegramProbe.ts 2>/dev/null < /dev/null || echo "failed stand -")
# shellcheck disable=SC2086 — three plain words, split on purpose
set -- $ANSWER

case "${1:-}" in
  ok)
    echo "Готово ($NAME): бот принят, в группу ушло тестовое сообщение — проверьте, что оно пришло."
    echo "Теперь туда приходят: ремонт ждёт согласования, согласован, отклонён, закрыт; пора на ТО; деталь ниже минимума — со ссылкой на $URL."
    if [ -n "$FROM_TEST" ]; then
      echo "Тестовый стенд пишет в ту же группу. Выключить его: ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-telegram.sh --off"
    fi
    ;;
  off)
    echo "Записано, но стенд не видит бота или группу. Это нужно показать разработчику."
    exit 1
    ;;
  *)
    case "${2:-}" in
      unauthorized)   echo "Telegram не принял токен (ответ ${3:-401}). Возьмите токен у @BotFather ещё раз и запустите этот скрипт снова." ;;
      chat_not_found) echo "Telegram не знает такую группу или бота в ней нет (ответ ${3:-400}). Добавьте бота в группу, проверьте номер и запустите скрипт снова." ;;
      chat_moved)     echo "Группа стала супергруппой с новым номером (он начинается с -100). Запустите скрипт снова с новым номером." ;;
      forbidden)      echo "Бот не может писать в эту группу (ответ ${3:-403}): его удалили или запретили ему писать. Верните права и запустите скрипт снова." ;;
      rate_limited)   echo "Telegram просит подождать. Бот и группа записаны; запустите скрипт снова через минуту." ;;
      network)        echo "С сервера не удалось достучаться до Telegram. Бот и группа записаны; уведомления пойдут, когда связь появится." ;;
      stand)          echo "Записано, но стенд не смог спросить Telegram. Это нужно показать разработчику." ;;
      *)              echo "Telegram ответил не так, как ожидалось (${2:-?} ${3:--}). Записано; это нужно показать разработчику." ;;
    esac
    echo "Выключить уведомления: … set-telegram.sh$FLAG --off"
    exit 1
    ;;
esac
