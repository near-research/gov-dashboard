import { z } from "every-plugin/zod";
import {
  DiscourseService,
  CryptoService,
  NEARService,
  NonceManager,
  LinkageStore,
} from "./service";
/**
 * Discourse Plugin
 *
 * Enables NEAR account holders to connect and interact with forums
 *
 * Shows how to:
 * - Link NEAR accounts to Discourse usernames
 * - Verify on-chain message signatures (NEP-413)
 * - Create posts on behalf of users via API calls
 * - Manage RSA encryption for secure key exchange
 */
declare const _default: import("every-plugin").LoadedPluginWithBinding<
  {
    getUserApiAuthUrl: import("@orpc/contract").ContractProcedure<
      z.ZodObject<
        {
          clientId: z.ZodString;
          applicationName: z.ZodString;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          authUrl: z.ZodString;
          nonce: z.ZodString;
        },
        z.core.$strip
      >,
      import("@orpc/contract").MergedErrorMap<
        Record<never, never>,
        import("@orpc/contract").MergedErrorMap<
          Record<never, never>,
          {
            UNAUTHORIZED: {
              data: z.ZodObject<
                {
                  apiKeyProvided: z.ZodBoolean;
                  provider: z.ZodOptional<z.ZodString>;
                  authType: z.ZodOptional<
                    z.ZodEnum<{
                      apiKey: "apiKey";
                      oauth: "oauth";
                      token: "token";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            RATE_LIMITED: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodNumber;
                  remainingRequests: z.ZodOptional<z.ZodNumber>;
                  resetTime: z.ZodOptional<z.ZodString>;
                  limitType: z.ZodOptional<
                    z.ZodEnum<{
                      requests: "requests";
                      tokens: "tokens";
                      bandwidth: "bandwidth";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            SERVICE_UNAVAILABLE: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodOptional<z.ZodNumber>;
                  maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
                  estimatedUptime: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            BAD_REQUEST: {
              data: z.ZodObject<
                {
                  invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  validationErrors: z.ZodOptional<
                    z.ZodArray<
                      z.ZodObject<
                        {
                          field: z.ZodString;
                          message: z.ZodString;
                          code: z.ZodOptional<z.ZodString>;
                        },
                        z.core.$strip
                      >
                    >
                  >;
                },
                z.core.$strip
              >;
            };
            NOT_FOUND: {
              data: z.ZodObject<
                {
                  resource: z.ZodOptional<z.ZodString>;
                  resourceId: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            FORBIDDEN: {
              data: z.ZodObject<
                {
                  requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  action: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
          }
        >
      >,
      Record<never, never>
    >;
    completeLink: import("@orpc/contract").ContractProcedure<
      z.ZodObject<
        {
          payload: z.ZodString;
          nonce: z.ZodString;
          authToken: z.ZodString;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          success: z.ZodBoolean;
          nearAccount: z.ZodString;
          discourseUsername: z.ZodString;
          message: z.ZodString;
        },
        z.core.$strip
      >,
      import("@orpc/contract").MergedErrorMap<
        Record<never, never>,
        import("@orpc/contract").MergedErrorMap<
          Record<never, never>,
          {
            UNAUTHORIZED: {
              data: z.ZodObject<
                {
                  apiKeyProvided: z.ZodBoolean;
                  provider: z.ZodOptional<z.ZodString>;
                  authType: z.ZodOptional<
                    z.ZodEnum<{
                      apiKey: "apiKey";
                      oauth: "oauth";
                      token: "token";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            RATE_LIMITED: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodNumber;
                  remainingRequests: z.ZodOptional<z.ZodNumber>;
                  resetTime: z.ZodOptional<z.ZodString>;
                  limitType: z.ZodOptional<
                    z.ZodEnum<{
                      requests: "requests";
                      tokens: "tokens";
                      bandwidth: "bandwidth";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            SERVICE_UNAVAILABLE: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodOptional<z.ZodNumber>;
                  maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
                  estimatedUptime: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            BAD_REQUEST: {
              data: z.ZodObject<
                {
                  invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  validationErrors: z.ZodOptional<
                    z.ZodArray<
                      z.ZodObject<
                        {
                          field: z.ZodString;
                          message: z.ZodString;
                          code: z.ZodOptional<z.ZodString>;
                        },
                        z.core.$strip
                      >
                    >
                  >;
                },
                z.core.$strip
              >;
            };
            NOT_FOUND: {
              data: z.ZodObject<
                {
                  resource: z.ZodOptional<z.ZodString>;
                  resourceId: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            FORBIDDEN: {
              data: z.ZodObject<
                {
                  requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  action: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
          }
        >
      >,
      Record<never, never>
    >;
    createPost: import("@orpc/contract").ContractProcedure<
      z.ZodObject<
        {
          authToken: z.ZodString;
          title: z.ZodString;
          raw: z.ZodString;
          category: z.ZodOptional<z.ZodNumber>;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          success: z.ZodBoolean;
          postUrl: z.ZodOptional<z.ZodString>;
          postId: z.ZodOptional<z.ZodNumber>;
          topicId: z.ZodOptional<z.ZodNumber>;
        },
        z.core.$strip
      >,
      import("@orpc/contract").MergedErrorMap<
        Record<never, never>,
        import("@orpc/contract").MergedErrorMap<
          Record<never, never>,
          {
            UNAUTHORIZED: {
              data: z.ZodObject<
                {
                  apiKeyProvided: z.ZodBoolean;
                  provider: z.ZodOptional<z.ZodString>;
                  authType: z.ZodOptional<
                    z.ZodEnum<{
                      apiKey: "apiKey";
                      oauth: "oauth";
                      token: "token";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            RATE_LIMITED: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodNumber;
                  remainingRequests: z.ZodOptional<z.ZodNumber>;
                  resetTime: z.ZodOptional<z.ZodString>;
                  limitType: z.ZodOptional<
                    z.ZodEnum<{
                      requests: "requests";
                      tokens: "tokens";
                      bandwidth: "bandwidth";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            SERVICE_UNAVAILABLE: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodOptional<z.ZodNumber>;
                  maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
                  estimatedUptime: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            BAD_REQUEST: {
              data: z.ZodObject<
                {
                  invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  validationErrors: z.ZodOptional<
                    z.ZodArray<
                      z.ZodObject<
                        {
                          field: z.ZodString;
                          message: z.ZodString;
                          code: z.ZodOptional<z.ZodString>;
                        },
                        z.core.$strip
                      >
                    >
                  >;
                },
                z.core.$strip
              >;
            };
            NOT_FOUND: {
              data: z.ZodObject<
                {
                  resource: z.ZodOptional<z.ZodString>;
                  resourceId: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            FORBIDDEN: {
              data: z.ZodObject<
                {
                  requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  action: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
          }
        >
      >,
      Record<never, never>
    >;
    getLinkage: import("@orpc/contract").ContractProcedure<
      z.ZodObject<
        {
          nearAccount: z.ZodString;
        },
        z.core.$strip
      >,
      z.ZodNullable<
        z.ZodObject<
          {
            nearAccount: z.ZodString;
            discourseUsername: z.ZodString;
            verifiedAt: z.ZodString;
          },
          z.core.$strip
        >
      >,
      import("@orpc/contract").MergedErrorMap<
        Record<never, never>,
        import("@orpc/contract").MergedErrorMap<
          Record<never, never>,
          {
            UNAUTHORIZED: {
              data: z.ZodObject<
                {
                  apiKeyProvided: z.ZodBoolean;
                  provider: z.ZodOptional<z.ZodString>;
                  authType: z.ZodOptional<
                    z.ZodEnum<{
                      apiKey: "apiKey";
                      oauth: "oauth";
                      token: "token";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            RATE_LIMITED: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodNumber;
                  remainingRequests: z.ZodOptional<z.ZodNumber>;
                  resetTime: z.ZodOptional<z.ZodString>;
                  limitType: z.ZodOptional<
                    z.ZodEnum<{
                      requests: "requests";
                      tokens: "tokens";
                      bandwidth: "bandwidth";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            SERVICE_UNAVAILABLE: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodOptional<z.ZodNumber>;
                  maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
                  estimatedUptime: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            BAD_REQUEST: {
              data: z.ZodObject<
                {
                  invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  validationErrors: z.ZodOptional<
                    z.ZodArray<
                      z.ZodObject<
                        {
                          field: z.ZodString;
                          message: z.ZodString;
                          code: z.ZodOptional<z.ZodString>;
                        },
                        z.core.$strip
                      >
                    >
                  >;
                },
                z.core.$strip
              >;
            };
            NOT_FOUND: {
              data: z.ZodObject<
                {
                  resource: z.ZodOptional<z.ZodString>;
                  resourceId: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            FORBIDDEN: {
              data: z.ZodObject<
                {
                  requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  action: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
          }
        >
      >,
      Record<never, never>
    >;
    ping: import("@orpc/contract").ContractProcedure<
      import("@orpc/contract").Schema<unknown, unknown>,
      z.ZodObject<
        {
          status: z.ZodLiteral<"ok">;
          timestamp: z.ZodString;
          discourseConnected: z.ZodBoolean;
        },
        z.core.$strip
      >,
      import("@orpc/contract").MergedErrorMap<
        Record<never, never>,
        import("@orpc/contract").MergedErrorMap<
          Record<never, never>,
          {
            UNAUTHORIZED: {
              data: z.ZodObject<
                {
                  apiKeyProvided: z.ZodBoolean;
                  provider: z.ZodOptional<z.ZodString>;
                  authType: z.ZodOptional<
                    z.ZodEnum<{
                      apiKey: "apiKey";
                      oauth: "oauth";
                      token: "token";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            RATE_LIMITED: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodNumber;
                  remainingRequests: z.ZodOptional<z.ZodNumber>;
                  resetTime: z.ZodOptional<z.ZodString>;
                  limitType: z.ZodOptional<
                    z.ZodEnum<{
                      requests: "requests";
                      tokens: "tokens";
                      bandwidth: "bandwidth";
                    }>
                  >;
                },
                z.core.$strip
              >;
            };
            SERVICE_UNAVAILABLE: {
              data: z.ZodObject<
                {
                  retryAfter: z.ZodOptional<z.ZodNumber>;
                  maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
                  estimatedUptime: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            BAD_REQUEST: {
              data: z.ZodObject<
                {
                  invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  validationErrors: z.ZodOptional<
                    z.ZodArray<
                      z.ZodObject<
                        {
                          field: z.ZodString;
                          message: z.ZodString;
                          code: z.ZodOptional<z.ZodString>;
                        },
                        z.core.$strip
                      >
                    >
                  >;
                },
                z.core.$strip
              >;
            };
            NOT_FOUND: {
              data: z.ZodObject<
                {
                  resource: z.ZodOptional<z.ZodString>;
                  resourceId: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
            FORBIDDEN: {
              data: z.ZodObject<
                {
                  requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  action: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >;
            };
          }
        >
      >,
      Record<never, never>
    >;
  },
  z.ZodObject<
    {
      discourseBaseUrl: z.ZodString;
      discourseApiUsername: z.ZodDefault<z.ZodString>;
      clientId: z.ZodDefault<z.ZodString>;
      recipient: z.ZodDefault<z.ZodString>;
    },
    z.core.$strip
  >,
  z.ZodObject<
    {
      discourseApiKey: z.ZodString;
    },
    z.core.$strip
  >,
  {
    discourseService: DiscourseService;
    cryptoService: CryptoService;
    nearService: NEARService;
    nonceManager: NonceManager;
    linkageStore: LinkageStore;
    config: {
      variables: {
        discourseBaseUrl: string;
        discourseApiUsername: string;
        clientId: string;
        recipient: string;
      };
      secrets: {
        discourseApiKey: string;
      };
    };
  }
>;
export default _default;
