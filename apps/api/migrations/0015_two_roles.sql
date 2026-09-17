-- EV8 Ops — migration 0015: two roles.
--
-- Mika, 17.09.2026 (redesign blueprint D0): the owners — Mika and Kardu — and
-- the managers. A director becomes an owner; a mechanic or an accountant
-- becomes a manager. Each move is written to the change journal first, with
-- the role it was, so nobody's access changes without a trace.

INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before, after, note)
SELECT NULL, 'user.role.migrate', 'user', id::text,
       jsonb_build_object('role', role::text),
       jsonb_build_object('role', CASE WHEN role = 'director' THEN 'owner' ELSE 'manager' END),
       'migration 0015: two roles (Mika, 17.09.2026)'
FROM users
WHERE role IN ('director', 'mechanic', 'accountant');

ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
ALTER TYPE user_role RENAME TO user_role_before_0015;
CREATE TYPE user_role AS ENUM ('owner', 'manager');
ALTER TABLE users
  ALTER COLUMN role TYPE user_role
  USING (CASE role::text WHEN 'director' THEN 'owner' WHEN 'owner' THEN 'owner' ELSE 'manager' END)::user_role;
DROP TYPE user_role_before_0015;
