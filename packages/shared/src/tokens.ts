// EV8 Ops design tokens — generated from packages/shared/tokens.json.
// Do not edit by hand: run `node scripts/tokens.mjs` after changing the JSON.
// Source of the values: docs/design/brand.md (the ev8.ge theme).

/**
 * The tokens as values, for code that draws outside the browser — today the
 * contract and act PDFs. In the interface use the custom properties in
 * apps/web/src/styles/tokens.css instead; importing colours into a component
 * would put the value back in two places.
 */
export const tokens = {
  /** surfaces — The page, the cards on it, and the ink on both. */
  bg: '#fbfbfb', // light-theme page background (--white-background on the site)
  surface: '#ffffff', // cards, panels, table bodies
  surface2: '#f3f3f3', // table headers, soft fills, inactive chips (site --grey-01)
  surfaceHover: '#dbe4de', // the row or card under the pointer — on the site this is what a model card turns when hovered
  ink: '#0b0b0b', // text (--black on the site)
  muted: '#5d5d5d', // secondary text, PDF translations (site --grey-04/07). Neutral, not green-tinted: the site's greys carry no hue
  line: '#dbe4de', // borders and rules (site light grey-green)
  lineSoft: '#ebebeb', // the quieter rule inside a card (site --grey-02)

  /** brand — The greens. On ev8.ge these three are one button's three states — #819481 at rest, #628767 on hover, #557553 when pressed. Here #557553 sits at rest instead (Mika, 15.09.2026): white on #819481 is 2.55:1 and Kardu reads the screen outdoors. The consequence is that hover lightens here where the site darkens; the theme has no darker green and inventing one is not allowed. */
  brand: '#819481', // logo and large marks; the site button at rest. Never text: 3.2:1 on white
  accent: '#557553', // text green: links, status text, primary button at rest — 5.2:1. The site uses it for :active
  accentHover: '#628767', // hover on the primary button and the border of an active element (the site's own :hover)
  accentSoft: '#e3ebe3', // the tint behind an accent pill
  onAccent: '#ffffff', // text on the accent fill
  lime: '#e0ffa2', // the one highlight per screen (--avocado)

  /** states — Vehicle and rental states. Colour is never the only carrier: every state also has a shape and a word (brand.md). */
  rented: '#598eeb', // state rented (--blue-tag)
  service: '#fe5d02', // state in service (--orange)
  serviceInk: '#e45e22', // the darker orange: text on light here, and the site's hover on .button-accent
  crit: '#c8402f', // overdue, written off — added for the ops UI, does not fight the orange
  critSoft: '#f9e3df', // the tint behind a critical pill
  warnSoft: '#fdeadf', // the tint behind a service pill
  infoSoft: '#e4ecfb', // the tint behind a rented pill
  accentInk: '#4d6a4b', // the word inside an available pill — the text green darkened until it clears 4.5:1 on its own tint (4.96). The site never sets these greens as 12px text, so this is ours and is measured, not chosen
  rentedInk: '#2f63c0', // the word inside a rented pill: --blue-tag is 2.7:1 on its tint and unreadable small; this is 4.8:1 and the same blue
  serviceDeep: '#b2450f', // the word inside a service pill: even the darker --service-ink is 3.0:1 on its tint; this is 4.8:1
  critInk: '#b3392a', // the word inside a written-off or overdue pill, 4.8:1 on --crit-soft
  greyInk: '#666666', // the word inside a sold pill, 5.2:1 on --surface-2
  grey: '#7a7a7a', // finished and sold; PDF footers (site --grey-06/03)

  /** paint — What the six colour words look like, so the fleet's colour column can be read at a glance instead of spelled out. These are NOT paint codes: nobody has measured a moped, and Odoo holds a word and not a number. A swatch here depicts the word in the data — `Красный` — and nothing more. A word we do not know keeps being written out, because a guessed swatch would be a claim about a moped. */
  paintBlack: '#1c1c1c', // not the ink: a moped read as black against white ink would disappear into it
  paintWhite: '#ffffff', // invisible on the row, which is why every swatch carries a hairline
  paintRed: '#d24b3a', // a red apart from --crit, which means overdue and must not be mistaken for paint
  paintGreen: '#4f8a4f', // brighter than the brand green: this is a moped, not the wordmark
  paintGrey: '#9a9a9a', // lighter than --grey so it does not read as disabled
  paintPurple: '#7b5ea7', // for იისფერი, the only colour in the data with no Latin twin

  /** rail — The navigation rail is the one dark surface in a light app: brand black with the light logo. */
  rail: '#0b0b0b', // rail background
  railInk: '#c9d3c9', // rail text
  railActive: '#1b211b', // hover inside the rail
  railAccent: '#e0ffa2', // the active rail item
  railLine: '#2a332b', // borders of controls sitting on the rail

  /** effects — Shadow and scrim. Written out here so no component carries a colour literal of its own. */
  shadow: '0 12px 40px rgba(11, 11, 11, 0.16)', // the sheet and the sidebar
  scrim: 'rgba(11, 11, 11, 0.7)', // the dark disc over a photo thumbnail
  scrimSoft: 'rgba(11, 11, 11, 0.32)', // the veil behind a side panel: the same ink as --scrim, lighter, because the list behind it is still the work
  onScrim: '#ffffff', // the glyph on that disc

  /** type — Neither Be Vietnam Pro nor Inter has Georgian glyphs, so Noto Sans Georgian is in every text stack. A face without the glyphs falls back to the system font silently — that is why it is checked on real names in acceptance. */
  display: "'Be Vietnam Pro', 'Noto Sans Georgian', system-ui, -apple-system, 'Segoe UI', sans-serif", // headings, buttons, navigation
  body: "'Be Vietnam Pro', 'Noto Sans Georgian', system-ui, -apple-system, 'Segoe UI', sans-serif", // body text and tables. The site sets body to --main-font, so Be Vietnam Pro leads here too; Inter is the second family
  mono: "'IBM Plex Mono', 'Noto Sans Georgian', ui-monospace, SFMono-Regular, Menlo, monospace", // VIN and money

  /** text — Named text styles. Fourteen of them, because the interface uses fourteen — the point is that they are named and counted, not that a component reaches for a size of its own. Each is a CSS `font` shorthand, so a rule says `font: var(--text-body)` and nothing else. The shorthand resets font-variant, so tabular figures are set by the .t-* class next to it, never by the token. */
  textDisplay: '500 28px/1.1 var(--display)', // the number on a tile, the one figure a screen is about
  textH1: '500 24px/1.15 var(--display)', // the page title
  textH1Phone: '500 22px/1.15 var(--display)', // the same title under 900 px
  textH2: '500 16px/1.25 var(--display)', // a section inside a page
  textH3: '500 14px/1.3 var(--display)', // a subsection, and the head of a card
  textBody: '400 15px/1.45 var(--body)', // running text; the page default
  textBodySm: '400 14px/1.45 var(--body)', // tables, key-value rows, the history feed
  textLabel: '400 13px/1.4 var(--body)', // field labels, hints, tile captions
  textOverline: '500 12px/1.3 var(--display)', // table headers and small caps marks; the class adds the letter-spacing
  textButton: '500 14px/1 var(--display)', // pills and buttons (.button, .button-light on the site)
  textCta: '500 19px/0.92 var(--display)', // the one loud action of a screen (.button-accent on the site)
  textButtonSm: '500 13px/1 var(--display)', // the small pill and the inline field
  textMono: '400 14px/1.45 var(--mono)', // VIN and anything read character by character
  textMoney: '500 14px/1.45 var(--mono)', // sums; the class adds tabular figures and right alignment
  textMonoSm: '400 12px/1.4 var(--mono)', // code quoted inside the interface — token names on /design

  /** motion — Letter-spacing and the one transition, copied from the theme. The CSS `font` shorthand cannot carry tracking, so it lives beside the text styles rather than inside them. */
  trackingTight: '-0.02em', // headings: the site sets -1px at 38px, -0.56px at 28px, -0.4px at 20px — all -0.02em
  trackingButton: '-0.01em', // buttons and chips (.button, .button-light)
  ease: '0.36s cubic-bezier(0.2, 0, 0, 1)', // a colour changing under the pointer. The site writes .3s ease; ours is slower and decelerating, by the owner's decision (15.09.2026) — a working screen is looked at all day and an eased ending reads as softer than the same length linear-in-out
  enter: '0.42s cubic-bezier(0.32, 0.72, 0, 1)', // something arriving over the page — a panel, a sheet, a menu. Slower than a hover and braked hard at the end, so it reads as sliding into place rather than being switched on. An addition: nothing on the site arrives
  undoWindow: '10s', // how long a park move stays undoable, drawn as the line draining under the undo button; the same ten seconds the screen counts and the API enforces
  hairline: '0.82px', // the outline button's border, exactly as the theme writes it

  /** shape — One radius language: pills for buttons and chips, 16 px cards, nothing else. */
  radiusCard: '16px', // cards and panels
  radiusPill: '999px', // buttons and filter chips
  controlDense: '34px', // the same control on a screen driven by a pointer rather than a thumb. From 900px up, where 44px is the thumb's measure and nobody's finger is on the glass
  rowY: '8px', // a list row's air above and below, on a pointer screen. Every list in the system reads this, so a screen tightened here is not tightened again there
  rowX: '10px', // a list row's air left and right, and the gap between its columns
  cardPad: '14px', // inside a card, a tile, a number with its label. Was 18-20px, which is a poster's margin, not a working screen's
  control: '44px', // touch targets no smaller than 44 px (spec §9.2)
  railW: '220px', // the rail on a laptop
} as const;

export type TokenName = keyof typeof tokens;

/**
 * The same tokens with their grouping, their custom-property names and the
 * note that says what each is for. This is what the /design page renders:
 * the page shows the source rather than a second description of it, so a
 * token added to the JSON appears there without anyone writing it twice.
 */
export interface TokenEntry {
  name: TokenName;
  cssVar: string;
  value: string;
  note: string;
}

export interface TokenGroup {
  name: string;
  note: string;
  tokens: TokenEntry[];
}

export const tokenGroups: TokenGroup[] = [
  {
    "name": "surfaces",
    "note": "The page, the cards on it, and the ink on both.",
    "tokens": [
      {
        "name": "bg",
        "cssVar": "--bg",
        "value": "#fbfbfb",
        "note": "light-theme page background (--white-background on the site)"
      },
      {
        "name": "surface",
        "cssVar": "--surface",
        "value": "#ffffff",
        "note": "cards, panels, table bodies"
      },
      {
        "name": "surface2",
        "cssVar": "--surface-2",
        "value": "#f3f3f3",
        "note": "table headers, soft fills, inactive chips (site --grey-01)"
      },
      {
        "name": "surfaceHover",
        "cssVar": "--surface-hover",
        "value": "#dbe4de",
        "note": "the row or card under the pointer — on the site this is what a model card turns when hovered"
      },
      {
        "name": "ink",
        "cssVar": "--ink",
        "value": "#0b0b0b",
        "note": "text (--black on the site)"
      },
      {
        "name": "muted",
        "cssVar": "--muted",
        "value": "#5d5d5d",
        "note": "secondary text, PDF translations (site --grey-04/07). Neutral, not green-tinted: the site's greys carry no hue"
      },
      {
        "name": "line",
        "cssVar": "--line",
        "value": "#dbe4de",
        "note": "borders and rules (site light grey-green)"
      },
      {
        "name": "lineSoft",
        "cssVar": "--line-soft",
        "value": "#ebebeb",
        "note": "the quieter rule inside a card (site --grey-02)"
      }
    ]
  },
  {
    "name": "brand",
    "note": "The greens. On ev8.ge these three are one button's three states — #819481 at rest, #628767 on hover, #557553 when pressed. Here #557553 sits at rest instead (Mika, 15.09.2026): white on #819481 is 2.55:1 and Kardu reads the screen outdoors. The consequence is that hover lightens here where the site darkens; the theme has no darker green and inventing one is not allowed.",
    "tokens": [
      {
        "name": "brand",
        "cssVar": "--brand",
        "value": "#819481",
        "note": "logo and large marks; the site button at rest. Never text: 3.2:1 on white"
      },
      {
        "name": "accent",
        "cssVar": "--accent",
        "value": "#557553",
        "note": "text green: links, status text, primary button at rest — 5.2:1. The site uses it for :active"
      },
      {
        "name": "accentHover",
        "cssVar": "--accent-hover",
        "value": "#628767",
        "note": "hover on the primary button and the border of an active element (the site's own :hover)"
      },
      {
        "name": "accentSoft",
        "cssVar": "--accent-soft",
        "value": "#e3ebe3",
        "note": "the tint behind an accent pill"
      },
      {
        "name": "onAccent",
        "cssVar": "--on-accent",
        "value": "#ffffff",
        "note": "text on the accent fill"
      },
      {
        "name": "lime",
        "cssVar": "--lime",
        "value": "#e0ffa2",
        "note": "the one highlight per screen (--avocado)"
      }
    ]
  },
  {
    "name": "states",
    "note": "Vehicle and rental states. Colour is never the only carrier: every state also has a shape and a word (brand.md).",
    "tokens": [
      {
        "name": "rented",
        "cssVar": "--rented",
        "value": "#598eeb",
        "note": "state rented (--blue-tag)"
      },
      {
        "name": "service",
        "cssVar": "--service",
        "value": "#fe5d02",
        "note": "state in service (--orange)"
      },
      {
        "name": "serviceInk",
        "cssVar": "--service-ink",
        "value": "#e45e22",
        "note": "the darker orange: text on light here, and the site's hover on .button-accent"
      },
      {
        "name": "crit",
        "cssVar": "--crit",
        "value": "#c8402f",
        "note": "overdue, written off — added for the ops UI, does not fight the orange"
      },
      {
        "name": "critSoft",
        "cssVar": "--crit-soft",
        "value": "#f9e3df",
        "note": "the tint behind a critical pill"
      },
      {
        "name": "warnSoft",
        "cssVar": "--warn-soft",
        "value": "#fdeadf",
        "note": "the tint behind a service pill"
      },
      {
        "name": "infoSoft",
        "cssVar": "--info-soft",
        "value": "#e4ecfb",
        "note": "the tint behind a rented pill"
      },
      {
        "name": "accentInk",
        "cssVar": "--accent-ink",
        "value": "#4d6a4b",
        "note": "the word inside an available pill — the text green darkened until it clears 4.5:1 on its own tint (4.96). The site never sets these greens as 12px text, so this is ours and is measured, not chosen"
      },
      {
        "name": "rentedInk",
        "cssVar": "--rented-ink",
        "value": "#2f63c0",
        "note": "the word inside a rented pill: --blue-tag is 2.7:1 on its tint and unreadable small; this is 4.8:1 and the same blue"
      },
      {
        "name": "serviceDeep",
        "cssVar": "--service-deep",
        "value": "#b2450f",
        "note": "the word inside a service pill: even the darker --service-ink is 3.0:1 on its tint; this is 4.8:1"
      },
      {
        "name": "critInk",
        "cssVar": "--crit-ink",
        "value": "#b3392a",
        "note": "the word inside a written-off or overdue pill, 4.8:1 on --crit-soft"
      },
      {
        "name": "greyInk",
        "cssVar": "--grey-ink",
        "value": "#666666",
        "note": "the word inside a sold pill, 5.2:1 on --surface-2"
      },
      {
        "name": "grey",
        "cssVar": "--grey",
        "value": "#7a7a7a",
        "note": "finished and sold; PDF footers (site --grey-06/03)"
      }
    ]
  },
  {
    "name": "paint",
    "note": "What the six colour words look like, so the fleet's colour column can be read at a glance instead of spelled out. These are NOT paint codes: nobody has measured a moped, and Odoo holds a word and not a number. A swatch here depicts the word in the data — `Красный` — and nothing more. A word we do not know keeps being written out, because a guessed swatch would be a claim about a moped.",
    "tokens": [
      {
        "name": "paintBlack",
        "cssVar": "--paint-black",
        "value": "#1c1c1c",
        "note": "not the ink: a moped read as black against white ink would disappear into it"
      },
      {
        "name": "paintWhite",
        "cssVar": "--paint-white",
        "value": "#ffffff",
        "note": "invisible on the row, which is why every swatch carries a hairline"
      },
      {
        "name": "paintRed",
        "cssVar": "--paint-red",
        "value": "#d24b3a",
        "note": "a red apart from --crit, which means overdue and must not be mistaken for paint"
      },
      {
        "name": "paintGreen",
        "cssVar": "--paint-green",
        "value": "#4f8a4f",
        "note": "brighter than the brand green: this is a moped, not the wordmark"
      },
      {
        "name": "paintGrey",
        "cssVar": "--paint-grey",
        "value": "#9a9a9a",
        "note": "lighter than --grey so it does not read as disabled"
      },
      {
        "name": "paintPurple",
        "cssVar": "--paint-purple",
        "value": "#7b5ea7",
        "note": "for იისფერი, the only colour in the data with no Latin twin"
      }
    ]
  },
  {
    "name": "rail",
    "note": "The navigation rail is the one dark surface in a light app: brand black with the light logo.",
    "tokens": [
      {
        "name": "rail",
        "cssVar": "--rail",
        "value": "#0b0b0b",
        "note": "rail background"
      },
      {
        "name": "railInk",
        "cssVar": "--rail-ink",
        "value": "#c9d3c9",
        "note": "rail text"
      },
      {
        "name": "railActive",
        "cssVar": "--rail-active",
        "value": "#1b211b",
        "note": "hover inside the rail"
      },
      {
        "name": "railAccent",
        "cssVar": "--rail-accent",
        "value": "#e0ffa2",
        "note": "the active rail item"
      },
      {
        "name": "railLine",
        "cssVar": "--rail-line",
        "value": "#2a332b",
        "note": "borders of controls sitting on the rail"
      }
    ]
  },
  {
    "name": "effects",
    "note": "Shadow and scrim. Written out here so no component carries a colour literal of its own.",
    "tokens": [
      {
        "name": "shadow",
        "cssVar": "--shadow",
        "value": "0 12px 40px rgba(11, 11, 11, 0.16)",
        "note": "the sheet and the sidebar"
      },
      {
        "name": "scrim",
        "cssVar": "--scrim",
        "value": "rgba(11, 11, 11, 0.7)",
        "note": "the dark disc over a photo thumbnail"
      },
      {
        "name": "scrimSoft",
        "cssVar": "--scrim-soft",
        "value": "rgba(11, 11, 11, 0.32)",
        "note": "the veil behind a side panel: the same ink as --scrim, lighter, because the list behind it is still the work"
      },
      {
        "name": "onScrim",
        "cssVar": "--on-scrim",
        "value": "#ffffff",
        "note": "the glyph on that disc"
      }
    ]
  },
  {
    "name": "type",
    "note": "Neither Be Vietnam Pro nor Inter has Georgian glyphs, so Noto Sans Georgian is in every text stack. A face without the glyphs falls back to the system font silently — that is why it is checked on real names in acceptance.",
    "tokens": [
      {
        "name": "display",
        "cssVar": "--display",
        "value": "'Be Vietnam Pro', 'Noto Sans Georgian', system-ui, -apple-system, 'Segoe UI', sans-serif",
        "note": "headings, buttons, navigation"
      },
      {
        "name": "body",
        "cssVar": "--body",
        "value": "'Be Vietnam Pro', 'Noto Sans Georgian', system-ui, -apple-system, 'Segoe UI', sans-serif",
        "note": "body text and tables. The site sets body to --main-font, so Be Vietnam Pro leads here too; Inter is the second family"
      },
      {
        "name": "mono",
        "cssVar": "--mono",
        "value": "'IBM Plex Mono', 'Noto Sans Georgian', ui-monospace, SFMono-Regular, Menlo, monospace",
        "note": "VIN and money"
      }
    ]
  },
  {
    "name": "text",
    "note": "Named text styles. Fourteen of them, because the interface uses fourteen — the point is that they are named and counted, not that a component reaches for a size of its own. Each is a CSS `font` shorthand, so a rule says `font: var(--text-body)` and nothing else. The shorthand resets font-variant, so tabular figures are set by the .t-* class next to it, never by the token.",
    "tokens": [
      {
        "name": "textDisplay",
        "cssVar": "--text-display",
        "value": "500 28px/1.1 var(--display)",
        "note": "the number on a tile, the one figure a screen is about"
      },
      {
        "name": "textH1",
        "cssVar": "--text-h1",
        "value": "500 24px/1.15 var(--display)",
        "note": "the page title"
      },
      {
        "name": "textH1Phone",
        "cssVar": "--text-h1-phone",
        "value": "500 22px/1.15 var(--display)",
        "note": "the same title under 900 px"
      },
      {
        "name": "textH2",
        "cssVar": "--text-h2",
        "value": "500 16px/1.25 var(--display)",
        "note": "a section inside a page"
      },
      {
        "name": "textH3",
        "cssVar": "--text-h3",
        "value": "500 14px/1.3 var(--display)",
        "note": "a subsection, and the head of a card"
      },
      {
        "name": "textBody",
        "cssVar": "--text-body",
        "value": "400 15px/1.45 var(--body)",
        "note": "running text; the page default"
      },
      {
        "name": "textBodySm",
        "cssVar": "--text-body-sm",
        "value": "400 14px/1.45 var(--body)",
        "note": "tables, key-value rows, the history feed"
      },
      {
        "name": "textLabel",
        "cssVar": "--text-label",
        "value": "400 13px/1.4 var(--body)",
        "note": "field labels, hints, tile captions"
      },
      {
        "name": "textOverline",
        "cssVar": "--text-overline",
        "value": "500 12px/1.3 var(--display)",
        "note": "table headers and small caps marks; the class adds the letter-spacing"
      },
      {
        "name": "textButton",
        "cssVar": "--text-button",
        "value": "500 14px/1 var(--display)",
        "note": "pills and buttons (.button, .button-light on the site)"
      },
      {
        "name": "textCta",
        "cssVar": "--text-cta",
        "value": "500 19px/0.92 var(--display)",
        "note": "the one loud action of a screen (.button-accent on the site)"
      },
      {
        "name": "textButtonSm",
        "cssVar": "--text-button-sm",
        "value": "500 13px/1 var(--display)",
        "note": "the small pill and the inline field"
      },
      {
        "name": "textMono",
        "cssVar": "--text-mono",
        "value": "400 14px/1.45 var(--mono)",
        "note": "VIN and anything read character by character"
      },
      {
        "name": "textMoney",
        "cssVar": "--text-money",
        "value": "500 14px/1.45 var(--mono)",
        "note": "sums; the class adds tabular figures and right alignment"
      },
      {
        "name": "textMonoSm",
        "cssVar": "--text-mono-sm",
        "value": "400 12px/1.4 var(--mono)",
        "note": "code quoted inside the interface — token names on /design"
      }
    ]
  },
  {
    "name": "motion",
    "note": "Letter-spacing and the one transition, copied from the theme. The CSS `font` shorthand cannot carry tracking, so it lives beside the text styles rather than inside them.",
    "tokens": [
      {
        "name": "trackingTight",
        "cssVar": "--tracking-tight",
        "value": "-0.02em",
        "note": "headings: the site sets -1px at 38px, -0.56px at 28px, -0.4px at 20px — all -0.02em"
      },
      {
        "name": "trackingButton",
        "cssVar": "--tracking-button",
        "value": "-0.01em",
        "note": "buttons and chips (.button, .button-light)"
      },
      {
        "name": "ease",
        "cssVar": "--ease",
        "value": "0.36s cubic-bezier(0.2, 0, 0, 1)",
        "note": "a colour changing under the pointer. The site writes .3s ease; ours is slower and decelerating, by the owner's decision (15.09.2026) — a working screen is looked at all day and an eased ending reads as softer than the same length linear-in-out"
      },
      {
        "name": "enter",
        "cssVar": "--enter",
        "value": "0.42s cubic-bezier(0.32, 0.72, 0, 1)",
        "note": "something arriving over the page — a panel, a sheet, a menu. Slower than a hover and braked hard at the end, so it reads as sliding into place rather than being switched on. An addition: nothing on the site arrives"
      },
      {
        "name": "undoWindow",
        "cssVar": "--undo-window",
        "value": "10s",
        "note": "how long a park move stays undoable, drawn as the line draining under the undo button; the same ten seconds the screen counts and the API enforces"
      },
      {
        "name": "hairline",
        "cssVar": "--hairline",
        "value": "0.82px",
        "note": "the outline button's border, exactly as the theme writes it"
      }
    ]
  },
  {
    "name": "shape",
    "note": "One radius language: pills for buttons and chips, 16 px cards, nothing else.",
    "tokens": [
      {
        "name": "radiusCard",
        "cssVar": "--radius-card",
        "value": "16px",
        "note": "cards and panels"
      },
      {
        "name": "radiusPill",
        "cssVar": "--radius-pill",
        "value": "999px",
        "note": "buttons and filter chips"
      },
      {
        "name": "controlDense",
        "cssVar": "--control-dense",
        "value": "34px",
        "note": "the same control on a screen driven by a pointer rather than a thumb. From 900px up, where 44px is the thumb's measure and nobody's finger is on the glass"
      },
      {
        "name": "rowY",
        "cssVar": "--row-y",
        "value": "8px",
        "note": "a list row's air above and below, on a pointer screen. Every list in the system reads this, so a screen tightened here is not tightened again there"
      },
      {
        "name": "rowX",
        "cssVar": "--row-x",
        "value": "10px",
        "note": "a list row's air left and right, and the gap between its columns"
      },
      {
        "name": "cardPad",
        "cssVar": "--card-pad",
        "value": "14px",
        "note": "inside a card, a tile, a number with its label. Was 18-20px, which is a poster's margin, not a working screen's"
      },
      {
        "name": "control",
        "cssVar": "--control",
        "value": "44px",
        "note": "touch targets no smaller than 44 px (spec §9.2)"
      },
      {
        "name": "railW",
        "cssVar": "--rail-w",
        "value": "220px",
        "note": "the rail on a laptop"
      }
    ]
  }
];
