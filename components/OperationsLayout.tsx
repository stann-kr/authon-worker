import type { ReactNode } from "react";

interface OperationsLayoutProps {
  title: string;
  dashboard: ReactNode;
  children: ReactNode;
  variant?: "split" | "stacked";
  headingLevel?: 1 | 2 | 3 | null;
  headingId?: string;
}

export default function OperationsLayout({
  title,
  dashboard,
  children,
  variant = "split",
  headingLevel = 1,
  headingId,
}: OperationsLayoutProps) {
  const Heading =
    headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";
  return (
    <div
      className={`operations-layout ${
        variant === "stacked" ? "operations-layout-stacked" : ""
      }`}
    >
      <div className="min-w-0">
        {headingLevel !== null && (
          <Heading id={headingId} className="sr-only">{title}</Heading>
        )}
        <div className="space-y-4">{dashboard}</div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
