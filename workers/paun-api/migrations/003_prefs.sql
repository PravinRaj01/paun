-- Preferences and watchlist sync (PLAN.md 4b.5): one row per account.
--
-- Each half is stored whole, with the moment it was last changed; the newest change wins. Both start empty (null): an account that
-- has never saved settings has none, and the first device to sync decides what they are.
-- "on delete cascade": deleting the account deletes these settings in the same statement.

create table user_prefs (
  user_id text primary key references "user" ("id") on delete cascade,
  prefs jsonb,
  prefs_at timestamptz,
  watchlist jsonb,
  watchlist_at timestamptz
);
