"use client";

import { ReactNode, ElementType } from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

// ─── Reveal ────────────────────────────────────────────────────────────────
export interface RevealProps {
  children?: ReactNode;
  /** Render as any HTML element (default: div) */
  as?: ElementType;
  distance?: number;
  delay?: number;
  duration?: number;
  once?: boolean;
  className?: string;
  [key: string]: unknown;
}

export function Reveal({
  children,
  as: Tag = "div",
  distance = 20,
  delay = 0,
  duration = 0.4,
  once = true,
  className,
  ...rest
}: RevealProps) {
  // Build the motion-wrapped version of the requested element
  const MotionTag = motion(Tag as "div");
  return (
    <MotionTag
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once }}
      transition={{ duration, delay, ease: "easeOut" }}
      className={cn(className)}
      {...(rest as HTMLMotionProps<"div">)}
    >
      {children}
    </MotionTag>
  );
}

// ─── Stagger ───────────────────────────────────────────────────────────────
export interface StaggerProps {
  children?: ReactNode;
  /** Render as any HTML element (default: div) */
  as?: ElementType;
  gap?: number;
  amount?: number;
  className?: string;
  [key: string]: unknown;
}

export function Stagger({
  children,
  as: Tag = "div",
  gap = 0.07,
  amount = 0.15,
  className,
  ...rest
}: StaggerProps) {
  const MotionTag = motion(Tag as "div");
  return (
    <MotionTag
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: gap } },
      }}
      className={cn(className)}
      {...(rest as HTMLMotionProps<"div">)}
    >
      {children}
    </MotionTag>
  );
}

// ─── StaggerItem ───────────────────────────────────────────────────────────
export interface StaggerItemProps {
  children?: ReactNode;
  /** Render as any HTML element (default: div) */
  as?: ElementType;
  distance?: number;
  className?: string;
  [key: string]: unknown;
}

export function StaggerItem({
  children,
  as: Tag = "div",
  distance = 16,
  className,
  ...rest
}: StaggerItemProps) {
  const MotionTag = motion(Tag as "div");
  return (
    <MotionTag
      variants={{
        hidden: { opacity: 0, y: distance },
        visible: {
          opacity: 1,
          y: 0,
          transition: { ease: "easeOut", duration: 0.35 },
        },
      }}
      className={cn(className)}
      {...(rest as HTMLMotionProps<"div">)}
    >
      {children}
    </MotionTag>
  );
}