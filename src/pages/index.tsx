"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";

const Chat = dynamic(() => import("@/components/chat/Chat"), {
  ssr: false,
  loading: () => <div className="animate-pulse h-full bg-gray-100" />,
});

export default function AgentPage() {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-full min-h-0">
          <Chat className="h-full" showVerification={false} />
        </div>
      </div>
    </div>
  );
}
