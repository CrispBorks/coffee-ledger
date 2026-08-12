import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Tags are deliberately monochrome — a recipe being "dinner" or "roast" is
// not a state worth spending the palette's only hue on. `status` is, and is
// the one variant allowed to carry color.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full border label-mono whitespace-nowrap transition-colors [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "border-border bg-transparent px-2 py-[3px] text-muted-foreground",
        solid: "border-transparent bg-primary px-2 py-[3px] text-primary-foreground",
        status: "border-transparent bg-status px-2 py-[3px] text-status-foreground",
        destructive:
          "border-transparent bg-destructive px-2 py-[3px] text-destructive-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
