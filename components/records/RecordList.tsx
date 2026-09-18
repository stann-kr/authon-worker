"use client";

import { createContext, useContext, useRef, useState, type HTMLAttributes } from "react";

import { requestSheetClose } from "../overlays/Sheet";

const Selection = createContext<{ id: string | null; select: (id: string | null) => void } | null>(null);

export default function RecordList({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  const [id, setId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const select = (next: string | null) => {
    const panel = rootRef.current?.querySelector<HTMLElement>(".product-sheet[id]");
    if (next && next !== id && panel) requestSheetClose(panel.id, () => setId(next));
    else setId(next);
  };
  return <Selection.Provider value={{ id, select }}>
    <div ref={rootRef} {...props} className={`record-list ${className}`}>{children}</div>
  </Selection.Provider>;
}

export function useRecordDetail(id: string) {
  const selection = useContext(Selection);
  const [localOpen, setLocalOpen] = useState(false);
  return {
    open: selection ? selection.id === id : localOpen,
    show: () => selection ? selection.select(id) : setLocalOpen(true),
    close: () => selection ? selection.select(null) : setLocalOpen(false),
  };
}
