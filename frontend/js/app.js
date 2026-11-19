"use strict";

async function updateConnectionStatus() {
  const label = document.getElementById("connection-label");
  const dot = document.getElementById("connection-dot");

  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("Connection unavailable");
    const data = await response.json();
    if (data.status !== "ok") throw new Error("Unexpected server response");
    label.textContent = "Connected";
    dot.className = "connection-dot online";
  } catch {
    label.textContent = "Disconnected";
    dot.className = "connection-dot offline";
  }
}

updateConnectionStatus();
