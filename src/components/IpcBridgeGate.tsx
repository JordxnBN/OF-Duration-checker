export function IpcBridgeGate(props: { children: React.ReactNode }) {
  const hasBridge =
    typeof window !== "undefined" &&
    !!(window as Window & { worklog?: unknown }).worklog;

  if (!hasBridge) {
    return (
      <div
        style={{
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
          maxWidth: "480px",
          margin: "2rem auto",
        }}
      >
        <h2>IPC bridge not ready</h2>
        <p>
          The app could not connect to the main process. Try restarting. If you
          see Smart App Control blocking the app, run via{" "}
          <code>npm run dev</code> instead.
        </p>
      </div>
    );
  }

  return props.children;
}

