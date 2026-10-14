-- The price paid, in the currency it was paid in (refocus phase 2, issue #27).
--
-- Until now a piece kept only `paid_usd`: the amount converted to dollars at the rate in force when it was typed, so correcting an
-- exchange rate later changed what the person appeared to have paid. These two columns hold the amount as it was paid.
-- Both are nullable on purpose: rows written by an older app version have neither, and `paid_usd` stays as the fallback.

alter table vault_items
  add column paid double precision,
  add column currency text;
