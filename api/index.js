// Cửa vào của lớp API trên Vercel: file này là một Vercel Function, phục vụ tại /api.
// Toàn bộ phần xử lý (giao thức, các lệnh, kết nối database) nằm ở server/app.js.
import { handleFetch } from "../server/app.js";

export default { fetch: handleFetch };
