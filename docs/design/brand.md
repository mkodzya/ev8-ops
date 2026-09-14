# EV8 brand — taken from ev8.ge (theme `ev8`, `assets/css/style.min.css`, 13.09.2026)

Everything here is read from the live site, not invented. When the site changes,
update this file from the source, do not guess.

## Logo
- `logo.svg` (112×28, sage green `#819481`) — light backgrounds.
- `logo-light.svg` — dark backgrounds (app rail, dark theme, PDF headers on dark).
- Source: `https://ev8.ge/wp-content/themes/ev8/assets/images/logo.svg`, `logo-light.svg`.
- Never redraw, recolor or stretch. Minimum height in UI 24 px.

## Palette (site CSS variables and theme colours)

| Token (site)          | Hex       | Use in EV8 Ops                                              |
|-----------------------|-----------|-------------------------------------------------------------|
| `--green`             | `#819481` | logo, large marks, fills. Not for text (3.2:1 on white)     |
| theme hover green     | `#628767` | secondary buttons, borders of active elements               |
| theme dark green      | `#557553` | **text green**: links, status text, primary button (5.2:1)  |
| `--green-light`       | `#a2b9a2` | dark-theme accent, soft fills                               |
| theme light grey-green| `#dbe4de` | lines, table headers, soft backgrounds                      |
| `--avocado`           | `#e0ffa2` | the one highlight per screen: active nav item, selected card|
| `--orange`            | `#fe5d02` | state "in service", warnings (dark variant `#e45e22`)       |
| `--blue-tag`          | `#598eeb` | state "rented"                                              |
| `--black`             | `#0b0b0b` | ink; dark-theme and rail background                         |
| `--white-background`  | `#fbfbfb` | light-theme page background                                 |

Added for the ops UI (not on the site, marked as proposal in the spec):
- critical / overdue / written-off: `#c8402f` (does not fight the orange)
- finished / sold: neutral grey from the ink scale
- mono for VIN and money: IBM Plex Mono

## Type
- Site: **Be Vietnam Pro** 300–700 (`--main-font`), **Inter** (`--second-family`).
- App: Be Vietnam Pro for headings, buttons, navigation; Inter for body and tables.
- **Neither face has Georgian glyphs.** Add **Noto Sans Georgian** (400–700) to every
  font stack; verify with real names (ვაჟა ჯაფარიძე, გიორგი სუთიძე) on every screen.

## Shape
- Site buttons and chips are pills (radii 24–60 px). App: pills for buttons and
  filter chips, 16 px cards, square cells inside tables.

## Vehicle states — colour + shape + word, everywhere the same
| state      | colour                | label ka / ru / en |
|------------|-----------------------|--------------------|
| available  | text green `#557553`  | თავისუფალი / Свободен / Available |
| rented     | blue `#598eeb`        | ქირაშია / В аренде / Rented |
| service    | orange `#fe5d02`      | სერვისში / В сервисе / In service |
| out        | red `#c8402f`         | ჩამოწერილი / Списан / Written off |
| sold       | grey                  | გაყიდული / Продан / Sold |
