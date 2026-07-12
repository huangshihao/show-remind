import crypto from "node:crypto";

// Ported from qqmusic-api-python algorithms/sign.py (zzc_sign).
const PART_1_INDEXES = [23, 14, 6, 36, 16, 7, 19];
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const SCRAMBLE_VALUES = [
  89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179,
];

export function zzcSign(payload: string | Buffer): string {
  const buf = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const hashHex = crypto.createHash("sha1").update(buf).digest("hex").toUpperCase();

  const part1 = PART_1_INDEXES.map((i) => hashHex[i]).join("");
  const part2 = PART_2_INDEXES.map((i) => hashHex[i]).join("");

  const part3 = Buffer.alloc(20);
  for (let i = 0; i < SCRAMBLE_VALUES.length; i++) {
    part3[i] = SCRAMBLE_VALUES[i] ^ parseInt(hashHex.slice(i * 2, i * 2 + 2), 16);
  }
  const b64 = part3.toString("base64").replace(/[\\/+=]/g, "");
  return `zzc${part1}${b64}${part2}`.toLowerCase();
}
