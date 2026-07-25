# なぞりがき

子供向けの線なぞり書き知育アプリです。ビルド不要のプレーンな HTML/CSS/JS で作られています。

## 使い方

`index.html` をブラウザで開くだけで動作します。ローカルサーバーを使う場合は例えば:

```
python3 -m http.server 8000
```

を実行し、`http://localhost:8000` にアクセスしてください。

## 機能

- **おやモード**: 親が線（お手本）を描きます。描いている間は黒、描き終えると灰色になります。
- **こどもモード**: 子どもが好きな色を選んで、お手本をなぞって線を描けます。
- **消しゴム（一本消し）**: なぞった線をタップ/クリックすると一本だけ消せます。おやモードでは親の線のみ、こどもモードでは子の線のみ消せます（子は親の線を消せません）。
- **すべて消す**: 各モードで自分が描いた線をすべて消去できます。
- **書き順モード**（おやモードのみ）: 親の線を灰色ではなく描いた順に色分けし、線の始点に書き順の番号を表示します。

## レンタルサーバーへの自動デプロイ

`main` ブランチに push(PRのマージを含む)されると、`.github/workflows/deploy.yml` が以下の順で自動的にレンタルサーバー(XREA)へアップロードします。

1. XREAのAPI(`https://api.xrea.com/v1/tool/ssh_ip_allow`)へ、実行中のGitHub ActionsランナーのIPアドレスを送信し、SSH接続許可リストへ自動登録
2. 反映を待つため5分間待機(XREAの管理画面の表示に合わせています)
3. SFTPで `index.html` / `style.css` / `app.js` をアップロード

使うには、リポジトリの **Settings > Secrets and variables > Actions** で以下を設定してください。

### Secrets(必須、値は非公開)
- `XREA_HOST`: SFTPのホスト名(XREAの「SSH接続IP許可」APIの `server_name` としても使われます)
- `XREA_PORT`: SFTPのポート番号
- `XREA_USER`: SFTPのユーザー名(同APIの `account` としても使われます)
- `XREA_PASSWORD`: SFTPのパスワード
- `XREA_API_SECRET_KEY`: XREAの「SSH接続IP許可」API用のシークレットキー

### Variables(任意)
- `FTP_SERVER_DIR`: アップロード先ディレクトリ(未設定の場合は `/public_html/madakotools/nazorigaki`)

設定後は Actions タブから手動実行(workflow_dispatch)もできます。
