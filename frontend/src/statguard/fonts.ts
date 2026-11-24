// Self-hosted fonts (bundled by Vite, so the site's CSP `font-src 'self'` is kept). Both are SIL OFL 1.1.
// Pretendard: Korean UI/headlines, split into unicode-range subsets so a page downloads only the glyphs it uses.
// JetBrains Mono: every number the site recomputes or reports.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource-variable/jetbrains-mono';
