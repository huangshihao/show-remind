export interface Env {
  DB: D1Database;
  // vars / secrets (populated in later plans; declared now so the type is stable)
  APP_BASE_URL: string;
  INTERNAL_SECRET: string;
  RESEND_API_KEY: string;
  MAIL_FROM: string;
  ADMIN_EMAIL: string;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  PUBLIC_MODE: string; // "1" enables Turnstile + limits; "0" for self-host
}
