import React from "react";
import { Capacitor } from "@capacitor/core";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import NativeLifecycle from "./NativeLifecycle";
import "./styles.css";
document.documentElement.dataset.platform = Capacitor.getPlatform();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <NativeLifecycle />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
