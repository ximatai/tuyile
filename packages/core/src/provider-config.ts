/** Resolved server-side configuration. Never include this in client DTOs. */
type SvgConfig = {
  readonly svgAuthor?: import("@tuyile/contracts").ImageCapability["svgAuthor"];
};
export type ImageExecutionConfig = SvgConfig &
  (
    | { readonly mode: "fake" }
    | {
        readonly mode: "openai";
        readonly baseUrl: string;
        readonly apiKey: string;
      }
  );
