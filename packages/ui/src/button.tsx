import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "./utils";

const buttonVariants = cva(
    "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    {
        defaultVariants: {
            size: "default",
            variant: "default",
        },
        variants: {
            size: {
                default: "h-10",
                icon: "size-10 px-0",
                lg: "h-11 px-5",
                sm: "h-9 px-3",
            },
            variant: {
                default: "bg-slate-950 text-white hover:bg-slate-800",
                ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
                outline: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
            },
        },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants>
{
    asChild?: boolean;
}

/**
 * Button
 * ----------------
 * Renders the shared shadcn-style button primitive with accessible focus and disabled states.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
export function Button({
    asChild = false,
    className,
    size,
    variant,
    ...props
}: ButtonProps): React.JSX.Element
{
    const Component = asChild ? Slot : "button";

    return (
        <Component
            className={cn(buttonVariants({
                className,
                size,
                variant,
            }))}
            {...props}
        />
    );
}
