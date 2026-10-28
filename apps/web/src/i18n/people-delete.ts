// Settings → People: deleting a login nobody ever signed in with and to which
// nothing is recorded (GitHub issue #17, item 5; ADR-0049). Everybody else
// keeps only «Switch off». One file, so the Georgian goes to proofreading as
// one list (docs/qa/issue-17-rented-free-and-four-fixes-ka-strings.md).

export const peopleDeleteEn = {
  peopleDelete: {
    /** The button in the person's row. */
    remove: 'Delete',
    /** What the button does, on hover and beside it. */
    hint: 'Nobody ever signed in with this login and nothing is recorded to it: it can be deleted, and its email is free again.',
    title: 'Delete the login',
    /** The email in brackets when there is one: a mechanic on the tablet has none. */
    ask: (name: string, email: string | null) =>
      `Delete ${email ? `${name} (${email})` : name}? Nobody ever signed in with it and nothing is recorded to it. The email is free again: a new login can be made with it. A deletion cannot be undone.`,
    cta: 'Delete the login',
    done: (name: string) => `${name}: login deleted`,
  },
};

export const peopleDeleteRu: typeof peopleDeleteEn = {
  peopleDelete: {
    remove: 'Удалить',
    hint: 'Через этот вход ни разу не входили и за ним ничего не записано: его можно удалить, почта освободится.',
    title: 'Удалить вход',
    ask: (name: string, email: string | null) =>
      `Удалить ${email ? `${name} (${email})` : name}? Через этот вход ни разу не входили, за ним ничего не записано. Почта освободится — с ней можно завести вход заново. Удаление не отменить.`,
    cta: 'Удалить вход',
    done: (name: string) => `${name}: вход удалён`,
  },
};

export const peopleDeleteKa: typeof peopleDeleteEn = {
  peopleDelete: {
    remove: 'წაშლა',
    hint: 'ამ შესვლით არავინ შესულა და მასზე არაფერია ჩაწერილი: შეიძლება წაიშალოს, ელფოსტა გათავისუფლდება.',
    title: 'შესვლის წაშლა',
    ask: (name: string, email: string | null) =>
      `წავშალოთ ${email ? `${name} (${email})` : name}? ამ შესვლით არავინ შესულა და მასზე არაფერია ჩაწერილი. ელფოსტა გათავისუფლდება — მისით ახალი შესვლის შექმნა შეიძლება. წაშლის გაუქმება შეუძლებელია.`,
    cta: 'შესვლის წაშლა',
    done: (name: string) => `${name}: შესვლა წაიშალა`,
  },
};
