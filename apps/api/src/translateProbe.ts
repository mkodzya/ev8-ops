// The one test request deploy/set-anthropic-key.sh asks for once it has put
// the translator's key on a stand (ADR-0042). Through the app's own door: is
// the key one, and does the model translate a fixed, invented note into the
// other two languages.
//
//   npx tsx src/translateProbe.ts   →   ok <input tokens> <output tokens> | off | failed <our word> <status>
//
// Status words and counts only: never the key, the note or the service's answer.
import { TranslatorError, translateText, translatorConfig } from './lib/translator.js';

/** Invented for the probe: no moped, repair or person of the company's. */
const NOTE = 'Заменили задние тормозные колодки на EV-0000, мопед снова в парке.';

async function main(): Promise<string> {
  const cfg = translatorConfig();
  if (!cfg) return 'off';
  try {
    const answer = await translateText(cfg, NOTE);
    if (!answer.ok) return `failed ${answer.failure} -`;
    // The note is Russian; a translator that says otherwise, or leaves a language out, is not working.
    if (answer.lang !== 'ru' || !answer.ka || !answer.en) return 'failed bad_answer -';
    return `ok ${answer.usage.inputTokens} ${answer.usage.outputTokens}`;
  } catch (err) {
    if (err instanceof TranslatorError) return `failed ${err.failure} ${err.httpStatus ?? '-'}`;
    return 'failed stand -';
  }
}

main().then((said) => {
  console.log(said);
  process.exit(0);
});
