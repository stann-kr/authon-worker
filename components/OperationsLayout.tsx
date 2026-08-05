import type { ReactNode } from "react";

interface OperationsLayoutProps {
  title: string;
  dashboard: ReactNode;
  children: ReactNode;
  variant?: "split" | "stacked";
}

export default function OperationsLayout({
  title,
  dashboard,
  children,
  variant = "split",
}: OperationsLayoutProps) {
  return (
    <div
      className={`operations-layout ${
        variant === "stacked" ? "operations-layout-stacked" : ""
      }`}
    >
      <div className="min-w-0">
        <h1 className="sr-only">{title}</h1>
        <div className="space-y-4">{dashboard}</div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
