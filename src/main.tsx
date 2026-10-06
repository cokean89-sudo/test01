import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PAGE_CSS } from "./components/PageView";
import { registerServiceWorker } from "./lib/share";
import "./tokens.css";
import "./styles.css";

const style = document.createElement("style");
style.textContent = PAGE_CSS;
document.head.appendChild(style);

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
