"use client";

/**
 * Motion for the landing only: LazyMotion with the small `domAnimation` feature set (strict:
 * only `m.*` components), and MotionConfig honouring the OS reduced-motion setting.
 */
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import type { ReactNode } from "react";
import { RevealRoot } from "./RevealRoot";

export function LandingMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <RevealRoot>{children}</RevealRoot>
      </MotionConfig>
    </LazyMotion>
  );
}
