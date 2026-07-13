import { useEffect, useRef } from "react";

// Renders the Turnstile widget only when a site key is provided. The widget
// script is loaded on demand. onToken fires with the solved token.
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey) return;
    const id = "cf-turnstile-script";
    function render() {
      const w = (window as any).turnstile;
      if (w && ref.current) w.render(ref.current, { sitekey: siteKey, callback: onToken });
    }
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    } else {
      render();
    }
  }, [siteKey, onToken]);
  if (!siteKey) return null;
  return <div ref={ref} />;
}
