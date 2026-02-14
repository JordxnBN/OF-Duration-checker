const { spawn } = require("node:child_process");

if (process.env.ELECTRON_RUN_AS_NODE === "1" && process.env.WORKLOG_SKIP_RELAUNCH !== "1") {
  const env = { ...process.env, WORKLOG_SKIP_RELAUNCH: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const isDevRelaunch = Boolean(process.env.VITE_DEV_SERVER_URL);
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: !isDevRelaunch,
    env,
    stdio: isDevRelaunch ? "inherit" : "ignore",
  });
  if (isDevRelaunch) {
    child.on("exit", (code) => process.exit(code ?? 0));
  } else {
    child.unref();
    process.exit(0);
  }
  return;
}

import("./main.mjs").catch((error) => {
  console.error("Failed to start Worklog main process:", error);
  process.exit(1);
});
