import "@/styles/globals.css";
import { AppProps } from "next/app";
import { Navigation } from "@/components/nav/navigation";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/providers/auth-provider";
import PlausibleProvider from "next-plausible";

const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "neargov.ai";

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const message = event.reason?.message || "";
    if (message.includes("Iframe not loaded")) {
      event.preventDefault();
    }
  });

  window.addEventListener("error", (event) => {
    if (event.message?.includes("Iframe not loaded")) {
      event.preventDefault();
    }
  });
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <PlausibleProvider
        domain={domain}
        enabled={process.env.NODE_ENV === "production"}
        trackOutboundLinks
      >
        <Navigation />
        <Component {...pageProps} />
        <Toaster />
      </PlausibleProvider>
    </AuthProvider>
  );
}
