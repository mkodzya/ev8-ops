// One form of a name on every card, from a list (lib/nameSetter.ts).
//
//   tsx src/setNames.ts < names.json             check only: nothing is written
//   tsx src/setNames.ts --commit < names.json    write
//
// The cards are changed in the name of the stand's only owner; where there
// are several, `--owner <email>` names one.
//
// The list comes on standard input and goes nowhere else: no file is written.
// The report prints names — the Latin one and the Georgian one — and nothing
// else of a card. On a stand it is run by deploy/set-names.sh, by the owner.
import { closeDb } from './lib/db.js';
import { formatNamesReport, namesExitCode, setNames } from './lib/nameSetter.js';
import { brief } from './lib/rentalLoader.js';

const USAGE = 'Запуск: tsx src/setNames.ts [--commit] [--owner <e-mail владельца>] < список.json';

function args(argv: string[]): { owner: string | null; commit: boolean } | null {
  let owner: string | null = null;
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
  const report = await setNames({ text: await stdin(), ownerEmail: a.owner, commit: a.commit });
  console.log(formatNamesReport(report));
  return namesExitCode(report);
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    // Never the list itself: an unexpected failure says what broke, not what was in a row.
    console.error(`Запись имён остановилась: ${brief(err)}`);
    await closeDb();
    process.exit(2);
  });
