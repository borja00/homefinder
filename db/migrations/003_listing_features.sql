-- More of what Idealista shows on each result card, for the Listings filters.
ALTER TABLE listings
    ADD COLUMN property_type  text,                       -- "Piso", "Ático", "Chalet adosado"… (title before " en ")
    ADD COLUMN parking        text,                       -- included | optional (extra cost) | NULL
    ADD COLUMN tags           text[] NOT NULL DEFAULT '{}', -- Lujo, Alquilada, Nuda propiedad, Ocupada ilegalmente…
    ADD COLUMN has_plan       boolean,                    -- the ad has a floor plan
    ADD COLUMN professional   boolean,                    -- agency (true) or private seller (false)
    ADD COLUMN previous_price integer;                    -- Idealista's crossed-out price after a drop
