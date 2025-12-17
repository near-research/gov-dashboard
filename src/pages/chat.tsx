import { useEffect } from "react";
import dynamic from "next/dynamic";

const Chatbot = dynamic(() => import("@/components/chat/Chatbot").then((mod) => mod.Chatbot), {
  ssr: false,
  loading: () => <div className="animate-pulse h-full bg-gray-100" />,
});

export default function ChatPage() {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-full">
          <Chatbot className="h-full" />
        </div>
      </div>
    </div>
  );
}
