-- A listing's own Idealista page (/inmueble/<id>/): full description, photos,
-- all features. Fetched by the scrape the first time a listing shows up (a
-- capped number per run, newest first), and again on demand from the
-- dashboard's detail page. The raw HTML is kept so `reparse` can rebuild
-- `data` after a selector fix.
CREATE TABLE listing_details (
    listing_id    text PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
    status        text NOT NULL,   -- ok | gone (taken down) | error (never fetched successfully)
    fetched_at    timestamptz,     -- last successful fetch (ok or gone)
    attempted_at  timestamptz NOT NULL DEFAULT now(),
    attempts      integer NOT NULL DEFAULT 0,  -- failed attempts in a row
    error         text,            -- last failure, if the last attempt failed
    html_gz       bytea,
    data          jsonb
);
