# 매뉴얼 화면 캡처

[user-manual_ko.adoc](../user-manual_ko.adoc), [user-manual_en.adoc](../user-manual_en.adoc)의 그림(`../images/*.png`)을 만드는 스크립트입니다.
화면이 바뀌면 다시 실행해서 그림을 갱신합니다. Windows에서 Microsoft Edge(Playwright `msedge` 채널)를 사용합니다.

## 준비

```bash
cd doc/screenshots
npm install
```

## 웹 버전 (01 ~ 07)

```bash
# 프로젝트 폴더에서
npm run build
npm run preview            # http://localhost:4173

# doc/screenshots에서
npm run web                # 01 ~ 07을 차례로 실행
node 04_view.mjs           # 하나만 다시 캡처
```

- 쇼핑몰 예제 문서는 `shop.sql`(DDL)을 가져와 만든 `shop.json`을 사용합니다. `01_base.mjs`가 `shop.json`을 다시 만듭니다.
- `06_addons.mjs`는 표준 사전 예제로 `domains.csv`, `words.csv`를 가져옵니다.
- `07_ai.mjs`는 API 키를 사용하지 않습니다. AI 설정의 키 확인 요청에만 가짜 응답을 돌려줍니다.
- 다른 주소의 서버를 쓰려면 `APP_URL`을 지정합니다.

## 데스크톱 앱 (08)

Database 메뉴(Forward Engineering, Reverse Engineering, Compare and Merge)를 캡처합니다.

```bash
# 프로젝트 폴더에서 실행 파일 빌드
npx tauri build --no-bundle

# doc/screenshots에서 (PowerShell은 $env:DB_PASSWORD="...")
DB_PASSWORD=비밀번호 npm run desktop
```

- `src-tauri/target/release/erd9.exe`를 WebView2 원격 디버깅 포트(9222)로 실행해서 조작하고, 끝나면 닫습니다.
- **로컬 MariaDB의 `erd9_manual` 데이터베이스를 지우고 다시 만듭니다.** 다른 이름을 쓰려면 `DB_NAME`을 지정합니다.
- 환경 변수: `DB_PASSWORD`(필수), `DB_USER`(root), `DB_NAME`(erd9_manual), `MYSQL`(mysql.exe 경로), `ERD9_EXE`(실행 파일 경로)
- 창 전체 그림(`tauri-window.png`)은 `capwin.ps1`로 제목 표시줄까지 캡처합니다.
- `.erd9` 저장/열기 대화상자(Windows 파일 대화상자)는 `filedialog.ps1`이 찾아서 캡처하고, 파일 이름을 넣어 확인합니다. 파일은 `%TEMP%\erd9-manual`에 저장합니다.
