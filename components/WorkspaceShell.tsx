import type { ReactNode } from "react";
import AdminHeader from "@/app/admin/components/AdminHeader";
import Footer from "@/components/Footer";

interface WorkspaceShellProps {
  children: ReactNode;
  width?: "default" | "narrow";
  contentClassName?: string;
}

const widthClasses = {
  default: "max-w-[1440px]",
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
      <div className="page-scroll">
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
