import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";

import App from "@/App";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="coffeeLedger.theme"
      disableTransitionOnChange
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);

// Keeps the app itself on the device, so it opens from the home screen
// instantly and offline (public/sw.js). Production only: under `npm run dev`
// a cached shell would hide every edit behind a stale copy.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* no service worker: the app still works, it just needs the network */
    });
  });
}
