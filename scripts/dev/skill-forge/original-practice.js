if (location.hostname !== '127.0.0.1' || location.protocol !== 'http:') throw Error('Local practice only.');
const $ = id => document.getElementById(id);
const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
let snapshot = null, busy = false, reviewId = null;
const names = { ENABLE_FORGE: 'Enable copied Forge', APPROVE: 'Approve copy #1753',
  BURN: 'Sacrifice copy #1753 → credit copy #93', learn: 'Learn Rarity Eye', equip: 'Equip Rarity Eye in slot 1',
  unequip: 'Unequip Rarity Eye', claim_rarity: 'Claim copied Punk’s starting slots', unlock: 'Unlock another slot' };
const messages = {
  FORGE_TRAINING_NO_CREDIT: 'No credit is available. Learning used the credit earned by this sacrifice. Another slot requires another source Punk.',
  SKILL_TOOL_DENIED: 'Equip Rarity Eye before using it.',
  BURN_SOURCE_ASSETS_OR_ACTIVITY: 'A source wallet has assets or activity. No sacrifice was submitted.',
  BURN_SOURCE_TOKEN_RECEIPT_FOUND: 'Standard token transfers were found for the source wallets. No sacrifice was submitted.',
  FORGE_TRAINING_REVIEW_EXPIRED: 'The review needs refreshing. Refresh progress to check the saved step before continuing.',
  BURN_REVIEW_EXPIRED: 'The copied chain could not verify a current review. Refresh progress to check the saved step before continuing.',
  PRACTICE_UNSENT_REVIEW_REQUIRED: 'This step may have reached the copied chain. Refresh progress to check the original transaction.',
  PRACTICE_REVIEW_UNAVAILABLE: 'The saved review could not be verified. Refresh progress before trying another step.',
  PRACTICE_CHECK_UNAVAILABLE: 'A practice read could not finish. Refresh progress to recover the saved step.',
};
const eth = value => { const n = BigInt(value), f = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, ''); return `${n / 10n ** 18n}${f ? '.' + f : ''} ETH`; };
function button(parent, label, operation, input, disabled = false) {
  const node = el('button', label); node.type = 'button'; node.disabled = busy || disabled;
  node.onclick = () => run(operation, input); parent.append(node);
}
function render() {
  if (!snapshot) return;
  const s = snapshot.training, r = snapshot.review;
  const active = r && !['CONFIRMED', 'SETTLED_SUCCESS', 'CANCELLED'].includes(r.status);
  const expired = r && (r.status === 'EXPIRED' || Date.now() >= r.expiresAt);
  const needsRefresh = r && (expired || Date.now() + 5000 >= r.expiresAt);
  const unsent = r?.canDiscardUnsent === true;
  $('stats').replaceChildren();
  for (const [value, label] of [[s.credits, 'TRAINING CREDITS'], [s.slots, 'UNLOCKED SLOTS'], [s.skills.filter(x => x.level > 0).length, 'LEARNED SKILLS']]) {
    const div = el('div'); div.append(el('strong', String(value)), el('span', label)); $('stats').append(div);
  }
  $('coverage').textContent = snapshot.sourceCoverage; $('burn-actions').replaceChildren();
  if (snapshot.burn.credited) $('burn-actions').append(el('p', 'Copy #1753 was sacrificed. Copy #93 earned exactly one credit.'));
  else if (snapshot.burn.paused) button($('burn-actions'), 'Review enabling copied Forge', 'prepare_burn', { action: 'ENABLE_FORGE' }, active);
  else if (snapshot.burn.approved === null || /^0x0+$/.test(snapshot.burn.approved)) button($('burn-actions'), 'Review approval for copy #1753', 'prepare_burn', { action: 'APPROVE' }, active);
  else button($('burn-actions'), 'Review copied sacrifice', 'prepare_burn', { action: 'BURN' }, active);
  $('training-actions').replaceChildren(); $('slot-actions').replaceChildren();
  const skill = s.skills[0], equipped = s.equipped.includes(skill.key);
  button($('training-actions'), 'Learn · 1 credit', 'prepare_training', { action: { operation: 'learn' } }, active || skill.level > 0 || BigInt(s.credits) < 1n || !skill.available);
  button($('training-actions'), equipped ? 'Unequip skill' : 'Equip in slot 1', 'prepare_training', { action: { operation: equipped ? 'unequip' : 'equip' } }, active || skill.level !== 1 || !skill.available);
  if (s.claimed === 0) button($('slot-actions'), 'Claim starting slots', 'prepare_training', { action: { operation: 'claim_rarity' } }, active);
  button($('slot-actions'), 'Unlock slot · 1 credit', 'prepare_training', { action: { operation: 'unlock' } }, active || s.claimed === 0 || s.slots >= 7 || BigInt(s.credits) < 1n);
  $('loadout').textContent = `Rarity Eye: ${equipped ? 'equipped and usable' : skill.level === 1 ? 'learned; equip it to use it' : 'not learned yet'}.`;
  $('next-step').textContent = active ? (!unsent ? 'Next: refresh progress to check the original transaction before continuing.' : needsRefresh ? 'Next: discard the expired review, then choose your next step.' : 'Next: finish or discard the review below before starting another step.')
    : equipped ? 'Next: use Rarity Eye to compare the three copied Punks.'
      : skill.level === 1 ? 'Next: equip Rarity Eye in slot 1.'
        : BigInt(s.credits) > 0n ? 'Next: learn Rarity Eye using your credit.'
          : snapshot.burn.credited ? 'The copied sacrifice is complete. Check your learned skill below.'
            : 'Next: approve copy #1753, then sacrifice it to earn the credit. Extra slots are optional.';
  $('research').disabled = busy || active || !equipped; $('refresh').disabled = busy; $('review-panel').hidden = !active;
  if (active) {
    if (reviewId !== r.id) { reviewId = r.id; $('ack').checked = false; $('confirmation').value = ''; }
    $('review-title').textContent = names[r.action];
    $('review-fee').textContent = `Maximum practice network fee: ${eth(r.feeCeilingWei)}. No real ETH is spent.`;
    $('review-expiry').textContent = unsent && needsRefresh
      ? `${expired ? 'This review expired.' : 'This review has too little time left.'} Nothing was submitted. Discard it to continue; no transaction will be sent.`
      : r.status === 'PREPARED' ? `Review ready for ${Math.max(0, Math.ceil((r.expiresAt - Date.now()) / 1000))} more seconds. Confirm before it expires.`
        : 'Submission reserved. Refresh progress to check the original transaction. It will not be sent again.';
    $('review-fields').hidden = needsRefresh || r.status !== 'PREPARED';
    $('confirmation-label').textContent = r.action === 'BURN' ? 'Type BURN COPY 1753' : 'Type CONFIRM COPY';
    $('cancel').textContent = needsRefresh && unsent ? 'Discard expired review' : 'Cancel unsent review';
    $('cancel').disabled = busy || !unsent;
  }
  $('confirm').hidden = Boolean(active && needsRefresh && unsent);
  $('confirm').disabled = busy || !active || r.status !== 'PREPARED' || needsRefresh || !$('ack').checked || $('confirmation').value !== (r.action === 'BURN' ? 'BURN COPY 1753' : 'CONFIRM COPY');
}
async function run(operation, input = {}) {
  if (busy) return; busy = true;
  // A missing response cannot prove a claim failed. Retire the stale PREPARED
  // display before contacting the server; only a fresh record can restore it.
  if (['confirm', 'cancel'].includes(operation) && snapshot?.review)
    snapshot = { ...snapshot, review: { ...snapshot.review, status: 'CHECKING', canDiscardUnsent: false } };
  render();
  $('status').textContent = operation === 'confirm' ? 'Submitting your confirmed practice step and checking its receipt…' : 'Checking the copied Punks…';
  try {
    const response = await fetch('/api/practice', operation ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-nonce': snapshot.nonce }, body: JSON.stringify({ operation, input }) } : {});
    const value = await response.json();
    if (!response.ok) throw Error(value.code ?? 'PRACTICE_CHECK_UNAVAILABLE');
    if (value.schema !== 'GOGH_ORIGINAL_FORGE_INTERACTIVE_PRACTICE_V1' || value.localOnly !== true || value.productionAuthority !== false || value.sourceTokenId !== '1753' || value.targetTokenId !== '93') throw Error('PRACTICE_CHECK_UNAVAILABLE');
    snapshot = value; render();
    $('status').textContent = operation === 'cancel' ? 'Unsent review discarded. Choose your next step; nothing was submitted.'
      : value.review?.status === 'EXPIRED' ? 'The unsent review expired. Discard it below to continue.'
        : value.review?.status === 'PREPARED' ? 'Review ready. Nothing has been submitted.'
          : value.lastResult?.confirmed ? `${names[value.lastResult.action]} confirmed on the disposable chain.` : 'Practice state refreshed. Your original Punks are unchanged.';
    if (value.lastResult?.result) {
      const result = value.lastResult.result; $('result').replaceChildren(el('h3', 'Trait comparison complete'), el('p', `${result.sampleSize} copied Punks compared. Unequip Rarity Eye to see this capability become unavailable.`));
      if (result.ranked?.length) { const list = el('ul'); for (const item of result.ranked) list.append(el('li', `Sample rank ${item.rank} · Punk #${item.tokenId} · score ${item.score}`)); $('result').append(list); }
    }
    if (operation === 'prepare_burn' || operation === 'prepare_training') $('review-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { $('status').textContent = operation === 'confirm'
    ? 'The confirmation result could not be verified. Refresh progress to check the original step before continuing.'
    : messages[error.message] ?? `${error.message.replaceAll('_', ' ').toLowerCase()}. Refresh progress before trying another step.`; }
  finally { busy = false; render(); }
}
$('refresh').onclick = () => run(snapshot ? 'recheck' : undefined);
$('research').onclick = () => run('research');
$('cancel').onclick = () => run('cancel', { id: snapshot.review.id });
$('confirm').onclick = () => run('confirm', { id: snapshot.review.id, confirmation: $('confirmation').value, acknowledged: $('ack').checked });
$('ack').onchange = render; $('confirmation').oninput = render;
setInterval(render, 1000); await run();
