import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'DCInside 디시봇',
    description: 'DCInside 댓글 @디시봇 트리거에 답글을 자동 작성합니다.',
    permissions: ['storage'],
    host_permissions: ['https://gall.dcinside.com/*', 'https://m.dcinside.com/*'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
});
