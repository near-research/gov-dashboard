import type { LoadedPluginWithBinding } from "every-plugin";
import type { z } from "every-plugin/zod";
import type contract from "../../discourse-plugin";

// Local typing shim for the remote discourse plugin. The runtime fetches the
// plugin over Module Federation, so we mirror the config schema here to keep
// `usePlugin` strongly typed without pulling the implementation into the repo.
type DiscourseVariables = z.ZodObject<
  {
    discourseBaseUrl: z.ZodString;
    discourseApiUsername: z.ZodString;
    clientId: z.ZodString;
  },
  "strip"
>;

type DiscourseSecrets = z.ZodObject<
  {
    discourseApiKey: z.ZodString;
  },
  "strip"
>;

type DiscoursePlugin = LoadedPluginWithBinding<
  contract,
  DiscourseVariables,
  DiscourseSecrets,
  any
>;

declare module "every-plugin" {
  interface RegisteredPlugins {
    "discourse-plugin": DiscoursePlugin;
  }
}
