/*
 * Every link and every prev/next in the documentation goes somewhere real,
 * and the reading chain matches the order the sidebar shows.
 *
 *   npx vite-node scripts/check-doc-links.mjs
 *
 * WHY, AND IT IS NOT HYPOTHETICAL
 *
 * Written the day an audit found three broken links at once, two of them
 * shipped by the commit that added the tutorial:
 *
 *   emb-put-it-on-a-board -> /docs/emb-how-silent   a page not written yet
 *   emb-give-it-a-tune    -> /simulator             the playground is #sim
 *   emb-performance       -> /docs/on-hardware      a page never written
 *
 * None of them is visible to the type checker, the build, or any other gate.
 * A reader gets the "no page lives here" fallback, or worse, silently lands
 * on the home page, which is what an unknown non-/docs path does.
 *
 * THE CHAIN CHECK IS THE OTHER HALF
 *
 * prev/next is separate data from the group lists, so a page can be third in
 * the sidebar and eleventh in the chain. That happened the same day: the
 * tutorial was inserted at the top and the reference pages kept a chain from
 * the previous order, so following "next" from the last reference page
 * jumped into the middle of Understanding, and that page's "prev" pointed
 * somewhere else again. Two ways to walk the same tree that disagree is
 * worse than one, so this asserts they are the same walk.
 */

import { DOC_PAGES, EMBEDDED_DOC_PAGES, DOC_GROUPS, EMBEDDED_DOC_GROUPS } from '../src/docs/index.ts';

/* The hash routes App.vue knows. A link to anything else that is not /docs
 * lands on the home page with no error, which reads as a dead link. */
const MODES = new Set(['#', '#bench', '#code', '#play', '#ref', '#sim']);

const all = [...DOC_PAGES, ...EMBEDDED_DOC_PAGES];
const slugs = new Set(all.map((p) => p.slug));
const problems = [];
let links = 0;

for (const page of all) {
  for (const m of page.body.matchAll(/\]\((\/[^)\s]*)\)/g)) {
    links++;
    const href = m[1];
    if (href.startsWith('/docs/')) {
      const target = href.slice('/docs/'.length);
      if (!slugs.has(target)) problems.push(`${page.slug}: /docs/${target} is not a page`);
      continue;
    }
    if (href.startsWith('/#') || href === '/') {
      const hash = href.slice(1) || '#';
      if (!MODES.has(hash)) problems.push(`${page.slug}: ${href} is not a mode App.vue knows`);
      continue;
    }
    /* Files served from public/, like the two LLM references. */
    if (/^\/[\w.-]+\.(txt|json|wav|png|svg)$/.test(href)) continue;
    if (href === '/docs') continue;
    problems.push(
      `${page.slug}: ${href} is neither a doc page, a mode, nor a file in public/. ` +
        'An unknown path renders the home page rather than failing.',
    );
  }
}

/* prev/next resolves, and walking it visits the sidebar order exactly. */
for (const [label, groups, pages] of [
  ['browser', DOC_GROUPS, DOC_PAGES],
  ['embedded', EMBEDDED_DOC_GROUPS, EMBEDDED_DOC_PAGES],
]) {
  const order = groups.flatMap((g) => g.pages).map((p) => p.slug);
  for (const p of pages) {
    if (p.prev !== null && !slugs.has(p.prev)) problems.push(`${p.slug}: prev ${p.prev} is not a page`);
    if (p.next !== null && !slugs.has(p.next)) problems.push(`${p.slug}: next ${p.next} is not a page`);
  }
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const walked = [];
  let cursor = order[0];
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    walked.push(cursor);
    cursor = bySlug.get(cursor)?.next ?? null;
  }
  if (walked.join(' > ') !== order.join(' > ')) {
    problems.push(
      `${label} tree: the prev/next chain is not the sidebar order.\n` +
        `      sidebar: ${order.join(' > ')}\n` +
        `      chain:   ${walked.join(' > ')}`,
    );
  }
  const heads = pages.filter((p) => p.prev === null).map((p) => p.slug);
  if (heads.length !== 1) problems.push(`${label} tree: ${heads.length} pages have no prev (${heads.join(', ')})`);
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  ${p}`);
  console.log(`${problems.length} problem(s) in the documentation links`);
  process.exit(1);
}

console.log(`ok       ${links} link(s) resolve, and both reading chains match their sidebar`);
