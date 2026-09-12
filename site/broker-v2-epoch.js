// Reusable read-only receipt roster. Never adds wrapped IDs to legacy spending controls.
export function createEpochControl(root, { getOwner, readRoster, readProfile }) {
  let generation = 0, selected = null, rosterWrapper = null;
  const heading = document.createElement('h3'); heading.textContent = 'SESSION RECEIPT PUNKS';
  const info = document.createElement('p'); info.textContent = 'A separate, opt-in account path. Training follows the Punk; old wallet controls do not migrate. Viewing a profile may request a wallet-login signature, never a transaction signature.';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'RECHECK RECEIPT OWNERSHIP';
  const notice = document.createElement('p'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const roster = document.createElement('div'); roster.className = 'epoch-roster';
  const detail = document.createElement('div'); detail.className = 'epoch-profile';
  root.replaceChildren(heading, info, refresh, notice, roster, detail);
  const current = (n, owner) => n === generation && owner?.toLowerCase() === getOwner()?.toLowerCase();
  async function show(tokenId) {
    const owner = getOwner(), n = ++generation; selected = tokenId; detail.replaceChildren();
    notice.textContent = 'Verifying profile and current owner…';
    try {
      const result = await readProfile(tokenId);
      if (!current(n, owner)) return;
      const p = result.profile;
      if (!result.ok || !p || p.tokenId !== tokenId || p.owner?.toLowerCase() !== owner.toLowerCase()
        || p.chainId !== 4663 || p.collection?.toLowerCase() !== '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
        || !rosterWrapper || p.wrapper?.toLowerCase() !== rosterWrapper.toLowerCase()) throw Error('PROFILE_OWNER_MISMATCH');
      for (const text of [`PUNK #${p.tokenId} · ${p.wrapped ? 'SESSION RECEIPT' : 'ORIGINAL PUNK'} · EPOCH ${p.epoch}`,
        `${p.training.credits} training credits · ${p.training.learned.length} learned · ${p.training.slots}/${p.training.cap} slots`,
        `New agent account: ${p.agentAccount} · ${p.accountCreated ? 'CREATED' : 'NOT CREATED'}`,
        `Session: ${p.sessionActive ? 'ACTIVE AT SNAPSHOT' : 'INACTIVE — NEW OWNER APPROVAL REQUIRED'}`,
        `Legacy wallet: ${p.legacyWalletOwnerAccess ? 'Original ownership restored; check legacy controls separately.' : 'Direct owner access requires unwrapping.'}`,
        `Verified block ${p.blockNumber}. This snapshot is not transaction approval.`]) {
        const row = document.createElement('p'); row.textContent = text; detail.append(row);
      }
      const warning = document.createElement('p'); warning.textContent = 'ENROLLMENT LOCKED · No asset migration, transaction signature, burn or spending permission is created here.'; detail.append(warning);
      for (const reason of result.enrollment?.warnings ?? []) { const row = document.createElement('p'); row.textContent = reason; detail.append(row); }
      notice.textContent = 'Current owner and permanent progression verified.';
    } catch {
      if (!current(n, owner)) return;
      detail.replaceChildren(); notice.textContent = 'Profile unavailable or owner changed. No stale profile or approval is retained.';
    }
  }
  async function load() {
    const owner = getOwner(), n = ++generation; selected = null; rosterWrapper = null; roster.replaceChildren(); detail.replaceChildren();
    if (!owner) { notice.textContent = 'Connect your owner wallet to check session receipts.'; return; }
    notice.textContent = 'Checking the on-chain receipt roster…';
    try {
      const result = await readRoster(owner);
      if (!current(n, owner)) return;
      if (!result.ok || !result.complete || result.owner?.toLowerCase() !== owner.toLowerCase() || !Array.isArray(result.tokenIds)) throw Error('INVALID_ROSTER');
      if (!result.enabled) { notice.textContent = 'NOT DEPLOYED · Production wrapping and enrollment remain locked. Existing Punk accounts are unchanged.'; return; }
      if (result.chainId !== 4663 || result.collection?.toLowerCase() !== '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
        || !/^0x[0-9a-f]{40}$/i.test(result.wrapper ?? '') || new Set(result.tokenIds).size !== result.tokenIds.length) throw Error('INVALID_ROSTER');
      rosterWrapper = result.wrapper;
      notice.textContent = result.tokenIds.length ? 'Select a receipt-owned Punk. This roster has no legacy-wallet spending controls.' : 'No session receipt Punks owned at this snapshot.';
      for (const id of result.tokenIds) {
        if (!/^(0|[1-9]\d{0,3})$/.test(id)) throw Error('INVALID_TOKEN');
        const button = document.createElement('button'); button.type = 'button'; button.textContent = `PUNK #${id}`;
        button.dataset.epochPunk = id; button.addEventListener('click', () => void show(id)); roster.append(button);
      }
    } catch {
      if (!current(n, owner)) return;
      roster.replaceChildren(); notice.textContent = 'Receipt ownership could not be verified. Refresh to retry; unavailable is not zero.';
    }
  }
  refresh.addEventListener('click', () => void load());
  return { refresh: load, invalidate() { ++generation; selected = null; rosterWrapper = null; roster.replaceChildren(); detail.replaceChildren(); notice.textContent = 'Owner or chain changed. Recheck receipt ownership.'; }, get selected() { return selected; } };
}
