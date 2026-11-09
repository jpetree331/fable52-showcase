// Entry point: tabs, theme, and mounting the three instruments.

import { store } from './state.js';
import { mountBalance } from './balanceView.js';
import { mountStructure } from './structureView.js';
import { mountTitrate } from './titrateView.js';

const TABS = ['balance', 'structure', 'titrate'];
const tabButtons = [...document.querySelectorAll('.tab')];

function showTab(name, focus = false) {
  for (const button of tabButtons) {
    const selected = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(`panel-${button.dataset.tab}`).hidden = !selected;
    if (selected && focus) button.focus();
  }
  store.set('tab', name === TABS[0] ? '' : name);
}

tabButtons.forEach((button, index) => {
  button.addEventListener('click', () => showTab(button.dataset.tab));
  // arrow keys move between tabs, as the ARIA tab pattern expects
  button.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    showTab(TABS[(index + step + TABS.length) % TABS.length], true);
  });
});

document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('alembic-theme', next);
  } catch {
    // private browsing: the choice just won't persist
  }
});

mountBalance(document.getElementById('panel-balance'), store);
mountStructure(document.getElementById('panel-structure'), store);
mountTitrate(document.getElementById('panel-titrate'), store);

const initial = store.get('tab');
showTab(TABS.includes(initial) ? initial : TABS[0]);
