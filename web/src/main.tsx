import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Wizard } from "./Wizard";
import { Manage } from "./Manage";
import "./styles.css";

function Root() {
  const path = window.location.pathname;
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  if (path.startsWith("/manage") && token) return <Manage token={token} />;
  return <Wizard />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
