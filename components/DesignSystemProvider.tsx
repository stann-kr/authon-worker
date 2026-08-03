"use client";

import { GlobalTheme } from "@carbon/react";

export default function DesignSystemProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <GlobalTheme theme="g100">{children}</GlobalTheme>;
}
