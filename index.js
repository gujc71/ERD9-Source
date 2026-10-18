// Vite 빌드 결과(dist/)를 서비스하는 서버.  npm run build 후 npm run server
const helmet = require('helmet');
const express = require('express');
const path = require('path');

const DIST = path.join(__dirname, 'dist');

const cspOptions = {
  directives: {
    ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    "script-src": ["'self'"],
    // 툴바 아이콘(data:), 인쇄 미리보기(blob:, data:)
    "img-src": ["'self'", "data:", "blob:"],
    // 샘플 파일, AI API (OpenAI, Anthropic, Gemini)
    "connect-src": ["'self'", "https://gujc71.github.io", "https://api.openai.com", "https://api.anthropic.com", "https://generativelanguage.googleapis.com"],
  }
};
const app = express();
const port = process.env.PORT || 3000;
app.set('trust proxy', 1);
app.disable('x-powered-by');

// 보안 헤더를 정적 파일에도 적용하기 위해 static보다 먼저 등록
app.use(helmet({contentSecurityPolicy: cspOptions}));

// 빌드된 js/css는 파일명에 해시가 붙으므로 오래 캐시
app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(DIST));

// 404
app.use(function(req, res) {
  res.status(404).send('Not Found');
});

// error handler
app.use(function(err, req, res, next) {
  console.log("error", err.message);
  res.status(err.status || 500).send(req.app.get('env') === 'development' ? err.message : 'Server Error');
});

app.listen(port, () => {
    console.log(`server is listening at localhost:${port}`);
});
