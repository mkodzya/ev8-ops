// A contract signed in Signify, marked here (ADR-0039). One file, so the
// Georgian goes to proofreading as one list
// (docs/qa/contract-signed-in-signify-ka-strings.md).

export const contractSignedEn = {
  signedElsewhere: {
    /** The button beside "Sign on the screen". */
    mark: 'Signed in Signify',
    /** The state of the row once marked: when, and who marked it. */
    state: (at: string, by: string | null) => (by ? `signed in Signify ${at} · ${by}` : `signed in Signify ${at}`),
    title: 'The contract is signed in Signify',
    hint: 'The customer signed the contract in Signify or on paper. EV8 Ops stops asking for a signature: the rental leaves “Not signed” and “Today”. The mark goes to the journal under your name.',
    drive: 'Open the contract in Drive',
    note: 'Note',
    noteHint: 'Optional — for example, where the signed copy is.',
    submit: 'Mark as signed',
    done: 'Marked: the contract is signed in Signify',
    undo: 'Remove the mark',
    undoTitle: 'Remove the “signed in Signify” mark',
    undoHint: 'The contract will be asked for again — in the list and on “Today”. The journal keeps who marked it and when.',
    reason: 'Why the mark is removed',
    reasonHint: 'Required. It goes to the journal — for example, «marked on the wrong rental».',
    undone: 'The mark is removed',
  },
};

export const contractSignedRu: typeof contractSignedEn = {
  signedElsewhere: {
    mark: 'Подписан в Signify',
    state: (at, by) => (by ? `подписан в Signify ${at} · ${by}` : `подписан в Signify ${at}`),
    title: 'Договор подписан в Signify',
    hint: 'Клиент подписал договор в Signify или на бумаге. EV8 Ops больше не просит подпись: аренда уходит из «Не подписан» и с «Сегодня». Отметка попадёт в журнал с вашим именем.',
    drive: 'Открыть договор в Drive',
    note: 'Заметка',
    noteHint: 'Необязательно — например, где лежит подписанный экземпляр.',
    submit: 'Отметить подписанным',
    done: 'Отмечено: договор подписан в Signify',
    undo: 'Снять отметку',
    undoTitle: 'Снять отметку «подписан в Signify»',
    undoHint: 'Договор снова попросит подпись — в списке и на «Сегодня». В журнале останется, кто и когда его отметил.',
    reason: 'Почему снимаем',
    reasonHint: 'Обязательно. Уйдёт в журнал — например, «отметили не ту аренду».',
    undone: 'Отметка снята',
  },
};

export const contractSignedKa: typeof contractSignedEn = {
  signedElsewhere: {
    mark: 'ხელმოწერილია Signify-ში',
    state: (at, by) => (by ? `ხელმოწერილია Signify-ში ${at} · ${by}` : `ხელმოწერილია Signify-ში ${at}`),
    title: 'ხელშეკრულება ხელმოწერილია Signify-ში',
    hint: 'კლიენტმა ხელშეკრულებას ხელი მოაწერა Signify-ში ან ქაღალდზე. EV8 Ops აღარ მოითხოვს ხელმოწერას: ქირა აღარ გამოჩნდება „ხელმოუწერელში“ და „დღეს“-ზე. მონიშვნა ჩაიწერება ჟურნალში თქვენი სახელით.',
    drive: 'ხელშეკრულების გახსნა Drive-ში',
    note: 'შენიშვნა',
    noteHint: 'არასავალდებულო — მაგალითად, სად ინახება ხელმოწერილი ეგზემპლარი.',
    submit: 'მონიშვნა ხელმოწერილად',
    done: 'მოინიშნა: ხელშეკრულება ხელმოწერილია Signify-ში',
    undo: 'მონიშვნის მოხსნა',
    undoTitle: 'მონიშვნის „ხელმოწერილია Signify-ში“ მოხსნა',
    undoHint: 'ხელშეკრულება კვლავ მოითხოვს ხელმოწერას — სიაში და „დღეს“-ზე. ჟურნალში დარჩება, ვინ და როდის მონიშნა.',
    reason: 'რატომ იხსნება',
    reasonHint: 'სავალდებულოა. ჩაიწერება ჟურნალში — მაგალითად, «სხვა ქირა მოინიშნა».',
    undone: 'მონიშვნა მოიხსნა',
  },
};
