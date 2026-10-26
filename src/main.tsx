import ReactDOM from "react-dom/client";
import { App } from "./App";
import React from "react";
import { BrowserRouter } from "react-router";
import "@fontsource-variable/archivo";
import "@fontsource-variable/noto-sans-sc";
import AppProviders from "@/app/AppProviders";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppProviders>
  </React.StrictMode>
);
