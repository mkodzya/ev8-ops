# tools/

`odoo_rpc.py` — thin XML-RPC helper for the one-time migration from Odoo
(emotion-motors.odoo.com). Reads `~/.config/ev8/odoo.env`; never prints the key.

```python
from odoo_rpc import Odoo
o = Odoo()
o.search_read("fleet.vehicle", [], ["vin_sn", "model_id", "state_id"])
```

Migration scripts go here as `migrate_*.py` and must be read-only against Odoo:
they read, they never write. Output snapshots are written to `~/Desktop/EV8-ops/`
(outside the repository — see `.gitignore`).
