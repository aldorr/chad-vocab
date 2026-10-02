import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "error" | "ok" | "info";

type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
  remainingMs: number;
};

type ToastApi = {
  push: (
    message: string,
    opts?: { variant?: ToastVariant; durationMs?: number }
  ) => void;
  error: (message: string) => void;
  ok: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TICK = 100;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const hovering = useRef<Set<string>>(new Set());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    hovering.current.delete(id);
  }, []);

  const push = useCallback(
    (
      message: string,
      opts?: { variant?: ToastVariant; durationMs?: number }
    ) => {
      const durationMs = opts?.durationMs ?? 8000;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setItems((prev) => [
        ...prev,
        {
          id,
          message,
          variant: opts?.variant ?? "info",
          durationMs,
          remainingMs: durationMs,
        },
      ]);
    },
    []
  );

  const api: ToastApi = {
    push,
    error: (message) => push(message, { variant: "error", durationMs: 12000 }),
    ok: (message) => push(message, { variant: "ok", durationMs: 5000 }),
    info: (message) => push(message, { variant: "info", durationMs: 6000 }),
  };

  useEffect(() => {
    if (items.length === 0) return;
    const timer = window.setInterval(() => {
      setItems((prev) =>
        prev
          .map((t) => {
            if (hovering.current.has(t.id)) return t;
            return { ...t, remainingMs: t.remainingMs - TICK };
          })
          .filter((t) => t.remainingMs > 0)
      );
    }, TICK);
    return () => window.clearInterval(timer);
  }, [items.length]);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => {
          const pct = Math.max(0, (t.remainingMs / t.durationMs) * 100);
          return (
            <div
              key={t.id}
              className={`toast toast-${t.variant}`}
              onMouseEnter={() => hovering.current.add(t.id)}
              onMouseLeave={() => hovering.current.delete(t.id)}
              role={t.variant === "error" ? "alert" : "status"}
            >
              <div className="toast-body">
                <pre className="toast-message">{t.message}</pre>
                <div className="toast-actions">
                  {t.variant === "error" && (
                    <button
                      type="button"
                      className="btn ghost toast-btn"
                      onClick={() => void copyText(t.message)}
                    >
                      Copy
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn ghost toast-btn"
                    onClick={() => dismiss(t.id)}
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="toast-bar" style={{ width: `${pct}%` }} />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}
