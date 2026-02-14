import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { IpcBridgeGate } from "./components/IpcBridgeGate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <IpcBridgeGate>
        <App />
      </IpcBridgeGate>
    </ErrorBoundary>
  </StrictMode>
);
