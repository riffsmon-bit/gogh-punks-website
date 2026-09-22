import { mountPersistentWatch } from './broker-persistent-watch.js';

const selectionKey = value => JSON.stringify(value ? [value.owner?.toLowerCase(), value.tokenId,
  value.chainId, value.context, value.preview] : null);
const validSelection = value => value && !value.preview && value.chainId === 4663
  && ['PRODUCTION', 'DEPLOY_PREVIEW'].includes(value.context)
  && /^0x[0-9a-f]{40}$/i.test(value.owner ?? '') && !/^0x0{40}$/i.test(value.owner)
  && /^[1-9][0-9]{0,3}$/.test(value.tokenId) && Number(value.tokenId) <= 5016;
const sessionKey = session => `${session?.walletAddress?.toLowerCase()}:${session?.expiresAt}`;

// Session reads never open a wallet. Sign-in is an explicit button; each write
// rechecks the existing cookie before dispatch and cannot reuse an old draft
// after an account, Punk, chain, context, or authenticated-session change.
export function createPersistentWatchMount({ root, getSelection, request, ensureSession,
  onFund, onReviewPermission, now = Date.now }) {
  const document = root.ownerDocument;
  const access = document.createElement('div'), status = document.createElement('p');
  const signIn = document.createElement('button'), body = document.createElement('div');
  access.className = 'persistent-watch-access'; status.setAttribute('role', 'status');
  signIn.type = 'button'; signIn.textContent = 'Sign in to manage watching';
  access.append(status, signIn); root.replaceChildren(access, body);
  let revision = 0, selectedKey = '', authenticated = null, destroyed = false;
  const current = (version, key) => !destroyed && version === revision
    && key === selectedKey && key === selectionKey(getSelection());
  const validSession = (session, selected) => session?.authenticated === true
    && session.walletAddress?.toLowerCase() === selected.owner.toLowerCase()
    && Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > now();
  const clear = message => {
    authenticated = null; panel.setIdentity(null); body.hidden = true;
    status.textContent = message; signIn.hidden = !validSelection(getSelection()); signIn.disabled = false;
  };
  const panel = mountPersistentWatch({ root: body,
    request: async (path, { method, body: payload } = {}) => {
      const version = revision, key = selectedKey, selected = getSelection(), savedSession = authenticated;
      if (!validSelection(selected) || !savedSession || !current(version, key)
        || path !== `/api/v2/punks/${selected.tokenId}/persistent-watch`) throw Error('Watching selection changed. Refresh this Punk.');
      try {
        if (method === 'POST') {
          const session = await request('/api/v2/session');
          if (!current(version, key)) throw Error('Watching selection changed. Refresh this Punk.');
          if (!validSession(session, selected) || sessionKey(session) !== savedSession) {
            revision++; clear('Your sign-in changed. Sign in and review your watching settings again.');
            throw Error('Watching sign-in changed. Review your settings again.');
          }
        }
        if (!current(version, key)) throw Error('Watching selection changed. Refresh this Punk.');
        return await request(path, { method: method ?? 'GET', ...(payload ? {
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        } : {}) });
      } catch (error) {
        if (current(version, key) && ['V2_SESSION_REQUIRED', 'V2_SESSION_EXPIRED'].includes(error?.code)) {
          revision++; clear('Sign in again to manage this Punk’s watching settings.');
        }
        throw error;
      }
    },
    onFund: identity => { if (authenticated && current(revision, selectedKey)
      && identity.sessionVersion === `${revision}:${authenticated}`) onFund?.(identity); },
    onReviewPermission: identity => { if (authenticated && current(revision, selectedKey)
      && identity.sessionVersion === `${revision}:${authenticated}`) onReviewPermission?.(identity); },
  });
  async function load({ force = false, sign = false } = {}) {
    if (destroyed) return;
    const selected = getSelection(), key = selectionKey(selected);
    if (!force && key === selectedKey) return;
    selectedKey = key; const version = ++revision;
    root.hidden = Boolean(selected?.preview) || (selected && !['PRODUCTION', 'DEPLOY_PREVIEW'].includes(selected.context));
    clear('Connect the current holder on Robinhood Chain and select a Punk.');
    if (!validSelection(selected)) return;
    status.textContent = sign ? 'Confirm the free sign-in message in your wallet.' : 'Checking your watching session…';
    signIn.disabled = true;
    try {
      if (sign) { await ensureSession(); if (!current(version, key)) return; }
      const session = await request('/api/v2/session');
      if (!current(version, key)) return;
      if (!validSession(session, selected)) { clear('Sign in as the current holder to manage watching.'); return; }
      authenticated = sessionKey(session); signIn.hidden = true;
      status.textContent = 'Watching saves research preferences. It does not request a wallet transaction.';
      body.hidden = false;
      await panel.setIdentity({ ...selected, owner: selected.owner.toLowerCase(), sessionVersion: `${revision}:${authenticated}` });
    } catch (error) {
      if (current(version, key)) clear(['V2_SESSION_REQUIRED', 'V2_SESSION_EXPIRED'].includes(error?.code)
        ? 'Sign in as the current holder to manage watching.' : 'Watching could not verify your sign-in. Try again.');
    } finally { if (current(version, key)) signIn.disabled = false; }
  }
  signIn.addEventListener('click', () => { if (!signIn.disabled) void load({ force: true, sign: true }); });
  return {
    selectionChanged: load,
    sessionChanged(session) {
      if (authenticated && authenticated !== sessionKey(session)) return load({ force: true });
    },
    destroy() { destroyed = true; revision++; panel.destroy(); root.replaceChildren(); },
  };
}
