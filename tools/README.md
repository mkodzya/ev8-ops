# tools/

`odoo_rpc.py` — thin XML-RPC helper for the one-time migration from Odoo
(emotion-motors.odoo.com). Reads `~/.config/ev8/odoo.env`; never prints the key.

```python
from odoo_rpc import Odoo
o = Odoo()
o.search_read("fleet.vehicle", [], ["vin_sn", "model_id", "state_id"])
```

`reconcile_odoo.py` — сверка контрольных цифр из `docs/handoff.md`, п. 3 с живой
Odoo. Только чтение, в выводе только количества и суммы (ни имён, ни VIN), код
возврата 1 при расхождении без объяснения:

```bash
python3 tools/reconcile_odoo.py            # отчёт
python3 tools/reconcile_odoo.py --json     # то же машиночитаемо
```

Migration scripts go here as `migrate_*.py` and must be read-only against Odoo:
they read, they never write. Output snapshots are written to `~/Desktop/EV8-ops/`
(outside the repository — see `.gitignore`).
