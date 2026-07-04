/*
 * One doc page: markdown body in a template literal, rendered by DocsView.
 * Pages are plain modules so Vite hot-reloads them and nothing ships that
 * is not imported.
 */

export interface DocPage {
  slug: string;
  title: string;
  /** One-line summary shown on the docs index. */
  blurb: string;
  /** Slug of the previous page in reading order, or null at the start. */
  prev: string | null;
  /** Slug of the next page in reading order, or null at the end. */
  next: string | null;
  /** Markdown source. Headings at h2 feed the on-this-page list. */
  body: string;
}
