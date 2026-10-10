// GoatCounter가 canonical 대신 ?v=변형 포함 경로를 집계하도록(자가 진화의 성과 신호)
window.goatcounter = { path: location.pathname + location.search };
if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('sw.js', document.querySelector('link[rel=manifest]').href));
const txt = () => (document.getElementById('script') || {}).innerText || '';
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'copy') { await navigator.clipboard.writeText(txt()); b.textContent = '✅ 복사됨'; }
  if (act === 'print') window.print();
  if (act === 'share') {
    const url = location.origin + location.pathname + '?v=' + b.dataset.v;
    const data = { title: document.title, text: txt().split('\n').slice(0, 6).join('\n') + '\n…전체 보기:', url };
    if (navigator.share) { try { await navigator.share(data); } catch (_) {} }
    else { await navigator.clipboard.writeText(data.text + ' ' + url); b.textContent = '✅ 링크 복사됨'; }
  }
});
let deferred; const ib = document.getElementById('install');
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (ib) ib.hidden = false; });
if (ib) ib.onclick = () => deferred && deferred.prompt();
