// Bring running rentals over from a list (lib/rentalLoader.ts).
//
//   tsx src/loadRentals.ts --owner <email> < list.json             check only: nothing is written
//   tsx src/loadRentals.ts --owner <email> --commit < list.json    write
//
// The list comes on standard input and goes nowhere else: no file is written,
// and the report names no phone, personal number or address. On a stand it is
// run by deploy/load-rentals.sh, by the owner.
import { closeDb } from './lib/db.js';
import { brief, exitCodeOf, formatLoadReport, loadRentals } from './lib/rentalLoader.js';

const USAGE = 'Запуск: tsx src/loadRentals.ts --owner <e-mail владельца> [--commit] < список.json';

function args(argv: string[]): { owner: string; commit: boolean } | null {
  let owner = process.env.OWNER_EMAIL ?? '';
  let commit = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--commit') commit = true;
    else if (argv[i] === '--owner' && argv[i + 1]) owner = argv[++i]!;
    // A mistyped flag is not read as "check only": it is refused.
    else return null;
  }
  return { owner, commit };
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const a = args(process.argv.slice(2));
  if (!a || process.stdin.isTTY) {
    console.log(a ? `Список не передан: он приходит на вход, из файла.\n${USAGE}` : USAGE);
    return 2;
  }
  const report = await loadRentals({ text: await stdin(), ownerEmail: a.owner, commit: a.commit });
  console.log(formatLoadReport(report));
  return exitCodeOf(report);
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    // Never the list itself: an unexpected failure says what broke, not what was in a row.
    console.error(`Загрузчик остановился: ${brief(err)}`);
    await closeDb();
    process.exit(2);
  });
