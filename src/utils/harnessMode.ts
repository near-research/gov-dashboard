"use client";

const STORAGE_KEY = "near-harness-mode";
const envMode = process.env.NEXT_PUBLIC_HARNESS_MODE?.toLowerCase() ?? "auto";

type HarnessPreference = "on" | "off" | "auto";

const getStoredPreference = (): HarnessPreference => {
  if (typeof window === "undefined") return "auto";
  const value = window.localStorage?.getItem(STORAGE_KEY);
  if (value === "on" || value === "off") return value;
  return "auto";
};

const setStoredPreference = (value: HarnessPreference) => {
  if (typeof window === "undefined") return;
  if (value === "auto") {
    window.localStorage?.removeItem(STORAGE_KEY);
  } else {
    window.localStorage?.setItem(STORAGE_KEY, value);
  }
};

export const isHarnessRuntimeEnabled = (): boolean => {
  if (envMode === "always") return true;
  if (envMode === "never") return false;

  const stored = getStoredPreference();
  if (stored === "on") return true;
  if (stored === "off") return false;

  return process.env.NODE_ENV !== "production";
};

export const registerHarnessToggleShortcuts = () => {
  if (typeof window === "undefined") return;
  if (window.enableNearHarness) return;

  const reloadWith = (pref: HarnessPreference) => {
    setStoredPreference(pref);
    window.location.reload();
  };

  window.enableNearHarness = () => reloadWith("on");
  window.disableNearHarness = () => reloadWith("off");
  window.resetNearHarnessMode = () => reloadWith("auto");

  if (process.env.NODE_ENV !== "production") {
    console.info(
      "[NEAR Harness] window.enableNearHarness(), window.disableNearHarness(), and window.resetNearHarnessMode() are available."
    );
  }
};
