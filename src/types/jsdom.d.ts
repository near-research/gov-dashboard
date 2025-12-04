declare module "jsdom" {
  export interface JSDOMOptions {
    url?: string;
    referrer?: string;
    contentType?: string;
    includeNodeLocations?: boolean;
    storageQuota?: number;
    [key: string]: any;
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    window: any;
  }
}
