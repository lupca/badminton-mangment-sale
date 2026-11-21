import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {pathToFileURL} from 'url';
import {loadEnv, type Connect, type Plugin} from 'vite';
import {defineConfig} from 'vitest/config';

/**
 * Chạy ở máy mình (`npm run dev`, `npm run preview`): gắn lớp API vào /api của chính máy chủ Vite, để trang web và lớp API
 * cùng một địa chỉ như trên Vercel (ở đó /api là api/index.js).
 */
function localApi(): Plugin {
  // Nạp lúc có yêu cầu đầu tiên, thẳng từ đĩa (không gói vào file cấu hình): chạy không máy chủ thì không đụng tới thư viện database.
  const entry = pathToFileURL(path.resolve(__dirname, 'server/node.js')).href;
  const mount = (middlewares: Connect.Server) => {
    middlewares.use('/api', (req, res) => {
      import(entry).then(
        (api: {handleNode(request: typeof req, response: typeof res): Promise<void>}) => api.handleNode(req, res),
        (error) => {
          console.error('[km-api] không nạp được lớp API:', error);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({error: {code: 'server', message: 'Có lỗi trên máy chủ. Hãy thử lại.'}}));
        },
      );
    });
  };
  return {
    name: 'km-local-api',
    configureServer: (server) => mount(server.middlewares),
    configurePreviewServer: (server) => mount(server.middlewares),
  };
}

export default defineConfig(({mode}) => {
  // Biến môi trường của nơi build / chạy, kể cả từ file .env.local. Chỉ đọc ở đây: KHÔNG biến nào được chép vào mã gửi
  // xuống trình duyệt — trình duyệt chỉ nhận đúng một giá trị có / không (`__KM_SERVER__`).
  const env = loadEnv(mode, process.cwd(), '');
  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  // Có DATABASE_URL thì ứng dụng dùng máy chủ (đăng nhập, dữ liệu dùng chung). KM_SERVER=off: vẫn build bản không máy chủ.
  // Kiểm thử đơn vị (`npm test`) luôn chạy như bản không máy chủ, bất kể máy đang có file .env.local hay không.
  const serverMode = databaseUrl !== '' && env.KM_SERVER !== 'off' && mode !== 'test';
  if (serverMode) {
    // Cho lớp API chạy trong máy chủ Vite (xem localApi) thấy cấu hình đọc từ .env.local.
    process.env.DATABASE_URL ??= databaseUrl;
    if (env.DATABASE_CA) process.env.DATABASE_CA ??= env.DATABASE_CA;
  }
  return {
    define: {
      __KM_SERVER__: JSON.stringify(serverMode),
    },
    plugins: [react(), tailwindcss(), ...(serverMode ? [localApi()] : [])],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      // `npm test` chỉ chạy kiểm thử thuần trong src/. Các kiểm thử trong server/tests cần một PostgreSQL thật
      // (tự dựng bằng Docker) và được gọi riêng bằng `npm run test:db`.
      include: ['src/**/*.test.{ts,tsx}'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
