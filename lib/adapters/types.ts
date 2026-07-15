export type PlatformId = "netease" | "qq";

// An artist as it appears on one song. `avatar` comes straight from the
// playlist payload when the platform carries it (QQ singer mid). `sourceId`
// is the platform's artist id, kept so a later per-artist lookup (netease
// head-info) can fetch the avatar exactly, without a name search.
export interface ResolvedSongArtist {
  name: string;
  avatar?: string | null;
  sourceId?: string;
}

export interface ResolvedSong {
  name: string;
  artists: ResolvedSongArtist[];
}

export interface ResolvedPlaylist {
  platform: PlatformId;
  externalId: string;
  title: string;
  songs: ResolvedSong[];
}

export interface ArtistTally {
  name: string;
  songCount: number;
  avatar?: string | null;
  sourceId?: string;
}
