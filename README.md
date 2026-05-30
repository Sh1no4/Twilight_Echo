# Twilight Echo

<img src="./assets/logo.png" style="margin-left:0px; width: 35%;" alt="logo" /><img src="./assets/icon.svg" style=" width: 17%; margin-left: 20px; margin-bottom: 10px;" align="right" alt="icon" />

> Twilight Echo 鏄竴娆剧幇浠ｇ殑闊充箰鎾斁鍣紝鏈夌幇浠ｇ殑UI鍜屾祦濯掍綋鎾斁锛屾湰鍦版挱鏀惧姛鑳姐€?

## **鍔熻兘鐗规€?*

- **鏈湴闊充箰搴撶鐞?*
  - 鎸夋瓕鏇层€佽壓鏈銆佷笓杈戣繘琛屾祻瑙?
  - 鎸佷箙鍖栦繚瀛樺凡鎵弿鐨勯煶涔愬簱涓庢枃浠跺す璁板綍
- **缃戞槗浜戦煶涔愭祦濯掍綋妯″紡**
  - 鏀寔浜岀淮鐮佺櫥褰曠綉鏄撲簯闊充箰
  - 鏀寔璇诲彇鐧诲綍鐘舵€佷笌涓汉璧勬枡
  - 鏀寔鎺ㄨ崘姝屾洸銆佹帹鑽愭瓕鍗曘€佺浜烘极娓搞€佺浜洪浄杈?
  - 鏀寔鏌ョ湅鎴戝枩娆㈢殑闊充箰涓庝釜浜烘瓕鍗?
  - 鏀寔鍦ㄧ嚎鎼滅储姝屾洸涓庢敹钘?鍙栨秷鏀惰棌
- **鑹ソ鐨勯煶棰戣緭鍑鸿兘鍔?*
  - 閲囩敤Twilight Audio Engine浣滀负鎾斁寮曟搸
  - 鎷ユ湁WASAPI鐙崰杈撳嚭锛岀‘淇濋煶棰戞祦浠ュ師濮嬮噰鏍风巼鍜屼綅娣憋紙濡?96kHz/24bit锛変紶杈擄紝涓嶇粡杩囩郴缁熺殑閲嶉噰鏍风畻娉曪紝浠庤€岄伩鍏嶄簡鏁板瓧杞崲甯︽潵鐨勫け鐪熷拰搴曞櫔銆?
  - 鑷姩鍒囨崲姣旂壒鐜?

## 鎶€鏈爤

- Electron
- Vue 3
- TypeScript
- Vite / electron-vite
- PrimeIcons
- Twilight Audio Engine
- `@neteasecloudmusicapienhanced/api`
- `music-metadata`

## 鏀寔鐨勯煶棰戞牸寮?

椤圭洰褰撳墠鍦ㄤ富杩涚▼涓敮鎸佷富娴佺殑闊抽鏍煎紡锛屽寘鎷細

> .mp3 .flac .wav .aac .ogg .wma .m4a .aiff / .aif .opus .webm .alac .ape .wv .dsf .dff

## 椤圭洰缁撴瀯

```text
src/
鈹溾攢 main/         Electron 涓昏繘绋嬶紝璐熻矗绐楀彛銆佹枃浠舵壂鎻忋€乵pv銆丯CM API
鈹溾攢 preload/      棰勫姞杞藉眰锛屽悜娓叉煋杩涚▼鏆撮湶 IPC API
鈹斺攢 renderer/     Vue 鍓嶇鐣岄潰
   鈹斺攢 src/
      鈹溾攢 components/
      鈹溾攢 stores/
      鈹溾攢 types/
      鈹斺攢 utils/
```

## 寮€鍙戝墠鍑嗗

璇峰厛纭繚浣犵殑鐜涓叿澶囷細

- Node.js 18+
- npm 鎴?pnpm

鎺ㄨ崘鐩存帴浣跨敤椤圭洰鐜版湁閿佹枃浠跺搴旂殑鍖呯鐞嗗櫒瀹夎渚濊禆銆?

### 鍏充簬 Twilight Audio Engine

椤圭洰鎾斁鑳藉姏渚濊禆 Twilight Audio Engine锛?

- 寮€鍙戠幆澧冧笅锛屼唬鐮佷細浼樺厛灏濊瘯鐩存帴璋冪敤绯荤粺涓殑 `Twilight Audio Engine`
- 鎵撳寘鏃讹紝椤圭洰浼氬皾璇曞皢 `resources/audio-engine` 瑙ｅ帇鍒?`resources/Twilight Audio Engine/` 鍚庨殢搴旂敤鍒嗗彂

濡傛灉浣犳槸鍦ㄦ湰鍦板紑鍙戝苟閬囧埌鏃犳硶鎾斁鐨勯棶棰橈紝閫氬父闇€瑕侊細

1. 鍦ㄧ郴缁熶腑瀹夎 `Twilight Audio Engine`
2. 鎴栬€呯‘淇濋」鐩墦鍖呰祫婧愪腑鐨?Twilight Audio Engine 鍙敤

## 瀹夎渚濊禆

濡傛灉浣犱娇鐢?pnpm锛?

```bash
pnpm install
```

濡傛灉浣犱娇鐢?npm锛?

```bash
npm install
```

## 鍚姩寮€鍙戠幆澧?

```bash
pnpm dev
```

鎴栵細

```bash
npm run dev
```

鍚姩鍚庝細鎵撳紑 Electron 妗岄潰绐楀彛銆?

## 浠ｇ爜妫€鏌ヤ笌鏍煎紡鍖?

### Type Check

```bash
npm run typecheck
```

### Lint

```bash
npm run lint
```

### Format

```bash
npm run format
```

## 鏋勫缓搴旂敤

### 閫氱敤鏋勫缓

```bash
npm run build
```

### 骞冲彴鎵撳寘

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

### 棰濆璇存槑

- 鎵撳寘閰嶇疆浣嶄簬 `electron-builder.yml`
- 鎵撳寘鍓嶄細鎵ц `audio-engine/CMakeLists.txt`

## 浣跨敤璇存槑

### 1. 瀵煎叆鏈湴闊充箰

鍚姩搴旂敤鍚庯紝鍙互閫夋嫨闊充箰鏂囦欢澶硅繘琛屾壂鎻忋€傜▼搴忎細锛?

- 閫掑綊鏌ユ壘鏀寔鐨勯煶棰戞枃浠?
- 鑷姩鎻愬彇鍏冩暟鎹?
- 灏濊瘯璇诲彇灏侀潰涓庢瓕璇?
- 灏嗘壂鎻忕粨鏋滀繚瀛樺埌鏈湴鐢ㄦ埛鏁版嵁鐩綍

### 2. 浣跨敤娴佸獟浣撴ā寮?

杩涘叆娴佸獟浣撻〉闈㈠悗锛屽彲浠ラ€氳繃浜岀淮鐮佺櫥褰曠綉鏄撲簯闊充箰銆傜櫥褰曞悗鍙娇鐢細

- 棣栭〉鎺ㄨ崘
- 鍦ㄧ嚎鎼滅储
- 鎴戝枩娆㈢殑闊充箰
- 涓汉姝屽崟
- 鎺ㄨ崘姝屽崟

### 3. 鎾斁鎺у埗

鎾斁鍣ㄦ敮鎸侊細

- 鎾斁 / 鏆傚仠
- 涓婁竴棣?/ 涓嬩竴棣?
- 璋冩暣鎾斁杩涘害
- 闊抽噺鎺у埗
- 鎾斁妯″紡鍒囨崲
- 鐙崰妯″紡鍒囨崲

## 鏁版嵁瀛樺偍

搴旂敤浼氬皢閮ㄥ垎鏁版嵁淇濆瓨鍦?Electron 鐢ㄦ埛鐩綍涓紝鍖呮嫭锛?

- 鏈湴闊充箰搴撴暟鎹?
- 宸叉壂鎻忔枃浠跺す璁板綍
- 缃戞槗浜戠櫥褰?Cookie

## 宸茬煡娉ㄦ剰浜嬮」

- 缃戞槗浜戠浉鍏宠兘鍔涗緷璧栨湰鍦板惎鍔ㄧ殑澧炲己 API 鏈嶅姟
- 寮€鍙戠幆澧冧笅鑻ョ郴缁熶腑娌℃湁 `Twilight Audio Engine`锛屾挱鏀惧姛鑳藉彲鑳戒笉鍙敤
- Windows 鐙崰妯″紡寮€鍚悗锛屽叾浠栧簲鐢ㄥ彲鑳芥棤娉曞悓鏃惰緭鍑洪煶棰?
- 閮ㄥ垎鎵撳寘娴佺▼渚濊禆 `resources/audio-engine` 鏄惁瀛樺湪

