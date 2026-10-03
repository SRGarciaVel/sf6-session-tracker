import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-bold">Welcome back</h1>
      <AuthForm mode="login" />
    </>
  );
}
