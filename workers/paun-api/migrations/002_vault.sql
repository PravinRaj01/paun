-- Vault sync (PLAN.md 4b.4): one row per piece per account, plus tombstones for removed pieces.
--
-- * "on delete cascade" from the user: deleting an account deletes its synced pieces in the same statement.
-- * `version` comes from a database sequence and is bumped on every change; a device asks for "everything after version N".
-- * `deleted_at` is the tombstone, so a piece removed on one device cannot come back from another.
--   A tombstone for a piece this server never saw is stored with placeholder values (name '', weight 0, ...): only id and deleted_at matter.

create sequence vault_version_seq;

create table vault_items (
  user_id text not null references "user" ("id") on delete cascade,
  id text not null,
  name text not null,
  weight double precision not null,
  purity text not null,
  paid_usd double precision not null,
  date text not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version bigint not null default nextval('vault_version_seq'),
  primary key (user_id, id)
);

create index vault_items_user_version_idx on vault_items (user_id, version);
