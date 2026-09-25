import { createSignal } from "solid-js";

export interface Toast {
  id: number;
  tone: "success" | "danger" | "info";
  title: string;
  body?: string;
}

let nextId = 1;
export const [toasts, setToasts] = createSignal<Toast[]>([]);

export function pushToast(t: Omit<Toast, "id">) {
  const id = nextId++;
  setToasts((list) => [...list, { ...t, id }]);
  setTimeout(() => dismissToast(id), 5000);
}

export function dismissToast(id: number) {
  setToasts((list) => list.filter((t) => t.id !== id));
}
