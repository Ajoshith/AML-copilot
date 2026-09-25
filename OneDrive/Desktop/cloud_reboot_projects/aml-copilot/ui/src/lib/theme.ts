import { createSignal } from "solid-js";

type Theme = "dark" | "light";

const initial = (document.documentElement.dataset.theme as Theme | undefined) ?? "dark";
export const [theme, setThemeSignal] = createSignal<Theme>(initial);

export function toggleTheme() {
  const next: Theme = theme() === "dark" ? "light" : "dark";
  setThemeSignal(next);
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("aml-theme", next);
  } catch {
    // storage can be unavailable (private mode); theme still applies for this session
  }
}
