"use client";

import { useEffect } from "react";

// Registers /sw.js (installable app; the app shell opens even without internet).
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
