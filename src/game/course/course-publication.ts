import { z } from "zod";

import { courseDocumentSchema } from "./course-document";

export const coursePublicationSummarySchema = z.strictObject({
  publicationId: z.number().int().positive(),
  publishedAt: z.string().datetime(),
  publishedByUserId: z.string().min(1),
  revision: z.number().int().positive(),
});

export const persistedCoursePublicationSchema = z.strictObject({
  authorUserId: z.string().min(1),
  courseId: z.string().min(1),
  createdAt: z.string().datetime(),
  document: courseDocumentSchema,
  publicationId: z.number().int().positive(),
  publishedAt: z.string().datetime(),
  publishedByUserId: z.string().min(1),
  revision: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
});

export const publishedCourseRuntimeSchema = z.strictObject({
  courseId: z.string().min(1),
  document: courseDocumentSchema,
  publishedAt: z.string().datetime(),
  revision: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
});

export type CoursePublicationSummary = z.infer<
  typeof coursePublicationSummarySchema
>;
