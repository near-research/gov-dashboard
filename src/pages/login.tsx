import { useEffect } from "react";
import { useRouter } from "next/router";
import { SignInForm } from "@/components/auth/sign-in-form";
import { useAuth } from "@/components/providers/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const { user, isPending } = useAuth();
  const redirect = (router.query.redirect as string) || "/";

  useEffect(() => {
    if (!isPending && user) {
      router.push(redirect);
    }
  }, [user, isPending, redirect, router]);

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (user) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <SignInForm />
    </div>
  );
}
