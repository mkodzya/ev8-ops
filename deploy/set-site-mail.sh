#!/bin/bash
# Switch on the email for queue requests from the site (POST /api/site/queue)
# on the test stand. Mika runs it, and types the mailbox's app password here:
# it is read without echo, written only into .env.test (mode 600) and passed
# to the API container as an environment variable. It never appears in the
# shell history, the process list, the output or any log.
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-site-mail.sh
#
# The mailbox is a Google one: smtp.gmail.com, port 465. The password is an
# "app password" (myaccount.google.com/apppasswords), made for this alone —
# never the mailbox's own password. An app password is revoked on its own and
# cannot sign in through a browser, but it is NOT limited to sending: a mail
# program can read that mailbox with it. A mailbox kept only for sending is
# the safer sender.
# With --off the settings are removed and the route answers 503 again.
#
# Production is not touched: its settings go into .env.prod with the launch
# of the site, on Mika's word.
set -euo pipefail

cd /srv/ev8-ops
ENV=.env.test
COMPOSE=(docker compose -p ev8-test --env-file "$ENV" -f docker-compose.prod.yml)
[ -f "$ENV" ] || { echo "Нет файла $ENV."; exit 1; }

write_env() { # the old SITE_MAIL_* lines out, the new ones (stdin) in; same owner and mode
  local tmp; tmp=$(mktemp "$ENV.XXXXXX")
  chmod 600 "$tmp"
  grep -v '^SITE_MAIL_' "$ENV" > "$tmp" || true
  cat >> "$tmp"
  mv "$tmp" "$ENV"
}

if [ "${1:-}" = "--off" ]; then
  write_env < /dev/null
  "${COMPOSE[@]}" up -d api > /dev/null 2>&1
  echo "Почта для заявок выключена: сайт снова открывает WhatsApp."
  exit 0
fi

read -rp "Ящик, с которого уходят письма [info@ev8.ge]: " BOX; BOX=${BOX:-info@ev8.ge}
read -rp "Куда приходят заявки [$BOX]: " TO; TO=${TO:-$BOX}
read -rsp "Пароль приложения Google (16 букв, пробелы не важны; на экране не виден): " P; echo
P=${P// /}
[ ${#P} -eq 16 ] || { echo "В пароле приложения 16 букв, а введено ${#P}. Ничего не изменено."; exit 1; }
case "$BOX$TO" in *[[:space:]]*) echo "В адресе не должно быть пробелов. Ничего не изменено."; exit 1;; esac

write_env <<EOT
SITE_MAIL_HOST=smtp.gmail.com
SITE_MAIL_PORT=465
SITE_MAIL_USER=$BOX
SITE_MAIL_PASSWORD=$P
SITE_MAIL_TO=$TO
EOT
unset P

echo "Перезапускаю тестовый стенд…"
"${COMPOSE[@]}" up -d api > /dev/null 2>&1 || { echo "Стенд не перезапустился. Смотреть: docker compose -p ev8-test logs api"; exit 1; }
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' ev8-test-api-1 2>/dev/null)" = healthy ] && break
  sleep 2
done

# Ask the mailbox whether it lets us in — without sending anything and without
# printing the password: the container reads it from its own environment.
if "${COMPOSE[@]}" exec -T api node --input-type=module -e '
  import nodemailer from "nodemailer";
  const e = process.env;
  const t = nodemailer.createTransport({ host: e.SITE_MAIL_HOST, port: +e.SITE_MAIL_PORT, secure: +e.SITE_MAIL_PORT === 465, auth: { user: e.SITE_MAIL_USER, pass: e.SITE_MAIL_PASSWORD } });
  t.verify().then(() => process.exit(0)).catch((err) => { console.log(String(err && err.message).slice(0, 200)); process.exit(1); });
'; then
  echo "Готово: ящик $BOX принял вход. Заявки с тестового адреса сайта теперь приходят на $TO."
  echo "Проверка: отправить заявку с https://test.ops.ev8.ge/garage/site/subscription/ и найти письмо в ящике."
else
  echo "Ящик не принял вход (ответ выше). Настройки записаны, но письма не уйдут:"
  echo "проверьте пароль приложения и запустите этот скрипт ещё раз, или выключите: … set-site-mail.sh --off"
  exit 1
fi
