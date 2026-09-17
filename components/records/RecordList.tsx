"use client";

import { createContext, useContext, useState, type HTMLAttributes } from "react";

const Selection = createContext<{ id: string | null; select: (id: string | null) => void } | null>(null);

export default function RecordList({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  const [id, select] = useState<string | null>(null);
  return <Selection.Provider value={{ id, select }}>
    <div {...props} className={`record-list ${className}`}>{children}</div>
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
