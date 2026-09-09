import test from 'node:test';
import assert from 'node:assert/strict';
import { sniperMissionPreview } from '../scripts/dev/skill-forge/sniper-missions.mjs';

test('one learned Sniper exposes both mission choices, never dispatch authority', () => {
  for (const learned of [true, false, 'true', undefined]) for (const equipped of [true, false]) {
    const model = sniperMissionPreview({ learned, equipped });
    assert.equal(model.canChoose, learned === true);
    assert.equal(model.canDispatch, false);
    assert.deepEqual(model.options.map(option => option.id), ['mint-link', 'floor-snipe']);
    assert.match(model.options[1].requires, /Link review alone grants no purchase authority/);
    for (const option of model.options) {
      assert.match(option.prompt, /\[quantity\]/);
      assert.match(option.prompt, /\[budget\]/);
      assert.match(option.prompt, /\[reserve\]/);
      assert.match(option.prompt, /\[deadline \+ timezone\]/);
      assert.match(option.prompt, /confirm/);
    }
  }
});
