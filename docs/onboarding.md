# Второй разработчик: как Kardu работает с EV8 Ops через Claude

Дата: 28.09.2026. Решение Mika: Kardu ведёт задачи со своим Claude так же, как она, и **сам вливает
их в `develop`**; релизы на прод выпускает только Mika.

Этот файл читает Claude на компьютере Kardu. Сказать ему одной строкой:

> Прочитай docs/onboarding.md и настрой всё по нему.

---

## 1. Кто что делает

| | Mika | Kardu |
|---|---|---|
| Задачи в своих ветках `feature/*` | да | да |
| Слияние в `develop` → тестовый стенд | да | да |
| Релиз: `main`, тег, прод https://ops.ev8.ge | **только Mika** | нет |
| Сервер (SSH), секреты, пароли в базе | только Mika | нет |
| Решения о продукте | Mika | предлагает; спорное — к Mika |

Порядок — как в Self Platform (Mika, 28.09.2026): влитое в `develop` сессия Mika сразу выкатывает на
тестовый стенд https://test.ops.ev8.ge, а на прод — только по слову Mika. У Claude Kardu доступа к
серверу нет: влил — написать Mika, что готово, и это попадёт на тест с ближайшей выкаткой сессии Mika.

Всё остальное — общие правила проекта в `CLAUDE.md`, они одинаковы для обоих.

## 2. Настройка компьютера (один раз)

Нужны: приложение Claude с вкладкой **Code**, Git, **Docker Desktop**, вход в GitHub под `Kardu89`
(доступ к `mkodzya/ev8-ops` и `mkodzya/ev8-handbook` у него есть с правом записи).

Пути — **ровно такие же, как у Mika**: `CLAUDE.md` подключает книгу по адресу
`~/Developer/ev8/handbook`, а инструкции в `docs/handoff.md` написаны от `~/Desktop/claude-mika`.

```bash
mkdir -p ~/Desktop/claude-mika ~/Developer/ev8
git clone git@github.com:mkodzya/ev8-ops.git ~/Desktop/claude-mika/ev8-ops-platform
git clone git@github.com:mkodzya/ev8-handbook.git ~/Developer/ev8/handbook
cd ~/Desktop/claude-mika/ev8-ops-platform
git checkout develop
git config user.name "Kardu Kukhianidze"
git config user.email "<почта Kardu в GitHub>"
git config core.hooksPath .githooks
```

`core.hooksPath` включает `.githooks/pre-push`: он не даёт отправить `main` или тег с чужой учётки.
На платном GitHub это делала бы защита веток; на бесплатном с закрытым репозиторием её нет.

Репозиторий **не класть в iCloud** и в папку с `:` в имени (`docs/handoff.md` §8).

Локальный стенд — **пустая база с демо-набором**, живых данных на этом компьютере нет и не будет
(их нет в репозитории по правилу; живые данные — только на сервере):

```bash
cp .env.example .env    # значения для ноутбука; OWNER_EMAIL и OWNER_NAME поменять на свои
SEED_MODE=demo nice -n 10 docker compose up -d --build
nice -n 10 docker run --rm -v "$PWD":/w -w /w node:22-alpine npm ci --no-audit --no-fund
```

Стенд — http://localhost:5175. Вход — владелец из `.env` (`OWNER_EMAIL`, `OWNER_PASSWORD`, пароль там
учебный, только для ноутбука) и `demo.manager@ev8.test` с тем же паролем. Начать заново с чистым
демо-набором — двойной щелчок по `Reset EV8 Ops (DEMO data).command`. Последняя строка (`npm ci`)
нужна для гейта проверок из `docs/handoff.md` §3: он берёт `node_modules` из этой папки.

Mac на 8 ГБ: одна тяжёлая задача за раз, как в `CLAUDE.md`.

## 3. Одна задача

1. `git pull --ff-only` на `develop`. Посмотреть, что сейчас в работе у Mika: `git branch -r` —
   ветки `feature/*` на GitHub. **Если задача задевает то же место, сначала договориться с Mika.**
2. Ветка в отдельной папке:
   `git worktree add ../_worktrees/ev8-ops-<тема> -b feature/<тема> develop`.
3. Работа, проверка гейтом (`docs/handoff.md` §3) и в браузере; коммит и push по ходу.
4. Готово — в `develop`:
   ```bash
   git checkout develop && git pull --ff-only
   git merge --no-ff feature/<тема> && git push origin develop
   git worktree remove ../_worktrees/ev8-ops-<тема>
   git branch -d feature/<тема> && git push origin --delete feature/<тема>
   ```
   Если `push` отказан, потому что Mika успела влить своё, — `git pull --no-rebase`, разобрать
   конфликт, снова `push`. `push --force` — никогда.
5. Написать Mika, что влито и что проверить. На тест и в релиз это уходит, когда решит Mika.
6. Когда это окажется на тесте — проверить на https://test.ops.ev8.ge со своего телефона.

## 4. Чего Claude у Kardu не делает

- Не отправляет `main` и теги, не выкатывает прод, не ходит на сервер.
- Не пишет в Odoo, не удаляет в Google Drive, не вводит пароли и банковские данные (`CLAUDE.md`).
- Не меняет решения из `docs/adr/` и книги проекта сам: предлагает Mika.
- Не кладёт в репозиторий личные данные клиентов, выписки, снимки базы.

## 5. Что сессии уже знают по опыту

Перенесено из памяти сессий Mika, чтобы было у обоих:

- **Роли в продукте две** — владелец (Mika и Kardu) и менеджер (`docs/redesign/blueprint.md` §0). Книга
  проекта местами описывает старые роли — это расхождение, а не правило.
- **Автор по `git log` не виден точно**: документы дизайнера коммитит разработчик, а коммиты подписаны
  одним человеком. Чужие незакоммиченные правки в рабочей копии — чья-то работа в процессе, их не
  трогать. Нужно знать, кто сделал, — спросить, а не выводить из лога.
- **Ловушки экранной проверки** — `docs/qa/README.md`, раздел «Ловушки».
- **Даты**: продукт живёт по Asia/Tbilisi. Машина в другом поясе видит «вчера» там, где его нет;
  проверять дату по базе (`select now() at time zone 'Asia/Tbilisi'`).
