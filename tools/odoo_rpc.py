"""Thin XML-RPC helper for emotion-motors.odoo.com. Reads ~/.config/ev8/odoo.env. Never prints the key."""
import os, xmlrpc.client

def _load_env():
    p = os.path.expanduser("~/.config/ev8/odoo.env")
    env = {}
    with open(p) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

class Odoo:
    def __init__(self):
        e = _load_env()
        self.url, self.db, self.user, self._key = e["ODOO_URL"], e["ODOO_DB"], e["ODOO_USER"], e["ODOO_API_KEY"]
        common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common")
        self.uid = common.authenticate(self.db, self.user, self._key, {})
        if not self.uid:
            raise SystemExit("Odoo authentication failed (check DB/USER/API key)")
        self._m = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object")

    def call(self, model, method, *args, **kw):
        return self._m.execute_kw(self.db, self.uid, self._key, model, method, list(args), kw)

    def search_read(self, model, domain, fields, **kw):
        return self.call(model, "search_read", domain, fields=fields, **kw)

    def count(self, model, domain=None):
        return self.call(model, "search_count", domain or [])
