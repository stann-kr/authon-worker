import type { ReactNode } from "react";
import type { AsyncListState } from "@/lib/ui/async-list-state";

interface AsyncListContentProps {
  state: AsyncListState;
  loading: ReactNode;
  empty: ReactNode;
  children: ReactNode;
}

/** Renders exactly one truthful list state; full errors render no empty copy. */
export default function AsyncListContent({
  state,
  loading,
  empty,
  children,
}: AsyncListContentProps) {
  if (state === "idle" || state === "error") return null;
  if (state === "loading") return <>{loading}</>;
  if (state === "success-empty") return <>{empty}</>;
  return <>{children}</>;
}
