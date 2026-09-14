# Clickable demo

`ev8-ops-demo.template.html` is the single-file prototype (all screens, drawers,
CSS tokens) with a `__DATA__` placeholder. The data file is built from a
read-only Odoo snapshot and is **not** in the repository (customer names, phones).

Build: replace `__DATA__` with the contents of `~/Desktop/EV8-ops/demo_data.json`
(escape `</script`). A static, script-free version for viewers without JS is
produced by opening the built file with `#bake` in headless Chrome and dumping
the DOM (`--dump-dom`), then stripping `<script>`; navigation there is CSS-only
(radio inputs).

The demo is the visual starting point for stage 1, not a code base to reuse.
