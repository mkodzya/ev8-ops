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

`migrate_stage1.py --only suppliers` — только поставщики (в Odoo — `supplier_rank > 0`,
на 28.09.2026 их восемь). На ноутбучный стенд — как обычно, `--apply`. На стенд на
сервере база снаружи не видна, поэтому `--sql`: Odoo читается на этом Mac, где лежит
ключ, а SQL по ssh уходит прямо в psql внутри контейнера базы. Файла между ними нет,
ни ключ Odoo, ни пароль базы на другую сторону не попадают:

```bash
python3 tools/migrate_stage1.py --only suppliers --sql | ssh root@204.168.149.105 "cd /srv/ev8-ops && docker compose -p ev8-test --env-file .env.test -f docker-compose.prod.yml exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -o /dev/null -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'" && echo "на тесте"
```

Повторный запуск не задваивает (`on conflict (odoo_partner_id)`), и полный перенос
потом обновит эти же строки, а не заведёт вторые.
