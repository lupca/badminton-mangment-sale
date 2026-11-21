// Chạy toàn bộ kiểm thử của lớp máy chủ:  npm run test:db   (tức: node server/tests/run.mjs)
//
// Tự lo từ đầu đến cuối, không đụng tới database nào có sẵn:
//   1. dựng một PostgreSQL dùng-xong-bỏ bằng Docker (cổng ngẫu nhiên, chỉ mở trên 127.0.0.1);
//   2. tạo vai trò «app» (đăng nhập được, CREATEROLE, KHÔNG phải superuser) và database «app» do nó làm chủ — giống
//      database thật của ứng dụng;
//   3. cài lược đồ bằng chính lệnh người dùng sẽ chạy (server/setup.mjs);
//   4. chạy lần lượt mọi file *.test.mjs (bằng node) và *.test.ts (bằng tsx) trong thư mục này;
//   5. gỡ container, kể cả khi có lỗi hoặc bấm Ctrl-C.
//
// Mỗi file kiểm thử nhận hai biến môi trường:
//   KM_TEST_DATABASE_URL   địa chỉ database thử, vai trò «app» (ứng dụng dùng đúng loại vai trò này)
//   KM_TEST_ADMIN_URL      cùng máy chủ đó, vai trò superuser (để dựng tình huống: bật TLS trên máy chủ thử…)
//   KM_TEST_THROWAWAY      «1» nếu database là cái file này tự dựng bằng Docker (dùng xong bỏ)
//
// Tùy chọn:
//   node server/tests/run.mjs api          chỉ chạy các file có «api» trong tên
//   KM_TEST_PG_IMAGE=postgres:16-alpine    dùng bản PostgreSQL khác
//   KM_TEST_DATABASE_URL=postgres://…      KHÔNG dựng Docker, dùng database có sẵn này (vd trong CI). Chỉ nhận database trên
//                                          chính máy này, và chỉ khi nó còn trống hoặc đã mang dấu «database thử» — vì các bài
//                                          kiểm thử XÓA SẠCH dữ liệu. Kèm KM_TEST_ADMIN_URL nếu có tài khoản superuser.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { TEST_MARK_KEY, assertLocalUrl, pgConfig } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const IMAGE = process.env.KM_TEST_PG_IMAGE ?? "postgres:17-alpine";
const filters = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));

/** @type {string | null} */
let container = null;
/** File kiểm thử đang chạy (để dừng nó khi bấm Ctrl-C). */
/** @type {import("node:child_process").ChildProcess | null} */
let running = null;

function removeContainer() {
  if (!container) return;
  const name = container;
  container = null;
  spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" });
}

process.on("exit", removeContainer);
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
  process.on(signal, () => {
    console.error(`\nNhận ${signal}: dọn dẹp rồi dừng.`);
    running?.kill("SIGTERM");
    removeContainer();
    process.exit(130);
  });
}

function fail(message, code = 1) {
  console.error(message);
  removeContainer();
  process.exit(code);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mở một kết nối, chạy `work`, rồi đóng. */
async function withClient(url, work) {
  const client = new pg.Client({ ...pgConfig(url), connectionTimeoutMillis: 5_000, application_name: "km-test-run" });
  client.on("notice", () => {});
  client.on("error", () => {});
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

// ───────────────────────── Database thử ─────────────────────────

/** Dựng PostgreSQL bằng Docker. Trả về { url, adminUrl }. */
async function startDockerDatabase() {
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  if (docker.error || docker.status !== 0) {
    fail(
      [
        "Không dùng được Docker (chưa cài, chưa chạy, hoặc tài khoản này không có quyền gọi lệnh docker).",
        "Kiểm thử lớp máy chủ cần một PostgreSQL dùng-xong-bỏ. Hai cách:",
        "  • cài / bật Docker rồi chạy lại `npm run test:db`; hoặc",
        "  • tự dựng một PostgreSQL TRỐNG ngay trên máy này rồi chạy:",
        "      KM_TEST_DATABASE_URL=postgres://<user>:<mật khẩu>@127.0.0.1:<cổng>/<database> npm run test:db",
        docker.stderr ? `(docker: ${docker.stderr.trim().split("\n")[0]})` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      2,
    );
  }

  // Lần chạy đầu tiên Docker phải tải image về (vài chục MB): cho hiện tiến độ để không tưởng là máy bị treo.
  if (spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }).status !== 0) {
    console.log(`Tải image ${IMAGE} về máy (chỉ lần đầu)…`);
    const pull = spawnSync("docker", ["pull", IMAGE], { stdio: "inherit" });
    if (pull.status !== 0) fail(`Không tải được image ${IMAGE} (lần chạy đầu tiên cần có mạng Internet).`, 2);
  }

  const name = `km-test-${randomBytes(4).toString("hex")}`;
  const superPassword = randomBytes(12).toString("hex");
  const appPassword = randomBytes(12).toString("hex");
  console.log(`Dựng PostgreSQL thử bằng Docker (${IMAGE}, container ${name})…`);
  const run = spawnSync(
    "docker",
    ["run", "-d", "--rm", "--name", name, "-e", `POSTGRES_PASSWORD=${superPassword}`, "-p", "127.0.0.1::5432", IMAGE],
    { encoding: "utf8" },
  );
  if (run.status !== 0) fail(`Không chạy được container PostgreSQL:\n${run.stderr || run.stdout}`, 2);
  container = name;

  const port = spawnSync("docker", ["port", name, "5432/tcp"], { encoding: "utf8" });
  const match = /127\.0\.0\.1:(\d+)/.exec(port.stdout ?? "");
  if (!match) fail(`Không biết container mở cổng nào:\n${port.stdout}${port.stderr}`, 2);
  const hostPort = /** @type {RegExpExecArray} */ (match)[1];
  const adminUrl = `postgres://postgres:${superPassword}@127.0.0.1:${hostPort}/postgres?sslmode=disable`;
  const url = `postgres://app:${appPassword}@127.0.0.1:${hostPort}/app?sslmode=disable`;

  // Chờ tới khi nối được qua cổng TCP (lúc khởi tạo, PostgreSQL trong container chạy tạm một lần rồi khởi động lại;
  // bản chạy tạm không nghe trên TCP, nên nối được ở đây nghĩa là đã sẵn sàng thật).
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      await withClient(adminUrl, (client) => client.query("select 1"));
      break;
    } catch (error) {
      if (Date.now() > deadline) fail(`PostgreSQL trong container không sẵn sàng sau 90 giây: ${error?.message ?? error}`, 2);
      await sleep(300);
    }
  }

  await withClient(adminUrl, async (client) => {
    // Giống database thật: vai trò của ứng dụng không phải superuser, có CREATEROLE, làm chủ database «app».
    await client.query(`create role app login createrole password '${appPassword}'`);
    await client.query("create database app owner app");
  });
  return { url, adminUrl };
}

/** Dùng database có sẵn (KM_TEST_DATABASE_URL): chỉ khi nó ở trên máy này và còn trống hoặc đã mang dấu «database thử». */
async function useGivenDatabase(given) {
  const url = assertLocalUrl(given, "KM_TEST_DATABASE_URL");
  const adminUrl = process.env.KM_TEST_ADMIN_URL ? assertLocalUrl(process.env.KM_TEST_ADMIN_URL, "KM_TEST_ADMIN_URL") : url;
  console.log("Dùng database thử có sẵn (KM_TEST_DATABASE_URL), không dựng Docker.");
  const state = await withClient(url, async (client) => {
    const { rows: schema } = await client.query("select to_regclass('km.meta') is not null as installed");
    if (!schema[0].installed) return { installed: false, marked: false, rows: 0 };
    const { rows: mark } = await client.query("select 1 from km.meta where key = $1", [TEST_MARK_KEY]);
    const { rows: counts } = await client.query(
      "select (select count(*) from km.accounts)::int + (select count(*) from km.programs)::int + (select count(*) from km.orders)::int as n",
    );
    return { installed: true, marked: mark.length > 0, rows: counts[0].n };
  }).catch((error) => fail(`Không nối được database thử: ${error?.message ?? error}`, 2));
  if (!state.marked && state.rows > 0) {
    fail(
      [
        "TỪ CHỐI CHẠY: database này đang có dữ liệu (tài khoản / chương trình / đơn hàng) và không mang dấu «database thử».",
        "Các bài kiểm thử xóa sạch dữ liệu, nên chỉ chạy trên database trống hoặc database mà chính bộ kiểm thử đã đánh dấu.",
      ].join("\n"),
      2,
    );
  }
  return { url, adminUrl };
}

/** Cài lược đồ bằng đúng lệnh của người dùng, rồi đặt dấu «database thử». */
async function installSchema(url) {
  const setup = spawnSync(process.execPath, [join(root, "server", "setup.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: { ...childEnv(), DATABASE_URL: url },
  });
  if (setup.status !== 0) fail("Không cài được lược đồ vào database thử (xem lỗi của server/setup.mjs ở trên).", 2);
  await withClient(url, (client) =>
    client.query("insert into km.meta (key, value) values ($1, 'yes') on conflict (key) do nothing", [TEST_MARK_KEY]),
  );
}

// ───────────────────────── Chạy các file kiểm thử ─────────────────────────

/** Môi trường cho tiến trình con: không mang theo địa chỉ database thật của ứng dụng. */
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.DATABASE_URL;
  delete env.DATABASE_CA;
  return env;
}

/** Chạy một file kiểm thử; in nguyên văn những gì nó in, và đọc dòng tổng kết «PASS=n FAIL=m» của nó. */
function runTestFile(file, env) {
  const path = join(here, file);
  const localTsx = join(root, "node_modules", ".bin", "tsx");
  const [command, args] = file.endsWith(".ts")
    ? existsSync(localTsx)
      ? [localTsx, [path]]
      : ["npx", ["--yes", "tsx", path]]
    : [process.execPath, [path]];
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "inherit"] });
    running = child;
    let tail = "";
    let passed = 0;
    let failed = 0;
    let counted = false;
    const scan = (line) => {
      // Hai kiểu dòng tổng kết: «PASS=12 FAIL=0» và «12 passed, 0 failed».
      const match = /PASS=(\d+)\s+FAIL=(\d+)/.exec(line) ?? /(\d+) passed, (\d+) failed/.exec(line);
      if (!match) return;
      passed = Number(match[1]);
      failed = Number(match[2]);
      counted = true;
    };
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      const lines = (tail + chunk.toString("utf8")).split("\n");
      tail = lines.pop() ?? "";
      lines.forEach(scan);
    });
    child.on("error", (error) => resolve({ file, code: 1, passed: 0, failed: 1, counted: false, problem: error.message }));
    child.on("close", (code, signal) => {
      running = null;
      scan(tail);
      resolve({ file, code: code ?? 1, signal, passed, failed, counted });
    });
  });
}

const started = Date.now();
const throwaway = !process.env.KM_TEST_DATABASE_URL;
const database = throwaway ? await startDockerDatabase() : await useGivenDatabase(/** @type {string} */ (process.env.KM_TEST_DATABASE_URL));
await installSchema(database.url);

const files = readdirSync(here)
  .filter((name) => /\.test\.(mjs|ts)$/.test(name))
  .filter((name) => filters.length === 0 || filters.some((filter) => name.includes(filter)))
  .sort();
if (files.length === 0) fail(`Không có file kiểm thử nào${filters.length ? ` khớp «${filters.join(", ")}»` : ""} trong server/tests.`, 2);

const env = childEnv({
  KM_TEST_DATABASE_URL: database.url,
  KM_TEST_ADMIN_URL: database.adminUrl,
  // «1» = database do chính file này dựng bằng Docker, dùng xong bỏ: bài kiểm thử được phép chỉnh cả cấu hình máy chủ của
  // nó (bật TLS…). Với database có sẵn được giao cho thì không bao giờ.
  KM_TEST_THROWAWAY: throwaway ? "1" : "",
  // Băm mật khẩu (scrypt) chạy trên các luồng phụ của Node: thêm luồng để các tài khoản thử được tạo song song.
  UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? "8",
});

const results = [];
for (const file of files) {
  console.log(`\n════════ ${file} ════════`);
  results.push(await runTestFile(file, env));
}
removeContainer();

let passed = 0;
let failed = 0;
console.log("\n════════ Tổng kết ════════");
for (const result of results) {
  // File không in dòng tổng kết (hoặc thoát với mã khác 0 mà không báo FAIL nào): tính theo mã thoát.
  const brokeSilently = result.code !== 0 && result.failed === 0;
  passed += result.passed;
  failed += result.failed + (brokeSilently ? 1 : 0);
  const state = result.code === 0 ? "đạt" : `KHÔNG ĐẠT (mã thoát ${result.code}${result.signal ? `, ${result.signal}` : ""})`;
  console.log(`  ${result.file}: ${result.counted ? `PASS=${result.passed} FAIL=${result.failed}` : "không có dòng tổng kết"} — ${state}`);
}
console.log(`══ Tất cả: PASS=${passed} FAIL=${failed} (${results.length} file, ${Math.round((Date.now() - started) / 1000)} giây)`);
process.exit(failed > 0 || results.some((result) => result.code !== 0) ? 1 : 0);
