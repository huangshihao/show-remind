// Remembers the magic-link token in localStorage so a returning visitor can
// reach their manage page without re-opening the email. The token IS the
// credential (account-free design), same trust model as a "remember me" cookie.
const KEY = "sr_manage_token";

export function storeToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* private mode / disabled */
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
