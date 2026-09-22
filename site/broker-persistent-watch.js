// Logical watching is independent of a bounded wallet mint permission.
const copy = value => structuredClone(value);
const identityKey = value => value ? `${value.chainId}:${value.context}:${value.tokenId}:${value.owner?.toLowerCase()}:${value.sessionVersion ?? ''}` : '';
const validIdentity = value => value?.chainId === 4663 && ['PRODUCTION', 'DEPLOY_PREVIEW'].includes(value.context)
  && typeof value.tokenId === 'string' && /^[1-9][0-9]{0,3}$/.test(value.tokenId) && Number(value.tokenId) <= 5016
  && typeof value.owner === 'string' && /^0x[0-9a-f]{40}$/i.test(value.owner)
  && value.owner.toLowerCase() !== `0x${'0'.repeat(40)}` && value.sessionVersion !== undefined;
export function persistentEthToWei(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,18})?$/.test(value.trim())) throw Error('Enter an ETH amount with up to 18 decimal places.');
  const [whole, decimal = ''] = value.trim().split('.');
  return (BigInt(whole) * 10n ** 18n + BigInt(decimal.padEnd(18, '0'))).toString();
}
export function persistentWeiToEth(value = '0') {
  const amount = BigInt(value), fraction = (amount % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${amount / 10n ** 18n}${fraction ? `.${fraction}` : ''}`;
}
export function createPersistentWatchController({ request, onChange = () => {} }) {
  let identity = null, revision = 0, destroyed = false;
  let state = { loading: false, data: null, draft: null, editConfig: null, error: null, notice: null };
  const emit = () => { if (!destroyed) onChange(copy(state)); };
  async function run(body = null) {
    if (destroyed || !identity || state.loading) return false;
    const captured = revision, key = identityKey(identity), token = identity.tokenId;
    state = { ...state, loading: true, error: null, notice: null }; emit();
    try {
      const result = await request(`/api/v2/punks/${encodeURIComponent(token)}/persistent-watch`,
        { method: body ? 'POST' : 'GET', ...(body ? { body } : {}) });
      if (destroyed || revision !== captured || key !== identityKey(identity)) return false;
      if (!result || result.ok !== true || result.tokenId !== token) throw Error(result?.message || result?.error || 'Watching could not be refreshed. Try again.');
      if (body?.action === 'prepare') state.draft = result.draft;
      else if (body) {
        state.draft = null;
        state.data = { ...state.data, watch: result.watch, status: null };
        state.notice = body.action === 'pause' ? 'Watching paused. Existing wallet mint permissions are unchanged.'
          : 'Your taste is saved. Watching is active; wallet spending permissions are unchanged.';
      } else state.data = result;
      return true;
    } catch (error) {
      if (!destroyed && revision === captured) state.error = error instanceof Error ? error.message : 'Watching could not be updated. Refresh before trying again.';
      return false;
    } finally {
      if (!destroyed && revision === captured) { state.loading = false; emit(); }
    }
  }
  return {
    setIdentity(value) {
      revision++; identity = validIdentity(value) ? copy(value) : null;
      state = { loading: false, data: null, draft: null, editConfig: null, error: null, notice: null }; emit();
    },
    refresh: () => run(),
    prepare: config => { state.editConfig = copy(config); return run({ action: 'prepare', config, expectedVersion: state.data?.watch?.version ?? 0 }); },
    confirm: () => state.draft ? run({ action: 'confirm', draftId: state.draft.draftId }) : Promise.resolve(false),
    pause: () => state.data?.watch ? run({ action: 'pause', expectedVersion: state.data.watch.version }) : Promise.resolve(false),
    discardDraft() { state.draft = null; emit(); },
    getState: () => copy(state),
    destroy() { destroyed = true; revision++; identity = null; },
  };
}
const DEFAULTS = { schema: 'GOGH_PERSISTENT_WATCH_CONFIG_V1', likes: [], dislikes: [], maximumSupply: 2000,
  requireWebsite: true, requireX: true, freeOnly: true, maxMintPriceWei: '0', maxGasWei: '500000000000000',
  reserveWei: '10000000000000000', dailySpendWei: '3000000000000000', dailyCollectionLimit: 3, expiresAt: null };
const REASONS = {
  TASTE_NOT_MATCHED: 'Different art style', EXCLUDED_STYLE: 'A style you excluded', SUPPLY_OUTSIDE_RULES: 'Supply outside your rules',
  WEBSITE_REQUIRED: 'Website missing', X_REQUIRED: 'X account missing', MINT_PRICE_LIMIT: 'Mint price above your limit',
  WAITING_FOR_WINDOW: 'Mint has not opened', OPPORTUNITY_EXPIRED: 'Mint has ended', SECURITY_SCREEN_REQUIRED: 'Security review needed',
  SIMULATION_FAILED: 'The available simulation failed', EQUIPPED_PAID_MINT_LICENSE_REQUIRED: 'Paid Mint License must be learned and equipped',
  WATCH_DAILY_LIMIT_REACHED: 'Daily limit reached',
  EQUIPPED_MINT_HUNTER_REQUIRED: 'Mint Hunter must be learned and equipped', EXECUTION_RELEASE_BLOCKED: 'Collecting needs the approved mint flow',
  DAILY_USAGE_UNVERIFIED: 'Spending and collection totals need checking', DAILY_SPEND_LIMIT: 'Daily spending limit reached',
  DAILY_COLLECTION_LIMIT: 'Daily collection limit reached', GAS_REVIEW_REQUIRED: 'Gas estimate needs checking',
  AVAILABLE_BUDGET_LIMIT: 'Available budget needs checking', EXISTING_EXECUTOR_REVIEW_REQUIRED: 'A fresh mint review is required',
  WATCH_SESSION_REVIEW_REQUIRED: 'Wallet mint permission needs review', WATCH_RESERVE_REACHED: 'Reserve reached',
  WATCH_PERMISSION_UNVERIFIED: 'Wallet permission could not be checked', WATCH_BALANCE_UNVERIFIED: 'Balance could not be checked',
};
export function mountPersistentWatch({ root, request, onReviewPermission = null, onFund = null }) {
  const document = root.ownerDocument;
  let identity = null, destroyed = false;
  const el = (tag, text, className) => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
    if (className) node.className = className; return node;
  };
  const controller = createPersistentWatchController({ request, onChange: render });
  const button = (text, callback, disabled = false) => {
    const node = el('button', text); node.type = 'button'; node.disabled = disabled;
    node.addEventListener('click', callback); return node;
  };
  async function changed(action) { if (await action()) await controller.refresh(); }
  function render(state) {
    if (destroyed) return;
    root.replaceChildren(); root.classList.add('persistent-watch');
    const heading = el('h3', identity ? `Punk #${identity.tokenId} · Keep looking` : 'Keep looking'); root.append(heading);
    if (!identity) { root.append(el('p', 'Connect your wallet and select a Punk to save its collecting taste.')); return; }
    root.append(el('p', 'Set your taste once. Your Punk keeps reviewing shared discoveries until you pause it.'));
    const status = state.data?.status;
    const stateName = status?.watching ? 'OUT LOOKING' : status?.state === 'SAFETY_BLOCKED' || status?.state === 'OWNER_ACTION_REQUIRED' ? 'WATCHING NEEDS REVIEW'
      : state.data?.watch?.state === 'ACTIVE' && !status ? 'WATCHING ACTIVATED' : 'WATCHING PAUSED';
    const statusLine = el('p', state.loading ? 'Checking your Punk…' : stateName, 'persistent-watch-status'); statusLine.setAttribute('role', 'status'); root.append(statusLine);
    if (status?.message) root.append(el('p', status.message));
    root.append(el('p', 'Watching does not grant or renew permission to spend. Collecting still needs an approved wallet mint permission and every safety check.', 'persistent-watch-note'));
    if (state.error) { const error = el('p', state.error, 'persistent-watch-error'); error.setAttribute('role', 'alert'); root.append(error); }
    if (state.notice) root.append(el('p', state.notice, 'persistent-watch-notice'));
    const actions = el('div', undefined, 'persistent-watch-actions');
    actions.append(button('Refresh status', () => controller.refresh(), state.loading));
    if (state.data?.watch?.state === 'ACTIVE') actions.append(button('Pause watching', () => changed(controller.pause), state.loading));
    if (status?.action === 'FUND' && onFund) actions.append(button('Fund Punk', () => onFund(copy(identity)), state.loading));
    if (status?.action === 'REVIEW_PERMISSION' && onReviewPermission) actions.append(button('Review mint permission', () => onReviewPermission(copy(identity)), state.loading));
    root.append(actions);
    if (!state.data) return;
    if (state.draft) {
      const review = el('section', undefined, 'persistent-watch-review'); review.append(el('h4', 'Review your Punk’s taste and limits'));
      const c = state.draft.config;
      review.append(el('p', `Likes: ${c.likes.join(', ') || 'All styles'}. Avoids: ${c.dislikes.join(', ') || 'None selected'}.`));
      review.append(el('p', `Supply: ${c.maximumSupply ?? 'Any'}. ${c.freeOnly ? 'Free mints only.' : `Mint price up to ${persistentWeiToEth(c.maxMintPriceWei)} ETH.`}`));
      review.append(el('p', `Reserve: ${persistentWeiToEth(c.reserveWei)} ETH. Daily spending limit: ${persistentWeiToEth(c.dailySpendWei)} ETH. Daily collection limit: ${c.dailyCollectionLimit}.`));
      review.append(el('p', `Gas per mint: up to ${persistentWeiToEth(c.maxGasWei)} ETH. Website ${c.requireWebsite ? 'required' : 'optional'}. X account ${c.requireX ? 'required' : 'optional'}.`));
      review.append(el('p', c.expiresAt ? `Watch until ${new Date(c.expiresAt).toLocaleString()}.` : 'Keep watching until paused.'));
      review.append(el('p', 'These are saved research rules. Existing wallet permissions remain unchanged. No transaction or payment is submitted.'));
      review.append(button('Confirm · activate watching', () => changed(controller.confirm), state.loading), button('Back to settings', () => controller.discardDraft(), state.loading));
      root.append(review); return;
    }
    const detail = el('details'); detail.open = !state.data.watch;
    detail.append(el('summary', state.data.watch ? 'Edit taste and limits' : 'Set up continuous watching'));
    const form = el('form', undefined, 'persistent-watch-form'), c = state.editConfig ?? state.data.watch?.config ?? DEFAULTS, fields = {};
    function field(name, label, value, type = 'text') {
      const wrap = el('label', label), input = el('input'); input.type = type; input.name = name;
      if (type === 'checkbox') input.checked = value; else input.value = String(value);
      input.disabled = state.loading; fields[name] = input; wrap.append(input); form.append(wrap); return input;
    }
    field('likes', 'Art you like · separate with commas', c.likes.join(', ')).maxLength = 780;
    field('dislikes', 'Art to avoid · separate with commas', c.dislikes.join(', ')).maxLength = 780;
    field('maximumSupply', 'Maximum collection size · leave empty for any', c.maximumSupply ?? '', 'number').min = '1';
    field('freeOnly', 'Free mints only', c.freeOnly, 'checkbox');
    for (const [name, label] of [['maxMintPriceWei', 'Maximum mint price · ETH'], ['maxGasWei', 'Maximum gas per mint · ETH'],
      ['reserveWei', 'Keep this much untouched · ETH'], ['dailySpendWei', 'Daily spending limit · ETH']]) {
      const input = field(name, label, persistentWeiToEth(c[name])); input.inputMode = 'decimal';
    }
    const count = field('dailyCollectionLimit', 'Daily collection limit', c.dailyCollectionLimit, 'number'); count.min = '1'; count.max = '20';
    field('requireWebsite', 'Require a website', c.requireWebsite, 'checkbox'); field('requireX', 'Require an X account', c.requireX, 'checkbox');
    const durationWrap = el('label', 'Keep watching'), duration = el('select'); duration.name = 'duration';
    for (const [value, label] of [['KEEP', c.expiresAt ? 'Keep current end date' : 'Until paused'], ['FOREVER', 'Until paused'], ['DAY', 'For 24 hours'], ['WEEK', 'For 7 days']]) {
      const option = el('option', label); option.value = value; duration.append(option);
    }
    duration.disabled = state.loading; durationWrap.append(duration); form.append(durationWrap);
    const feedback = el('p'); feedback.setAttribute('role', 'alert'); form.append(feedback);
    const submit = el('button', 'Review watching settings'); submit.type = 'submit'; submit.disabled = state.loading; form.append(submit);
    form.addEventListener('submit', event => {
      event.preventDefault(); if (state.loading) return;
      try {
        const next = { ...c, likes: fields.likes.value.split(',').map(x => x.trim()).filter(Boolean),
          dislikes: fields.dislikes.value.split(',').map(x => x.trim()).filter(Boolean),
          maximumSupply: fields.maximumSupply.value.trim() ? Number(fields.maximumSupply.value) : null,
          dailyCollectionLimit: Number(fields.dailyCollectionLimit.value), freeOnly: fields.freeOnly.checked,
          requireWebsite: fields.requireWebsite.checked, requireX: fields.requireX.checked };
        for (const key of ['maxMintPriceWei', 'maxGasWei', 'reserveWei', 'dailySpendWei']) next[key] = persistentEthToWei(fields[key].value);
        if (next.freeOnly) next.maxMintPriceWei = '0';
        if (duration.value === 'FOREVER') next.expiresAt = null;
        else if (duration.value === 'DAY' || duration.value === 'WEEK') next.expiresAt = new Date(Date.now() + (duration.value === 'DAY' ? 1 : 7) * 86400000).toISOString();
        controller.prepare(next);
      } catch (error) { feedback.textContent = error.message; }
    });
    detail.append(form); root.append(detail);
    if (state.data.summary) {
      const { reviewed, matched, passed } = state.data.summary;
      root.append(el('p', `Today · UTC: ${reviewed} reviewed · ${matched} taste matches · ${passed} passed. These are research observations, not completed mints.`, 'persistent-watch-note'));
    }
    const history = (state.data.history ?? []).filter(x => x.status === 'DONE' && x.result).slice(0, 5);
    if (history.length) {
      const list = el('ul', undefined, 'persistent-watch-history');
      for (const entry of history) {
        const result = entry.result, item = el('li'); item.append(el('strong', `${result.matchesTaste ? 'Taste match' : 'Passed'} · ${result.collectionName}`));
        item.append(el('p', `Reviewed ${new Date(entry.createdAt).toLocaleString()}. ${result.reasons.map(reason => REASONS[reason] ?? 'Fresh review required').join('. ')}. No transaction submitted by watching.`));
        list.append(item);
      }
      root.append(list);
    } else root.append(el('p', 'Your next shared discoveries will appear here. You do not need to send your Punk out again.'));
  }
  return {
    setIdentity(value) { identity = validIdentity(value) ? copy(value) : null; controller.setIdentity(identity); if (identity) return controller.refresh(); },
    refresh: controller.refresh,
    destroy() { destroyed = true; controller.destroy(); root.replaceChildren(); },
  };
}
