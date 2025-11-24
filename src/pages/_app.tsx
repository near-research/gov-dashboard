import "@/styles/globals.css";
import { AppProps } from "next/app";
import { Navigation } from "@/components/nav/navigation";
import { Toaster } from "@/components/ui/sonner";
import PlausibleProvider from "next-plausible";

const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "neargov.ai";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <PlausibleProvider
      domain={domain}
      enabled={process.env.NODE_ENV === "production"}
      trackOutboundLinks
    >
      <Navigation />
      <Component {...pageProps} />
      <Toaster />
    </PlausibleProvider>
  );
}
