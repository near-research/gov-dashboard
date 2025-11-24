export type TopicId = string | number;

type TopicEventBase = {
  topic_id: TopicId;
};

type FailureBase = {
  message: string;
};

export type GovernanceEvents = {
  // -------- Draft evaluation --------
  draft_evaluation_started: {
    content_length: number;
  };

  draft_evaluation_succeeded: {
    overall_pass: boolean;
    quality_score: number;
    model: string;
    has_verification: boolean;
  };

  draft_evaluation_failed: FailureBase;

  draft_evaluation_rate_limited: {
    remaining: number | null;
    reset_seconds: number | null;
  };

  // -------- Proposal page --------
  proposal_viewed: TopicEventBase & {
    category: string | null;
    reply_count: number;
  };

  // -------- Proposal summary --------
  proposal_summary_requested: TopicEventBase;

  proposal_summary_succeeded: TopicEventBase;

  proposal_summary_failed: TopicEventBase & FailureBase;

  // -------- Revision summary --------
  proposal_revision_summary_requested: TopicEventBase & {
    revision: number;
  };

  proposal_revision_summary_succeeded: TopicEventBase & {
    revision: number;
  };

  proposal_revision_summary_failed: TopicEventBase &
    FailureBase & {
      revision: number;
    };

  // -------- Reply summary --------
  proposal_reply_summary_requested: TopicEventBase & {
    reply_id: number;
  };

  proposal_reply_summary_succeeded: TopicEventBase & {
    reply_id: number;
  };

  proposal_reply_summary_failed: TopicEventBase &
    FailureBase & {
      reply_id: number;
    };

  // -------- Discussion summary --------
  proposal_discussion_summary_requested: TopicEventBase;

  proposal_discussion_summary_succeeded: TopicEventBase;

  proposal_discussion_summary_failed: TopicEventBase & FailureBase;

  proposal_discussion_summary_toggled: TopicEventBase & {
    visible: boolean;
  };

  // -------- Home --------
  home_latest_proposals_requested: {};

  home_latest_proposals_succeeded: {
    count: number;
  };

  home_latest_proposals_failed: FailureBase;

  // -------- Chat --------
  agent_chat_opened: {
    path: string | null;
  };

  agent_chat_message_sent: {
    length: number;
    turn_number: number;
    has_history: boolean;
  };

  agent_chat_run_started: {
    turn_number: number;
  };

  agent_chat_run_succeeded: {
    turn_number: number;
    response_length: number;
  };

  agent_chat_run_failed: {
    turn_number: number;
    message: string;
  };

  agent_chat_cleared: {
    had_events: boolean;
  };

  agent_chat_retry_clicked: {
    last_error: string | null;
  };

  // Proposal chatbot
  proposal_chatbot_opened: TopicEventBase;
  proposal_chatbot_message_sent: TopicEventBase & { length: number };
  proposal_chatbot_tool_used: TopicEventBase & { tool_name: string };

  // Wallet events
  wallet_connect_clicked: {};
  wallet_connect_failed: FailureBase;
  wallet_disconnect_clicked: {};
  wallet_connect_succeeded: { account_id: string };

  // Proposal screening from detail page
  proposal_screening_started: TopicEventBase & { revision: number };
  proposal_screening_succeeded: TopicEventBase & {
    revision: number;
    overall_pass: boolean;
  };
  proposal_screening_failed: TopicEventBase & {
    revision: number;
  } & FailureBase;

  // Revision screening from version history
  revision_screening_started: TopicEventBase & { revision: number };
  revision_screening_succeeded: TopicEventBase & {
    revision: number;
    overall_pass: boolean;
  };
  revision_screening_failed: TopicEventBase & {
    revision: number;
  } & FailureBase;
};
