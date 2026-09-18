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
  const content =
    <Sheet id="workspace-all-menu" presentation="modal" title={title} onClose={onClose} blockDuringRouteTransition={false}>
      <div className="workspace-menu-panel">{children}</div>
    </Sheet>;
  const slot = document.getElementById("workspace-menu-slot");
  return slot ? createPortal(content, slot) : content;
}
