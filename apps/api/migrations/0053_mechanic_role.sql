-- EV8 Ops — migration 0053: the mechanic is a role again (ADR-0033, stage 1
-- of docs/spec/mechanic-in-erp-plan.md).
--
-- Mika, 20.10.2026: «А: заводим две новые роли — механик и главный механик,
-- как в ТЗ и ADR-0033. Решение о двух ролях от 17.09 меняется в этой части».
-- Migration 0015 folded the mechanics into managers; nobody is moved back by
-- this file — the owner gives the role to a person in Settings.
--
-- One value per file: a value added to an enum cannot be used in the
-- transaction that added it, and the migration runner wraps every file in
-- one. The chief mechanic follows in 0054, the columns that name both in 0055.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'mechanic';
