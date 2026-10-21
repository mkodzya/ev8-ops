// The one test notice deploy/set-telegram.sh asks for once it has put the
// bot's token and the workshop's group on a stand (stage 6, plan «Сдан»: «тестовое
// уведомление пришло в чат, который указал владелец»). Through the app's own
// client: is the token a bot's, and does the group take a message from it.
//
//   npx tsx src/telegramProbe.ts   →   ok | off | failed <our word> <status>
//
// Status words only: never the token, the group, or Telegram's answer.
import { twoLanguages } from './lib/noticeWords.js';
import { TelegramError, telegramClient, telegramConfig } from './lib/telegram.js';

async function main(): Promise<string> {
  const cfg = telegramConfig();
  if (!cfg) return 'off';
  const client = telegramClient(cfg);
  try {
    await client.getMe();
    await client.sendMessage(cfg.chatId, twoLanguages((w) => w.probe, '/service'));
    return 'ok';
  } catch (err) {
    if (err instanceof TelegramError) return `failed ${err.failure} ${err.httpStatus ?? '-'}`;
    return 'failed stand -';
  }
}

main().then((said) => {
  console.log(said);
  process.exit(0);
});
