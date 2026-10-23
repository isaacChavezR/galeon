// Diagnóstico CDP de Galeón: ejecuta JS en el renderer real por WebSocket
// Uso: node scripts/cdp-diag.mjs
const BASE = 'http://127.0.0.1:9222';

async function main() {
  const targets = await (await fetch(`${BASE}/json/list`)).json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
  if (!page) { console.log('SIN-TARGET', targets.map(t => t.type + ':' + t.url.slice(0, 60))); return; }
  console.log('target:', page.url.slice(0, 80));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const evaluar = (expr, awaitPromise = false) => new Promise((resolve) => {
    const id = ++seq;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        resolve(m.result?.result?.value ?? JSON.stringify(m.result ?? {}));
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise } }));
  });

  console.log('1. estado:', await evaluar(`JSON.stringify({
    nTabs: tabs.length, activeId,
    tab: (() => { const t = activeTab(); return t ? { id: t.id, url: (t.url||'').slice(0,60), tieneWV: !!t.webview, durmiendo: !!t.sleeping } : null; })(),
    wvGetURL: (() => { try { return activeTab().webview.getURL().slice(0, 60); } catch (e) { return 'ERR ' + e.message; } })(),
    wvisLoading: (() => { try { return activeTab().webview.isLoading(); } catch (e) { return 'ERR ' + e.message; } })()
  })`));

  console.log('2. loadURL directo:', await evaluar(`(async () => {
    try { await activeTab().webview.loadURL('https://www.google.com/'); return 'LOADURL-OK'; }
    catch (e) { return 'LOADURL-ERR [' + e.message.slice(0, 140) + ']'; }
  })()`, true));

  console.log('3. tras intento, URL actual:', await evaluar(`(() => { try { return activeTab().webview.getURL().slice(0, 80); } catch (e) { return 'ERR'; } })()`));

  console.log('4. fallback con src:', await evaluar(`(() => { try { activeTab().webview.src = 'https://www.google.com/'; return 'SRC-ASIGNADO'; } catch (e) { return 'SRC-ERR ' + e.message; } })()`));

  await new Promise(r => setTimeout(r, 6000));
  console.log('5. URL final (6 s después):', await evaluar(`(() => { try { return activeTab().webview.getURL().slice(0, 80); } catch (e) { return 'ERR'; } })()`));
  ws.close();
}

main().catch(e => { console.error('CDP-ERR', e.message); process.exit(1); });
