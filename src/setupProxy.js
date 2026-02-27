const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy all backend API routes to port 3002
  app.use(
    ['/api', '/resources', '/balance', '/sc', '/login', '/registration', '/me', '/health', '/jackpot'],
    createProxyMiddleware({
      target: 'http://localhost:3002',
      changeOrigin: true,
    })
  );
};
