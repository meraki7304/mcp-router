import { useState } from "react";

import { ping } from "./platform-api/tauri-platform-api";

export default function App() {
  const [name, setName] = useState("World");
  const [reply, setReply] = useState<string>("");

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>MCP Router (Tauri Skeleton)</h1>
      <p>End-to-end smoke test. Type a name and click Ping.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 6 }}
        />
        <button
          onClick={async () => {
            try {
              const out = await ping(name);
              setReply(out);
            } catch (err) {
              setReply(`error: ${String(err)}`);
            }
          }}
          style={{ padding: 6 }}
        >
          Ping
        </button>
      </div>
      <pre style={{ marginTop: 16 }}>{reply}</pre>
    </main>
  );
}
