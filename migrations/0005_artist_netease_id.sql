-- Migration number: 0005 	 2026-07-15T12:00:00.000Z

-- Netease artist id captured from imported playlists. Lets the manage-page
-- avatar backfill fetch the artist's photo exactly (head-info by id) instead
-- of relying on a Showstart name search that may have no match.
ALTER TABLE artists ADD COLUMN netease_id TEXT;
