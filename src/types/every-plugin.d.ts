import type DiscoursePlugin from "../../discourse-plugin";

declare module "every-plugin" {
  interface RegisteredPlugins {
    "discourse-plugin": typeof DiscoursePlugin;
  }
}
