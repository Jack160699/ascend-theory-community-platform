"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "ascend:privacy-strip:dismissed:v1";
const BODY_CLASS = "ascend-cookie-strip-active";
const STRIP_CHANGE_EVENT = "ascend:privacy-strip-change";

function readDismissedFromStorage(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeToStorage(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const run = () => onStoreChange();
  window.addEventListener(STRIP_CHANGE_EVENT, run);
  window.addEventListener("storage", run);
  return () => {
    window.removeEventListener(STRIP_CHANGE_EVENT, run);
    window.removeEventListener("storage", run);
  };
}

export function CookieNotice() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const dismissedInStorage = useSyncExternalStore(
    subscribeToStorage,
    readDismissedFromStorage,
    () => true,
  );
  const open = !dismissedInStorage && !pathname.startsWith("/admin");

  useEffect(() => {
    if (open) {
      document.body.classList.add(BODY_CLASS);
    } else {
      document.body.classList.remove(BODY_CLASS);
    }
    return () => {
      document.body.classList.remove(BODY_CLASS);
    };
  }, [open]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(STRIP_CHANGE_EVENT));
  }, []);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="status"
          aria-live="polite"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={
            reduce
              ? { opacity: 0 }
              : { opacity: 0, y: 6, transition: { duration: 0.32 } }
          }
          transition={{ duration: 0.42, ease: [0.33, 1, 0.68, 1] }}
          className="fixed inset-x-0 bottom-0 z-[90] border-t border-[color:var(--ascend-border)] bg-zinc-950/75 px-4 py-3 backdrop-blur-md sm:px-6 sm:py-3.5"
          style={{
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-6">
            <p className="max-w-2xl text-left text-[11px] leading-relaxed tracking-[0.02em] text-zinc-500 sm:text-[11.5px] sm:leading-relaxed">
              This site uses essential cookies to run the experience. We do not
              sell your data.{" "}
              <Link
                href="/privacy"
                className="text-zinc-400 underline decoration-zinc-700 underline-offset-[3px] transition-colors duration-[var(--ascend-hover-duration)] ease-[var(--ascend-hover-ease)] hover:text-zinc-300"
              >
                Privacy
              </Link>
            </p>
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 text-[11px] font-medium tracking-[0.14em] text-zinc-500 transition-colors duration-[var(--ascend-hover-duration)] ease-[var(--ascend-hover-ease)] hover:text-zinc-300 sm:tracking-[0.16em]"
            >
              Dismiss
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
