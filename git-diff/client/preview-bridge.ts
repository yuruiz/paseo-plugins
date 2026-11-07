// Only this bundled script may execute in Markdown frames. Source HTML stays escaped.
export function previewBridge(token: string) {
  return `(() => {
    const token = ${JSON.stringify(token).replaceAll("<", "\\u003c")};
    function scroll(fragment) {
      if (!fragment) { window.scrollTo(0, 0); return; }
      const target = document.getElementById(fragment) || document.getElementsByName(fragment)[0];
      if (target) target.scrollIntoView({block: 'start'});
    }
    function click(event) {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || (event.type === 'auxclick' && event.button !== 1)) return;
      event.preventDefault();
      const href = link.getAttribute('href');
      if (!href) return;
      if (href.startsWith('#')) {
        try { scroll(decodeURIComponent(href.slice(1))); } catch {}
      } else {
        parent.postMessage({type: 'git-preview-link', token, href}, '*');
      }
    }
    document.addEventListener('click', click);
    document.addEventListener('auxclick', click);
    window.addEventListener('message', event => {
      if (event.source === parent && event.data?.type === 'git-preview-anchor' && event.data.token === token && typeof event.data.fragment === 'string') scroll(event.data.fragment);
    });
  })();`;
}
