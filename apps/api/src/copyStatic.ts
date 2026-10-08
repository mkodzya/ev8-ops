// The static part of a stand, carried to another (lib/staticCopy.ts): models,
// points, customer cards, the list of mopeds.
//
//   tsx src/copyStatic.ts export                     this stand's static rows, as JSON on standard output
//   tsx src/copyStatic.ts import < set.json          check only: nothing is written
//   tsx src/copyStatic.ts import --commit < set.json write
//
// Models, points and cards go by default; `--mopeds` adds the list of mopeds.
// `--owner <email>` names the owner the rows are written in the name of where
// a stand has several. The set goes
// from one command to the other through a pipe and nowhere else: no file is
// written. On the server it is run by deploy/copy-static-to-prod.sh, by the
// owner.
import { closeDb } from './lib/db.js';
import { brief } from './lib/rentalLoader.js';
import { copyStatic, formatStaticReport, readStatic, staticExitCode } from './lib/staticCopy.js';

const USAGE = 'Запуск: tsx src/copyStatic.ts export | tsx src/copyStatic.ts import [--commit] [--mopeds] [--owner <e-mail владельца>]';

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'export' && rest.length === 0) {
    // The set and nothing else: whatever reads this reads JSON.
    const json = JSON.stringify(await readStatic());
    // Wait for the pipe to take all of it: an exit before that would cut the set short.
    await new Promise<void>((done, fail) => process.stdout.write(json, (e) => (e ? fail(e) : done())));
    return 0;
  }
  if (command !== 'import') {
    console.log(USAGE);
    return 2;
  }
  let owner: string | null = null;
  let commit = false;
  let mopeds = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--commit') commit = true;
    else if (rest[i] === '--mopeds') mopeds = true;
    else if (rest[i] === '--owner' && rest[i + 1]) owner = rest[++i]!;
    else {
      // A mistyped flag is not read as "check only": it is refused.
      console.log(USAGE);
      return 2;
    }
  }
  if (process.stdin.isTTY) {
    console.log(`Данные не переданы: они приходят на вход от команды export.\n${USAGE}`);
    return 2;
  }
  const report = await copyStatic({ text: await stdin(), ownerEmail: owner, commit, mopeds });
  console.log(formatStaticReport(report));
  return staticExitCode(report);
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    // Never the rows themselves: an unexpected failure says what broke, not what was in a card.
    console.error(`Перенос остановился: ${brief(err)}`);
    await closeDb();
    process.exit(2);
  });
