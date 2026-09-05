"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  hideClose,
}: {
  className?: string;
  children: React.ReactNode;
  title: string;
  description?: string;
  hideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[3px] data-[state=open]:animate-fade-up" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(96vw,620px)] -translate-x-1/2 -translate-y-1/2",
          "panel-raised p-0 outline-none data-[state=open]:animate-fade-up",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-line">
          <div>
            <DialogPrimitive.Title className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-[12.5px] text-mute mt-1 leading-relaxed">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {!hideClose ? (
            <DialogPrimitive.Close
              className="rounded-lg p-1.5 text-mute hover:text-ink hover:bg-white/5 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          ) : null}
        </div>
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
