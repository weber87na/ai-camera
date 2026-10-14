import test from "node:test";
import assert from "node:assert/strict";
import { getCameraConfig, getCameraMode, getPhotoPrompt } from "./camera-mode.js";
import { OPERA_ROLES, getOperaPrompt } from "./opera.js";
import { allowedStyles, getStylePrompt } from "./styles.js";

test("PHOTO_MODE defaults to standard and accepts the documented opera switch", () => {
  for (const value of ["", "  ", "standard", " STANDARD "]) {
    assert.equal(getCameraMode(value), "standard");
  }
  for (const value of ["opera", " OPERA ", "歌仔戲", " 歌仔戲 "]) {
    assert.equal(getCameraMode(value), "opera");
  }
  for (const value of ["oper", "traditional", null, 1, [], {}]) {
    assert.throws(() => getCameraMode(value), /PHOTO_MODE/);
  }
});

test("PHOTO_MODE is read from the environment when not explicitly supplied", () => {
  const original = process.env.PHOTO_MODE;
  try {
    delete process.env.PHOTO_MODE;
    assert.equal(getCameraMode(), "standard");
    assert.deepEqual(getCameraConfig(), { mode: "standard", roles: [] });
    process.env.PHOTO_MODE = "opera";
    assert.equal(getCameraMode(), "opera");
    assert.equal(getCameraConfig().roles.length, 4);
    process.env.PHOTO_MODE = "invalid";
    assert.throws(() => getCameraMode(), /PHOTO_MODE/);
  } finally {
    if (original === undefined) delete process.env.PHOTO_MODE;
    else process.env.PHOTO_MODE = original;
  }
});

test("public config offers exactly the four ordered opera roles without prompts", () => {
  assert.deepEqual(getCameraConfig("standard"), { mode: "standard", roles: [] });
  const config = getCameraConfig("opera");
  assert.equal(config.mode, "opera");
  assert.deepEqual(config.roles.map(({ id, name }) => [id, name]), [
    ["sheng", "生"], ["dan", "旦"], ["jing", "淨"], ["chou", "丑"]
  ]);
  assert.deepEqual(config.roles.map(({ id, propId, propName }) => [id, propId, propName]), [
    ["sheng", "paper-fan", "紙扇"],
    ["dan", "iron-chain", "鐵鍊"],
    ["jing", "paper-umbrella", "紙傘"],
    ["chou", "dessert-grid", "甜點九宮格"]
  ]);
  for (const role of config.roles) {
    assert.deepEqual(Object.keys(role).sort(), ["description", "id", "name", "propId", "propName", "title"]);
    assert.ok(role.title.length > 0 && role.description.length > 0);
    assert.ok(role.description.includes(role.propName));
  }
  assert.match(config.roles.find(({ id }) => id === "dan").description, /鐵鍊/);
  assert.throws(() => { config.roles[0].id = "invalid"; }, TypeError);
  assert.throws(() => getCameraConfig("invalid"), /PHOTO_MODE/);
});

test("standard mode preserves every existing style prompt exactly", () => {
  for (const style of allowedStyles) {
    assert.equal(getPhotoPrompt({ mode: "standard", style }), getStylePrompt(style));
  }
  assert.equal(getPhotoPrompt({ style: "opera" }), getStylePrompt("opera"));
  assert.equal(getPhotoPrompt({ mode: "standard", style: "missing" }), null);
});

test("standard mode refuses role-bearing requests instead of silently ignoring the role", () => {
  for (const role of ["dan", "sheng", "", null, [], {}]) {
    assert.equal(getPhotoPrompt({ mode: "standard", style: "opera", role }), null);
  }
});

test("opera mode requires the opera style and an explicit valid role", () => {
  for (const { id } of OPERA_ROLES) {
    assert.equal(getPhotoPrompt({ mode: "opera", style: "opera", role: id }), getOperaPrompt(id));
    assert.equal(getPhotoPrompt({ mode: "opera", style: "simpsons", role: id }), null);
  }
  for (const role of [undefined, null, "", "dan ", "Dan", "旦", "__proto__", "constructor", [], {}]) {
    assert.equal(getPhotoPrompt({ mode: "opera", style: "opera", role }), null);
    assert.equal(getOperaPrompt(role), null);
  }
  assert.equal(getPhotoPrompt({ mode: "opera", role: "dan" }), null);
  assert.equal(getPhotoPrompt({ mode: "invalid", style: "opera", role: "dan" }), null);
});

test("role prompts preserve identity while allowing theatrical costume and stage changes", () => {
  const directions = { sheng: /俊雅書生/, dan: /《目連救母》中的母親/, jing: /威武花臉/, chou: /喜劇丑角/ };
  for (const { id } of OPERA_ROLES) {
    const prompt = getOperaPrompt(id);
    assert.match(prompt, directions[id]);
    assert.match(prompt, /大致年齡/);
    assert.match(prompt, /人物數量/);
    assert.match(prompt, /戲服、舞台妝、假髮、頭飾與必要道具優先/);
    assert.match(prompt, /固定道具優先於原照片手勢與裁切/);
    assert.match(prompt, /不可省略、替換或與其他角色互換/);
    assert.match(prompt, /任何性別的人都能演出/);
    assert.match(prompt, /不可增加陪襯演員/);
    assert.match(prompt, /YouTube 播放器 UI/);
    assert.doesNotMatch(prompt, /不要將普通房間改成宮殿、舞台|請嚴格保留原始照片中的場景|保留原始照片的裁切範圍/);
  }
});

test("every opera role requires its fixed prop with visible identifying features", () => {
  for (const { id, propId, propName } of OPERA_ROLES) {
    assert.ok(getOperaPrompt(id).includes(`固定道具：${propName}（${propId}），不可省略或替換`));
  }
  const sheng = getOperaPrompt("sheng");
  assert.match(sheng, /必須手持明顯展開的象牙白紙折扇/);
  assert.match(sheng, /完整扇面、扇骨與握扇的手都要清楚入鏡/);
  assert.doesNotMatch(sheng, /畫面允許時|手持合攏的折扇/);

  const jing = getOperaPrompt("jing");
  assert.match(jing, /必須手持一把展開的傳統油紙傘/);
  assert.match(jing, /放射狀竹製傘骨/);
  assert.match(jing, /肩膀旁側或肩後/);
  assert.match(jing, /不是現代尼龍傘/);
  assert.match(jing, /傘面不得遮擋臉部/);

  const chou = getOperaPrompt("chou");
  assert.match(chou, /服裝融合聖誕老人元素/);
  assert.match(chou, /聖誕紅.*中式歌仔戲/);
  assert.match(chou, /金色雲紋刺繡/);
  assert.match(chou, /白色毛絨滾邊/);
  assert.match(chou, /歌仔戲布帽融合聖誕帽/);
  assert.match(chou, /不強加大白鬍鬚、肥胖體型、老人皺紋/);
  assert.match(chou, /保留上傳人物原本的年齡感與辨識度/);
  assert.match(chou, /恰好 3 × 3 = 9 個獨立方形格子/);
  assert.match(chou, /每格各放一件傳統甜點/);
  assert.match(chou, /朝鏡頭傾斜/);
  assert.match(chou, /九宮格頂面、四邊與雙手都完整入鏡/);
  assert.match(chou, /不得少格、多格/);
  assert.match(chou, /不得有文字或標誌/);
});

test("dan prioritizes visible substantial iron chains, even for a close selfie", () => {
  const prompt = getOperaPrompt("dan");
  assert.match(prompt, /角色固定為《目連救母》中的母親/);
  assert.match(prompt, /淡紫色、灰紫色長袍/);
  assert.match(prompt, /黑色長髮略微披散/);
  assert.match(prompt, /優先級高於保持原照片手勢與裁切/);
  assert.match(prompt, /雙手持鍊/);
  assert.match(prompt, /互相扣接的橢圓形金屬鏈環/);
  assert.match(prompt, /橫跨胸前下方與畫面前景/);
  assert.match(prompt, /U 形鍊段/);
  assert.match(prompt, /不可省略鐵鍊，不可用項鍊、珠鍊、繩子/);
  assert.match(prompt, /若原圖為近距離自拍或沒有拍到手，必須輕微擴大取景/);
  assert.match(prompt, /不新增拉扯鐵鍊的其他人、僧人、目連或鬼卒/);
});
