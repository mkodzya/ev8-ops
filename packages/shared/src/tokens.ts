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
  surface2: '#f3f6f3', // table headers, soft fills, inactive chips
  ink: '#0b0b0b', // text (--black on the site)
  muted: '#5d6b5d', // secondary text, PDF translations
  line: '#dbe4de', // borders and rules (site light grey-green)
  lineSoft: '#e9efea', // the quieter rule inside a card

  /** brand — The greens. The site green is a fill, never text: #819481 is 3.2:1 on white and fails AA. */
  brand: '#819481', // logo and large marks; never text
  accent: '#557553', // text green: links, status text, primary button — 5.2:1
  accentHover: '#628767', // hover and the border of an active element
  accentSoft: '#e3ebe3', // the tint behind an accent pill
  onAccent: '#ffffff', // text on the accent fill
  lime: '#e0ffa2', // the one highlight per screen (--avocado)

  /** states — Vehicle and rental states. Colour is never the only carrier: every state also has a shape and a word (brand.md). */
  rented: '#598eeb', // state rented (--blue-tag)
  service: '#fe5d02', // state in service (--orange)
  serviceInk: '#e45e22', // the darker orange, for text on light
  crit: '#c8402f', // overdue, written off — added for the ops UI, does not fight the orange
  critSoft: '#f9e3df', // the tint behind a critical pill
  warnSoft: '#fdeadf', // the tint behind a service pill
  infoSoft: '#e4ecfb', // the tint behind a rented pill
  grey: '#7a827a', // finished and sold; PDF footers

  /** rail — The navigation rail is the one dark surface in a light app: brand black with the light logo. */
  rail: '#0b0b0b', // rail background
  railInk: '#c9d3c9', // rail text
  railActive: '#1b211b', // hover inside the rail
  railAccent: '#e0ffa2', // the active rail item
  railLine: '#2a332b', // borders of controls sitting on the rail

  /** effects — Shadow and scrim. Written out here so no component carries a colour literal of its own. */
  shadow: '0 12px 40px rgba(11, 11, 11, 0.16)', // the sheet and the sidebar
  scrim: 'rgba(11, 11, 11, 0.7)', // the dark disc over a photo thumbnail
  onScrim: '#ffffff', // the glyph on that disc

  /** type — Neither Be Vietnam Pro nor Inter has Georgian glyphs, so Noto Sans Georgian is in every text stack. A face without the glyphs falls back to the system font silently — that is why it is checked on real names in acceptance. */
  display: "'Be Vietnam Pro', 'Noto Sans Georgian', system-ui, -apple-system, 'Segoe UI', sans-serif", // headings, buttons, navigation
  body: "'Inter', 'Noto Sans Georgian', system-ui, -apple-system, 'Segoe UI', sans-serif", // body text and tables
  mono: "'IBM Plex Mono', 'Noto Sans Georgian', ui-monospace, SFMono-Regular, Menlo, monospace", // VIN and money

  /** text — Named text styles. Fourteen of them, because the interface uses fourteen — the point is that they are named and counted, not that a component reaches for a size of its own. Each is a CSS `font` shorthand, so a rule says `font: var(--text-body)` and nothing else. The shorthand resets font-variant, so tabular figures are set by the .t-* class next to it, never by the token. */
  textDisplay: '600 28px/1.1 var(--display)', // the number on a tile, the one figure a screen is about
  textH1: '600 24px/1.25 var(--display)', // the page title
  textH1Phone: '600 22px/1.25 var(--display)', // the same title under 900 px
  textH2: '600 16px/1.35 var(--display)', // a section inside a page
  textH3: '600 14px/1.4 var(--display)', // a subsection, and the head of a card
  textBody: '400 15px/1.45 var(--body)', // running text; the page default
  textBodySm: '400 14px/1.45 var(--body)', // tables, key-value rows, the history feed
  textLabel: '400 13px/1.4 var(--body)', // field labels, hints, tile captions
  textOverline: '600 12px/1.3 var(--display)', // table headers and small caps marks; the class adds the letter-spacing
  textButton: '500 14px/1 var(--display)', // pills and buttons
  textButtonSm: '500 13px/1 var(--display)', // the small pill and the inline field
  textMono: '400 14px/1.45 var(--mono)', // VIN and anything read character by character
  textMoney: '600 14px/1.45 var(--mono)', // sums; the class adds tabular figures and right alignment
  textMonoSm: '400 12px/1.4 var(--mono)', // code quoted inside the interface — token names on /design

  /** shape — One radius language: pills for buttons and chips, 16 px cards, nothing else. */
  radiusCard: '16px', // cards and panels
  radiusPill: '999px', // buttons and filter chips
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
        "value": "#f3f6f3",
        "note": "table headers, soft fills, inactive chips"
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
        "value": "#5d6b5d",
        "note": "secondary text, PDF translations"
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
        "value": "#e9efea",
        "note": "the quieter rule inside a card"
      }
    ]
  },
  {
    "name": "brand",
    "note": "The greens. The site green is a fill, never text: #819481 is 3.2:1 on white and fails AA.",
    "tokens": [
      {
        "name": "brand",
        "cssVar": "--brand",
        "value": "#819481",
        "note": "logo and large marks; never text"
      },
      {
        "name": "accent",
        "cssVar": "--accent",
        "value": "#557553",
        "note": "text green: links, status text, primary button — 5.2:1"
      },
      {
        "name": "accentHover",
        "cssVar": "--accent-hover",
        "value": "#628767",
        "note": "hover and the border of an active element"
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
        "note": "the darker orange, for text on light"
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
        "name": "grey",
        "cssVar": "--grey",
        "value": "#7a827a",
        "note": "finished and sold; PDF footers"
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
        "value": "'Inter', 'Noto Sans Georgian', system-ui, -apple-system, 'Segoe UI', sans-serif",
        "note": "body text and tables"
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
        "value": "600 28px/1.1 var(--display)",
        "note": "the number on a tile, the one figure a screen is about"
      },
      {
        "name": "textH1",
        "cssVar": "--text-h1",
        "value": "600 24px/1.25 var(--display)",
        "note": "the page title"
      },
      {
        "name": "textH1Phone",
        "cssVar": "--text-h1-phone",
        "value": "600 22px/1.25 var(--display)",
        "note": "the same title under 900 px"
      },
      {
        "name": "textH2",
        "cssVar": "--text-h2",
        "value": "600 16px/1.35 var(--display)",
        "note": "a section inside a page"
      },
      {
        "name": "textH3",
        "cssVar": "--text-h3",
        "value": "600 14px/1.4 var(--display)",
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
        "value": "600 12px/1.3 var(--display)",
        "note": "table headers and small caps marks; the class adds the letter-spacing"
      },
      {
        "name": "textButton",
        "cssVar": "--text-button",
        "value": "500 14px/1 var(--display)",
        "note": "pills and buttons"
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
        "value": "600 14px/1.45 var(--mono)",
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
