// Browser preferences never authorize a strategy, a wallet request or a mission.
const LABELS = Object.freeze({ AUTO: 'Auto · choose for this task', GEMINI: 'Gemini',
  OPENAI: 'GPT', ANTHROPIC: 'Claude', XAI: 'Grok', BANKR: 'Bankr', GROQ: 'Groq · GPT OSS' });
export const validProviderPreference = value => Object.hasOwn(LABELS, value) ? value : 'AUTO';
function ownerKey(context) {
  return context?.chainId === 4663 && /^0x[0-9a-f]{40}$/i.test(context.owner ?? '')
    ? `gogh-v2-preferences:4663:${context.owner.toLowerCase()}` : null;
}
export function readBrokerPreferences(context, storage) {
  try {
    const key = ownerKey(context), value = key && JSON.parse(storage?.getItem(key) ?? '{}');
    return { provider: validProviderPreference(value?.provider), welcomed: value?.welcomed === true };
  } catch { return { provider: 'AUTO', welcomed: false }; }
}
export function saveBrokerPreferences(context, patch, storage) {
  const key = ownerKey(context);
  if (!key) return false;
  const previous = readBrokerPreferences(context, storage);
  const value = { provider: validProviderPreference(patch.provider ?? previous.provider),
    welcomed: patch.welcomed === true || previous.welcomed };
  try { storage?.setItem(key, JSON.stringify(value)); return !!storage; } catch { return false; }
}
export function availableProviderPreferences(payload) {
  const result = new Set(['AUTO']);
  if (payload?.ok !== true || !Array.isArray(payload.providers)) return [...result];
  for (const row of payload.providers.slice(0, 32)) {
    if (row && Object.hasOwn(LABELS, row.provider) && row.health?.ok === true) result.add(row.provider);
  }
  return [...result];
}
export function mountBrokerPreferences({ select, status, welcome, getContext, navigate,
  fetchImpl = fetch, storage }) {
  let available = ['AUTO'], checked = false, loading = null, memory = new Map();
  const read = () => memory.get(ownerKey(getContext())) ?? readBrokerPreferences(getContext(), storage);
  const save = patch => {
    const context = getContext(), key = ownerKey(context);
    if (!key) return;
    const value = { ...read(), ...patch };
    memory.set(key, value); saveBrokerPreferences(context, value, storage);
  };
  function render() {
    const context = getContext(), preference = read().provider;
    const options = available.includes(preference) ? available : [...available, preference];
    select.replaceChildren(...options.map(provider => {
      const option = document.createElement('option'); option.value = provider;
      option.textContent = LABELS[provider] + (!available.includes(provider) ? checked ? ' · unavailable' : ' · checking' : '');
      option.disabled = !available.includes(provider); return option;
    }));
    select.value = preference;
    select.disabled = !ownerKey(context);
    status.textContent = !checked ? 'Checking available models…'
      : available.length === 1 ? 'Models are temporarily unavailable. You can still review your rules and use wallet controls.'
        : available.includes(preference) ? 'Your choice applies to chat. Auto can try another available model. Choosing a specific model keeps replies with that provider.'
          : 'Your saved model is unavailable. Choose Auto or another available model to change providers.';
    welcome.hidden = !ownerKey(context) || !context.tokenId || read().welcomed;
    const token = welcome.querySelector('[data-welcome-token]');
    if (token) token.textContent = context.tokenId ?? '';
  }
  async function load() {
    if (checked || loading) return loading;
    loading = (async () => {
      try {
        const response = await fetchImpl('/api/v2/providers', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (response.ok) available = availableProviderPreferences(await response.json());
      } catch { /* Wallet exploration and deterministic commands remain usable. */ }
      finally { checked = true; loading = null; render(); }
    })();
    return loading;
  }
  select.addEventListener('change', () => { save({ provider: validProviderPreference(select.value) }); render(); });
  welcome.querySelector('[data-welcome-dismiss]')?.addEventListener('click', () => { save({ welcomed: true }); render(); });
  welcome.querySelectorAll('[data-welcome-action]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.welcomeAction)));
  return Object.freeze({ refresh() { render(); if (ownerKey(getContext())) void load(); },
    preference() { return read().provider; } });
}
