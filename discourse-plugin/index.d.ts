import { CommonPluginErrors } from "every-plugin";
import { z } from "every-plugin/zod";
import type { ContractProcedure } from "@orpc/contract";

type PluginProcedure<
  TInputSchema extends z.ZodTypeAny,
  TOutputSchema extends z.ZodTypeAny
> = ContractProcedure<
  TInputSchema,
  TOutputSchema,
  typeof CommonPluginErrors,
  Record<never, never>
>;

export declare const AuthUrlSchema: z.ZodObject<
  {
    authUrl: z.ZodString;
    nonce: z.ZodString;
    expiresAt: z.ZodString;
  },
  "strip",
  z.ZodTypeAny,
  {
    authUrl: string;
    nonce: string;
    expiresAt: string;
  },
  {
    authUrl: string;
    nonce: string;
    expiresAt: string;
  }
>;

export declare const CompleteLinkResultSchema: z.ZodObject<
  {
    userApiKey: z.ZodString;
    discourseUsername: z.ZodString;
    discourseUserId: z.ZodNumber;
  },
  "strip",
  z.ZodTypeAny,
  {
    userApiKey: string;
    discourseUsername: string;
    discourseUserId: number;
  },
  {
    userApiKey: string;
    discourseUsername: string;
    discourseUserId: number;
  }
>;

export declare const PostResultSchema: z.ZodObject<
  {
    success: z.ZodBoolean;
    postUrl: z.ZodOptional<z.ZodString>;
    postId: z.ZodOptional<z.ZodNumber>;
    topicId: z.ZodOptional<z.ZodNumber>;
  },
  "strip",
  z.ZodTypeAny,
  {
    success: boolean;
    postUrl?: string | undefined;
    postId?: number | undefined;
    topicId?: number | undefined;
  },
  {
    success: boolean;
    postUrl?: string | undefined;
    postId?: number | undefined;
    topicId?: number | undefined;
  }
>;

export declare const PostActionResultSchema: z.ZodObject<
  {
    success: z.ZodBoolean;
    action: z.ZodDefault<
      z.ZodEnum<
        [
          "like",
          "unlike",
          "flag",
          "flag_off_topic",
          "flag_inappropriate",
          "flag_spam",
          "notify_user",
          "notify_moderators",
          "custom"
        ]
      >
    >;
    postActionTypeId: z.ZodNumber;
    postActionId: z.ZodOptional<z.ZodNumber>;
  },
  "strip",
  z.ZodTypeAny,
  {
    success: boolean;
    action:
      | "like"
      | "unlike"
      | "flag"
      | "flag_off_topic"
      | "flag_inappropriate"
      | "flag_spam"
      | "notify_user"
      | "notify_moderators"
      | "custom";
    postActionTypeId: number;
    postActionId?: number | undefined;
  },
  {
    success: boolean;
    action:
      | "like"
      | "unlike"
      | "flag"
      | "flag_off_topic"
      | "flag_inappropriate"
      | "flag_spam"
      | "notify_user"
      | "notify_moderators"
      | "custom";
    postActionTypeId: number;
    postActionId?: number | undefined;
  }
>;

export declare const CategorySchema: z.ZodObject<
  {
    id: z.ZodNumber;
    name: z.ZodString;
    slug: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    color: z.ZodString;
    topicCount: z.ZodNumber;
    postCount: z.ZodNumber;
    parentCategoryId: z.ZodNullable<z.ZodNumber>;
    readRestricted: z.ZodBoolean;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    color: string;
    topicCount: number;
    postCount: number;
    parentCategoryId: number | null;
    readRestricted: boolean;
  },
  {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    color: string;
    topicCount: number;
    postCount: number;
    parentCategoryId: number | null;
    readRestricted: boolean;
  }
>;

export declare const TagSchema: z.ZodObject<
  {
    id: z.ZodNumber;
    name: z.ZodString;
    topicCount: z.ZodNumber;
    pmTopicCount: z.ZodNumber;
    synonyms: z.ZodArray<z.ZodString, "many">;
    targetTag: z.ZodNullable<z.ZodString>;
    description: z.ZodNullable<z.ZodString>;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    name: string;
    topicCount: number;
    pmTopicCount: number;
    synonyms: string[];
    targetTag: string | null;
    description: string | null;
  },
  {
    id: number;
    name: string;
    topicCount: number;
    pmTopicCount: number;
    synonyms: string[];
    targetTag: string | null;
    description: string | null;
  }
>;

export declare const TagGroupSchema: z.ZodObject<
  {
    id: z.ZodNumber;
    name: z.ZodString;
    tagNames: z.ZodArray<z.ZodString, "many">;
    parentTagNames: z.ZodArray<z.ZodString, "many">;
    onePerTopic: z.ZodBoolean;
    permissions: z.ZodRecord<z.ZodString, z.ZodNumber>;
    tags: z.ZodOptional<z.ZodArray<typeof TagSchema, "many">>;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    name: string;
    tagNames: string[];
    parentTagNames: string[];
    onePerTopic: boolean;
    permissions: Record<string, number>;
    tags?: z.infer<typeof TagSchema>[] | undefined;
  },
  {
    id: number;
    name: string;
    tagNames: string[];
    parentTagNames: string[];
    onePerTopic: boolean;
    permissions: Record<string, number>;
    tags?: z.infer<typeof TagSchema>[] | undefined;
  }
>;

export declare const TopicSchema: z.ZodObject<
  {
    id: z.ZodNumber;
    title: z.ZodString;
    slug: z.ZodString;
    categoryId: z.ZodNullable<z.ZodNumber>;
    createdAt: z.ZodNullable<z.ZodString>;
    lastPostedAt: z.ZodNullable<z.ZodString>;
    postsCount: z.ZodNumber;
    replyCount: z.ZodNumber;
    likeCount: z.ZodNumber;
    views: z.ZodNumber;
    pinned: z.ZodBoolean;
    closed: z.ZodBoolean;
    archived: z.ZodBoolean;
    visible: z.ZodBoolean;
    excerpt: z.ZodOptional<z.ZodString>;
    username: z.ZodOptional<z.ZodString>;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    title: string;
    slug: string;
    categoryId: number | null;
    createdAt: string | null;
    lastPostedAt: string | null;
    postsCount: number;
    replyCount: number;
    likeCount: number;
    views: number;
    pinned: boolean;
    closed: boolean;
    archived: boolean;
    visible: boolean;
    excerpt?: string | undefined;
    username?: string | undefined;
  },
  {
    id: number;
    title: string;
    slug: string;
    categoryId: number | null;
    createdAt: string | null;
    lastPostedAt: string | null;
    postsCount: number;
    replyCount: number;
    likeCount: number;
    views: number;
    pinned: boolean;
    closed: boolean;
    archived: boolean;
    visible: boolean;
    excerpt?: string | undefined;
    username?: string | undefined;
  }
>;

export declare const PaginatedTopicsSchema: z.ZodObject<
  {
    topics: z.ZodArray<typeof TopicSchema, "many">;
    hasMore: z.ZodBoolean;
    nextPage: z.ZodNullable<z.ZodNumber>;
    canCreateTopic: z.ZodOptional<z.ZodBoolean>;
  },
  "strip",
  z.ZodTypeAny,
  {
    topics: z.infer<typeof TopicSchema>[];
    hasMore: boolean;
    nextPage: number | null;
    canCreateTopic?: boolean | undefined;
  },
  {
    topics: z.infer<typeof TopicSchema>[];
    hasMore: boolean;
    nextPage: number | null;
    canCreateTopic?: boolean | undefined;
  }
>;

export declare const PostSchema: z.ZodObject<
  {
    id: z.ZodNumber;
    topicId: z.ZodNumber;
    postNumber: z.ZodNumber;
    username: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    avatarTemplate: z.ZodString;
    raw: z.ZodOptional<z.ZodString>;
    cooked: z.ZodString;
    createdAt: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodNullable<z.ZodString>;
    replyCount: z.ZodNumber;
    likeCount: z.ZodNumber;
    replyToPostNumber: z.ZodNullable<z.ZodNumber>;
    canEdit: z.ZodOptional<z.ZodBoolean>;
    version: z.ZodNumber;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    topicId: number;
    postNumber: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    raw?: string | undefined;
    cooked: string;
    createdAt: string | null;
    updatedAt: string | null;
    replyCount: number;
    likeCount: number;
    replyToPostNumber: number | null;
    canEdit?: boolean | undefined;
    version: number;
  },
  {
    id: number;
    topicId: number;
    postNumber: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    raw?: string | undefined;
    cooked: string;
    createdAt: string | null;
    updatedAt: string | null;
    replyCount: number;
    likeCount: number;
    replyToPostNumber: number | null;
    canEdit?: boolean | undefined;
    version: number;
  }
>;

export declare const PaginatedPostsSchema: z.ZodObject<
  {
    posts: z.ZodArray<typeof PostSchema, "many">;
    hasMore: z.ZodBoolean;
    nextPage: z.ZodNullable<z.ZodNumber>;
  },
  "strip",
  z.ZodTypeAny,
  {
    posts: z.infer<typeof PostSchema>[];
    hasMore: boolean;
    nextPage: number | null;
  },
  {
    posts: z.infer<typeof PostSchema>[];
    hasMore: boolean;
    nextPage: number | null;
  }
>;

export declare const DiscourseUserSchema: z.ZodObject<
  {
    id: z.ZodNumber;
    username: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    avatarTemplate: z.ZodString;
    title: z.ZodNullable<z.ZodString>;
    trustLevel: z.ZodNumber;
    moderator: z.ZodBoolean;
    admin: z.ZodBoolean;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    title: string | null;
    trustLevel: number;
    moderator: boolean;
    admin: boolean;
  },
  {
    id: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    title: string | null;
    trustLevel: number;
    moderator: boolean;
    admin: boolean;
  }
>;

export declare const UserProfileSchema: z.ZodObject<
  {
    createdAt: z.ZodOptional<z.ZodString>;
    lastPostedAt: z.ZodNullable<z.ZodString>;
    lastSeenAt: z.ZodNullable<z.ZodString>;
    postCount: z.ZodNumber;
    badgeCount: z.ZodNumber;
    profileViewCount: z.ZodNumber;
    id: z.ZodNumber;
    username: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    avatarTemplate: z.ZodString;
    title: z.ZodNullable<z.ZodString>;
    trustLevel: z.ZodNumber;
    moderator: z.ZodBoolean;
    admin: z.ZodBoolean;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    title: string | null;
    trustLevel: number;
    moderator: boolean;
    admin: boolean;
    createdAt?: string | undefined;
    lastPostedAt: string | null;
    lastSeenAt: string | null;
    postCount: number;
    badgeCount: number;
    profileViewCount: number;
  },
  {
    id: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    title: string | null;
    trustLevel: number;
    moderator: boolean;
    admin: boolean;
    createdAt?: string | undefined;
    lastPostedAt: string | null;
    lastSeenAt: string | null;
    postCount: number;
    badgeCount: number;
    profileViewCount: number;
  }
>;

export declare const SearchPostSchema: z.ZodObject<
  {
    topicTitle: z.ZodString;
    blurb: z.ZodString;
    id: z.ZodNumber;
    topicId: z.ZodNumber;
    postNumber: z.ZodNumber;
    username: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    avatarTemplate: z.ZodString;
    raw: z.ZodOptional<z.ZodString>;
    cooked: z.ZodString;
    createdAt: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodNullable<z.ZodString>;
    replyCount: z.ZodNumber;
    likeCount: z.ZodNumber;
    replyToPostNumber: z.ZodNullable<z.ZodNumber>;
    canEdit: z.ZodOptional<z.ZodBoolean>;
    version: z.ZodNumber;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    topicId: number;
    postNumber: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    raw?: string | undefined;
    cooked: string;
    createdAt: string | null;
    updatedAt: string | null;
    replyCount: number;
    likeCount: number;
    replyToPostNumber: number | null;
    canEdit?: boolean | undefined;
    version: number;
    topicTitle: string;
    blurb: string;
  },
  {
    id: number;
    topicId: number;
    postNumber: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    raw?: string | undefined;
    cooked: string;
    createdAt: string | null;
    updatedAt: string | null;
    replyCount: number;
    likeCount: number;
    replyToPostNumber: number | null;
    canEdit?: boolean | undefined;
    version: number;
    topicTitle: string;
    blurb: string;
  }
>;

export declare const RevisionSchema: z.ZodObject<
  {
    number: z.ZodNumber;
    postId: z.ZodNumber;
    userId: z.ZodOptional<z.ZodNumber>;
    username: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updatedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    raw: z.ZodOptional<z.ZodString>;
    cooked: z.ZodOptional<z.ZodString>;
    changes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
  },
  "strip",
  z.ZodTypeAny,
  {
    number: number;
    postId: number;
    userId?: number | undefined;
    username?: string | undefined;
    createdAt?: string | null | undefined;
    updatedAt?: string | null | undefined;
    raw?: string | undefined;
    cooked?: string | undefined;
    changes?: Record<string, any> | undefined;
  },
  {
    number: number;
    postId: number;
    userId?: number | undefined;
    username?: string | undefined;
    createdAt?: string | null | undefined;
    updatedAt?: string | null | undefined;
    raw?: string | undefined;
    cooked?: string | undefined;
    changes?: Record<string, any> | undefined;
  }
>;

export declare const SearchResultSchema: z.ZodObject<
  {
    posts: z.ZodArray<typeof SearchPostSchema, "many">;
    topics: z.ZodArray<typeof TopicSchema, "many">;
    users: z.ZodArray<typeof DiscourseUserSchema, "many">;
    categories: z.ZodArray<typeof CategorySchema, "many">;
    totalResults: z.ZodNumber;
    hasMore: z.ZodBoolean;
    nextPage: z.ZodOptional<z.ZodNumber>;
  },
  "strip",
  z.ZodTypeAny,
  {
    posts: z.infer<typeof SearchPostSchema>[];
    topics: z.infer<typeof TopicSchema>[];
    users: z.infer<typeof DiscourseUserSchema>[];
    categories: z.infer<typeof CategorySchema>[];
    totalResults: number;
    hasMore: boolean;
    nextPage?: number | undefined;
  },
  {
    posts: z.infer<typeof SearchPostSchema>[];
    topics: z.infer<typeof TopicSchema>[];
    users: z.infer<typeof DiscourseUserSchema>[];
    categories: z.infer<typeof CategorySchema>[];
    totalResults: number;
    hasMore: boolean;
    nextPage?: number | undefined;
  }
>;

export declare const AdminUserSchema: z.ZodObject<
  {
    email: z.ZodOptional<z.ZodString>;
    active: z.ZodOptional<z.ZodBoolean>;
    lastSeenAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    staged: z.ZodOptional<z.ZodBoolean>;
    id: z.ZodNumber;
    username: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    avatarTemplate: z.ZodString;
    title: z.ZodNullable<z.ZodString>;
    trustLevel: z.ZodNumber;
    moderator: z.ZodBoolean;
    admin: z.ZodBoolean;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    title: string | null;
    trustLevel: number;
    moderator: boolean;
    admin: boolean;
    email?: string | undefined;
    active?: boolean | undefined;
    lastSeenAt?: string | null | undefined;
    staged?: boolean | undefined;
  },
  {
    id: number;
    username: string;
    name: string | null;
    avatarTemplate: string;
    title: string | null;
    trustLevel: number;
    moderator: boolean;
    admin: boolean;
    email?: string | undefined;
    active?: boolean | undefined;
    lastSeenAt?: string | null | undefined;
    staged?: boolean | undefined;
  }
>;

export declare const DirectoryItemSchema: z.ZodObject<
  {
    user: typeof DiscourseUserSchema;
    likesReceived: z.ZodNumber;
    likesGiven: z.ZodNumber;
    topicsEntered: z.ZodNumber;
    postsRead: z.ZodNumber;
    daysVisited: z.ZodNumber;
    topicCount: z.ZodNumber;
    postCount: z.ZodNumber;
  },
  "strip",
  z.ZodTypeAny,
  {
    user: z.infer<typeof DiscourseUserSchema>;
    likesReceived: number;
    likesGiven: number;
    topicsEntered: number;
    postsRead: number;
    daysVisited: number;
    topicCount: number;
    postCount: number;
  },
  {
    user: z.infer<typeof DiscourseUserSchema>;
    likesReceived: number;
    likesGiven: number;
    topicsEntered: number;
    postsRead: number;
    daysVisited: number;
    topicCount: number;
    postCount: number;
  }
>;

export declare const UserStatusSchema: z.ZodObject<
  {
    emoji: z.ZodNullable<z.ZodString>;
    description: z.ZodNullable<z.ZodString>;
    endsAt: z.ZodNullable<z.ZodString>;
  },
  "strip",
  z.ZodTypeAny,
  {
    emoji: string | null;
    description: string | null;
    endsAt: string | null;
  },
  {
    emoji: string | null;
    description: string | null;
    endsAt: string | null;
  }
>;

export declare const UploadSchema: z.ZodObject<
  {
    id: z.ZodNumber;
    url: z.ZodString;
    shortUrl: z.ZodOptional<z.ZodString>;
    originalFilename: z.ZodOptional<z.ZodString>;
    filesize: z.ZodOptional<z.ZodNumber>;
    humanFileSize: z.ZodOptional<z.ZodString>;
    extension: z.ZodOptional<z.ZodString>;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    thumbnailUrl: z.ZodOptional<z.ZodString>;
  },
  "strip",
  z.ZodTypeAny,
  {
    id: number;
    url: string;
    shortUrl?: string | undefined;
    originalFilename?: string | undefined;
    filesize?: number | undefined;
    humanFileSize?: string | undefined;
    extension?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
    thumbnailUrl?: string | undefined;
  },
  {
    id: number;
    url: string;
    shortUrl?: string | undefined;
    originalFilename?: string | undefined;
    filesize?: number | undefined;
    humanFileSize?: string | undefined;
    extension?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
    thumbnailUrl?: string | undefined;
  }
>;

export declare const UploadRequestSchema: z.ZodObject<
  {
    url: z.ZodString;
    method: z.ZodLiteral<"POST">;
    headers: z.ZodRecord<z.ZodString, z.ZodString>;
    fields: z.ZodRecord<z.ZodString, z.ZodString>;
  },
  "strip",
  z.ZodTypeAny,
  {
    url: string;
    method: "POST";
    headers: Record<string, string>;
    fields: Record<string, string>;
  },
  {
    url: string;
    method: "POST";
    headers: Record<string, string>;
    fields: Record<string, string>;
  }
>;

export declare const PresignedUploadSchema: z.ZodObject<
  {
    method: z.ZodLiteral<"PUT">;
    uploadUrl: z.ZodString;
    headers: z.ZodRecord<z.ZodString, z.ZodString>;
    key: z.ZodString;
    uniqueIdentifier: z.ZodString;
  },
  "strip",
  z.ZodTypeAny,
  {
    method: "PUT";
    uploadUrl: string;
    headers: Record<string, string>;
    key: string;
    uniqueIdentifier: string;
  },
  {
    method: "PUT";
    uploadUrl: string;
    headers: Record<string, string>;
    key: string;
    uniqueIdentifier: string;
  }
>;

export declare const MultipartPresignPartSchema: z.ZodObject<
  {
    partNumber: z.ZodNumber;
    url: z.ZodString;
    headers: z.ZodRecord<z.ZodString, z.ZodString>;
  },
  "strip",
  z.ZodTypeAny,
  {
    partNumber: number;
    url: string;
    headers: Record<string, string>;
  },
  {
    partNumber: number;
    url: string;
    headers: Record<string, string>;
  }
>;

export declare const MultipartPresignSchema: z.ZodObject<
  {
    uploadId: z.ZodString;
    key: z.ZodString;
    uniqueIdentifier: z.ZodString;
    parts: z.ZodArray<typeof MultipartPresignPartSchema, "many">;
  },
  "strip",
  z.ZodTypeAny,
  {
    uploadId: string;
    key: string;
    uniqueIdentifier: string;
    parts: z.infer<typeof MultipartPresignPartSchema>[];
  },
  {
    uploadId: string;
    key: string;
    uniqueIdentifier: string;
    parts: z.infer<typeof MultipartPresignPartSchema>[];
  }
>;

export declare const SiteBasicInfoSchema: z.ZodObject<
  {
    title: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    logoUrl: z.ZodNullable<z.ZodString>;
    mobileLogoUrl: z.ZodNullable<z.ZodString>;
    faviconUrl: z.ZodNullable<z.ZodString>;
    contactEmail: z.ZodNullable<z.ZodString>;
    canonicalHostname: z.ZodNullable<z.ZodString>;
    defaultLocale: z.ZodNullable<z.ZodString>;
  },
  "strip",
  z.ZodTypeAny,
  {
    title: string;
    description: string | null;
    logoUrl: string | null;
    mobileLogoUrl: string | null;
    faviconUrl: string | null;
    contactEmail: string | null;
    canonicalHostname: string | null;
    defaultLocale: string | null;
  },
  {
    title: string;
    description: string | null;
    logoUrl: string | null;
    mobileLogoUrl: string | null;
    faviconUrl: string | null;
    contactEmail: string | null;
    canonicalHostname: string | null;
    defaultLocale: string | null;
  }
>;

export declare const SiteInfoSchema: z.ZodObject<
  {
    title: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    logoUrl: z.ZodNullable<z.ZodString>;
    mobileLogoUrl: z.ZodNullable<z.ZodString>;
    faviconUrl: z.ZodNullable<z.ZodString>;
    contactEmail: z.ZodNullable<z.ZodString>;
    canonicalHostname: z.ZodNullable<z.ZodString>;
    defaultLocale: z.ZodNullable<z.ZodString>;
    categories: z.ZodArray<typeof CategorySchema, "many">;
  },
  "strip",
  z.ZodTypeAny,
  {
    title: string;
    description: string | null;
    logoUrl: string | null;
    mobileLogoUrl: string | null;
    faviconUrl: string | null;
    contactEmail: string | null;
    canonicalHostname: string | null;
    defaultLocale: string | null;
    categories: z.infer<typeof CategorySchema>[];
  },
  {
    title: string;
    description: string | null;
    logoUrl: string | null;
    mobileLogoUrl: string | null;
    faviconUrl: string | null;
    contactEmail: string | null;
    canonicalHostname: string | null;
    defaultLocale: string | null;
    categories: z.infer<typeof CategorySchema>[];
  }
>;

export declare const ValidateUserApiKeyResultSchema: z.ZodObject<
  {
    valid: z.ZodUnion<[z.ZodLiteral<true>, z.ZodLiteral<false>]>;
    retryable: z.ZodOptional<z.ZodBoolean>;
    error: z.ZodOptional<z.ZodString>;
    user: z.ZodOptional<typeof DiscourseUserSchema>;
  },
  "strip",
  z.ZodTypeAny,
  {
    valid: boolean;
    retryable?: boolean | undefined;
    error?: string | undefined;
    user?: z.infer<typeof DiscourseUserSchema> | undefined;
  },
  {
    valid: boolean;
    retryable?: boolean | undefined;
    error?: string | undefined;
    user?: z.infer<typeof DiscourseUserSchema> | undefined;
  }
>;

export declare const TopicStatusSchema: z.ZodEnum<
  ["closed", "archived", "pinned", "visible"]
>;

export declare const TopicNotificationLevelNames: readonly [
  "muted",
  "regular",
  "tracking",
  "watching",
  "watching_first_post"
];

export type TopicNotificationLevelName =
  (typeof TopicNotificationLevelNames)[number];
export type TopicNotificationLevel = number | TopicNotificationLevelName;

export declare const TopicNotificationLevelMap: Record<
  TopicNotificationLevelName,
  number
>;

export declare const normalizeTopicNotificationLevel: (
  value: TopicNotificationLevel
) => number;

export declare const TopicNotificationLevelSchema: z.ZodEffects<
  z.ZodUnion<
    [
      z.ZodNumber,
      z.ZodEnum<
        ["muted", "regular", "tracking", "watching", "watching_first_post"]
      >
    ]
  >,
  number,
  TopicNotificationLevel
>;

export declare const TopicTimerStatusSchema: z.ZodEnum<
  [
    "open",
    "close",
    "delete",
    "publish",
    "auto_close",
    "auto_delete",
    "reminder"
  ]
>;

export declare const ListTopicListInputSchema: z.ZodEffects<
  z.ZodObject<
    {
      type: z.ZodDefault<z.ZodEnum<["latest", "new", "top"]>>;
      categoryId: z.ZodOptional<z.ZodNumber>;
      page: z.ZodDefault<z.ZodNumber>;
      order: z.ZodDefault<
        z.ZodEnum<["default", "created", "activity", "views", "posts", "likes"]>
      >;
      period: z.ZodDefault<
        z.ZodEnum<["all", "yearly", "quarterly", "monthly", "weekly", "daily"]>
      >;
    },
    "strip",
    z.ZodTypeAny,
    {
      type: "latest" | "new" | "top";
      categoryId?: number | undefined;
      page: number;
      order: "default" | "created" | "activity" | "views" | "posts" | "likes";
      period: "all" | "yearly" | "quarterly" | "monthly" | "weekly" | "daily";
    },
    {
      type: "latest" | "new" | "top";
      categoryId?: number | undefined;
      page: number;
      order: "default" | "created" | "activity" | "views" | "posts" | "likes";
      period: "all" | "yearly" | "quarterly" | "monthly" | "weekly" | "daily";
    }
  >
>;

export declare const TopicActionResultSchema: z.ZodObject<
  {
    topic: typeof TopicSchema;
  },
  "strip",
  z.ZodTypeAny,
  {
    topic: z.infer<typeof TopicSchema>;
  },
  {
    topic: z.infer<typeof TopicSchema>;
  }
>;

export declare const BookmarkResultSchema: z.ZodObject<
  {
    success: z.ZodBoolean;
    bookmarkId: z.ZodOptional<z.ZodNumber>;
  },
  "strip",
  z.ZodTypeAny,
  {
    success: boolean;
    bookmarkId?: number | undefined;
  },
  {
    success: boolean;
    bookmarkId?: number | undefined;
  }
>;

export declare const TopicNotificationResultSchema: z.ZodObject<
  {
    success: z.ZodBoolean;
    notificationLevel: z.ZodNumber;
  },
  "strip",
  z.ZodTypeAny,
  {
    success: boolean;
    notificationLevel: number;
  },
  {
    success: boolean;
    notificationLevel: number;
  }
>;

export declare const TopicTimerResultSchema: z.ZodObject<
  {
    success: z.ZodBoolean;
    status: z.ZodString;
  },
  "strip",
  z.ZodTypeAny,
  {
    success: boolean;
    status: string;
  },
  {
    success: boolean;
    status: string;
  }
>;

export declare const SuccessSchema: z.ZodObject<
  {
    success: z.ZodBoolean;
  },
  "strip",
  z.ZodTypeAny,
  {
    success: boolean;
  },
  {
    success: boolean;
  }
>;

export type AuthUrl = z.infer<typeof AuthUrlSchema>;
export type CompleteLinkResult = z.infer<typeof CompleteLinkResultSchema>;
export type PostResult = z.infer<typeof PostResultSchema>;
export type PostActionResult = z.infer<typeof PostActionResultSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Tag = z.infer<typeof TagSchema>;
export type TagGroup = z.infer<typeof TagGroupSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type PaginatedTopics = z.infer<typeof PaginatedTopicsSchema>;
export type Post = z.infer<typeof PostSchema>;
export type DiscourseUser = z.infer<typeof DiscourseUserSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type SearchPost = z.infer<typeof SearchPostSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type DiscourseSearchResponse = SearchResult;
export type DiscourseLatestPost = {
  id: Topic["id"];
  title: Topic["title"];
  excerpt?: string;
  created_at: string;
  username?: string;
  topic_id: Topic["id"];
  topic_slug: Topic["slug"];
  reply_count: Topic["replyCount"];
  views: Topic["views"];
  last_posted_at: string;
  like_count: Topic["likeCount"];
  posts_count: Topic["postsCount"];
  pinned: Topic["pinned"];
  closed: Topic["closed"];
  archived: Topic["archived"];
  visible: Topic["visible"];
  category_id?: Topic["categoryId"];
};
export type DiscourseLatestPostsResponse = {
  latest_posts: DiscourseLatestPost[];
  can_create_topic: boolean;
  per_page: number;
};
export type Upload = z.infer<typeof UploadSchema>;
export type UploadRequest = z.infer<typeof UploadRequestSchema>;
export type PresignedUpload = z.infer<typeof PresignedUploadSchema>;
export type MultipartPresign = z.infer<typeof MultipartPresignSchema>;
export type AdminUser = z.infer<typeof AdminUserSchema>;
export type DirectoryItem = z.infer<typeof DirectoryItemSchema>;
export type UserStatus = z.infer<typeof UserStatusSchema>;
export type SiteBasicInfo = z.infer<typeof SiteBasicInfoSchema>;
export type SiteInfo = z.infer<typeof SiteInfoSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type TopicActionResult = z.infer<typeof TopicActionResultSchema>;
export type BookmarkResult = z.infer<typeof BookmarkResultSchema>;
export type TopicNotificationResult = z.infer<typeof TopicNotificationResultSchema>;
export type TopicTimerResult = z.infer<typeof TopicTimerResultSchema>;
export type ValidateUserApiKeyResult = z.infer<
  typeof ValidateUserApiKeyResultSchema
>;

export declare const contract: {
  initiateLink: PluginProcedure<
    z.ZodObject<
      {
        clientId: z.ZodString;
        applicationName: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        clientId: string;
        applicationName: string;
      },
      {
        clientId: string;
        applicationName: string;
      }
    >,
    typeof AuthUrlSchema
  >;
  completeLink: PluginProcedure<
    z.ZodObject<
      {
        payload: z.ZodString;
        nonce: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        payload: string;
        nonce: string;
      },
      {
        payload: string;
        nonce: string;
      }
    >,
    typeof CompleteLinkResultSchema
  >;
  createPost: PluginProcedure<
    z.ZodEffects<
      z.ZodObject<
        {
          username: z.ZodString;
          userApiKey: z.ZodOptional<z.ZodString>;
          title: z.ZodOptional<z.ZodString>;
          raw: z.ZodString;
          category: z.ZodOptional<z.ZodNumber>;
          topicId: z.ZodOptional<z.ZodNumber>;
          replyToPostNumber: z.ZodOptional<z.ZodNumber>;
        },
        "strip",
        z.ZodTypeAny,
        {
          username: string;
          raw: string;
          userApiKey?: string | undefined;
          title?: string | undefined;
          category?: number | undefined;
          topicId?: number | undefined;
          replyToPostNumber?: number | undefined;
        },
        {
          username: string;
          raw: string;
          userApiKey?: string | undefined;
          title?: string | undefined;
          category?: number | undefined;
          topicId?: number | undefined;
          replyToPostNumber?: number | undefined;
        }
      >,
      {
        username: string;
        raw: string;
        userApiKey?: string | undefined;
        title?: string | undefined;
        category?: number | undefined;
        topicId?: number | undefined;
        replyToPostNumber?: number | undefined;
      },
      {
        username: string;
        raw: string;
        userApiKey?: string | undefined;
        title?: string | undefined;
        category?: number | undefined;
        topicId?: number | undefined;
        replyToPostNumber?: number | undefined;
      }
    >,
    typeof PostResultSchema
  >;
  editPost: PluginProcedure<
    z.ZodObject<
      {
        username: z.ZodString;
        userApiKey: z.ZodOptional<z.ZodString>;
        postId: z.ZodNumber;
        raw: z.ZodString;
        editReason: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        username: string;
        postId: number;
        raw: string;
        userApiKey?: string | undefined;
        editReason?: string | undefined;
      },
      {
        username: string;
        postId: number;
        raw: string;
        userApiKey?: string | undefined;
        editReason?: string | undefined;
      }
    >,
    typeof PostResultSchema
  >;
  prepareUpload: PluginProcedure<
    z.ZodObject<
      {
        uploadType: z.ZodDefault<z.ZodString>;
        username: z.ZodOptional<z.ZodString>;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        uploadType: string;
        username?: string | undefined;
        userApiKey?: string | undefined;
      },
      {
        uploadType: string;
        username?: string | undefined;
        userApiKey?: string | undefined;
      }
    >,
    z.ZodObject<
      {
        request: typeof UploadRequestSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        request: z.infer<typeof UploadRequestSchema>;
      },
      {
        request: z.infer<typeof UploadRequestSchema>;
      }
    >
  >;
  presignUpload: PluginProcedure<
    z.ZodObject<
      {
        filename: z.ZodString;
        byteSize: z.ZodNumber;
        contentType: z.ZodOptional<z.ZodString>;
        uploadType: z.ZodDefault<z.ZodString>;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        filename: string;
        byteSize: number;
        uploadType: string;
        contentType?: string | undefined;
        userApiKey?: string | undefined;
      },
      {
        filename: string;
        byteSize: number;
        uploadType: string;
        contentType?: string | undefined;
        userApiKey?: string | undefined;
      }
    >,
    typeof PresignedUploadSchema
  >;
  batchPresignMultipartUpload: PluginProcedure<
    z.ZodObject<
      {
        uniqueIdentifier: z.ZodString;
        partNumbers: z.ZodArray<z.ZodNumber, "many">;
        uploadId: z.ZodOptional<z.ZodString>;
        key: z.ZodOptional<z.ZodString>;
        contentType: z.ZodOptional<z.ZodString>;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        uniqueIdentifier: string;
        partNumbers: number[];
        uploadId?: string | undefined;
        key?: string | undefined;
        contentType?: string | undefined;
        userApiKey?: string | undefined;
      },
      {
        uniqueIdentifier: string;
        partNumbers: number[];
        uploadId?: string | undefined;
        key?: string | undefined;
        contentType?: string | undefined;
        userApiKey?: string | undefined;
      }
    >,
    typeof MultipartPresignSchema
  >;
  completeMultipartUpload: PluginProcedure<
    z.ZodObject<
      {
        uniqueIdentifier: z.ZodString;
        uploadId: z.ZodString;
        key: z.ZodString;
        parts: z.ZodArray<
          z.ZodObject<
            {
              partNumber: z.ZodNumber;
              etag: z.ZodString;
            },
            "strip",
            z.ZodTypeAny,
            {
              partNumber: number;
              etag: string;
            },
            {
              partNumber: number;
              etag: string;
            }
          >,
          "many"
        >;
        filename: z.ZodString;
        uploadType: z.ZodDefault<z.ZodString>;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        uniqueIdentifier: string;
        uploadId: string;
        key: string;
        parts: {
          partNumber: number;
          etag: string;
        }[];
        filename: string;
        uploadType: string;
        userApiKey?: string | undefined;
      },
      {
        uniqueIdentifier: string;
        uploadId: string;
        key: string;
        parts: {
          partNumber: number;
          etag: string;
        }[];
        filename: string;
        uploadType: string;
        userApiKey?: string | undefined;
      }
    >,
    z.ZodObject<
      {
        upload: typeof UploadSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        upload: z.infer<typeof UploadSchema>;
      },
      {
        upload: z.infer<typeof UploadSchema>;
      }
    >
  >;
  abortMultipartUpload: PluginProcedure<
    z.ZodObject<
      {
        uniqueIdentifier: z.ZodString;
        uploadId: z.ZodString;
        key: z.ZodString;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        uniqueIdentifier: string;
        uploadId: string;
        key: string;
        userApiKey?: string | undefined;
      },
      {
        uniqueIdentifier: string;
        uploadId: string;
        key: string;
        userApiKey?: string | undefined;
      }
    >,
    z.ZodObject<
      {
        aborted: z.ZodBoolean;
      },
      "strip",
      z.ZodTypeAny,
      {
        aborted: boolean;
      },
      {
        aborted: boolean;
      }
    >
  >;
  lockPost: PluginProcedure<
    z.ZodObject<
      {
        postId: z.ZodNumber;
        locked: z.ZodBoolean;
        username: z.ZodString;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        postId: number;
        locked: boolean;
        username: string;
        userApiKey?: string | undefined;
      },
      {
        postId: number;
        locked: boolean;
        username: string;
        userApiKey?: string | undefined;
      }
    >,
    z.ZodObject<
      {
        locked: z.ZodBoolean;
      },
      "strip",
      z.ZodTypeAny,
      {
        locked: boolean;
      },
      {
        locked: boolean;
      }
    >
  >;
  performPostAction: PluginProcedure<
    z.ZodObject<
      {
        postId: z.ZodNumber;
        action: z.ZodDefault<
          z.ZodEnum<
            [
              "like",
              "unlike",
              "flag",
              "flag_off_topic",
              "flag_inappropriate",
              "flag_spam",
              "notify_user",
              "notify_moderators",
              "custom"
            ]
          >
        >;
        postActionTypeId: z.ZodOptional<z.ZodNumber>;
        message: z.ZodOptional<z.ZodString>;
        flagTopic: z.ZodOptional<z.ZodBoolean>;
        takeAction: z.ZodOptional<z.ZodBoolean>;
        undo: z.ZodOptional<z.ZodBoolean>;
        username: z.ZodString;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        postId: number;
        action:
          | "like"
          | "unlike"
          | "flag"
          | "flag_off_topic"
          | "flag_inappropriate"
          | "flag_spam"
          | "notify_user"
          | "notify_moderators"
          | "custom";
        username: string;
        postActionTypeId?: number | undefined;
        message?: string | undefined;
        flagTopic?: boolean | undefined;
        takeAction?: boolean | undefined;
        undo?: boolean | undefined;
        userApiKey?: string | undefined;
      },
      {
        postId: number;
        action:
          | "like"
          | "unlike"
          | "flag"
          | "flag_off_topic"
          | "flag_inappropriate"
          | "flag_spam"
          | "notify_user"
          | "notify_moderators"
          | "custom";
        username: string;
        postActionTypeId?: number | undefined;
        message?: string | undefined;
        flagTopic?: boolean | undefined;
        takeAction?: boolean | undefined;
        undo?: boolean | undefined;
        userApiKey?: string | undefined;
      }
    >,
    typeof PostActionResultSchema
  >;
  deletePost: PluginProcedure<
    z.ZodObject<
      {
        postId: z.ZodNumber;
        forceDestroy: z.ZodOptional<z.ZodBoolean>;
        username: z.ZodString;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        postId: number;
        username: string;
        forceDestroy?: boolean | undefined;
        userApiKey?: string | undefined;
      },
      {
        postId: number;
        username: string;
        forceDestroy?: boolean | undefined;
        userApiKey?: string | undefined;
      }
    >,
    typeof SuccessSchema
  >;
  search: PluginProcedure<
    z.ZodObject<
      {
        query: z.ZodString;
        category: z.ZodOptional<z.ZodString>;
        username: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        before: z.ZodOptional<z.ZodString>;
        after: z.ZodOptional<z.ZodString>;
        order: z.ZodOptional<
          z.ZodEnum<["latest", "likes", "views", "latest_topic"]>
        >;
        status: z.ZodOptional<
          z.ZodEnum<
            [
              "open",
              "closed",
              "public",
              "archived",
              "noreplies",
              "solved",
              "unsolved"
            ]
          >
        >;
        in: z.ZodOptional<
          z.ZodEnum<
            [
              "title",
              "likes",
              "personal",
              "messages",
              "seen",
              "unseen",
              "posted",
              "created",
              "watching",
              "tracking",
              "bookmarks",
              "first",
              "pinned",
              "wiki"
            ]
          >
        >;
        page: z.ZodDefault<z.ZodNumber>;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        query: string;
        category?: string | undefined;
        username?: string | undefined;
        tags?: string[] | undefined;
        before?: string | undefined;
        after?: string | undefined;
        order?: "latest" | "likes" | "views" | "latest_topic" | undefined;
        status?:
          | "open"
          | "closed"
          | "public"
          | "archived"
          | "noreplies"
          | "solved"
          | "unsolved"
          | undefined;
        in?:
          | "title"
          | "likes"
          | "personal"
          | "messages"
          | "seen"
          | "unseen"
          | "posted"
          | "created"
          | "watching"
          | "tracking"
          | "bookmarks"
          | "first"
          | "pinned"
          | "wiki"
          | undefined;
        page: number;
        userApiKey?: string | undefined;
      },
      {
        query: string;
        category?: string | undefined;
        username?: string | undefined;
        tags?: string[] | undefined;
        before?: string | undefined;
        after?: string | undefined;
        order?: "latest" | "likes" | "views" | "latest_topic" | undefined;
        status?:
          | "open"
          | "closed"
          | "public"
          | "archived"
          | "noreplies"
          | "solved"
          | "unsolved"
          | undefined;
        in?:
          | "title"
          | "likes"
          | "personal"
          | "messages"
          | "seen"
          | "unseen"
          | "posted"
          | "created"
          | "watching"
          | "tracking"
          | "bookmarks"
          | "first"
          | "pinned"
          | "wiki"
          | undefined;
        page: number;
        userApiKey?: string | undefined;
      }
    >,
    typeof SearchResultSchema
  >;
  ping: PluginProcedure<
    z.ZodUndefined,
    z.ZodObject<
      {
        status: z.ZodEnum<["ok", "degraded"]>;
        timestamp: z.ZodString;
        discourseConnected: z.ZodBoolean;
      },
      "strip",
      z.ZodTypeAny,
      {
        status: "ok" | "degraded";
        timestamp: string;
        discourseConnected: boolean;
      },
      {
        status: "ok" | "degraded";
        timestamp: string;
        discourseConnected: boolean;
      }
    >
  >;
  getCategories: PluginProcedure<
    z.ZodUndefined,
    z.ZodObject<
      {
        categories: z.ZodArray<typeof CategorySchema, "many">;
      },
      "strip",
      z.ZodTypeAny,
      {
        categories: z.infer<typeof CategorySchema>[];
      },
      {
        categories: z.infer<typeof CategorySchema>[];
      }
    >
  >;
  getTags: PluginProcedure<
    z.ZodUndefined,
    z.ZodObject<
      {
        tags: z.ZodArray<typeof TagSchema, "many">;
      },
      "strip",
      z.ZodTypeAny,
      {
        tags: z.infer<typeof TagSchema>[];
      },
      {
        tags: z.infer<typeof TagSchema>[];
      }
    >
  >;
  getTag: PluginProcedure<
    z.ZodObject<
      {
        name: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        name: string;
      },
      {
        name: string;
      }
    >,
    z.ZodObject<
      {
        tag: typeof TagSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        tag: z.infer<typeof TagSchema>;
      },
      {
        tag: z.infer<typeof TagSchema>;
      }
    >
  >;
  getTagGroups: PluginProcedure<
    z.ZodUndefined,
    z.ZodObject<
      {
        tagGroups: z.ZodArray<typeof TagGroupSchema, "many">;
      },
      "strip",
      z.ZodTypeAny,
      {
        tagGroups: z.infer<typeof TagGroupSchema>[];
      },
      {
        tagGroups: z.infer<typeof TagGroupSchema>[];
      }
    >
  >;
  getTagGroup: PluginProcedure<
    z.ZodObject<
      {
        tagGroupId: z.ZodNumber;
      },
      "strip",
      z.ZodTypeAny,
      {
        tagGroupId: number;
      },
      {
        tagGroupId: number;
      }
    >,
    z.ZodObject<
      {
        tagGroup: typeof TagGroupSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        tagGroup: z.infer<typeof TagGroupSchema>;
      },
      {
        tagGroup: z.infer<typeof TagGroupSchema>;
      }
    >
  >;
  createTagGroup: PluginProcedure<
    z.ZodObject<
      {
        name: z.ZodString;
        tagNames: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        parentTagNames: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        onePerTopic: z.ZodOptional<z.ZodBoolean>;
        permissions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
      },
      "strip",
      z.ZodTypeAny,
      {
        name: string;
        tagNames: string[];
        parentTagNames: string[];
        onePerTopic?: boolean | undefined;
        permissions?: Record<string, number> | undefined;
      },
      {
        name: string;
        tagNames: string[];
        parentTagNames: string[];
        onePerTopic?: boolean | undefined;
        permissions?: Record<string, number> | undefined;
      }
    >,
    z.ZodObject<
      {
        tagGroup: typeof TagGroupSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        tagGroup: z.infer<typeof TagGroupSchema>;
      },
      {
        tagGroup: z.infer<typeof TagGroupSchema>;
      }
    >
  >;
  updateTagGroup: PluginProcedure<
    z.ZodObject<
      {
        tagGroupId: z.ZodNumber;
        name: z.ZodOptional<z.ZodString>;
        tagNames: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        parentTagNames: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        onePerTopic: z.ZodOptional<z.ZodBoolean>;
        permissions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
      },
      "strip",
      z.ZodTypeAny,
      {
        tagGroupId: number;
        name?: string | undefined;
        tagNames?: string[] | undefined;
        parentTagNames?: string[] | undefined;
        onePerTopic?: boolean | undefined;
        permissions?: Record<string, number> | undefined;
      },
      {
        tagGroupId: number;
        name?: string | undefined;
        tagNames?: string[] | undefined;
        parentTagNames?: string[] | undefined;
        onePerTopic?: boolean | undefined;
        permissions?: Record<string, number> | undefined;
      }
    >,
    z.ZodObject<
      {
        tagGroup: typeof TagGroupSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        tagGroup: z.infer<typeof TagGroupSchema>;
      },
      {
        tagGroup: z.infer<typeof TagGroupSchema>;
      }
    >
  >;
  getCategory: PluginProcedure<
    z.ZodObject<
      {
        idOrSlug: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
      },
      "strip",
      z.ZodTypeAny,
      {
        idOrSlug: string | number;
      },
      {
        idOrSlug: string | number;
      }
    >,
    z.ZodObject<
      {
        category: typeof CategorySchema;
        subcategories: z.ZodArray<typeof CategorySchema, "many">;
      },
      "strip",
      z.ZodTypeAny,
      {
        category: z.infer<typeof CategorySchema>;
        subcategories: z.infer<typeof CategorySchema>[];
      },
      {
        category: z.infer<typeof CategorySchema>;
        subcategories: z.infer<typeof CategorySchema>[];
      }
    >
  >;
  getTopic: PluginProcedure<
    z.ZodObject<
      {
        topicId: z.ZodNumber;
      },
      "strip",
      z.ZodTypeAny,
      {
        topicId: number;
      },
      {
        topicId: number;
      }
    >,
    z.ZodObject<
      {
        topic: typeof TopicSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        topic: z.infer<typeof TopicSchema>;
      },
      {
        topic: z.infer<typeof TopicSchema>;
      }
    >
  >;
  getLatestTopics: PluginProcedure<
    z.ZodObject<
      {
        categoryId: z.ZodOptional<z.ZodNumber>;
        page: z.ZodDefault<z.ZodNumber>;
        order: z.ZodDefault<
          z.ZodEnum<
            ["default", "created", "activity", "views", "posts", "likes"]
          >
        >;
      },
      "strip",
      z.ZodTypeAny,
      {
        page: number;
        order: "default" | "created" | "activity" | "views" | "posts" | "likes";
        categoryId?: number | undefined;
      },
      {
        page: number;
        order: "default" | "created" | "activity" | "views" | "posts" | "likes";
        categoryId?: number | undefined;
      }
    >,
    typeof PaginatedTopicsSchema
  >;
  listTopicList: PluginProcedure<
    typeof ListTopicListInputSchema,
    typeof PaginatedTopicsSchema
  >;
  getCategoryTopics: PluginProcedure<
    z.ZodObject<
      {
        slug: z.ZodString;
        categoryId: z.ZodNumber;
        page: z.ZodDefault<z.ZodNumber>;
      },
      "strip",
      z.ZodTypeAny,
      {
        slug: string;
        categoryId: number;
        page: number;
      },
      {
        slug: string;
        categoryId: number;
        page: number;
      }
    >,
    typeof PaginatedTopicsSchema
  >;
  getTopTopics: PluginProcedure<
    z.ZodObject<
      {
        period: z.ZodDefault<
          z.ZodEnum<["all", "yearly", "quarterly", "monthly", "weekly", "daily"]>
        >;
        categoryId: z.ZodOptional<z.ZodNumber>;
        page: z.ZodDefault<z.ZodNumber>;
      },
      "strip",
      z.ZodTypeAny,
      {
        page: number;
        period: "all" | "yearly" | "quarterly" | "monthly" | "weekly" | "daily";
        categoryId?: number | undefined;
      },
      {
        page: number;
        period: "all" | "yearly" | "quarterly" | "monthly" | "weekly" | "daily";
        categoryId?: number | undefined;
      }
    >,
    typeof PaginatedTopicsSchema
  >;
  updateTopicStatus: PluginProcedure<
    z.ZodObject<
      {
        topicId: z.ZodNumber;
        status: typeof TopicStatusSchema;
        enabled: z.ZodBoolean;
        username: z.ZodOptional<z.ZodString>;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        topicId: number;
        status: "closed" | "archived" | "pinned" | "visible";
        enabled: boolean;
        username?: string | undefined;
        userApiKey?: string | undefined;
      },
      {
        topicId: number;
        status: "closed" | "archived" | "pinned" | "visible";
        enabled: boolean;
        username?: string | undefined;
        userApiKey?: string | undefined;
      }
    >,
    typeof TopicActionResultSchema
  >;
  updateTopicMetadata: PluginProcedure<
    z.ZodEffects<
      z.ZodObject<
        {
          topicId: z.ZodNumber;
          title: z.ZodOptional<z.ZodString>;
          categoryId: z.ZodOptional<z.ZodNumber>;
          username: z.ZodOptional<z.ZodString>;
          userApiKey: z.ZodOptional<z.ZodString>;
        },
        "strip",
        z.ZodTypeAny,
        {
          topicId: number;
          username?: string | undefined;
          title?: string | undefined;
          categoryId?: number | undefined;
          userApiKey?: string | undefined;
        },
        {
          topicId: number;
          username?: string | undefined;
          title?: string | undefined;
          categoryId?: number | undefined;
          userApiKey?: string | undefined;
        }
      >,
      {
        topicId: number;
        username?: string | undefined;
        title?: string | undefined;
        categoryId?: number | undefined;
        userApiKey?: string | undefined;
      },
      {
        topicId: number;
        username?: string | undefined;
        title?: string | undefined;
        categoryId?: number | undefined;
        userApiKey?: string | undefined;
      }
    >,
    typeof TopicActionResultSchema
  >;
  bookmarkTopic: PluginProcedure<
    z.ZodObject<
      {
        topicId: z.ZodNumber;
        postNumber: z.ZodDefault<z.ZodNumber>;
        username: z.ZodString;
        userApiKey: z.ZodOptional<z.ZodString>;
        reminderAt: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        topicId: number;
        username: string;
        postNumber: number;
        userApiKey?: string | undefined;
        reminderAt?: string | undefined;
      },
      {
        topicId: number;
        username: string;
        postNumber: number;
        userApiKey?: string | undefined;
        reminderAt?: string | undefined;
      }
    >,
    typeof BookmarkResultSchema
  >;
  inviteToTopic: PluginProcedure<
    z.ZodEffects<
      z.ZodObject<
        {
          topicId: z.ZodNumber;
          usernames: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
          groupNames: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
          username: z.ZodOptional<z.ZodString>;
          userApiKey: z.ZodOptional<z.ZodString>;
        },
        "strip",
        z.ZodTypeAny,
        {
          topicId: number;
          usernames: string[];
          groupNames: string[];
          username?: string | undefined;
          userApiKey?: string | undefined;
        },
        {
          topicId: number;
          usernames: string[];
          groupNames: string[];
          username?: string | undefined;
          userApiKey?: string | undefined;
        }
      >,
      {
        topicId: number;
        usernames: string[];
        groupNames: string[];
        username?: string | undefined;
        userApiKey?: string | undefined;
      },
      {
        topicId: number;
        usernames: string[];
        groupNames: string[];
        username?: string | undefined;
        userApiKey?: string | undefined;
      }
    >,
    typeof SuccessSchema
  >;
  setTopicNotification: PluginProcedure<
    z.ZodObject<
      {
        topicId: z.ZodNumber;
        level: typeof TopicNotificationLevelSchema;
        username: z.ZodString;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        topicId: number;
        level:
          | "muted"
          | "regular"
          | "tracking"
          | "watching"
          | "watching_first_post"
          | number;
        username: string;
        userApiKey?: string | undefined;
      },
      {
        topicId: number;
        level:
          | "muted"
          | "regular"
          | "tracking"
          | "watching"
          | "watching_first_post"
          | number;
        username: string;
        userApiKey?: string | undefined;
      }
    >,
    typeof TopicNotificationResultSchema
  >;
  changeTopicTimestamp: PluginProcedure<
    z.ZodObject<
      {
        topicId: z.ZodNumber;
        timestamp: z.ZodString;
        username: z.ZodOptional<z.ZodString>;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        topicId: number;
        timestamp: string;
        username?: string | undefined;
        userApiKey?: string | undefined;
      },
      {
        topicId: number;
        timestamp: string;
        username?: string | undefined;
        userApiKey?: string | undefined;
      }
    >,
    typeof TopicActionResultSchema
  >;
  addTopicTimer: PluginProcedure<
    z.ZodObject<
      {
        topicId: z.ZodNumber;
        statusType: typeof TopicTimerStatusSchema;
        time: z.ZodString;
        basedOnLastPost: z.ZodOptional<z.ZodBoolean>;
        durationMinutes: z.ZodOptional<z.ZodNumber>;
        categoryId: z.ZodOptional<z.ZodNumber>;
        username: z.ZodOptional<z.ZodString>;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        topicId: number;
        statusType:
          | "open"
          | "close"
          | "delete"
          | "publish"
          | "auto_close"
          | "auto_delete"
          | "reminder";
        time: string;
        basedOnLastPost?: boolean | undefined;
        durationMinutes?: number | undefined;
        categoryId?: number | undefined;
        username?: string | undefined;
        userApiKey?: string | undefined;
      },
      {
        topicId: number;
        statusType:
          | "open"
          | "close"
          | "delete"
          | "publish"
          | "auto_close"
          | "auto_delete"
          | "reminder";
        time: string;
        basedOnLastPost?: boolean | undefined;
        durationMinutes?: number | undefined;
        categoryId?: number | undefined;
        username?: string | undefined;
        userApiKey?: string | undefined;
      }
    >,
    typeof TopicTimerResultSchema
  >;
  getPost: PluginProcedure<
    z.ZodObject<
      {
        postId: z.ZodNumber;
        includeRaw: z.ZodDefault<z.ZodBoolean>;
      },
      "strip",
      z.ZodTypeAny,
      {
        postId: number;
        includeRaw: boolean;
      },
      {
        postId: number;
        includeRaw: boolean;
      }
    >,
    z.ZodObject<
      {
        post: typeof PostSchema;
        topic: typeof TopicSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        post: z.infer<typeof PostSchema>;
        topic: z.infer<typeof TopicSchema>;
      },
      {
        post: z.infer<typeof PostSchema>;
        topic: z.infer<typeof TopicSchema>;
      }
    >
  >;
  getPostReplies: PluginProcedure<
    z.ZodObject<
      {
        postId: z.ZodNumber;
      },
      "strip",
      z.ZodTypeAny,
      {
        postId: number;
      },
      {
        postId: number;
      }
    >,
    z.ZodObject<
      {
        replies: z.ZodArray<typeof PostSchema, "many">;
      },
      "strip",
      z.ZodTypeAny,
      {
        replies: z.infer<typeof PostSchema>[];
      },
      {
        replies: z.infer<typeof PostSchema>[];
      }
    >
  >;
  listPosts: PluginProcedure<
    z.ZodObject<
      {
        page: z.ZodDefault<z.ZodNumber>;
      },
      "strip",
      z.ZodTypeAny,
      {
        page: number;
      },
      {
        page: number;
      }
    >,
    typeof PaginatedPostsSchema
  >;
  getRevision: PluginProcedure<
    z.ZodObject<
      {
        postId: z.ZodNumber;
        revision: z.ZodNumber;
        includeRaw: z.ZodDefault<z.ZodBoolean>;
        username: z.ZodOptional<z.ZodString>;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        postId: number;
        revision: number;
        includeRaw: boolean;
        username?: string | undefined;
        userApiKey?: string | undefined;
      },
      {
        postId: number;
        revision: number;
        includeRaw: boolean;
        username?: string | undefined;
        userApiKey?: string | undefined;
      }
    >,
    z.ZodObject<
      {
        revision: typeof RevisionSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        revision: z.infer<typeof RevisionSchema>;
      },
      {
        revision: z.infer<typeof RevisionSchema>;
      }
    >
  >;
  updateRevision: PluginProcedure<
    z.ZodObject<
      {
        postId: z.ZodNumber;
        revision: z.ZodNumber;
        raw: z.ZodString;
        editReason: z.ZodOptional<z.ZodString>;
        username: z.ZodString;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        postId: number;
        revision: number;
        raw: string;
        username: string;
        editReason?: string | undefined;
        userApiKey?: string | undefined;
      },
      {
        postId: number;
        revision: number;
        raw: string;
        username: string;
        editReason?: string | undefined;
        userApiKey?: string | undefined;
      }
    >,
    z.ZodObject<
      {
        revision: typeof RevisionSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        revision: z.infer<typeof RevisionSchema>;
      },
      {
        revision: z.infer<typeof RevisionSchema>;
      }
    >
  >;
  deleteRevision: PluginProcedure<
    z.ZodObject<
      {
        postId: z.ZodNumber;
        revision: z.ZodNumber;
        username: z.ZodString;
        userApiKey: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        postId: number;
        revision: number;
        username: string;
        userApiKey?: string | undefined;
      },
      {
        postId: number;
        revision: number;
        username: string;
        userApiKey?: string | undefined;
      }
    >,
    typeof SuccessSchema
  >;
  getUser: PluginProcedure<
    z.ZodObject<
      {
        username: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        username: string;
      },
      {
        username: string;
      }
    >,
    z.ZodObject<
      {
        user: typeof UserProfileSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        user: z.infer<typeof UserProfileSchema>;
      },
      {
        user: z.infer<typeof UserProfileSchema>;
      }
    >
  >;
  createUser: PluginProcedure<
    z.ZodObject<
      {
        username: z.ZodString;
        email: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
        active: z.ZodOptional<z.ZodBoolean>;
        approved: z.ZodOptional<z.ZodBoolean>;
        externalId: z.ZodOptional<z.ZodString>;
        externalProvider: z.ZodOptional<z.ZodString>;
        staged: z.ZodOptional<z.ZodBoolean>;
        emailVerified: z.ZodOptional<z.ZodBoolean>;
        locale: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        username: string;
        email: string;
        name?: string | undefined;
        password?: string | undefined;
        active?: boolean | undefined;
        approved?: boolean | undefined;
        externalId?: string | undefined;
        externalProvider?: string | undefined;
        staged?: boolean | undefined;
        emailVerified?: boolean | undefined;
        locale?: string | undefined;
      },
      {
        username: string;
        email: string;
        name?: string | undefined;
        password?: string | undefined;
        active?: boolean | undefined;
        approved?: boolean | undefined;
        externalId?: string | undefined;
        externalProvider?: string | undefined;
        staged?: boolean | undefined;
        emailVerified?: boolean | undefined;
        locale?: string | undefined;
      }
    >,
    z.ZodObject<
      {
        success: z.ZodBoolean;
        userId: z.ZodOptional<z.ZodNumber>;
        active: z.ZodOptional<z.ZodBoolean>;
      },
      "strip",
      z.ZodTypeAny,
      {
        success: boolean;
        userId?: number | undefined;
        active?: boolean | undefined;
      },
      {
        success: boolean;
        userId?: number | undefined;
        active?: boolean | undefined;
      }
    >
  >;
  updateUser: PluginProcedure<
    z.ZodObject<
      {
        username: z.ZodString;
        email: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        trustLevel: z.ZodOptional<z.ZodNumber>;
        active: z.ZodOptional<z.ZodBoolean>;
        suspendedUntil: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        suspendReason: z.ZodOptional<z.ZodString>;
        staged: z.ZodOptional<z.ZodBoolean>;
        bioRaw: z.ZodOptional<z.ZodString>;
        locale: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        username: string;
        email?: string | undefined;
        name?: string | undefined;
        title?: string | undefined;
        trustLevel?: number | undefined;
        active?: boolean | undefined;
        suspendedUntil?: string | null | undefined;
        suspendReason?: string | undefined;
        staged?: boolean | undefined;
        bioRaw?: string | undefined;
        locale?: string | undefined;
      },
      {
        username: string;
        email?: string | undefined;
        name?: string | undefined;
        title?: string | undefined;
        trustLevel?: number | undefined;
        active?: boolean | undefined;
        suspendedUntil?: string | null | undefined;
        suspendReason?: string | undefined;
        staged?: boolean | undefined;
        bioRaw?: string | undefined;
        locale?: string | undefined;
      }
    >,
    typeof SuccessSchema
  >;
  deleteUser: PluginProcedure<
    z.ZodObject<
      {
        userId: z.ZodNumber;
        blockEmail: z.ZodDefault<z.ZodBoolean>;
        blockUrls: z.ZodDefault<z.ZodBoolean>;
        blockIp: z.ZodDefault<z.ZodBoolean>;
        deletePosts: z.ZodDefault<z.ZodBoolean>;
        context: z.ZodOptional<z.ZodString>;
      },
      "strip",
      z.ZodTypeAny,
      {
        userId: number;
        blockEmail: boolean;
        blockUrls: boolean;
        blockIp: boolean;
        deletePosts: boolean;
        context?: string | undefined;
      },
      {
        userId: number;
        blockEmail: boolean;
        blockUrls: boolean;
        blockIp: boolean;
        deletePosts: boolean;
        context?: string | undefined;
      }
    >,
    typeof SuccessSchema
  >;
  listUsers: PluginProcedure<
    z.ZodObject<
      {
        page: z.ZodDefault<z.ZodNumber>;
      },
      "strip",
      z.ZodTypeAny,
      {
        page: number;
      },
      {
        page: number;
      }
    >,
    z.ZodObject<
      {
        users: z.ZodArray<typeof DiscourseUserSchema, "many">;
      },
      "strip",
      z.ZodTypeAny,
      {
        users: z.infer<typeof DiscourseUserSchema>[];
      },
      {
        users: z.infer<typeof DiscourseUserSchema>[];
      }
    >
  >;
  listAdminUsers: PluginProcedure<
    z.ZodObject<
      {
        filter: z.ZodDefault<
          z.ZodEnum<
            ["active", "new", "staff", "suspended", "blocked", "trust_level_0"]
          >
        >;
        page: z.ZodDefault<z.ZodNumber>;
        showEmails: z.ZodDefault<z.ZodBoolean>;
      },
      "strip",
      z.ZodTypeAny,
      {
        filter:
          | "active"
          | "new"
          | "staff"
          | "suspended"
          | "blocked"
          | "trust_level_0";
        page: number;
        showEmails: boolean;
      },
      {
        filter:
          | "active"
          | "new"
          | "staff"
          | "suspended"
          | "blocked"
          | "trust_level_0";
        page: number;
        showEmails: boolean;
      }
    >,
    z.ZodObject<
      {
        users: z.ZodArray<typeof AdminUserSchema, "many">;
      },
      "strip",
      z.ZodTypeAny,
      {
        users: z.infer<typeof AdminUserSchema>[];
      },
      {
        users: z.infer<typeof AdminUserSchema>[];
      }
    >
  >;
  getUserByExternal: PluginProcedure<
    z.ZodObject<
      {
        externalId: z.ZodString;
        provider: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        externalId: string;
        provider: string;
      },
      {
        externalId: string;
        provider: string;
      }
    >,
    z.ZodObject<
      {
        user: typeof UserProfileSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        user: z.infer<typeof UserProfileSchema>;
      },
      {
        user: z.infer<typeof UserProfileSchema>;
      }
    >
  >;
  getDirectory: PluginProcedure<
    z.ZodObject<
      {
        period: z.ZodDefault<
          z.ZodEnum<
            ["daily", "weekly", "monthly", "quarterly", "yearly", "all"]
          >
        >;
        order: z.ZodDefault<
          z.ZodEnum<
            [
              "likes_received",
              "likes_given",
              "topics_entered",
              "posts_read",
              "days_visited",
              "topic_count",
              "post_count"
            ]
          >
        >;
        page: z.ZodDefault<z.ZodNumber>;
      },
      "strip",
      z.ZodTypeAny,
      {
        period: "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "all";
        order:
          | "likes_received"
          | "likes_given"
          | "topics_entered"
          | "posts_read"
          | "days_visited"
          | "topic_count"
          | "post_count";
        page: number;
      },
      {
        period: "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "all";
        order:
          | "likes_received"
          | "likes_given"
          | "topics_entered"
          | "posts_read"
          | "days_visited"
          | "topic_count"
          | "post_count";
        page: number;
      }
    >,
    z.ZodObject<
      {
        items: z.ZodArray<typeof DirectoryItemSchema, "many">;
        totalRows: z.ZodNumber;
      },
      "strip",
      z.ZodTypeAny,
      {
        items: z.infer<typeof DirectoryItemSchema>[];
        totalRows: number;
      },
      {
        items: z.infer<typeof DirectoryItemSchema>[];
        totalRows: number;
      }
    >
  >;
  forgotPassword: PluginProcedure<
    z.ZodObject<
      {
        login: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        login: string;
      },
      {
        login: string;
      }
    >,
    typeof SuccessSchema
  >;
  changePassword: PluginProcedure<
    z.ZodObject<
      {
        token: z.ZodString;
        password: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        token: string;
        password: string;
      },
      {
        token: string;
        password: string;
      }
    >,
    typeof SuccessSchema
  >;
  logoutUser: PluginProcedure<
    z.ZodObject<
      {
        userId: z.ZodNumber;
      },
      "strip",
      z.ZodTypeAny,
      {
        userId: number;
      },
      {
        userId: number;
      }
    >,
    typeof SuccessSchema
  >;
  syncSso: PluginProcedure<
    z.ZodObject<
      {
        sso: z.ZodString;
        sig: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        sso: string;
        sig: string;
      },
      {
        sso: string;
        sig: string;
      }
    >,
    z.ZodObject<
      {
        success: z.ZodBoolean;
        userId: z.ZodOptional<z.ZodNumber>;
      },
      "strip",
      z.ZodTypeAny,
      {
        success: boolean;
        userId?: number | undefined;
      },
      {
        success: boolean;
        userId?: number | undefined;
      }
    >
  >;
  getUserStatus: PluginProcedure<
    z.ZodObject<
      {
        username: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        username: string;
      },
      {
        username: string;
      }
    >,
    z.ZodObject<
      {
        status: z.ZodNullable<typeof UserStatusSchema>;
      },
      "strip",
      z.ZodTypeAny,
      {
        status: z.infer<typeof UserStatusSchema> | null;
      },
      {
        status: z.infer<typeof UserStatusSchema> | null;
      }
    >
  >;
  updateUserStatus: PluginProcedure<
    z.ZodObject<
      {
        username: z.ZodString;
        emoji: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endsAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
      },
      "strip",
      z.ZodTypeAny,
      {
        username: string;
        emoji?: string | null | undefined;
        description?: string | null | undefined;
        endsAt?: string | null | undefined;
      },
      {
        username: string;
        emoji?: string | null | undefined;
        description?: string | null | undefined;
        endsAt?: string | null | undefined;
      }
    >,
    z.ZodObject<
      {
        status: typeof UserStatusSchema;
      },
      "strip",
      z.ZodTypeAny,
      {
        status: z.infer<typeof UserStatusSchema>;
      },
      {
        status: z.infer<typeof UserStatusSchema>;
      }
    >
  >;
  getSiteInfo: PluginProcedure<z.ZodUndefined, typeof SiteInfoSchema>;
  getSiteBasicInfo: PluginProcedure<z.ZodUndefined, typeof SiteBasicInfoSchema>;
  validateUserApiKey: PluginProcedure<
    z.ZodObject<
      {
        userApiKey: z.ZodString;
      },
      "strip",
      z.ZodTypeAny,
      {
        userApiKey: string;
      },
      {
        userApiKey: string;
      }
    >,
    typeof ValidateUserApiKeyResultSchema
  >;
};

export default contract;
