import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="font-display text-2xl font-bold">Create your account</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Takes 30 seconds. Then add your CFN User ID.</p>
      <AuthForm mode="signup" />
    </>
  );
}
