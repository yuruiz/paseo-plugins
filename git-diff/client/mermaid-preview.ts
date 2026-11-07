export function hasMermaid(source: string) {
  return /^\s{0,3}(?:`{3,}|~{3,})mermaid(?:\s|$)/im.test(source);
}

// This runs only inside an opaque-origin Markdown iframe. Repository HTML never
// gets script permission. Source stays text, and Mermaid's strict mode disables clicks.
export function mermaidScript(gzip: string, nonce: string, light: boolean): string {
  return `(async () => {
    const figures = [...document.querySelectorAll('.mermaid-diagram')];
    function failure(figure, error) {
      const target = figure.querySelector('.mermaid-display');
      target.textContent = 'Mermaid 无法绘制：' + String(error.message || error).slice(0, 320);
      target.setAttribute('role', 'alert');
      target.setAttribute('aria-busy', 'false');
      figure.dataset.state = 'error';
      figure.querySelector('details').open = true;
    }
    try {
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持离线图表解压，请更新浏览器。');
      const bytes = Uint8Array.from(atob(${JSON.stringify(gzip)}), c => c.charCodeAt(0));
      const source = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      const script = document.createElement('script');
      script.nonce = ${JSON.stringify(nonce)};
      script.textContent = source;
      document.head.appendChild(script);
      if (!window.mermaid) throw new Error('离线图表引擎未能加载');
      window.mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        theme: ${JSON.stringify(light ? "default" : "dark")},
        maxTextSize: 20000, maxEdges: 500,
        flowchart: { htmlLabels: false },
        secure: ['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','suppressErrorRendering'],
      });
      for (const [index, figure] of figures.entries()) {
        const source = figure.querySelector('.mermaid-source').textContent;
        try {
          if (index >= 16) throw new Error('每份预览最多绘制 16 个图表，其余图表保留源码。');
          if (source.length > 20000) throw new Error('图表超过 20000 字符，请缩小图表。');
          const result = await window.mermaid.render('git-mermaid-' + index, source);
          const target = figure.querySelector('.mermaid-display');
          target.innerHTML = result.svg;
          target.setAttribute('aria-busy', 'false');
          figure.dataset.state = 'ready';
        } catch (error) { failure(figure, error); }
      }
    } catch (error) { for (const figure of figures) failure(figure, error); }
  })();`;
}
