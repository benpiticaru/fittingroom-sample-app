import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveHost } from "./api/client";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

async function bootstrap(mount: HTMLElement) {
  const { client, store } = await resolveHost();
  createRoot(mount).render(
    <React.StrictMode>
      <App client={client} store={store} />
    </React.StrictMode>,
  );
}

void bootstrap(root);
