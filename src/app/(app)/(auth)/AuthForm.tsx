"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ErrorText, Input, Label } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim() || email.split("@")[0] || "Streamer";

    const { error: authError } =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });

    if (authError) {
      setPending(false);
      setError(authError.message ?? "Something went wrong. Try again.");
      return;
    }
    router.replace(mode === "signup" ? "/onboarding" : "/dashboard");
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "signup" && (
        <div>
          <Label htmlFor="name">Display name</Label>
          <Input id="name" name="name" autoComplete="nickname" maxLength={40} placeholder="Your streamer name" />
        </div>
      )}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={8}
          maxLength={128}
          required
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? "One moment…" : mode === "signup" ? "Create account" : "Log in"}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-accent hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="text-accent hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
