import { useState } from "react";

const PALETTE = ["#3b5bdb", "#0ca678", "#e8590c", "#ae3ec9", "#1098ad", "#d6336c", "#5c7cfa", "#f08c00"];

// Deterministic color from the name so the same artist always gets the same
// placeholder circle.
export function initialColor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return PALETTE[sum % PALETTE.length];
}

// Codepoint-aware first character (handles astral emoji; CJK unaffected).
export function avatarInitial(name: string): string {
  return [...name.trim()][0] ?? "?";
}

export function ArtistAvatar({
  name,
  avatar,
  size = 60,
}: {
  name: string;
  avatar?: string | null;
  // A number renders a fixed-size circle (px). "fill" renders a tile that
  // fills its container (width/height 100%) — used by the manage-page photo
  // grid, whose square tiles are sized by CSS grid, not a fixed pixel value.
  size?: number | "fill";
}) {
  // Fall back to the initial circle if the photo fails to load (a Showstart
  // avatar URL can 404), instead of showing the browser's broken-image icon.
  const [imgFailed, setImgFailed] = useState(false);
  const fill = size === "fill";
  const dims = fill ? {} : { width: size, height: size };
  const fillClass = fill ? "-fill" : "";
  if (avatar && !imgFailed) {
    return (
      <img
        className={`artist-avatar${fillClass}`}
        src={avatar}
        alt={name}
        loading="lazy"
        style={dims}
        onError={() => setImgFailed(true)}
      />
    );
  }
  return (
    <span
      className={`artist-initial${fillClass}`}
      style={{ ...dims, ...(fill ? {} : { fontSize: Math.round(size * 0.4) }), background: initialColor(name) }}
      aria-hidden="true"
    >
      {avatarInitial(name)}
    </span>
  );
}
