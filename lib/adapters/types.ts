export type PlatformId = "netease" | "qq";

export interface ResolvedSong {
  name: string;
  artists: string[];
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
}
