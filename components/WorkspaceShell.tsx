import type { ReactNode } from "react";
import AdminHeader from "@/app/admin/components/AdminHeader";
import Footer from "@/components/Footer";

interface WorkspaceShellProps {
  children: ReactNode;
  width?: "default" | "home" | "narrow";
  contentClassName?: string;
}

const widthClasses = {
  default: "max-w-[1440px]",
  home: "max-w-[1040px]",
  narrow: "max-w-[1040px]",
} as const;

export default function WorkspaceShell({
  children,
  width = "default",
  contentClassName = "",
}: WorkspaceShellProps) {
  return (
    <div className="page-shell">
      <AdminHeader />
      <div className="page-scroll pb-[calc(var(--app-mobile-nav-height)+1rem+env(safe-area-inset-bottom))] md:pb-0">
        <main
          id="main-content"
          tabIndex={-1}
          className={`page-container ${widthClasses[width]} ${contentClassName}`}
        >
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}
