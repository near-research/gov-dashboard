export type DiscourseAuthUrl = {
  authUrl: string;
  nonce: string;
  expiresAt: string;
};

export type DiscourseCompleteLinkResult = {
  userApiKey: string;
  discourseUsername: string;
  discourseUserId: number;
  nearAccount?: string;
};

export type DiscourseLinkage = {
  discourseUsername?: string;
  discourseUserId?: string | number;
  userApiKey?: string;
  nearAccount?: string;
};

export type DiscoursePostResult = {
  success: boolean;
  postUrl?: string;
  postId?: number;
  topicId?: number;
};
