// Action feedback is a single result, never a conversation or saved transcript.
export function renderActionFeedback(root, role, message, details = null) {
  if (!root) return;
  root.replaceChildren();
  root.hidden = role === 'owner' || !message;
  if (root.hidden) return;
  const title = root.ownerDocument.createElement('h3'); title.textContent = 'Action result';
  const text = root.ownerDocument.createElement('p'); text.textContent = message;
  root.append(title, text);
  if (details) root.append(details);
}

export function actionStatus(mission, review) {
  if (mission?.status === 'ACTIVE') return `Mission active · ${mission.completedMints}/${mission.totalLimit} mints. Open Activity for checks and receipts.`;
  if (mission?.status === 'COMPLETED') return `Last mission complete · ${mission.completedMints}/${mission.totalLimit} mints. Results are in Activity.`;
  if (mission?.status === 'PAUSED') return 'Mission paused. Review your rules before starting another mission.';
  if (review?.status === 'SCOUTING') return 'Checking opportunities. Open Activity for progress.';
  return 'Choose an action below. Rules and wallet transactions require your confirmation.';
}
