/** Resolved server-side configuration. Never include this in client DTOs. */
export type ImageExecutionConfig =
  | { readonly mode: "fake" }
  | {
      readonly mode: "openai";
      readonly baseUrl: string;
      readonly apiKey: string;
    };
