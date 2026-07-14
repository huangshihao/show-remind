import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Wizard } from "./Wizard";
import { Manage } from "./Manage";
import { getStoredToken } from "./session";
import "./styles.css";

function Root() {
  const urlToken = new URLSearchParams(window.location.search).get("token") ?? "";
  const token = urlToken || getStoredToken() || "";
  // A logged-in visitor (magic-link token in the URL, or one remembered from a
  // previous visit) lands on their dashboard — including at the root "/", not
  // just /manage — instead of the subscribe wizard. No token → the wizard.
  if (token) return <Manage token={token} />;
  return <Wizard />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
