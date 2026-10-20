# 超級跳跳 3D

類似瑪利歐的 3D 平台跳躍遊戲，使用 Three.js（WebGL）在瀏覽器裡執行，以 XAMPP（Apache + PHP）作為伺服器，排行榜用 PHP 存成 JSON 檔（不需要 MySQL）。

## 下載安裝（任何電腦，一行指令）

以下指令會下載最新版；偵測到 XAMPP 時直接安裝到 `htdocs/easygame`，否則下載到目前資料夾的 `easygame`。

**Windows（PowerShell）**
```powershell
irm https://raw.githubusercontent.com/n753951f/easygame/main/install.ps1 | iex
```

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/n753951f/easygame/main/install.sh | sh
```

**用 git（任何系統）**
```bash
git clone https://github.com/n753951f/easygame.git
```
Windows 要直接放進 XAMPP：`git clone https://github.com/n753951f/easygame.git C:\xampp\htdocs\easygame`

**不裝 git（Windows 10+ / macOS / Linux 都內建 curl 和 tar）**
```bash
curl -L -o easygame.zip https://github.com/n753951f/easygame/archive/refs/heads/main.zip
tar -xf easygame.zip
```
解壓後的資料夾叫 `easygame-main`，請改名成 `easygame` 再放到 htdocs。

## 檔案結構

```
easygame/
├─ index.html        遊戲頁面（選單、HUD、過關畫面）
├─ css/style.css     介面樣式
├─ js/main.js        遊戲本體（物理、角色、關卡、鏡頭、音效）
├─ api/scores.php    排行榜 API（GET 讀取 / POST 上傳）
├─ data/.htaccess    禁止外部直接讀取資料檔（scores.json 會自動產生在這裡）
├─ deploy.bat        從本機專案一鍵複製到 XAMPP
├─ install.ps1       線上安裝腳本（Windows）
└─ install.sh        線上安裝腳本（macOS / Linux）
```

## 部署步驟（Windows + XAMPP）

1. **安裝 XAMPP**：到 <https://www.apachefriends.org> 下載安裝，預設路徑為 `C:\xampp`（只需要 Apache + PHP，MySQL 可不裝）。
2. **複製檔案到 htdocs**，二擇一：
   - 雙擊專案裡的 `deploy.bat`，會自動複製到 `C:\xampp\htdocs\easygame`
   - 或手動把整個 `easygame` 資料夾複製到 `C:\xampp\htdocs\`
3. **啟動 Apache**：打開「XAMPP Control Panel」，按 Apache 旁邊的 **Start**，變綠色即可。
4. **開始玩**：用 Chrome / Edge 開啟 <http://localhost/easygame/>

> ⚠ 一定要透過 `http://localhost/...` 開啟，不能直接雙擊 index.html（`file://` 下 ES 模組與排行榜 API 都無法運作）。

### 讓同一個網路的其他電腦／手機連線
1. 在命令提示字元執行 `ipconfig`，找到本機 IPv4，例如 `192.168.1.20`
2. 其他裝置開啟 `http://192.168.1.20/easygame/`
3. 如果連不上，到 Windows 防火牆允許「Apache HTTP Server」通過私人網路。

## 常見問題

| 狀況 | 解法 |
| --- | --- |
| Apache 無法啟動（Port 80 被占用，常見於 Skype / IIS） | XAMPP 面板 Apache → Config → `httpd.conf`，把 `Listen 80` 改成 `Listen 8080`，之後用 `http://localhost:8080/easygame/` |
| 畫面顯示「無法載入遊戲引擎」 | Three.js 從 CDN 載入，電腦需能上網。離線方式見下方 |
| 排行榜「上傳失敗」 | 確認 `htdocs\easygame\data` 資料夾存在且可寫入；排行榜資料在 `data\scores.json`，刪掉即可清空 |
| 畫面卡頓 | 確認瀏覽器已開啟硬體加速（Chrome 設定 → 系統 → 使用圖形加速功能） |

### 離線使用（不連 CDN）
1. 下載 <https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js>，存成 `js/lib/three.module.js`
2. 把 `index.html` 的 importmap 改成：
   ```html
   { "imports": { "three": "./js/lib/three.module.js" } }
   ```

## 操作方式

| 按鍵 | 動作 |
| --- | --- |
| W A S D / 方向鍵 | 移動（以鏡頭方向為準） |
| Space | 跳躍，按越久跳越高 |
| Shift | 奔跑 |
| 落地瞬間再跳（移動中） | 二段跳 → 三段空翻跳（跳最高） |
| 滑鼠（點畫面鎖定）/ Q E | 旋轉鏡頭，滾輪縮放 |
| P / Esc | 暫停，M 靜音 |
| 手把 | 左搖桿移動、A 跳、X/RT 奔跑、右搖桿鏡頭、Start 暫停 |

## 流暢度設計

- 物理以固定 120Hz 步長計算，畫面依顯示器更新率插值渲染，60Hz / 144Hz 螢幕手感一致、不抖動。
- 鏡頭使用與幀率無關的指數平滑跟隨，垂直方向跟得較慢，跳躍時畫面穩定。
- 角色有跑步擺臂、跳躍姿勢、落地擠壓伸展、三段跳空翻；粒子用 InstancedMesh 一次繪製。
- 土狼時間（離開平台 0.1 秒內仍可跳）與跳躍緩衝（落地前 0.13 秒按跳也算），操作更寬容。
- 所有貼圖、音效皆程式產生，除了 Three.js 之外不需載入任何素材。

## 自訂

- 手感參數在 `js/main.js` 最上方（重力、速度、跳躍力等）。
- 關卡在 `buildLevel()` 裡，用 `addIsland`、`addBlock`、`addPipe`、`addMover`、`addEnemy`、`addCoin` 等函式組合。
- 網址加上 `?debug` 會在 console 暴露 `window.__game` 方便除錯。
