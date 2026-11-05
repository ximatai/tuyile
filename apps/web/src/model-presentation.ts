/** Short display names never replace the model ID sent to the service. */
export function modelDisplayName(modelId: string): string {
  return (
    (
      {
        "gpt-image-2.5-sunburst": "Sunburst 2.5",
        "gpt-image-2.6-sunburst": "Sunburst 2.6",
        "gpt-image-2.6-flare": "Flare 2.6",
        "gpt-image-2.5-flare": "Flare 2.5",
        "gpt-6.1-terra": "Terra",
      } as Record<string, string>
    )[modelId] ?? modelId
  );
}
