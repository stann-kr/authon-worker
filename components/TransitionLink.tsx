"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useRouteTransition } from "./RouteTransitionProvider";
import { confirmWorkspaceNavigation } from "./overlays/navigation-guard";

type TransitionLinkProps = ComponentProps<typeof Link>;

export default function TransitionLink({
  href,
  onClick,
  ...props
}: TransitionLinkProps) {
  const { startRouteTransition } = useRouteTransition();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target === "_blank"
    ) {
      return;
    }

    const targetHref = event.currentTarget.href;
    const target = new URL(targetHref);
    if (target.origin === window.location.origin &&
      (target.pathname !== window.location.pathname || target.search !== window.location.search) &&
      !confirmWorkspaceNavigation()) {
      event.preventDefault();
      return;
    }
    if (!startRouteTransition(targetHref)) {
      event.preventDefault();
    }
  };

  return (
    <Link
      href={href}
      onClick={handleClick}
      {...props}
    />
  );
}
