const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy API-only routes (never browser-navigated) to port 3002
  app.use(
    ['/api', '/resources', '/balance', '/sc', '/me', '/health', '/jackpot'],
    createProxyMiddleware({
      target: 'http://localhost:3002',
      changeOrigin: true,
    })
  );

  // /login and /registration are also React Router pages, so only proxy POST (API calls)
  const postOnlyProxy = createProxyMiddleware({
    target: 'http://localhost:3002',
    changeOrigin: true,
  });
  app.post('/login', postOnlyProxy);
  app.post('/registration', postOnlyProxy);
};
