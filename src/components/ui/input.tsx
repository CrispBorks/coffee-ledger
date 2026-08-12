import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base transition-colors outline-none md:text-sm",
        "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
        "file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "disabled:pointer-events-none disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/25",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
