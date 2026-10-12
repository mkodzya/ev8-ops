#!/bin/sh
# Cuts a release from develop and puts it on production — run by Mika, on
# Mika's Mac, from the main checkout:
#
#   deploy/release.sh 1.5.2 "the due day has its WhatsApp text"
#
# Until 12.10.2026 a Claude session did these steps itself on Mika's word.
# That day the session's permission system refused them — a release is a
# production deploy — so the steps live here and Mika runs the line. The
# session builds the tool, Mika runs the command, as with every other write
# to a stand (docs/handoff.md §4).
#
# What it does, in order:
#   1. checks — Mika's git identity, a clean develop level with GitHub,
#      nothing on main that develop does not hold, a version above the
#      current one;
#   2. release/X.Y.Z in its own worktree: the version in the five
#      package.json, one commit;
#   3. main: merge --no-ff and an annotated tag X.Y.Z, pushed together or
#      not at all;
#   4. develop: the release branch merged back and pushed; the branch and
#      the worktree removed;
#   5. production: deploy-prod.sh X.Y.Z on the server — it copies the
#      database first and stops if the copy does not restore;
#   6. the test stand follows develop.
# Run again after a failure it goes on from the first step that is not
# done. --no-deploy stops after step 4.
#
# It never forces a push and never rewrites a branch. The release is NOT
# written into docs/handoff.md here: the session records it afterwards.
set -eu

OWNER=mika@selfstudio.se
SERVER=root@204.168.149.105
OPS=/srv/ev8-ops

DEPLOY=1
if [ "${1:-}" = "--no-deploy" ]; then
  DEPLOY=0
  shift
fi
VERSION="${1:-}"
TITLE="${2:-}"

say() { printf '\n— %s\n' "$*"; }
stop() {
  printf '\nОСТАНОВЛЕНО: %s\n' "$*" >&2
  exit 1
}

echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || stop "нужен номер версии: deploy/release.sh 1.5.2 \"что в релизе\""

cd "$(dirname "$0")/.."
REPO=$(pwd)
BRANCH="release/$VERSION"
WT="$REPO/../_worktrees/ev8-ops-release-$VERSION"

# ── 1. Checks ────────────────────────────────────────────────────────────
[ "$(git config user.email)" = "$OWNER" ] || stop "релизы выпускает только Mika ($OWNER)."
[ "$(git rev-parse --abbrev-ref HEAD)" = "develop" ] || stop "основная папка проекта должна стоять на ветке develop."
[ -z "$(git status --porcelain)" ] || stop "в папке проекта есть незаписанные правки — сначала их закоммитить или убрать."

say "Сверяюсь с GitHub"
git fetch -q --tags origin
git merge-base --is-ancestor origin/develop develop || stop "develop на GitHub ушёл вперёд — нужен git pull."

on_github() { [ -n "$(git ls-remote --tags origin "refs/tags/$VERSION")" ]; }
here() { git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; }

if on_github; then
  say "Тег $VERSION уже на GitHub — релиз собран раньше, иду дальше"
else
  if here; then
    # A run that built the release and could not push it: the tag holds it.
    say "Тег $VERSION собран в прошлый раз, но не отправлен — отправляю"
  else
    # ── 2. The release branch ────────────────────────────────────────────
    [ -n "$TITLE" ] || stop "нужно название релиза вторым словом в кавычках: deploy/release.sh $VERSION \"что в релизе\""
    [ "$(git rev-parse develop)" = "$(git rev-parse origin/develop)" ] || stop "в develop есть коммиты, которых нет на GitHub — сначала git push."
    [ -z "$(git rev-list --no-merges origin/main ^develop)" ] || stop "на main есть правки, которых нет в develop — релиз из develop их потеряет. Нужен разбор."
    [ -n "$(git rev-list --no-merges origin/main..develop)" ] || stop "в develop нет ничего нового после прошлого релиза."
    NOW=$(sed -n 's/.*"version": "\([0-9.]*\)".*/\1/p' package.json | head -1)
    [ "$NOW" != "$VERSION" ] || stop "версия $VERSION уже стоит в package.json."
    [ "$(printf '%s\n%s\n' "$NOW" "$VERSION" | sort -V | tail -1)" = "$VERSION" ] || stop "версия $VERSION меньше текущей $NOW."

    say "Собираю релиз $VERSION (было $NOW): в него входит"
    git log --no-merges --format='   %s' origin/main..develop | cut -c1-110

    # Leftovers of a run that stopped before the tag hold nothing but the
    # version commit: start that part again.
    if [ -d "$WT" ]; then git worktree remove --force "$WT"; fi
    git worktree prune
    git worktree add -q -B "$BRANCH" "$WT" develop
    for f in package.json apps/api/package.json apps/worker/package.json apps/web/package.json packages/shared/package.json; do
      sed -i '' "s/\"version\": \"$NOW\"/\"version\": \"$VERSION\"/" "$WT/$f"
      grep -q "\"version\": \"$VERSION\"" "$WT/$f" || stop "не удалось поставить версию в $f."
    done
    git -C "$WT" commit -q -am "The Packages Say $VERSION"

    # ── 3. main and the tag ──────────────────────────────────────────────
    # On a detached HEAD at GitHub's main, so no local branch has to be
    # checked out or moved.
    git -C "$WT" checkout -q --detach origin/main
    git -C "$WT" merge -q --no-ff "$BRANCH" -m "Release $VERSION — $TITLE" -m "Released on Mika's word; cut by deploy/release.sh."
    git -C "$WT" tag -a "$VERSION" -m "Release $VERSION — $TITLE"
  fi
  say "Отправляю main и тег $VERSION на GitHub"
  git push -q --atomic origin "$(git rev-parse "refs/tags/$VERSION^{commit}"):refs/heads/main" "refs/tags/$VERSION" || stop "GitHub не принял main и тег $VERSION — ничего не выложено. Запустите команду ещё раз или покажите вывод Claude."
  git fetch -q origin
fi

# The release commit is the second parent of main's merge.
RELEASE=$(git rev-parse "refs/tags/$VERSION^{commit}^2")
git merge-base --is-ancestor "refs/tags/$VERSION^{commit}" origin/main || stop "тег $VERSION не на main — это не релиз. Нужен разбор."

# ── 4. Back into develop ─────────────────────────────────────────────────
if git merge-base --is-ancestor "$RELEASE" develop; then
  say "Релиз уже влит обратно в develop"
else
  say "Вливаю релиз обратно в develop"
  git merge -q --no-ff "$RELEASE" -m "Merge release/$VERSION back into develop"
fi
git push -q origin develop
if [ -d "$WT" ]; then git worktree remove --force "$WT"; fi
git worktree prune
if git rev-parse -q --verify "refs/heads/$BRANCH" >/dev/null; then git branch -q -d "$BRANCH"; fi
# The local main follows GitHub's; it is not checked out anywhere.
git fetch -q origin main:main 2>/dev/null || true

if [ "$DEPLOY" = 0 ]; then
  say "Релиз $VERSION собран и отправлен. На боевой НЕ выложен (--no-deploy)."
  exit 0
fi

# ── 5. Production ────────────────────────────────────────────────────────
say "Выкладываю $VERSION на боевой (сначала копия базы; сборка идёт несколько минут)"
ssh -o ConnectTimeout=20 "$SERVER" "$OPS/deploy/deploy-prod.sh" "$VERSION" || stop "боевой НЕ обновлён — что случилось, написано выше. Запустите команду ещё раз или покажите вывод Claude."

# ── 6. The test stand ────────────────────────────────────────────────────
say "Обновляю тестовый стенд"
ssh -o ConnectTimeout=20 "$SERVER" "$OPS/deploy/follow-develop.sh" --now || echo "   тестовый стенд не обновился — на боевой это не влияет."

say "ГОТОВО: на боевом $VERSION. Скажите Claude «готово» — он проверит стенд и запишет релиз."
