-- Page a run started at: 1, or later when it resumed an interrupted run.
ALTER TABLE runs ADD COLUMN first_page integer NOT NULL DEFAULT 1;
