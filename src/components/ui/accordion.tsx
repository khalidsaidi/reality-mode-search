import * as React from "react";

import { cn } from "@/lib/utils";

export function Accordion({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2", className)} {...props} />;
}

export type AccordionItemProps = React.DetailsHTMLAttributes<HTMLDetailsElement> & {
  value?: string;
};

export const AccordionItem = React.forwardRef<HTMLDetailsElement, AccordionItemProps>(function AccordionItem(
  { className, ...props },
  ref
) {
  return <details ref={ref} className={cn("rounded-lg border bg-card", className)} {...props} />;
});

export const AccordionTrigger = React.forwardRef<
  React.ElementRef<"summary">,
  React.ComponentPropsWithoutRef<"summary">
>(function AccordionTrigger({ className, ...props }, ref) {
  return (
    <summary
      ref={ref}
      className={cn(
        "cursor-pointer list-none px-4 py-3 text-sm font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    />
  );
});

export const AccordionContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AccordionContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn("px-4 pb-4 text-sm text-muted-foreground", className)} {...props} />;
  }
);
