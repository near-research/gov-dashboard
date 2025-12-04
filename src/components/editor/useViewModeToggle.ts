import { useEffect, useState } from "react";

export type ViewMode = "editor" | "preview";

export function useViewModeToggle(initialMode: ViewMode = "editor") {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setViewMode((m) => (m === "editor" ? "preview" : "editor"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleViewMode = () => setViewMode((m) => (m === "editor" ? "preview" : "editor"));

  return { viewMode, setViewMode, toggleViewMode };
}
