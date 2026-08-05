import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  titleId?: string;
}

export default function PageHeader({
  title,
  description,
  actions,
  titleId,
}: PageHeaderProps) {
  return (
    <header className="page-heading">
      <div className="min-w-0">
        <h1
          id={titleId}
          className="text-balance text-2xl font-semibold leading-tight tracking-[-0.025em] text-text-heading sm:text-[1.75rem]"
        >
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-[65ch] text-pretty text-sm leading-relaxed text-text-muted">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="w-full shrink-0 sm:w-auto">{actions}</div>}
    </header>
  );
}
