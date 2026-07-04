/*
 * One runnable example. `code` is plain javascript source, executed by the
 * runner as the body of an async function (b, lib, log, onCleanup). The
 * registry in index.ts groups examples into ordered categories.
 */

export interface Example {
  id: string;
  title: string;
  category: string;
  description: string;
  seed: string;
  code: string;
}
