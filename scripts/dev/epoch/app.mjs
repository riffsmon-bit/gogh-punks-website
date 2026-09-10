const notice = document.querySelector('#notice');
const request = async (path, options) => {
  const response = await fetch(path, options); const result = await response.json();
  if (!response.ok) throw Error(result.error); return result;
};
function render(state) {
  const stats = document.querySelector('#stats'); stats.replaceChildren();
  const owner = state.owner === state.alice ? 'ALICE' : state.owner === state.bob ? 'BOB' : state.owner;
  for (const [label, value] of [['OWNER', owner], ['RECEIPT', state.wrapped ? 'WRAPPED' : 'UNWRAPPED'], ['EPOCH', state.epoch],
    ['SESSION', state.active ? 'ACTIVE' : 'INACTIVE'], ['CREDITS', state.credits], ['EQUIPPED', `${state.equipped.length}/${state.slots}`], ['MINTS', state.mints]]) {
    const box = document.createElement('div'); box.className = 'stat'; const number = document.createElement('strong'); number.textContent = value;
    const caption = document.createElement('small'); caption.textContent = label; box.append(number, caption); stats.append(box);
  }
  document.querySelector('#account').textContent = `Local account: ${state.account} · ${state.created ? 'Created' : 'Not created yet'}`;
  const history = document.querySelector('#history'); history.replaceChildren();
  for (const row of state.history) { const li = document.createElement('li'); li.textContent = `${row.label} · block ${row.block} · ${row.hash}`; history.append(li); }
}
const refresh = async () => render(await request('/state'));
document.querySelector('#refresh').addEventListener('click', () => refresh().catch(error => { notice.textContent = error.message; notice.dataset.error = true; }));
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', async () => {
  document.querySelectorAll('button').forEach(b => { b.disabled = true; });
  notice.dataset.error = false; notice.textContent = 'Checking and applying local action…';
  try {
    const result = await request('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: button.dataset.action }) });
    render(result.state); document.querySelector('#result').textContent = result.result ? JSON.stringify(result.result, null, 2) : '';
    notice.textContent = 'Local action confirmed. Contract state refreshed.';
  } catch (error) {
    notice.dataset.error = true; notice.textContent = `Blocked: ${error.message}`;
    // Preserve and refresh state even when the attempted replay is correctly rejected.
    try { await refresh(); } catch { }
  } finally { document.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
});
try { await refresh(); notice.textContent = 'Ready. Start with Wrap Test Punk.'; }
catch (error) { notice.textContent = error.message; notice.dataset.error = true; }
