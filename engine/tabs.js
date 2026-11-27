// Phlox — phone tab layout (snicker02 app standard): docked view, pill tabs, one section scrolls.

const MQ = '(max-width: 760px), (max-height: 500px) and (orientation: landscape)';

export function setupTabs({ panel, bar, key }) {
  const mq = window.matchMedia(MQ);
  let current = null;
  try { current = localStorage.getItem(key); } catch (e) { /* storage blocked */ }

  const sections = () => Array.from(panel.querySelectorAll(':scope > section.sec'));
  const visible = (s) => !s.hidden && s.dataset.hidden !== '1';

  function build() {
    bar.innerHTML = '';
    for (const s of sections()) {
      if (!visible(s)) continue;
      const h = s.querySelector(':scope > h2');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tabpill';
      b.textContent = h ? h.textContent : s.dataset.tab;
      b.dataset.tab = s.dataset.tab;
      b.addEventListener('click', () => select(s.dataset.tab, true));
      bar.appendChild(b);
    }
    select(current, false);
  }

  function select(id, save) {
    const vis = sections().filter(visible);
    if (!vis.length) return;
    let target = vis.find(s => s.dataset.tab === id) || vis[0];
    current = target.dataset.tab;
    for (const s of sections()) s.classList.toggle('tabon', s === target);
    for (const b of bar.children) b.classList.toggle('on', b.dataset.tab === current);
    const on = bar.querySelector('.on');
    if (on && on.scrollIntoView && document.body.classList.contains('tabbed')) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (save) { try { localStorage.setItem(key, current); } catch (e) { /* ignore */ } panel.scrollTop = 0; }
  }

  function apply() { document.body.classList.toggle('tabbed', mq.matches); build(); }
  mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
  new MutationObserver((muts) => {
    if (muts.some(m => m.type === 'childList' && m.target === panel || m.type === 'attributes')) build();
  }).observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-hidden'] });
  apply();
  return { select, rebuild: build };
}
