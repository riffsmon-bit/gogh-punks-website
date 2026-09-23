// Fixed commands for the existing deterministic rule compiler. No model call,
// wallet authority, inferred budget or automatic submission is added here.
export function agentOptionsCommand(value) {
  if (!value || !['ASK', 'ASSIST', 'AUTONOMOUS'].includes(value.mode)
    || !['KEEP', 'PIXEL', 'GENERATIVE', 'EXPERIMENTAL'].includes(value.taste)
    || !['KEEP', 'ALL_SUPPORTED'].includes(value.collections ?? 'KEEP')
    || !['FIXED', 'KEEP_HUNTING'].includes(value.duration ?? 'FIXED')) throw Error('Choose a supported mission and art preference.');
  const keepHunting = value.duration === 'KEEP_HUNTING';
  if (keepHunting && value.mode !== 'AUTONOMOUS') throw Error('Choose free-mint automation to keep hunting. Your wallet permission is still required.');
  const amount = (text, maximum) => {
    if (typeof text !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,18})?$/.test(text)) throw Error('Enter an exact ETH amount.');
    const [whole, fraction = ''] = text.split('.');
    const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
    if (wei > maximum) throw Error('That amount exceeds the supported limit.');
    return text;
  };
  const reserve = amount(value.reserve, 100n * 10n ** 18n), gas = amount(value.gas, 10n ** 16n);
  if (Number(gas) === 0) throw Error('Set a non-zero maximum network fee.');
  if (!['1','2','3','5','10'].includes(value.daily) || !['1','2','3','5','10'].includes(value.total)) throw Error('Choose a supported collection limit.');
  const mode = { ASK:'Recommend only', ASSIST:'Assist me', AUTONOMOUS:'Autonomously find and mint' }[value.mode];
  const taste = value.taste === 'KEEP' ? 'Keep my existing art preferences.' : `Prefer ${value.taste.toLowerCase()} art.`;
  const collections = value.collections === 'ALL_SUPPORTED' ? 'Clear my collection target.' : 'Keep my existing collection target.';
  const duration = keepHunting ? ' Keep hunting for up to 100 mints over 30 days.' : '';
  return `${mode}. Find free mints. ${taste} ${collections} Max ${value.daily} mints per day and ${keepHunting ? '100' : value.total} mints total.${duration} Keep ${reserve} ETH in reserve. Max ${gas} ETH gas per mint. Keep all other existing rules. Show the complete rules for review.`;
}

export function mountAgentOptions({ root, submit, canAutomate = () => false }) {
  const doc = root.ownerDocument, field = (tag, text) => { const e = doc.createElement(tag); if (text) e.textContent = text; return e; };
  root.classList.add('agent-options'); const form = field('form');
  form.append(field('h3', 'Set your Punk’s rules'), field('p', 'Choose a supported mission. Review the full rules before saving or granting permission. Existing restrictions stay in place.'));
  const controls = {};
  for (const [name,label,choices] of [
    ['mode','Mission',[['ASK','Find free mints · recommend only'],['ASSIST','Find free mints · prepare for my approval'],['AUTONOMOUS','Free-mint automation · permission required']]],
    ['taste','Add an art preference',[['KEEP','Keep existing preferences'],['PIXEL','Pixel art'],['GENERATIVE','Generative art'],['EXPERIMENTAL','Experimental art']]],
    ['collections','Collections to search',[['KEEP','Keep saved collection restrictions'],['ALL_SUPPORTED','Clear target · search supported collections']]],
    ['daily','Maximum mints per day',['1','2','3','5','10'].map(v=>[v,v])],
    ['duration','How long to hunt',[['FIXED','Stop at my mission total'],['KEEP_HUNTING','Keep hunting · up to 100 mints / 30 days']]],
    ['total','Maximum mints for this mission',['1','2','3','5','10'].map(v=>[v,v])],
  ]) { const wrap=field('label',label),select=field('select');select.name=name;
    for(const [value,text]of choices){const option=field('option',text);option.value=value;select.append(option);}
    if(name==='mode')select.value='ASSIST';wrap.append(select);form.append(wrap);controls[name]=select;
  }
  controls.duration.addEventListener('change',()=>{controls.total.disabled=controls.duration.value==='KEEP_HUNTING';});
  form.append(field('p','Keep hunting requires free-mint automation. It stops sooner if gas reaches your reserve, you pause, or a safety rule blocks spending. Your daily limit still applies. After 100 mints or 30 days, review and renew permission; it never renews automatically.'));
  for(const [name,label,value]of [['reserve','Keep untouched (ETH)','0.01'],['gas','Maximum network fee per mint (ETH)','0.0005']]){
    const wrap=field('label',label),input=field('input');input.name=name;input.inputMode='decimal';input.value=value;input.required=true;input.maxLength=24;wrap.append(input);form.append(wrap);controls[name]=input;
  }
  form.append(field('p','Mint price: free only. Paid mints use the separate exact-price review below. These are draft values; your saved rules change only after confirmation.'));
  const button=field('button','REVIEW MY RULES');button.type='submit';button.className='primary-button';form.append(button);
  const status=field('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');form.append(status);
  form.addEventListener('submit',event=>{event.preventDefault();try{
    if(controls.mode.value==='AUTONOMOUS'&&!canAutomate())throw Error('Check autonomous readiness first. Automation remains locked until this Punk has the required permission.');
    const command=agentOptionsCommand(Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.value])));
    status.textContent='Preparing your rules for review…';submit(command);
  }catch(error){status.textContent=error.message;}});
  root.replaceChildren(form);
  return { setBusy(value){button.disabled=value; if(!value)status.textContent='Review the result and full confirmation below.';} };
}
