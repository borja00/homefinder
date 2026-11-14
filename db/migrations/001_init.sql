CREATE TABLE listings (
    id           text PRIMARY KEY,
    url          text NOT NULL,
    title        text,
    price        integer,
    size_m2      numeric(8, 2),
    rooms        integer,
    floor        text,
    has_lift     boolean,
    has_parking  boolean NOT NULL DEFAULT false,
    agency       text,
    thumbnail    text,
    description  text,
    first_seen   date NOT NULL,
    last_seen    date NOT NULL,
    active       boolean NOT NULL DEFAULT true,
    removed_on   date
);

-- One price observation per listing per day.
CREATE TABLE snapshots (
    listing_id  text NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    seen_on     date NOT NULL,
    price       integer,
    PRIMARY KEY (listing_id, seen_on)
);

CREATE TABLE listing_searches (
    listing_id   text NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    search_name  text NOT NULL,
    PRIMARY KEY (listing_id, search_name)
);
CREATE INDEX listing_searches_search ON listing_searches (search_name);

CREATE TABLE runs (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    search_name  text NOT NULL,
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    pages        integer NOT NULL DEFAULT 0,
    seen         integer NOT NULL DEFAULT 0,
    status       text  -- complete | truncated | blocked | error
);

-- Your own annotations, edited from the dashboard.
CREATE TABLE notes (
    listing_id  text PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
    starred     boolean NOT NULL DEFAULT false,
    rating      integer CHECK (rating BETWEEN 1 AND 5),
    note        text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Fetched result pages, gzipped, so `reparse` can rebuild listings after a
-- selector fix. Pruned after scraper.raw_html_retention_days.
CREATE TABLE raw_pages (
    fetched_on   date NOT NULL,
    search_name  text NOT NULL,
    page         integer NOT NULL,
    html_gz      bytea NOT NULL,
    PRIMARY KEY (fetched_on, search_name, page)
);

-- The Idealista Cookie header. Pasted in with `homefinder cookie`, and the
-- scraper writes back the cookies Idealista refreshes after each run.
CREATE TABLE session (
    key         text PRIMARY KEY,
    value       text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
