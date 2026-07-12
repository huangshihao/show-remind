-- CreateTable
CREATE TABLE "playlist_tallies" (
    "id" TEXT NOT NULL,
    "playlist_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "song_count" INTEGER NOT NULL,

    CONSTRAINT "playlist_tallies_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "playlist_tallies" ADD CONSTRAINT "playlist_tallies_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
