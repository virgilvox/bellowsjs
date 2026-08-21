<script setup lang="ts">
/*
 * The docs reader. Three columns on wide screens: grouped page list,
 * the rendered article, and an on-this-page list built from h2 headings.
 * Pages live under src/docs/pages as markdown-in-template-literal
 * modules; navigation is pushState so /docs/<slug> deep links work
 * without reloads (the host serves index.html for every path).
 */

import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { Marked } from 'marked';
import ListenBlock from '../components/docs/ListenBlock.vue';
import { stopAll } from '../lib/docs-player';
import {
  DOC_GROUPS,
  DOC_PAGES,
  bySlug,
  groupsFor,
  pagesFor,
  treeOf,
  type DocPage,
  type DocTree,
} from '../docs';

const BASE_TITLE = document.title;

/* ---------------------------------------------------------------- */
/* markdown rendering                                                */
/* ---------------------------------------------------------------- */

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const md = new Marked({
  renderer: {
    heading({ tokens, depth, text }) {
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugifyHeading(text)}">${inner}</h${depth}>\n`;
    },
  },
});

interface TocEntry {
  id: string;
  label: string;
}

/* ---------------------------------------------------------------- */
/* routing                                                           */
/* ---------------------------------------------------------------- */

function slugFromPath(): string {
  const path = location.pathname.replace(/\/+$/, '');
  if (!path.startsWith('/docs')) return '';
  return path.slice('/docs'.length).replace(/^\//, '');
}

const slug = ref(slugFromPath());
const page = computed<DocPage | null>(() => bySlug.get(slug.value) ?? null);

/*
 * Which tree is showing.
 *
 * Derived from the slug when there is one, so a deep link or a refresh lands
 * in the right tree, and held as state when there is not, so the index page
 * remembers which set you were reading.
 */
const chosenTree = ref<DocTree>(treeOf(slugFromPath()));
const tree = computed<DocTree>(() => (page.value ? treeOf(page.value.slug) : chosenTree.value));
const groups = computed(() => groupsFor(tree.value));

function setTree(next: DocTree): void {
  if (next === tree.value) return;
  chosenTree.value = next;
  /* Land on the first page of the tree rather than an index that would
   * immediately switch back. */
  go(pagesFor(next)[0].slug);
}
const unknown = computed(() => slug.value !== '' && !page.value);

/* ---------------------------------------------------------------- */
/* listen blocks                                                     */
/* ---------------------------------------------------------------- */

/*
 * A page body is markdown with one exception, a fence that mounts a player:
 *
 *     ```listen onekick params=decay,drive
 *     predict: Decay is 0.35 s. What happens at 2.0?
 *     A kick drum, and the two numbers worth touching.
 *     ```
 *
 * The fence line names the firmware and, optionally, which of its params to
 * expose as sliders. In the body, a line starting `predict:` is the question
 * shown before the button; everything else is the caption.
 *
 * WHY SPLIT THE BODY RATHER THAN EXTEND THE RENDERER
 *
 * `v-html` cannot mount a component, so a marked extension could only emit
 * inert markup that something would then have to hydrate by hand. Splitting
 * first and rendering a list of parts keeps the player an ordinary child
 * with ordinary props and no manual mounting.
 *
 * Two things this relies on, both checked before it was written. The
 * on-this-page list is built from `md.lexer(body)` rather than from the DOM,
 * and a fence is a `code` token, so splitting changes no heading. And the
 * article's click handler is delegated from the <article> element, so links
 * inside any segment still route.
 *
 * The one thing it gives up: markdown constructs cannot span a fence, since
 * each run of text is parsed on its own. Reference-style link definitions
 * are the case that would bite, and no page here uses them. Keep fences at
 * column zero with a blank line either side.
 */
type Segment =
  | { kind: 'md'; html: string }
  | { kind: 'listen'; firmware: string; params: string[]; caption: string; predict: string };

const FENCE_OPEN = /^```listen[ \t]+(\S+)[ \t]*(.*)$/;

function parseOptions(rest: string): { params: string[] } {
  const params: string[] = [];
  for (const m of rest.matchAll(/(\w+)=([^\s]+)/g)) {
    if (m[1] === 'params') params.push(...m[2].split(',').filter(Boolean));
  }
  return { params };
}

function splitBody(body: string): Segment[] {
  const out: Segment[] = [];
  const lines = body.split('\n');
  let buf: string[] = [];

  const flush = (): void => {
    if (buf.length === 0) return;
    out.push({ kind: 'md', html: md.parse(buf.join('\n')) as string });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) {
      buf.push(lines[i]);
      continue;
    }
    /* Stop at the close, or at whatever fence opens next if the author
     * forgot it. scripts/check-listen.mjs refuses the second case, so this
     * only has to fail small rather than swallow the rest of the page. */
    const body_: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j].trimEnd();
      if (line === '```') break;
      if (line.startsWith('```')) {
        j--;
        break;
      }
      body_.push(lines[j]);
    }
    flush();
    const predictLine = body_.find((l) => l.startsWith('predict:'));
    out.push({
      kind: 'listen',
      firmware: open[1],
      params: parseOptions(open[2]).params,
      predict: predictLine ? predictLine.slice('predict:'.length).trim() : '',
      caption: body_.filter((l) => l !== predictLine).join(' ').trim(),
    });
    i = j;
  }
  flush();
  return out;
}

const segments = computed<Segment[]>(() => (page.value ? splitBody(page.value.body) : []));

/* Kept for the watcher that re-runs enhanceArticle: it has to change when
 * the page does, and reading the body is the cheapest thing that does. */
const html = computed(() => page.value?.body ?? '');

const toc = computed<TocEntry[]>(() => {
  if (!page.value) return [];
  return md
    .lexer(page.value.body)
    .filter((t) => t.type === 'heading' && t.depth === 2)
    .map((t) => {
      const text = (t as { text: string }).text;
      return { id: slugifyHeading(text), label: text.replace(/`/g, '') };
    });
});

const prevPage = computed(() => (page.value?.prev ? bySlug.get(page.value.prev) ?? null : null));
const nextPage = computed(() => (page.value?.next ? bySlug.get(page.value.next) ?? null : null));

function go(target: string): void {
  const path = target === '' ? '/docs' : '/docs/' + target;
  if (location.pathname !== path) history.pushState(null, '', path);
  slug.value = slugFromPath();
  window.scrollTo({ top: 0 });
}

function onPopState(): void {
  // App.vue owns leaving /docs; only resync while we are on a docs path
  if (location.pathname.startsWith('/docs')) slug.value = slugFromPath();
}

function onArticleClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  const href = a.getAttribute('href') ?? '';
  if (!href.startsWith('/docs')) return; // externals and /llm.txt navigate normally
  e.preventDefault();
  go(href.replace(/^\/docs\/?/, ''));
}

/* ---------------------------------------------------------------- */
/* code block copy buttons                                           */
/* ---------------------------------------------------------------- */

const articleEl = ref<HTMLElement | null>(null);

function enhanceArticle(): void {
  const root = articleEl.value;
  if (!root) return;
  root.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener';
  });
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('codeblock')) return;
    const wrap = document.createElement('div');
    wrap.className = 'codeblock';
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.textContent = 'COPY';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      navigator.clipboard.writeText((code ?? pre).textContent ?? '').then(
        () => {
          btn.textContent = 'COPIED';
          setTimeout(() => (btn.textContent = 'COPY'), 1200);
        },
        () => {
          btn.textContent = 'FAILED';
          setTimeout(() => (btn.textContent = 'COPY'), 1200);
        },
      );
    });
    wrap.appendChild(btn);
  });
}

watch([html, articleEl], () => nextTick(enhanceArticle));

watch(
  page,
  (p) => {
    document.title = p ? p.title + ' // BELLOWS DOCS' : 'DOCS // BELLOWS';
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('popstate', onPopState);
  nextTick(enhanceArticle);
});

onBeforeUnmount(() => window.removeEventListener('popstate', onPopState));

onActivated(() => {
  // KeepAlive: re-entering docs via the header lands on whatever path is current
  slug.value = slugFromPath();
  document.title = page.value ? page.value.title + ' // BELLOWS DOCS' : 'DOCS // BELLOWS';
  nextTick(enhanceArticle);
});

onDeactivated(() => {
  document.title = BASE_TITLE;
  /* Leaving the docs is silence. Each ListenBlock stops itself too, but this
   * page is kept alive, so a reader who tabs to the playground and starts a
   * firmware there would otherwise be hearing two. */
  stopAll();
});
</script>

<template>
  <div class="docs">
    <details class="side-mobile">
      <summary>DOCS INDEX</summary>
      <nav>
        <div class="trees">
          <button :class="{ lit: tree === 'browser' }" @click="setTree('browser')">BROWSER</button>
          <button :class="{ lit: tree === 'embedded' }" @click="setTree('embedded')">EMBEDDED</button>
        </div>
        <div v-for="g in groups" :key="g.label" class="group">
          <div class="group-label">{{ g.label }}</div>
          <a
            v-for="p in g.pages"
            :key="p.slug"
            :href="'/docs/' + p.slug"
            :class="{ current: p.slug === slug }"
            @click.prevent="go(p.slug)"
          >{{ p.title }}</a>
        </div>
      </nav>
    </details>

    <aside class="side">
      <a href="/docs" class="side-home" :class="{ current: slug === '' }" @click.prevent="go('')">DOCUMENTATION</a>
      <div class="trees">
        <button :class="{ lit: tree === 'browser' }" @click="setTree('browser')">BROWSER</button>
        <button :class="{ lit: tree === 'embedded' }" @click="setTree('embedded')">EMBEDDED</button>
      </div>
      <nav>
        <div v-for="g in groups" :key="g.label" class="group">
          <div class="group-label">{{ g.label }}</div>
          <a
            v-for="p in g.pages"
            :key="p.slug"
            :href="'/docs/' + p.slug"
            :class="{ current: p.slug === slug }"
            @click.prevent="go(p.slug)"
          >{{ p.title }}</a>
        </div>
      </nav>
    </aside>

    <div class="main">
      <article v-if="page" ref="articleEl" class="article" @click="onArticleClick">
        <h1>{{ page.title }}</h1>
        <!--
          Keyed by SLUG and index, not index alone. Measured: with a bare
          index, navigating from a page whose second segment is a player to
          another page whose second segment is also a player patched the same
          component in place instead of remounting it, so the first page's
          voice went on sounding under the second page and its button already
          read "stop" to a reader who had never pressed play. Peak 0.53 before
          the navigation, 0.47 after it.
        -->
        <template v-for="(seg, i) in segments" :key="slug + '#' + i">
          <div v-if="seg.kind === 'md'" v-html="seg.html"></div>
          <ListenBlock
            v-else
            :firmware="seg.firmware"
            :params="seg.params"
            :caption="seg.caption"
            :predict="seg.predict"
          />
        </template>
      </article>

      <article v-else class="article home">
        <h1>Documentation</h1>
        <p v-if="unknown" class="missing">
          No page lives at <code>/docs/{{ slug }}</code>. The full index is below.
        </p>
        <p v-else>
          {{ pagesFor(tree).length }} pages, in reading order.
          <template v-if="tree === 'embedded'">
            The first four are a tutorial you can hear without owning a board.
          </template>
          <template v-else>From first sound to writing your own DSP.</template>
          Every code snippet is checked against the current release; the machine-readable
          companion at
          <a :href="tree === 'embedded' ? '/llm-embedded.txt' : '/llm.txt'">{{
            tree === 'embedded' ? '/llm-embedded.txt' : '/llm.txt'
          }}</a>
          lists every signature exactly.
        </p>
        <section v-for="g in groups" :key="g.label" class="home-group">
          <h2>{{ g.label }}</h2>
          <ul>
            <li v-for="p in g.pages" :key="p.slug">
              <a :href="'/docs/' + p.slug" @click.prevent="go(p.slug)">{{ p.title }}</a>
              <span class="blurb">{{ p.blurb }}</span>
            </li>
          </ul>
        </section>
      </article>

      <nav v-if="page" class="pager">
        <a v-if="prevPage" :href="'/docs/' + prevPage.slug" class="pager-link prev" @click.prevent="go(prevPage.slug)">
          <span class="pager-dir">PREV</span>
          <span class="pager-title">{{ prevPage.title }}</span>
        </a>
        <span v-else></span>
        <a v-if="nextPage" :href="'/docs/' + nextPage.slug" class="pager-link next" @click.prevent="go(nextPage.slug)">
          <span class="pager-dir">NEXT</span>
          <span class="pager-title">{{ nextPage.title }}</span>
        </a>
        <span v-else></span>
      </nav>
    </div>

    <aside v-if="page && toc.length" class="toc">
      <div class="toc-label">ON THIS PAGE</div>
      <a v-for="t in toc" :key="t.id" :href="'#' + t.id">{{ t.label }}</a>
    </aside>
    <aside v-else class="toc"></aside>
  </div>
</template>

<style scoped>
.docs {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 180px;
  gap: 28px;
  align-items: start;
}

/* ------------------------------------------------------------ */
/* left sidebar                                                  */
/* ------------------------------------------------------------ */

.side {
  position: sticky;
  top: 16px;
  border: 2px solid var(--seam);
  background: var(--soot);
  box-shadow: var(--shadow-sm);
  padding: 10px 0 12px;
}

.trees {
  display: flex;
  gap: 6px;
  padding: 0 12px 10px;
}
.trees button {
  flex: 1;
  font-family: var(--disp);
  font-weight: 600;
  font-size: 10px;
  padding: 7px 4px;
}
.side-home {
  display: block;
  font-family: var(--disp);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: var(--tick);
  text-decoration: none;
  text-transform: uppercase;
  padding: 2px 12px 8px;
  border-bottom: 1px dashed var(--seam);
  margin-bottom: 6px;
}

.side-home:hover,
.side-home.current {
  color: var(--phosphor);
}

.group {
  margin-top: 10px;
}

.group-label {
  font-size: 9px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--faded);
  padding: 0 12px 4px;
}

.side a:not(.side-home),
.side-mobile a {
  display: block;
  font-size: 11px;
  color: var(--bone);
  text-decoration: none;
  padding: 3px 12px;
  border-left: 2px solid transparent;
}

.side a:not(.side-home):hover,
.side-mobile a:hover {
  color: var(--phosphor);
}

.side a:not(.side-home).current,
.side-mobile a.current {
  color: var(--phosphor-hot);
  border-left-color: var(--phosphor);
  background: var(--phosphor-ghost);
}

/* mobile index */
.side-mobile {
  display: none;
  grid-column: 1 / -1;
  border: 2px solid var(--seam);
  background: var(--soot);
  box-shadow: var(--shadow-sm);
  padding: 8px 12px;
}

.side-mobile summary {
  font-family: var(--disp);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: var(--tick);
  cursor: pointer;
}

/* ------------------------------------------------------------ */
/* right toc                                                     */
/* ------------------------------------------------------------ */

.toc {
  position: sticky;
  top: 16px;
  font-size: 10px;
}

.toc-label {
  font-family: var(--disp);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.24em;
  color: var(--faded);
  text-transform: uppercase;
  border-bottom: 1px dashed var(--seam);
  padding-bottom: 5px;
  margin-bottom: 7px;
}

.toc a {
  display: block;
  color: var(--tick);
  text-decoration: none;
  padding: 2px 0;
  line-height: 1.5;
}

.toc a:hover {
  color: var(--phosphor);
}

/* ------------------------------------------------------------ */
/* article                                                       */
/* ------------------------------------------------------------ */

.article {
  background: var(--soot);
  border: 2px solid var(--seam);
  box-shadow: var(--shadow);
  padding: 26px 30px 30px;
  min-width: 0;
}

.article h1 {
  font-family: var(--disp);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--bone);
  border-bottom: 2px solid var(--seam);
  padding-bottom: 10px;
  margin-bottom: 14px;
}

.article :deep(h2) {
  font-family: var(--disp);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--phosphor-hot);
  margin: 26px 0 8px;
  scroll-margin-top: 16px;
}

.article :deep(h3) {
  font-family: var(--disp);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--bone);
  margin: 18px 0 6px;
}

.article :deep(p) {
  margin: 0 0 10px;
  max-width: 74ch;
  line-height: 1.6;
}

.article :deep(ul),
.article :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
  line-height: 1.6;
}

.article :deep(a) {
  color: var(--bone);
  text-decoration: none;
  border-bottom: 1px dotted var(--seam);
}

.article :deep(a:hover) {
  color: var(--phosphor);
  border-bottom-color: var(--phosphor);
}

.article :deep(code) {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--char);
  border: 1px solid var(--seam);
  padding: 0 4px;
  color: var(--phosphor-hot);
}

.article :deep(.codeblock) {
  position: relative;
  margin: 4px 0 14px;
}

.article :deep(pre) {
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 12px 14px;
  overflow-x: auto;
  line-height: 1.5;
}

.article :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
  color: var(--bone);
  font-size: 12px;
}

.article :deep(.copy-btn) {
  position: absolute;
  top: 6px;
  right: 6px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  padding: 3px 7px;
  background: var(--char);
  color: var(--tick);
  border: 1px solid var(--seam);
  box-shadow: none;
  cursor: pointer;
  text-transform: uppercase;
}

.article :deep(.copy-btn:hover) {
  color: var(--phosphor-hot);
  border-color: var(--phosphor);
  transform: none;
}

.article :deep(table) {
  border-collapse: collapse;
  margin: 4px 0 14px;
  font-size: 12px;
  display: block;
  overflow-x: auto;
  max-width: 100%;
}

.article :deep(th),
.article :deep(td) {
  border: 1px solid var(--seam);
  padding: 5px 10px;
  text-align: left;
  vertical-align: top;
}

.article :deep(th) {
  font-family: var(--disp);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--tick);
  background: var(--char);
}

.article :deep(blockquote) {
  border-left: 2px solid var(--phosphor);
  padding-left: 12px;
  color: var(--tick);
  margin: 0 0 10px;
}

/* home / index */
.home .missing {
  border: 1px dashed var(--slag);
  color: var(--slag);
  padding: 8px 10px;
}

.home-group h2 {
  font-family: var(--disp);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--phosphor-hot);
  margin: 20px 0 6px;
}

.home-group ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.home-group li {
  padding: 4px 0;
  border-bottom: 1px dashed var(--seam);
}

.home-group a {
  color: var(--bone);
  text-decoration: none;
  font-weight: 700;
  border-bottom: 1px dotted var(--seam);
}

.home-group a:hover {
  color: var(--phosphor);
}

.home-group .blurb {
  color: var(--tick);
  margin-left: 10px;
  font-size: 11px;
}

/* pager */
.pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 14px;
}

.pager-link {
  display: block;
  border: 2px solid var(--seam);
  background: var(--soot);
  box-shadow: var(--shadow-sm);
  padding: 9px 12px;
  text-decoration: none;
  transition: border-color 0.12s, color 0.12s;
}

.pager-link:hover {
  border-color: var(--phosphor);
}

.pager-link.next {
  text-align: right;
}

.pager-dir {
  display: block;
  font-size: 9px;
  letter-spacing: 0.24em;
  color: var(--faded);
}

.pager-title {
  font-family: var(--disp);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--bone);
}

.pager-link:hover .pager-title {
  color: var(--phosphor-hot);
}

/* ------------------------------------------------------------ */
/* collapse                                                      */
/* ------------------------------------------------------------ */

@media (max-width: 1020px) {
  .docs {
    grid-template-columns: 190px minmax(0, 1fr);
  }

  .toc {
    display: none;
  }
}

@media (max-width: 760px) {
  .docs {
    grid-template-columns: minmax(0, 1fr);
  }

  .side {
    display: none;
  }

  .side-mobile {
    display: block;
  }

  .article {
    padding: 18px 16px 22px;
  }
}
</style>
