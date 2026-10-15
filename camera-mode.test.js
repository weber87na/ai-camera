import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getCameraConfig, getCameraMode, getPhotoPrompt } from "./camera-mode.js";
import { OPERA_ROLES, getOperaPrompt } from "./opera.js";
import { allowedStyles, getStylePrompt } from "./styles.js";

const originalRoles = JSON.parse(readFileSync(new URL("./test-fixtures/opera-original-roles.json", import.meta.url), "utf8"));

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
    assert.equal(getCameraConfig().roles.length, 9);
    process.env.PHOTO_MODE = "invalid";
    assert.throws(() => getCameraMode(), /PHOTO_MODE/);
  } finally {
    if (original === undefined) delete process.env.PHOTO_MODE;
    else process.env.PHOTO_MODE = original;
  }
});

test("public config appends five portrait roles and exposes subtype names without changing its shape", () => {
  assert.deepEqual(getCameraConfig("standard"), { mode: "standard", roles: [] });
  const config = getCameraConfig("opera");
  assert.equal(config.mode, "opera");
  assert.deepEqual(config.roles.map(({ id, name }) => [id, name]), [
    ["sheng", "小生"], ["dan", "苦旦"], ["jing", "花臉"], ["chou", "文丑"],
    ["beauty-fan", "小旦"], ["beauty-necklace", "小旦"],
    ["beauty-umbrella", "小旦"], ["beauty-dessert", "花旦"],
    ["handsome-sheng", "小生"]
  ]);
  assert.deepEqual(config.roles.map(({ id, propId, propName }) => [id, propId, propName]), [
    ["sheng", "paper-fan", "紙扇"],
    ["dan", "iron-chain", "鐵鍊"],
    ["jing", "paper-umbrella", "紙傘"],
    ["chou", "dessert-grid", "甜點九宮格"],
    ["beauty-fan", "paper-fan", "紙扇"],
    ["beauty-necklace", "luxury-necklace", "銀飾項鍊"],
    ["beauty-umbrella", "paper-umbrella", "紙傘"],
    ["beauty-dessert", "dessert-grid", "甜點九宮格"],
    ["handsome-sheng", "paper-fan", "紙扇"]
  ]);
  for (const role of config.roles) {
    assert.deepEqual(Object.keys(role).sort(), ["description", "id", "name", "propId", "propName", "title"]);
    assert.ok(role.title.length > 0 && role.description.length > 0);
    assert.equal(role.title, role.name, "the title is the subtype itself, without an additional subtitle");
    assert.ok(role.description.includes(role.propName));
  }
  assert.match(config.roles.find(({ id }) => id === "dan").description, /鐵鍊/);
  assert.throws(() => { config.roles[0].id = "invalid"; }, TypeError);
  assert.throws(() => getCameraConfig("invalid"), /PHOTO_MODE/);
});

test("original roles change only their authorized subtype labels and keep complete photo prompts", () => {
  const labels = { sheng: "小生", dan: "苦旦", jing: "花臉", chou: "文丑" };
  const withoutLabels = ({ name, title, ...unchanged }) => unchanged;
  assert.deepEqual(OPERA_ROLES.slice(0, 4).map(withoutLabels), originalRoles.map(({ role }) => withoutLabels(role)));
  for (const { role, photoPrompt } of originalRoles) {
    const currentRole = OPERA_ROLES.find(({ id }) => id === role.id);
    assert.equal(currentRole.name, labels[role.id]);
    assert.equal(currentRole.title, labels[role.id]);
    assert.equal(getOperaPrompt(role.id), photoPrompt, `${role.id} keeps its complete photo prompt`);
  }
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
  for (const role of [undefined, null, "", "dan ", "Dan", "旦", "beauty-fan ", "Beauty-Fan", "beauty-unknown", "handsome-sheng ", "Handsome-Sheng", "handsome-unknown", "__proto__", "constructor", [], ["beauty-fan"], ["handsome-sheng"], {}]) {
    assert.equal(getPhotoPrompt({ mode: "opera", style: "opera", role }), null);
    assert.equal(getOperaPrompt(role), null);
  }
  assert.equal(getPhotoPrompt({ mode: "opera", role: "dan" }), null);
  assert.equal(getPhotoPrompt({ mode: "invalid", style: "opera", role: "dan" }), null);
});

test("role prompts preserve identity while allowing theatrical costume and stage changes", () => {
  const directions = { sheng: /俊雅書生/, dan: /《目連救母》中的母親/, jing: /威武花臉/, chou: /喜劇丑角/ };
  for (const { role: { id } } of originalRoles) {
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

test("beauty photo prompts keep identity and opera portrait styling independent of comic roles", () => {
  const beautyRoles = OPERA_ROLES.filter(({ id }) => id.startsWith("beauty-"));
  for (const { id, name } of beautyRoles) {
    const prompt = getOperaPrompt(id);
    assert.ok(prompt.includes(`指定角色：${name}`));
    assert.match(prompt, /保留本人的臉型、五官結構、眉眼辨識度、膚色與大致年齡/);
    assert.match(prompt, /人物數量與人物之間的位置關係必須保持一致/);
    assert.match(prompt, /自然膚質/);
    assert.match(prompt, /旦角髮髻/);
    assert.match(prompt, /成對環形高髻/);
    assert.match(prompt, /台灣歌仔戲傳統舞台旦角所穿的女褶子或女帔/);
    assert.match(prompt, /端莊閉合領口與完整衣襟/);
    assert.match(prompt, /寬大直身袍形、寬袖及另接的純白水袖袖口/);
    assert.match(prompt, /不透明、有厚度的緞面戲服與密實花卉彩繡/);
    assert.match(prompt, /不要把傳統戲服改成現代修身版型/);
    assert.match(prompt, /清新自然的網美妝感.*細眼線.*柔和腮紅/);
    assert.match(prompt, /妝容保留本人辨識度與實際年齡/);
    assert.match(prompt, /不用濃重舞台眼妝、厚白粉或刻意成熟的修容/);
    assert.match(prompt, /直式 1024 × 1536/);
    assert.match(prompt, /頭部至腰部構圖/);
    assert.match(prompt, /不使用白鼻、花臉、鬍鬚、聖誕元素、悲泣或誇張表情/);
    assert.match(prompt, /道具不得遮臉/);
    assert.match(prompt, /移除原照片中與指定造型無關的手持道具，不加入其他角色的固定道具/);
    assert.match(prompt, /不加入品牌文字/);
    assert.doesNotMatch(prompt, /指定行當：|服裝融合聖誕老人元素|雙手持鍊，或/);
    assert.doesNotMatch(prompt, /蝶扇千金|璀璨名伶|煙雨佳人|花宴甜心/);
    assert.throws(() => { OPERA_ROLES.find(role => role.id === id).title = "changed"; }, TypeError);
  }
  assert.match(getOperaPrompt("beauty-fan"), /花鳥紙折扇已展開於胸前下方/);
  assert.match(getOperaPrompt("beauty-fan"), /完整扇面、竹製扇骨與持扇的手/);
  assert.match(getOperaPrompt("beauty-necklace"), /正常日常尺寸的純銀細鏈/);
  assert.match(getOperaPrompt("beauty-necklace"), /自然佩戴於頸胸間/);
  assert.match(getOperaPrompt("beauty-necklace"), /位於閉合衣襟外側/);
  assert.match(getOperaPrompt("beauty-necklace"), /不開低領、不露胸、不改成晚禮服/);
  assert.match(getOperaPrompt("beauty-necklace"), /深藍背景.*暖金輪廓光/);
  assert.match(getOperaPrompt("beauty-necklace"), /最高點上方至少保留畫面高度 5% 的背景留白/);
  assert.match(getOperaPrompt("beauty-necklace"), /雙手從照片開始就自然交疊於腰間，不抬到肩側/);
  assert.match(getOperaPrompt("beauty-necklace"), /鏈身粗細為 1 至 2 毫米、整條長度為 40 至 45 公分/);
  assert.match(getOperaPrompt("beauty-necklace"), /一枚長度不超過 1 公分的簡單小水滴形銀墜/);
  assert.match(getOperaPrompt("beauty-necklace"), /不使用粗大金色鏈節、密鑲鑽石/);
  assert.doesNotMatch(getOperaPrompt("beauty-necklace"), /精品份量|由金色立體鏈節構成/);
  assert.match(getOperaPrompt("beauty-umbrella"), /淡色花卉油紙傘置於肩後/);
  assert.match(getOperaPrompt("beauty-umbrella"), /放射狀竹製傘骨/);
  assert.match(getOperaPrompt("beauty-umbrella"), /完整紙傘圓周必須容納於畫面，四側都有背景留白/);
  assert.match(getOperaPrompt("beauty-umbrella"), /傘面寬度控制在畫面寬度的 60% 至 70%，最多不得超過 70%/);
  assert.match(getOperaPrompt("beauty-umbrella"), /傘面中心位於畫面水平中央/);
  assert.match(getOperaPrompt("beauty-umbrella"), /左、右邊界各至少保留畫面寬度 10% 的清楚背景留白/);
  assert.match(getOperaPrompt("beauty-umbrella"), /頭部至上臀部構圖/);
  assert.match(getOperaPrompt("beauty-dessert"), /恰好 3 × 3 = 9 格.*每格一份甜點/);
  assert.match(getOperaPrompt("beauty-dessert"), /腰胸之間.*朝鏡頭傾斜/);
});

test("the additional xiaosheng portrait keeps the user's identity and an independent traditional male costume", () => {
  const role = OPERA_ROLES.at(-1);
  assert.equal(role.id, "handsome-sheng");
  assert.equal(role.name, "小生");
  assert.equal(role.title, "小生");
  const prompt = getOperaPrompt(role.id);
  for (const requirement of [
    /指定角色：小生/, /膚色、實際年齡與性別特徵/, /不強制年輕化/, /不重塑下顎/,
    /人物數量與人物之間的位置關係必須保持一致/, /任何性別的人都能演出/,
    /象牙白不透明緞面傳統男褶子/, /墨藍色領緣與襟邊.*銀色竹紋及雲紋/,
    /寬鬆直身袍形/, /純白水袖/, /黑色傳統文生巾帽/, /銀色帽緣與一枚小玉飾/,
    /一把已完全展開的象牙白紙折扇/, /水墨竹紋/, /完整扇面、扇骨與持扇的手清楚入鏡/,
    /直式 1024 × 1536/, /頭部至上臀部構圖/, /帽頂上方至少保留畫面高度 5%/,
    /深藍灰色雅緻庭院背景/, /柔和花窗天光/
  ]) assert.match(prompt, requirement);
  assert.doesNotMatch(prompt, /25 至 28|25-28|指定角色：小旦|蝶扇千金|璀璨名伶|煙雨佳人|花宴甜心/);
  assert.throws(() => { role.title = "changed"; }, TypeError);
});

test("traditional beauty costumes retain the first three palettes and give dessert a red robe", () => {
  assert.match(getOperaPrompt("beauty-fan"), /象牙白搭藕粉的傳統女褶子/);
  assert.match(getOperaPrompt("beauty-necklace"), /深孔雀藍搭香檳金的傳統旦角女帔/);
  assert.match(getOperaPrompt("beauty-umbrella"), /月白搭淺青的傳統女褶子/);
  const dessert = getOperaPrompt("beauty-dessert");
  assert.match(dessert, /以正紅色為主色的傳統女褶子/);
  assert.match(dessert, /正紅緞面袍身搭金色牡丹花卉彩繡/);
  assert.doesNotMatch(dessert, /穿杏桃、奶油白/);
  const dessertRole = OPERA_ROLES.find(role => role.id === "beauty-dessert");
  assert.match(dessertRole.description, /正紅色金繡傳統女褶子/);
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
