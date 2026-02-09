import * as React from "react";

/**
 * Minimal tooltip implementation for MVP.
 * Uses native `title` to avoid extra dependencies; replace with Radix if desired.
 */
export function Tooltip({ children }: { children: React.ReactElement }) {
  return children;
}

export function TooltipTrigger({
  asChild,
  children,
  title
}: {
  asChild?: boolean;
  title: string;
  children: React.ReactElement;
}) {
  if (!asChild) return <span title={title}>{children}</span>;
  return React.cloneElement(children, { title });
}

export function TooltipContent() {
  return null;
}

