import { z } from "zod";
export const annotationPoint = z.tuple([
  z.number().int().min(0).max(10000),
  z.number().int().min(0).max(10000),
]);
export const annotationStroke = z
  .object({
    kind: z.enum(["ellipse", "pen"]),
    points: z.array(annotationPoint).min(2).max(256),
  })
  .strict()
  .superRefine((s, c) => {
    if (s.kind === "ellipse" && s.points.length !== 2)
      c.addIssue({ code: "custom", message: "Ellipse needs two corners" });
  });
export const imageAnnotation = z
  .object({ version: z.literal(1), strokes: z.array(annotationStroke).max(80) })
  .strict()
  .superRefine((a, c) => {
    if (a.strokes.reduce((n, s) => n + s.points.length, 0) > 2000)
      c.addIssue({
        code: "custom",
        message: "Annotation point budget exceeded",
      });
  });
export type ImageAnnotation = z.infer<typeof imageAnnotation>;
export type AnnotationStroke = z.infer<typeof annotationStroke>;
