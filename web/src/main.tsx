import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Wizard } from "./Wizard";
import { Manage } from "./Manage";
import { getStoredToken } from "./session";
import "./styles.css";

function Root() {
  const path = window.location.pathname;
  const urlToken = new URLSearchParams(window.location.search).get("token") ?? "";
  if (path.startsWith("/manage")) {
    const token = urlToken || getStoredToken() || "";
    if (token) return <Manage token={token} />;
    return <Wizard />;
  }
  return <Wizard />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
