# Fonts for generated PDFs

Noto Sans and Noto Sans Georgian, hinted TTF, from
https://github.com/notofonts/notofonts.github.io — SIL Open Font License 1.1
(`OFL.txt`). Vendored rather than fetched at build time: a contract must
render identically on a laptop, on a stand and in five years.

Neither Be Vietnam Pro nor Inter (the ev8.ge brand faces) has Georgian
glyphs, so documents are set in Noto: the Georgian face for Georgian text
and the lari sign, the Latin face for everything else. `lib/pdf/doc.ts`
splits every string into runs and picks the face per run.
