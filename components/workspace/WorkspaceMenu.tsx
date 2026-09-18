"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Sheet from "../overlays/Sheet";

export default function WorkspaceMenu({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  const content = <div className="workspace-menu-panel">
    <Sheet id="workspace-all-menu" title={title} onClose={onClose} blockDuringRouteTransition={false}>
      {children}
    </Sheet>
  </div>;
  const slot = document.getElementById("workspace-menu-slot");
  return slot ? createPortal(content, slot) : content;
}
