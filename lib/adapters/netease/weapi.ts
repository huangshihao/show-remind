import crypto from "node:crypto";

const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const IV = "0102030405060708";
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const PUBLIC_KEY = "010001";
const MODULUS =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";

function aesEncrypt(text: string, key: string): string {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, IV);
  return cipher.update(text, "utf8", "base64") + cipher.final("base64");
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function rsaEncrypt(text: string): string {
  const reversed = text.split("").reverse().join("");
  const biText = BigInt("0x" + Buffer.from(reversed, "utf8").toString("hex"));
  const enc = modPow(biText, BigInt("0x" + PUBLIC_KEY), BigInt("0x" + MODULUS));
  return enc.toString(16).padStart(256, "0");
}

function randomKey(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += BASE62[bytes[i] % BASE62.length];
  return out;
}

export function weapi(
  payload: unknown,
  secretKey: string = randomKey(16),
): { params: string; encSecKey: string } {
  const text = JSON.stringify(payload);
  const params = aesEncrypt(aesEncrypt(text, PRESET_KEY), secretKey);
  const encSecKey = rsaEncrypt(secretKey);
  return { params, encSecKey };
}
