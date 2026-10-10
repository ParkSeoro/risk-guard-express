// GoatCounter가 ?v=변형 포함 경로를 집계하도록(자가 진화의 성과 신호)
window.goatcounter = { path: location.pathname + location.search };
const ROOT = document.body.dataset.root || '';
if ('serviceWorker' in navigator) navigator.serviceWorker.register(ROOT + 'sw.js');

// 한국식 금액: 1억 2,345만원
function won(n) {
  n = Math.round(n); const s = n < 0 ? '-' : ''; n = Math.abs(n);
  const man = Math.floor(n / 10000), eok = Math.floor(man / 10000), rest = man % 10000;
  if (eok && rest) return `${s}${eok.toLocaleString()}억 ${rest.toLocaleString()}만원`;
  if (eok) return `${s}${eok.toLocaleString()}억원`;
  if (man) return `${s}${man.toLocaleString()}만원`;
  return `${s}${n.toLocaleString()}원`;
}
const mult = (m) => (m < 100 ? m.toFixed(1) : Math.round(m).toLocaleString());
const cache = {};
async function prices(slug) {
  if (!cache[slug]) cache[slug] = fetch(ROOT + 'prices/' + slug + '.json').then((r) => r.json());
  return cache[slug];
}
function priceOn(p, keys, d) { // 그날 또는 직전 거래일 종가
  if (p[d] != null) return [d, p[d]];
  let lo = 0, hi = keys.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (keys[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans < 0 ? null : [keys[ans], p[keys[ans]]];
}

const $ = (id) => document.getElementById(id);
const calc = $('calc');
let mode = 'once', lastText = '';
if (calc) {
  const q = new URLSearchParams(location.search);
  if (q.get('c')) $('coin').value = q.get('c');
  calc.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
    mode = b.dataset.mode;
    calc.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    calc.querySelector('.once').hidden = mode !== 'once';
    calc.querySelector('.bday').hidden = mode !== 'bday';
  });
  $('amt').oninput = (e) => { const v = e.target.value.replace(/\D/g, ''); e.target.value = v ? Number(v).toLocaleString() : ''; };
  $('go').onclick = run;
}

async function run() {
  const slug = $('coin').value, name = $('coin').selectedOptions[0].text;
  const amt = Number($('amt').value.replace(/\D/g, '')) || 1000000;
  const p = await prices(slug), keys = Object.keys(p).sort(), now = p[keys[keys.length - 1]];
  let html, text;
  if (mode === 'once') {
    const d = $('date').value, hit = priceOn(p, keys, d);
    if (!hit) { $('out').innerHTML = `<p class="warn">${name}은(는) ${keys[0]}에 업비트 원화마켓에 상장했어요. 그 이후 날짜로 해보세요.</p>`; return; }
    const value = amt / hit[1] * now, m = value / amt, up = m >= 1;
    html = `<p class="res ${up ? 'up' : 'down'}"><b>${won(value)}</b></p>
      <p>${d}에 ${name} ${won(amt)} → 지금 <b>${mult(m)}배</b> (${up ? '+' : ''}${((m - 1) * 100).toFixed(1)}%)</p>
      <p class="sm">그날 가격 ${won(hit[1])} · 현재가 ${won(now)}</p>`;
    text = `${d}에 ${name} ${won(amt)} 샀으면 지금 ${won(value)} (${mult(m)}배)😱 내 날짜로도 계산해봐`;
  } else {
    const md = $('md').value.replace(/\D/g, '');
    if (md.length !== 4) { $('out').innerHTML = '<p class="warn">생일을 월일 4자리로 입력하세요(예: 0315).</p>'; return; }
    let units = 0, paid = 0, n = 0;
    const today = keys[keys.length - 1];
    for (let y = Number(keys[0].slice(0, 4)); y <= Number(today.slice(0, 4)); y++) {
      const d = `${y}-${md.slice(0, 2)}-${md.slice(2)}`;
      if (d < keys[0] || d > today) continue;
      const hit = priceOn(p, keys, d); if (!hit) continue;
      units += amt / hit[1]; paid += amt; n++;
    }
    if (!n) { $('out').innerHTML = '<p class="warn">계산 가능한 생일이 없어요.</p>'; return; }
    const value = units * now, m = value / paid, up = m >= 1;
    html = `<p class="res ${up ? 'up' : 'down'}"><b>${won(value)}</b></p>
      <p>생일마다 ${name} ${won(amt)}씩 ${n}번(총 ${won(paid)}) → 지금 <b>${mult(m)}배</b></p>
      <p class="sm">수익 ${won(value - paid)} · 현재가 ${won(now)}</p>`;
    text = `매년 내 생일마다 ${name} ${won(amt)}씩 샀으면 지금 ${won(value)} (${mult(m)}배)🎂 너도 해봐`;
  }
  $('out').innerHTML = html + '<p class="sm">수수료·세금 미반영 단순 계산 · 투자 권유 아님</p>';
  $('sharebox').hidden = false;
  lastText = text;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const v = calc ? calc.dataset.v : 'a';
  const url = location.origin + location.pathname + '?v=' + v + '&c=' + ($('coin') ? $('coin').value : '');
  if (b.dataset.act === 'share' && navigator.share) { try { await navigator.share({ title: document.title, text: lastText, url }); } catch (_) {} return; }
  await navigator.clipboard.writeText(lastText + '\n' + url);
  b.textContent = '✅ 복사됨';
});

let deferred; const ib = $('install');
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (ib) ib.hidden = false; });
if (ib) ib.onclick = () => deferred && deferred.prompt();
