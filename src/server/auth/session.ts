/**
 * Request-scoped auth helpers for server components and server actions.
 * Every protected page AND every server action calls one of these (never rely on layouts alone).
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/server/db/client";
import type { Sf6PlayerRow } from "@/server/db/schema";
import { findPlayerByUserId } from "@/server/players/service";
import { getAuth } from "./auth";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  locale: string | null;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Read request headers first: this marks the route dynamic before any env/DB access.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    locale: session.user.locale ?? null,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Signed-in user with a registered CFN player; otherwise redirect to the right step. */
export async function requirePlayer(): Promise<{ user: CurrentUser; player: Sf6PlayerRow }> {
  const user = await requireUser();
  const player = await findPlayerByUserId(getDb(), user.id);
  if (!player) redirect("/onboarding");
  return { user, player };
}
