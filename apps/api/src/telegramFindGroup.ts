// Finds the workshop's group for deploy/set-telegram.sh, so the owner pastes
// only the bot's token (stage 6, ADR-0038 §7). The token comes on stdin —
// never an argument — and is not printed; what is printed is the groups the
// bot was added to, most recent last, one per line as «group<TAB>id<TAB>title»,
// or «none», or «failed <our word> <status>».
//
//   printf '%s\n' "$TOKEN" | npx tsx src/telegramFindGroup.ts
import { TelegramError, telegramClient } from './lib/telegram.js';

async function readToken(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text.trim();
}

async function main(): Promise<string> {
  const token = await readToken();
  if (!/^\d+:[\w-]{30,}$/.test(token)) return 'failed bad_token -';
  try {
    const groups = await telegramClient({ token, chatId: '0' }).findGroups();
    if (groups.length === 0) return 'none';
    // A title is the group's own words: no tab or line break may split the answer.
    return groups.map((g) => `group\t${g.id}\t${g.title.replace(/[\t\r\n]+/g, ' ')}`).join('\n');
  } catch (err) {
    if (err instanceof TelegramError) return `failed ${err.failure} ${err.httpStatus ?? '-'}`;
    return 'failed stand -';
  }
}

main().then((said) => {
  console.log(said);
  process.exit(0);
});
