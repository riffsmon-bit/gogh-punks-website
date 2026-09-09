import { sniperMissionPreview } from './sniper-missions.mjs';
const $ = selector => document.querySelector(selector);
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const zero = `0x${'0'.repeat(64)}`;
// Original, code-native equipment glyphs; no third-party game assets.
function equipmentIcon(name, locked) {
  const paths = locked ? ['M8 11V7a4 4 0 0 1 8 0v4', 'M6 11h12v10H6z', 'M12 15v3']
    : /detective/i.test(name) ? ['M15 15l6 6', 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'M7 10h6', 'M10 7v6']
    : /rarity/i.test(name) ? ['M3 8l4-5h10l4 5-9 13z', 'M3 8h18', 'M7 3l5 18 5-18']
    : /market/i.test(name) ? ['M3 3v18h18', 'M6 15l5-5 4 3 6-8', 'M16 5h5v5']
    : /sniper|hunter/i.test(name) ? ['M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0', 'M12 1v6m0 10v6M1 12h6m10 0h6', 'M10 12h4m-2-2v4']
    : ['M12 5v14', 'M5 12h14'];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
let request = 0;
let selectedPunk;
let skillFilter = 'all';
let trainingBusy = false;
async function localTraining(data, operation, extra = {}) {
  if (trainingBusy || selectedPunk?.tokenId !== data.tokenId) return;
  trainingBusy = true;
  const sequence = request;
  $('#status').textContent = `Confirming ${operation} on disposable local chain 31337…`;
  $('#detail').close();
  try {
    const response = await fetch('/api/local-training', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-nonce': data.localTrainingNonce }, body: JSON.stringify({ tokenId: data.tokenId, expectedBlock: data.blockNumber, operation, ...extra }) });
    if (!response.ok) throw new Error('LOCAL_ACTION_NOT_CONFIRMED');
    const result = await response.json();
    if (result.localOnly !== true || result.chainId !== 31337 || result.productionAuthority !== false) throw new Error('INVALID_LOCAL_RECEIPT');
    if (sequence !== request) return;
    if (result.snapshot?.localOnly === true && result.snapshot.chainId === 31337 && result.snapshot.canBurn === false && result.snapshot.productionReadyCount === 0) render(result.snapshot);
    else await load(data.tokenId);
    $('#status').textContent = `Confirmed ${operation} for LOCAL Punk #${data.tokenId}. Test transaction ${result.transactionHash}. No production changes.`;
  } catch {
    if (sequence === request) { await load(data.tokenId); $('#status').textContent = 'Local action was not confirmed. State refreshed; inspect history before retrying. No production action exists.'; }
  } finally { trainingBusy = false; }
}
function filterSkills() {
  const cards = [...$('#skills').children];
  for (const card of cards) card.hidden = !(skillFilter === 'all' || (skillFilter === 'learned' ? card.classList.contains('learned') : card.dataset.category === skillFilter));
  const count = cards.filter(card => !card.hidden).length;
  $('#skill-count').textContent = `${count} of ${cards.length} entries · 0 production learnable${count === 0 ? ' · No skills in this view for this Punk.' : ''}`;
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === skillFilter)));
}
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { skillFilter = button.dataset.filter; filterSkills(); }));
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
  $('#detail-action').disabled = true; $('#detail-action').onclick = null;
  $('#detail-action').textContent = 'PRODUCTION TRAINING DISABLED';
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
  let floor = $('#forge-floor');
  if (!floor) { floor = element('p', undefined, 'target-strip'); floor.id = 'forge-floor'; $('#training-title').after(floor); }
  floor.textContent = `FORGE SUPPLY FLOOR: ${Number(data.forgeMinimumSupply).toLocaleString('en-US')} PUNKS · not deployed. Live supply not checked in this preview. Direct collection burns are outside this guard.`;
  let practice = $('#local-practice');
  if (!practice) { practice = element('div', undefined, 'panel'); practice.id = 'local-practice'; $('#training-title').after(practice); }
  const unlock = element('button', 'UNLOCK ONE SLOT · LOCAL TEST · 1 CREDIT'); unlock.type = 'button'; unlock.id = 'local-unlock';
  unlock.disabled = BigInt(data.credits) < 1n || data.slots >= data.cap;
  unlock.addEventListener('click', () => localTraining(data, 'unlock'));
  practice.replaceChildren(element('h3', 'PRACTICE ON TEST PUNKS'), element('p', 'Local learning and loadout changes are real transactions on a disposable Anvil chain. No MetaMask, real NFT, real funds or production capability is involved. Learn a supported fixture from its detail card.'), unlock);
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
    const node = element('div', undefined, `slot ${skill ? 'active' : locked ? 'locked' : 'empty'}`);
    const socket = element('div', undefined, 'equipment-socket');
    socket.append(equipmentIcon(skill?.name || '', locked));
    const level = data.learned.find(item => item.key === skill?.key)?.level;
    if (skill) socket.append(element('span', level == null ? 'EQUIPPED' : `LV ${level}`, 'equipment-level'));
    node.append(element('span', `SLOT 0${index + 1}`, 'slot-label'), socket,
      element('strong', skill?.name || (locked ? 'LOCKED' : 'EMPTY SLOT')),
      element('small', skill ? 'Equipped · local fixture' : locked ? '1 credit to unlock · local' : 'Equip a learned skill'));
    if (!locked) {
      const change = element('button', skill ? 'CHANGE · LOCAL' : 'EQUIP · LOCAL'); change.type = 'button'; change.dataset.loadoutSlot = index;
      change.setAttribute('aria-label', `${skill ? 'Change' : 'Equip'} skill in local slot ${index + 1}${skill ? `: ${skill.name}` : ''}`);
      change.addEventListener('click', () => {
        detail(`LOCAL SLOT ${index + 1}`, 'LOADOUT PRACTICE · CHAIN 31337', ['Only already-learned test skills can be equipped. This does not authorize a live mint.'], []);
        for (const learned of data.learned) {
          const candidate = data.skills.find(item => item.key === learned.key);
          if (!candidate) continue;
          const choice = element('button', `EQUIP ${candidate.name.toUpperCase()} · LOCAL`); choice.type = 'button';
          choice.disabled = data.equipped.includes(candidate.key);
          choice.addEventListener('click', () => localTraining(data, 'equip', { slot: index, key: candidate.key }));
          $('#detail-body').append(choice);
        }
        if (skill) {
          const clear = element('button', 'UNEQUIP · LOCAL'); clear.type = 'button';
          clear.addEventListener('click', () => localTraining(data, 'unequip', { slot: index })); $('#detail-body').append(clear);
        }
        if (!data.learned.length) $('#detail-body').append(element('p', 'No learned test skills yet.'));
      });
      node.append(change);
    }
    return node;
  }));
  $('#skills').replaceChildren(...data.skills.map(skill => {
    const learned = data.learned.find(item => item.key === skill.key);
    const card = element('article', undefined, `skill ${learned ? 'learned' : ''}`);
    card.dataset.category = skill.category; card.dataset.skill = skill.id;
    const top = element('div', undefined, 'skill-top'); top.append(element('span', skill.mark, 'skill-number'), element('span', skill.comingSoon ? `COMING SOON · ${skill.status.replaceAll('_', ' ')}` : skill.status, 'skill-status'));
    card.append(top, element('h3', skill.name), element('p', learned ? `LEARNED · LEVEL ${learned.level} · LOCAL FIXTURE` : skill.comingSoon ? 'NOT LEARNABLE YET' : 'NOT LEARNED', 'learned-label'), element('p', skill.description, 'description'));
    const button = element('button', 'INSPECT CAPABILITY ↗'); button.type = 'button';
    button.addEventListener('click', () => {
      detail(skill.name.toUpperCase(), `PRODUCTION STATUS · ${skill.status}`, [skill.description, skill.boundary], [
      ['PROPOSED TOOLS', skill.tools.length ? skill.tools.join(' · ') : 'No approved tool mapping yet'], ['CAPABILITY', skill.capability], ['VERSION', skill.version ? `${skill.version} · disposable local fixture, not a registered production package` : 'Unregistered roadmap candidate'], ['MANIFEST HASH · LOCAL FIXTURE', skill.manifestHash ?? 'Not registered'], ['INSTRUCTION HASH · LOCAL FIXTURE', skill.instructionHash ?? 'Not registered'], ['SOURCE / EVIDENCE', skill.source], ['STILL REQUIRED', skill.missing], ['READINESS', 'No production learning or live tool execution. Local test readiness is not production acceptance.'],
      ]);
      if (skill.sourceUrl) { const source = element('a', 'INSPECT PINNED UPSTREAM SOURCE ↗'); source.href = skill.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; $('#detail-body').append(source); }
      if (!learned && [2, 3, 4].includes(skill.id) && BigInt(data.credits) > 0n) {
        $('#detail-action').disabled = false;
        $('#detail-action').textContent = 'LEARN LOCAL FIXTURE · 1 TEST CREDIT';
        $('#detail-action').onclick = () => localTraining(data, 'learn', { key: skill.key });
      }
      if (skill.id === 2) {
        const model = sniperMissionPreview({ learned: Boolean(learned), equipped: data.equipped.includes(skill.key) });
        const section = element('section', undefined, 'sniper-options');
        section.append(element('h3', 'CHOOSE YOUR MISSION'), element('p', model.canChoose ? `Local Punk #${data.tokenId} learned Sniper. Both mission templates are unlocked for preview.` : 'Unlock Sniper to choose either mission. Local Punk #7 demonstrates the learned state.'), element('p', model.equipmentNote));
        const output = element('div', undefined, 'sniper-prompt'); output.setAttribute('role', 'status');
        for (const option of model.options) {
          const choice = element('button', option.name); choice.type = 'button'; choice.dataset.mission = option.id;
          choice.disabled = !model.canChoose; choice.setAttribute('aria-pressed', 'false');
          choice.addEventListener('click', () => {
            section.querySelectorAll('[data-mission]').forEach(item => item.setAttribute('aria-pressed', String(item === choice)));
            output.replaceChildren(element('h3', option.name), element('p', option.description), element('p', option.requires), element('p', 'EXAMPLE CHAT REQUEST · FILL IN YOUR LIMITS', 'eyebrow'), element('p', option.prompt), element('p', 'PREVIEW ONLY — no mission was sent, no signature requested, no transaction prepared.'));
          });
          section.append(choice);
        }
        section.append(output); $('#detail-body').prepend(section);
      }
    });
    if (skill.id === 2) button.textContent = learned ? 'CHOOSE SNIPER MISSION ↗' : 'INSPECT BOTH MISSIONS ↗';
    card.append(button); return card;
  }));
  filterSkills();
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
