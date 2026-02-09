import * as React from "react";

import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant };

const VARIANT: Record<BadgeVariant, string> = {
  default: "bg-muted text-foreground",
  secondary: "bg-background text-muted-foreground border"
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-5",
        VARIANT[variant],
        className
      )}
      {...props}
    />
  );
}

