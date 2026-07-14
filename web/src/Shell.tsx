import type { ReactNode } from "react";

// The flyer-wall app frame: sticky wordmark bar + centered column. Both the
// subscribe wizard and the manage dashboard live inside it.
export function Shell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href="/">
          <b>SL</b> Showlist
        </a>
        {right ?? <span className="tag">livehouse · 演出提醒</span>}
      </header>
      {children}
    </div>
  );
}

export function Loading({ label = "加载中" }: { label?: string }) {
  return (
    <div className="loading">
      <span className="bar" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}…</span>
    </div>
  );
}
