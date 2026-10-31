/** Short display names never replace the model ID sent to the service. */
export function modelDisplayName(modelId: string): string {
  return (
    (
      {
        "gpt-image-2.5-sunburst": "Sunburst",
        "gpt-image-2.5-flare": "Flare",
        "gpt-6.1-terra": "Terra",
      } as Record<string, string>
    )[modelId] ?? modelId
  );
}
