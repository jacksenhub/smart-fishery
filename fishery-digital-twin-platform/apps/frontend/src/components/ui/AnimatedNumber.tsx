"use client";

import { animate, useMotionValue, useTransform, motion } from "framer-motion";
import { useEffect } from "react";

interface AnimatedNumberProps {
  value: number;
  suffix?: string;
  decimals?: number;
  className?: string;
}

export function AnimatedNumber({ value, suffix = "", decimals = 0, className }: AnimatedNumberProps) {
  const motionValue = useMotionValue(value);
  const rounded = useTransform(motionValue, (latest) => `${latest.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.8, ease: "easeOut" });
    return controls.stop;
  }, [motionValue, value]);

  return <motion.span className={className}>{rounded}</motion.span>;
}

