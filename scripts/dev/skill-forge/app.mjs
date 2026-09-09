const $ = selector => document.querySelector(selector);
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const zero = `0x${'0'.repeat(64)}`;
let request = 0;
let selectedPunk;
let pickerRequest = 0;
function closePicker() { ++pickerRequest; $('#sacrifice-picker').close(); $('#candidate-review').hidden = true; }
$('#close-picker').addEventListener('click', closePicker);
$('#sacrifice-picker').addEventListener('close', () => { if (!$('#sacrifice-picker').open) ++pickerRequest; $('#candidate-review').hidden = true; });
$('#browse-sacrifice').addEventListener('click', async () => {
  if (!selectedPunk) return;
  const target = selectedPunk.tokenId, sequence = request;
  const pickerSequence = ++pickerRequest;
  $('#training-target').textContent = `KEEP & TRAIN: LOCAL PUNK #${target}`;
  $('#sacrifice-candidates').replaceChildren(); $('#candidate-review').hidden = true;
  $('#picker-status').textContent = 'Checking current fixture ownership…';
  $('#sacrifice-picker').showModal();
  try {
    const response = await fetch(`/api/forge?tokenId=${target}`);
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (sequence !== request || pickerSequence !== pickerRequest || !$('#sacrifice-picker').open) return;
    if (data.tokenId !== target || data.localOnly !== true || data.chainId !== 31337 || data.canBurn !== false || !Array.isArray(data.candidates)) throw new Error('Invalid snapshot');
    $('#picker-status').textContent = `${data.candidates.length} other owned local Punks · ownership checked at block ${data.blockNumber}. All sacrifice paths remain blocked.`;
    for (const candidate of data.candidates) {
      if (candidate.tokenId === target || candidate.owner.toLowerCase() !== data.owner.toLowerCase() || candidate.canBurn !== false) throw new Error('Invalid candidate');
      const card = element('article', undefined, 'sacrifice-card'); card.dataset.candidate = candidate.tokenId;
      const art = element('img'); art.src = `/art/${candidate.tokenId}.png`; art.alt = `Local fixture Punk #${candidate.tokenId}`;
      const info = element('div'); info.append(element('h3', `PUNK #${candidate.tokenId}`), element('span', 'BLOCKED · INVENTORY UNKNOWN', 'skill-status'));
      const stats = element('dl');
      for (const [label, value] of [['Wallet ETH', 'Unknown'], ['NFTs / ERC20 assets', 'Unknown / unknown'], ['Missions / automation / pending', 'Unknown'], ['Learned / credits / slots', `${candidate.learnedCount} / ${candidate.credits} / ${candidate.unlockedSlots} · local`]]) stats.append(element('dt', label), element('dd', value));
      const inspect = element('button', 'REVIEW THIS PUNK ↗'); inspect.type = 'button';
      inspect.addEventListener('click', () => {
        $('#sacrifice-candidates').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button === inspect)));
        $('#candidate-title').textContent = `REVIEW PUNK #${candidate.tokenId} → TRAIN #${target}`;
        $('#candidate-reason').textContent = candidate.reason;
        const inventory = $('#candidate-inventory'); inventory.replaceChildren();
        for (const role of ['V1', 'V2', 'V3', 'AGENT']) inventory.append(element('dt', `${role} WALLET`), element('dd', 'Address / ETH / NFTs / ERC20s / deposits: not verified.'));
        inventory.append(element('dt', 'PROGRESSION AT RISK'), element('dd', `${candidate.learnedCount} learned skills, ${candidate.credits} credits and ${candidate.unlockedSlots} slots belong to the sacrificed token. They would not transfer to Punk #${target}.`));
        if (!$('#leave-review')) {
          const leave = element('button', 'CANCEL & KEEP BOTH PUNKS'); leave.type = 'button'; leave.id = 'leave-review';
          leave.addEventListener('click', closePicker); $('#candidate-review').append(leave);
        }
        $('#candidate-review').hidden = false; $('#candidate-review').focus();
      });
      inspect.setAttribute('aria-pressed', 'false'); card.append(art, info, stats, inspect); $('#sacrifice-candidates').append(card);
    }
    if (!data.candidates.length) $('#picker-status').textContent = 'No other owned fixture Punks available. Your training target cannot sacrifice itself.';
  } catch {
    if (sequence === request && pickerSequence === pickerRequest && $('#sacrifice-picker').open) { $('#sacrifice-candidates').replaceChildren(); $('#candidate-review').hidden = true; $('#picker-status').textContent = 'Ownership or inventory checks unavailable. No Punk can be selected for sacrifice. Close and retry.'; }
  }
});
function detail(title, kicker, paragraphs, fields) {
  $('#detail-title').textContent = title;
  $('#detail-kicker').textContent = kicker;
  const body = $('#detail-body'); body.replaceChildren();
  for (const text of paragraphs) body.append(element('p', text));
  const list = element('dl');
  for (const [label, value] of fields) list.append(element('dt', label), element('dd', value));
  body.append(list); $('#detail').showModal();
}
$('#close-detail').addEventListener('click', () => $('#detail').close());
$('#review-burn').addEventListener('click', () => detail('PERMANENT MEANS PERMANENT.', 'SACRIFICE · BLOCKED', [
  'Burning the parent NFT can remove authority over its Punk Wallet. This does not transfer or recover the wallet’s assets. Acknowledging this warning does not unlock burning.',
  'Check every canonical and legacy wallet, token balance, deposit, mission and unsettled transaction. Unknown inventory is blocked—not assumed empty. Withdraw or resolve assets through an approved pathway first.',
], [['WALLET ASSET INVENTORY', 'Not connected / unknown. This preview does not inspect your production wallets.'], ['OPEN MISSIONS & UNSETTLED TRANSACTIONS', 'Unknown / not checked.'], ['BURN ELIGIBILITY', 'BLOCKED. No production burn source approved.'], ['PRODUCTION PUNK #93', 'Not used in this fixture. Previously observed gas funds must not be treated as zero.'], ['CONFIRMATION', 'No burn approval or signing is possible here. A future approved flow must recheck eligibility and require explicit token-ID confirmation.']]));
function render(data) {
  selectedPunk = data;
  $('#punk-label').textContent = `LOCAL PUNK #${data.tokenId}`;
  $('#portrait').src = `/art/${data.tokenId}.png`;
  $('#portrait').alt = `Gogh Punk #${data.tokenId} artwork used for local fixture`;
  document.querySelectorAll('[data-punk]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.punk) === data.tokenId)));
  const count = data.equipped.filter(key => key !== zero).length;
  $('#stats').replaceChildren(...[[data.credits, 'TRAINING CREDITS'], [data.learned.length, 'LEARNED · LOCAL'], [`${count} / ${data.slots}`, 'EQUIPPED / SLOTS']].map(([value, label]) => {
    const node = element('div', undefined, 'stat'); node.append(element('strong', value), element('span', label)); return node;
  }));
  $('#slots').replaceChildren(...Array.from({ length: data.cap }, (_, index) => {
    const skill = data.skills.find(item => item.key === data.equipped[index]);
    const locked = index >= data.slots;
    const node = element('div', undefined, `slot ${skill ? 'active' : locked ? 'locked' : ''}`);
    node.append(element('span', `SLOT 0${index + 1}`, 'slot-label'), element('strong', skill?.name || (locked ? 'LOCKED' : 'EMPTY SLOT')), element('small', skill ? 'Level 1 · local fixture' : locked ? 'Unlock with 1 credit · not live' : 'No active capability'));
    return node;
  }));
  $('#skills').replaceChildren(...data.skills.map(skill => {
    const learned = data.learned.find(item => item.key === skill.key);
    const card = element('article', undefined, `skill ${learned ? 'learned' : ''}`);
    const top = element('div', undefined, 'skill-top'); top.append(element('span', skill.mark, 'skill-number'), element('span', skill.status, 'skill-status'));
    card.append(top, element('h3', skill.name), element('p', learned ? `LEARNED · LEVEL ${learned.level} · LOCAL FIXTURE` : 'NOT LEARNED', 'learned-label'), element('p', skill.description, 'description'));
    const button = element('button', 'INSPECT CAPABILITY ↗'); button.type = 'button';
    button.addEventListener('click', () => detail(skill.name.toUpperCase(), `PRODUCTION STATUS · ${skill.status}`, [skill.description, skill.boundary], [
      ['PROPOSED TOOLS', skill.tools.join(' · ')], ['CAPABILITY', skill.capability], ['VERSION', `${skill.version} · disposable local fixture, not a registered production package`], ['MANIFEST HASH · LOCAL FIXTURE', skill.manifestHash], ['INSTRUCTION HASH · LOCAL FIXTURE', skill.instructionHash], ['READINESS', 'No production learning or live tool execution. Local test readiness is not production acceptance.'],
    ]));
    card.append(button); return card;
  }));
  const names = { TrainingCreditEarned: 'TRAINING CREDIT EARNED', SkillLearned: 'SKILL LEARNED', SlotUnlocked: 'SLOT UNLOCKED', SkillEquipped: 'SKILL EQUIPPED', SkillUnequipped: 'SKILL UNEQUIPPED' };
  $('#history').replaceChildren(...data.history.map(event => {
    const skill = data.skills.find(item => item.key === event.args.key);
    const item = element('li');
    item.append(element('strong', `${names[event.name] || event.name}${skill ? ` · ${skill.name.toUpperCase()}` : ''}`), element('span', event.name === 'TrainingCreditEarned' ? `Mock Punk #${event.args.sacrificedTokenId} sacrificed on local chain` : `Local Punk #${data.tokenId} · confirmed contract event`), element('span', `Block ${event.blockNumber} · log ${event.logIndex} · tx ${event.transactionHash}`)); return item;
  }));
  if (!data.history.length) $('#history').append(element('li', 'No training events for this local Punk.'));
  $('#snapshot').textContent = `Chain ${data.chainId} · snapshot block ${data.blockNumber} · progression ${data.progression}. History comes from this disposable contract, not production.`;
  $('#profile').hidden = false;
  $('#status').textContent = `Local Punk #${data.tokenId} · contract snapshot loaded. Production training remains locked.`;
}
async function load(tokenId) {
  const sequence = ++request;
  selectedPunk = undefined; closePicker();
  $('#profile').hidden = true;
  $('#status').textContent = `Reading local Punk #${tokenId}…`;
  try {
    const response = await fetch(`/api/forge?tokenId=${tokenId}`);
    if (!response.ok) throw new Error('Snapshot unavailable');
    const data = await response.json();
    if (sequence !== request) return;
    if (data.localOnly !== true || data.chainId !== 31337 || data.canBurn !== false || data.productionReadyCount !== 0) throw new Error('Unexpected preview configuration');
    render(data);
  } catch { if (sequence === request) $('#status').textContent = 'Local snapshot unavailable. No action was taken. Reload to retry.'; }
}
document.querySelectorAll('[data-punk]').forEach(button => button.addEventListener('click', () => load(button.dataset.punk)));
await load(1);
