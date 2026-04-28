"use client";

import { useEffect, useState } from "react";
import { DeviceModeIndicator } from "@/components/device-mode-indicator";
import { StandaloneIndicator } from "@/components/standalone-indicator";

/**
 * Device player context differs between server and first client paint; rendering
 * these badges only after mount avoids hydration mismatches next to static header chrome.
 */
export function HeaderDeviceIndicators() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  return (
    <>
      <StandaloneIndicator />
      <DeviceModeIndicator />
    </>
  );
}
