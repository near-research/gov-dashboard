import { Chat, type ChatProps } from "./Chat";

export type ChatbotProps = ChatProps;

export function Chatbot(props: ChatbotProps) {
  return <Chat {...props} />;
}
