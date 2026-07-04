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
import { DOC_GROUPS, DOC_PAGES, bySlug, type DocPage } from '../docs';

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
const unknown = computed(() => slug.value !== '' && !page.value);

const html = computed(() => (page.value ? (md.parse(page.value.body) as string) : ''));

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
});
</script>

<template>
  <div class="docs">
    <details class="side-mobile">
      <summary>DOCS INDEX</summary>
      <nav>
        <div v-for="g in DOC_GROUPS" :key="g.label" class="group">
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
      <nav>
        <div v-for="g in DOC_GROUPS" :key="g.label" class="group">
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
        <div v-html="html"></div>
      </article>

      <article v-else class="article home">
        <h1>Documentation</h1>
        <p v-if="unknown" class="missing">
          No page lives at <code>/docs/{{ slug }}</code>. The full index is below.
        </p>
        <p v-else>
          Fourteen pages, in reading order, from first sound to writing your own DSP.
          Every code snippet is checked against the current release; the machine-readable
          companion at <a href="/llm.txt">/llm.txt</a> lists every signature exactly.
        </p>
        <section v-for="g in DOC_GROUPS" :key="g.label" class="home-group">
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
