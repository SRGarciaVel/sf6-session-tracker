/**
 * Seeded demo account (scripts/seed.ts). Its CFN is a FAKE mock id: with a real data source
 * (companion / capcom) it would query another player. The dashboard flags it as demo data.
 */
export const DEMO_EMAIL = "demo@sf6.local";
export const DEMO_PASSWORD = "demo-password-123";
export const DEMO_CFN = "1122334455";

export type DemoDataReason = "mock_provider" | "demo_cfn";

/** Why the dashboard is showing demo data (null = real data). */
export function demoDataReason(provider: string, cfnUserId: string): DemoDataReason | null {
  if (provider === "mock") return "mock_provider";
  if (cfnUserId === DEMO_CFN) return "demo_cfn";
  return null;
}
