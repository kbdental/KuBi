-- 0008 granted kubi_authlookup column-level SELECT on the four columns the
-- login function RETURNS, but the function also filters on `email` -- and a
-- column-level grant covers every column the query touches, including those
-- only referenced in a WHERE clause. Add it.
--
-- The grant stays deliberately column-level rather than whole-table: this
-- role can read exactly the five columns authentication needs and nothing
-- else on `users` (no display label, no MFA state, no timestamps).
GRANT SELECT (email) ON users TO kubi_authlookup;
