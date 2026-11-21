// Trang "Dữ liệu".
//  • Không có máy chủ: vai trò trên máy này, thông tin sale, ngưỡng cảnh báo tồn kho, sao lưu ra file, nhập từ file,
//    khôi phục dữ liệu mẫu.
//  • Có máy chủ: tài khoản đang đăng nhập, ngưỡng cảnh báo tồn kho (quản lý), xuất file, và — riêng người quản lý —
//    nhập từ file, đưa dữ liệu cũ của máy này lên máy chủ.
import { useId, useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import AccountCard from "../components/account/AccountCard";
import { formatDateTime, todayISO } from "../lib/format";
import { ROLE_HINT, ROLE_LABEL, canManage } from "../lib/roles";
import { newerStock } from "../lib/stock";
import { mergeDeviceSettings, normalizeDB, readDeviceData, seedDB, useStore } from "../lib/store";
import type { DB, Role } from "../types";
import { Button, Card, Field, Input, Notice, PageHeader, QtyInput, toast } from "../ui";

const ROLES: Role[] = ["manager", "sale"];

type ImportMode = "merge" | "replace";

interface BackupFile {
  name: string;
  text: string;
  data: DB;
}

/** File người dùng vừa chọn: đọc được (kèm dữ liệu đã kiểm tra) hoặc không hợp lệ (kèm lý do). */
type PickedFile = BackupFile | { name: string; error: string };

function parseBackup(text: string): DB {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("File không phải JSON hợp lệ.");
  }
  return normalizeDB(raw);
}

function downloadFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Thu hồi chậm một nhịp để trình duyệt kịp bắt đầu tải.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function countSameId(incoming: Array<{ id: string }>, existing: Array<{ id: string }>): number {
  const ids = new Set(existing.map((x) => x.id));
  return incoming.filter((x) => ids.has(x.id)).length;
}

/** "3 chương trình và 12 đơn hàng, cùng số liệu tồn kho của 40 mã hàng" */
function describeData(data: Pick<DB, "programs" | "orders" | "stock">): string {
  const stockCount = Object.keys(data.stock.bySku).length;
  return (
    `${data.programs.length} chương trình và ${data.orders.length} đơn hàng` +
    (stockCount > 0 ? `, cùng số liệu tồn kho của ${stockCount} mã hàng` : "")
  );
}

/** File hợp lệ đã chọn: cho biết trong file có gì và các cách nhập (có máy chủ thì chỉ có «thêm vào»). */
function ImportOptions({ file, onImport }: { file: BackupFile; onImport: (mode: ImportMode) => void }) {
  const { programs, orders, stock, settings, mode } = useStore();
  const cloud = mode === "cloud";
  // Dữ liệu «đang có» nằm ở đâu, để câu chữ nói đúng nơi.
  const here = cloud ? "trên máy chủ" : "trên máy này";
  const incoming = file.data;
  const sameProgramCount = countSameId(incoming.programs, programs);
  const sameOrderCount = countSameId(incoming.orders, orders);
  const stockCount = Object.keys(stock.bySku).length;
  const incomingStockCount = Object.keys(incoming.stock.bySku).length;
  // Khi thêm vào dữ liệu hiện có, tồn kho không trộn từng mã: bộ nào được cập nhật gần đây hơn thì giữ trọn bộ đó.
  const fileStockWins = newerStock(stock, incoming.stock) === incoming.stock;
  // Máy sale lấy ngưỡng «sắp hết hàng» theo file (xem mergeDeviceSettings); chỉ nói ra khi ngưỡng thật sự đổi.
  const followsFileThreshold =
    mergeDeviceSettings(settings, incoming.settings).lowStockThreshold !== settings.lowStockThreshold;

  if (incoming.programs.length === 0 && incoming.orders.length === 0) {
    return (
      <Notice tone="warning" className="mt-3">
        File «{file.name}» không có chương trình hay đơn hàng nào nên không có gì để nhập.
      </Notice>
    );
  }
  return (
    <>
      <Notice tone="info" className="mt-3">
        File «{file.name}» có <strong>{incoming.programs.length}</strong> chương trình và{" "}
        <strong>{incoming.orders.length}</strong> đơn hàng
        {incomingStockCount > 0 ? (
          <>
            , cùng số liệu tồn kho của <strong>{incomingStockCount}</strong> mã hàng
          </>
        ) : null}
        .{cloud ? null : " Chọn một trong hai cách nhập:"}
      </Notice>
      <div className={cloud ? "mt-3" : "mt-3 grid gap-3 sm:grid-cols-2"}>
        <div className="rounded-md border border-gray-200 p-3">
          <Button variant="primary" onClick={() => onImport("merge")}>
            Thêm vào dữ liệu hiện có
          </Button>
          <p className="mt-2 text-sm text-gray-600">
            Giữ nguyên dữ liệu đang có và thêm dữ liệu trong file. Chương trình hoặc đơn hàng nào đã có sẵn {here} sẽ
            bị ghi đè bằng bản trong file.
            {cloud ? " Cả nhóm sẽ thấy dữ liệu vừa thêm; đơn mới thêm từ file đứng tên tài khoản của bạn." : null}
          </p>
          {sameProgramCount + sameOrderCount > 0 ? (
            <p className="mt-1 text-sm text-amber-800">
              Sẽ ghi đè {sameProgramCount} chương trình và {sameOrderCount} đơn hàng đang có.
            </p>
          ) : null}
          {followsFileThreshold ? (
            <p className="mt-1 text-sm text-gray-600">
              Ngưỡng báo «sắp hết hàng» sẽ theo file:{" "}
              {incoming.settings.lowStockThreshold > 0
                ? `tồn từ ${incoming.settings.lowStockThreshold} trở xuống.`
                : "không báo «sắp hết», chỉ báo hết hàng."}
            </p>
          ) : null}
          {incomingStockCount > 0 && stockCount > 0 ? (
            fileStockWins ? (
              <p className="mt-1 text-sm text-amber-800">
                Tồn kho trong file được cập nhật gần đây hơn nên sẽ thay số liệu tồn kho đang có.
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-600">
                Tồn kho {here} được cập nhật gần đây hơn nên giữ nguyên, không lấy tồn kho trong file.
              </p>
            )
          ) : null}
        </div>
        {cloud ? null : (
          <div className="rounded-md border border-gray-200 p-3">
            <Button variant="danger" onClick={() => onImport("replace")}>
              Thay toàn bộ dữ liệu hiện có
            </Button>
            <p className="mt-2 text-sm text-gray-600">
              Xóa hết {programs.length} chương trình và {orders.length} đơn hàng
              {stockCount > 0 ? ` cùng số liệu tồn kho của ${stockCount} mã hàng` : ""} đang có trên máy này, chỉ giữ dữ
              liệu trong file. Vai trò và thông tin sale của máy này vẫn giữ nguyên.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

/** Khung «Nhập dữ liệu từ file». */
function ImportCard() {
  const { programs, orders, stock, mode, importJSON } = useStore();
  const cloud = mode === "cloud";
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile | null>(null);

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // để lần sau chọn lại đúng file này vẫn nhận
    if (!file) return;
    const text = await file.text().catch(() => null);
    if (text == null) {
      setPicked({ name: file.name, error: "Không đọc được file này." });
      return;
    }
    try {
      setPicked({ name: file.name, text, data: parseBackup(text) });
    } catch (error) {
      setPicked({ name: file.name, error: error instanceof Error ? error.message : "File không hợp lệ." });
    }
  };

  const runImport = (file: BackupFile, importMode: ImportMode) => {
    if (importMode === "replace") {
      const question =
        `Thay toàn bộ dữ liệu hiện có bằng dữ liệu trong file «${file.name}»?\n\n` +
        `${describeData({ programs, orders, stock })} đang có trên máy này sẽ bị xóa. ` +
        "Không thể hoàn tác.";
      if (!window.confirm(question)) return;
    }
    try {
      // Nhập đè giữ nguyên vai trò và thông tin sale của máy này (kho dữ liệu lo việc đó).
      const result = importJSON(file.text, importMode);
      toast(
        importMode === "merge"
          ? `Đã thêm ${result.programs} chương trình và ${result.orders} đơn hàng vào dữ liệu hiện có`
          : `Đã thay toàn bộ dữ liệu: ${result.programs} chương trình, ${result.orders} đơn hàng`,
      );
      setPicked(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Không nhập được file.", "error");
    }
  };

  return (
    <Card title="Nhập dữ liệu từ file">
      <p className="text-sm text-gray-700">
        {cloud
          ? "Chọn file sao lưu (đuôi .json) để thêm dữ liệu trong đó vào dữ liệu chung trên máy chủ."
          : "Chọn file sao lưu (đuôi .json) đã xuất từ máy này hoặc máy khác."}
      </p>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={pickFile} />
      <Button className="mt-3" onClick={() => fileInput.current?.click()}>
        <Upload className="h-4 w-4" /> Chọn file…
      </Button>
      {picked && "error" in picked ? (
        <Notice tone="error" className="mt-3">
          Không nhập được file «{picked.name}»: {picked.error}
        </Notice>
      ) : null}
      {picked && "data" in picked ? <ImportOptions file={picked} onImport={(m) => runImport(picked, m)} /> : null}
    </Card>
  );
}

/** Khung «Sao lưu dữ liệu» / «Xuất dữ liệu ra file». */
function BackupCard() {
  const { programs, orders, stock, settings, mode, exportJSON } = useStore();
  const cloud = mode === "cloud";
  const stockCount = Object.keys(stock.bySku).length;

  const exportBackup = () => {
    const fileName = `khuyen-mai-${todayISO()}.json`;
    downloadFile(fileName, exportJSON());
    toast(`Đã xuất file ${fileName}`);
  };

  return (
    <Card title={cloud ? "Xuất dữ liệu ra file" : "Sao lưu dữ liệu"}>
      {cloud ? (
        <p className="text-sm text-gray-700">
          Dữ liệu được lưu trên máy chủ và dùng chung cho cả nhóm, không nằm trong trình duyệt này. Xuất file nếu muốn
          giữ thêm một bản trên máy.
          {canManage(settings.role) ? null : " File chỉ gồm những gì tài khoản của bạn được thấy: chương trình, tồn kho và đơn của bạn."}
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-700">
            Toàn bộ chương trình, đơn hàng và số liệu tồn kho được lưu ngay trong trình duyệt này, trên máy này, nên
            hãy xuất file sao lưu thường xuyên để không mất dữ liệu khi hỏng máy hoặc xóa dữ liệu trình duyệt.
          </p>
          <p className="mt-2 text-sm text-gray-700">
            Muốn chuyển sang máy khác hoặc gửi cho đồng nghiệp: xuất file ở đây, rồi sang máy kia vào mục «Nhập dữ liệu
            từ file».
          </p>
        </>
      )}
      <p className="mt-3 text-sm text-gray-900">
        Hiện có <strong>{programs.length}</strong> chương trình và <strong>{orders.length}</strong> đơn hàng
        {stockCount > 0 ? (
          <>
            , cùng số liệu tồn kho của <strong>{stockCount}</strong> mã hàng
          </>
        ) : null}
        .
      </p>
      <Button variant="primary" className="mt-3" onClick={exportBackup}>
        <Download className="h-4 w-4" /> Xuất file sao lưu
      </Button>
    </Card>
  );
}

/** Khung «Cảnh báo tồn kho» (chỉ người quản lý). */
function ThresholdCard() {
  const { settings, updateSettings } = useStore();
  const id = useId();
  return (
    <Card title="Cảnh báo tồn kho">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-800">
        <label htmlFor={id}>Báo «sắp hết hàng» khi tồn kho từ</label>
        <span className="inline-block w-20 shrink-0">
          <QtyInput
            id={id}
            value={settings.lowStockThreshold}
            onChange={(lowStockThreshold) => updateSettings({ lowStockThreshold })}
            max={9999}
          />
        </span>
        <span>trở xuống.</span>
      </div>
      <p className="mt-1.5 text-xs text-gray-500">
        Mã hết hàng (tồn 0) luôn được báo. Để trống hoặc 0 nếu không cần báo «sắp hết». Cảnh báo hiện ở màn hình
        «Sản phẩm» và khi nhập đơn.
      </p>
    </Card>
  );
}

// ───────────────────────── Có máy chủ ─────────────────────────

// Ghi lại lúc người quản lý đã đưa dữ liệu cũ của trình duyệt này lên máy chủ, để không mời lại.
const DEVICE_DATA_UPLOADED_KEY = "kmdb.v1.uploaded";

function wasDeviceDataUploaded(): boolean {
  try {
    return localStorage.getItem(DEVICE_DATA_UPLOADED_KEY) != null;
  } catch {
    return false;
  }
}

/**
 * Người quản lý đưa dữ liệu ban đầu lên máy chủ: dữ liệu còn nằm trong trình duyệt này từ lúc chưa có máy chủ, hoặc
 * (khi máy chủ chưa có chương trình nào) các chương trình mẫu.
 */
function StarterDataCard() {
  const { programs, importJSON } = useStore();
  const [deviceData] = useState(() => (wasDeviceDataUploaded() ? null : readDeviceData()));
  const [uploaded, setUploaded] = useState(false);
  const hasDeviceData = !uploaded && deviceData != null && deviceData.programs.length + deviceData.orders.length > 0;
  const serverEmpty = programs.length === 0;
  if (!hasDeviceData && !serverEmpty) return null;

  const add = (data: DB, done: string) => {
    try {
      importJSON(JSON.stringify(data), "merge");
      toast(done);
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Không đưa được dữ liệu lên máy chủ.", "error");
      return false;
    }
  };
  const uploadDeviceData = () => {
    if (!deviceData) return;
    if (!add(deviceData, `Đã đưa ${describeData(deviceData)} lên máy chủ`)) return;
    try {
      localStorage.setItem(DEVICE_DATA_UPLOADED_KEY, new Date().toISOString());
    } catch {
      // không ghi được dấu thì lần sau khung này hiện lại — không sao
    }
    setUploaded(true);
  };
  const loadSamples = () => {
    const seed = seedDB();
    add(seed, `Đã nạp ${seed.programs.length} chương trình mẫu`);
  };

  return (
    <Card title="Dữ liệu ban đầu">
      {hasDeviceData ? (
        <>
          <p className="text-sm text-gray-700">
            Trình duyệt này còn dữ liệu từ lúc hệ thống chưa có máy chủ: <strong>{describeData(deviceData)}</strong>
            {deviceData.stock.updatedAt ? ` (tồn kho cập nhật lúc ${formatDateTime(deviceData.stock.updatedAt)})` : ""}.
            Đưa lên máy chủ để cả nhóm dùng chung; bản trong trình duyệt này vẫn được giữ nguyên.
          </p>
          <Button variant="primary" className="mt-3" onClick={uploadDeviceData}>
            <Upload className="h-4 w-4" /> Đưa dữ liệu của máy này lên máy chủ
          </Button>
        </>
      ) : null}
      {serverEmpty ? (
        <div className={hasDeviceData ? "mt-4 border-t border-gray-200 pt-4" : undefined}>
          <p className="text-sm text-gray-700">
            Máy chủ chưa có chương trình nào. Có thể nạp các chương trình mẫu (bảng giá và chương trình khuyến mãi có
            sẵn trong ứng dụng) để bắt đầu, rồi sửa lại cho đúng.
          </p>
          <Button className="mt-3" onClick={loadSamples}>
            Nạp chương trình mẫu
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function CloudSettings() {
  const { settings, flushNow } = useStore();
  const manager = canManage(settings.role);

  // Đăng xuất khi còn thay đổi chưa lưu lên máy chủ thì các thay đổi đó mất: thử lưu trước, không được thì hỏi lại.
  const beforeSignOut = async () => {
    if (await flushNow()) return true;
    return window.confirm(
      "Còn thay đổi chưa lưu được lên máy chủ (có thể đang mất mạng). Đăng xuất bây giờ thì các thay đổi đó sẽ mất.\n\nVẫn đăng xuất?",
    );
  };

  return (
    <>
      <AccountCard beforeSignOut={beforeSignOut} />
      {manager ? <StarterDataCard /> : null}
      {manager ? <ThresholdCard /> : null}
      <BackupCard />
      {manager ? <ImportCard /> : null}
    </>
  );
}

// ───────────────────────── Không có máy chủ ─────────────────────────

function LocalSettings() {
  const { settings, updateSettings, resetToSeed } = useStore();
  const manager = canManage(settings.role);
  const roleName = useId();

  const changeRole = (role: Role) => {
    if (role === settings.role) return;
    if (
      role === "manager" &&
      !window.confirm("Chuyển máy này sang vai trò Quản lý?\n\nVai trò này dành cho người tạo và sửa chương trình khuyến mãi.")
    ) {
      return;
    }
    updateSettings({ role });
    toast(`Máy này đang dùng vai trò ${ROLE_LABEL[role]}`);
  };

  const restoreSeed = () => {
    if (!window.confirm("Xóa toàn bộ chương trình, đơn hàng và số liệu tồn kho hiện có rồi nạp lại dữ liệu mẫu?")) return;
    resetToSeed();
    toast("Đã nạp lại dữ liệu mẫu");
  };

  return (
    <>
      <Card title="Vai trò trên máy này">
        <fieldset className="space-y-2.5">
          <legend className="sr-only">Vai trò</legend>
          {ROLES.map((role) => (
            <label key={role} className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
              <input
                type="radio"
                name={roleName}
                checked={settings.role === role}
                onChange={() => changeRole(role)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
              />
              <span>
                <span className="font-medium text-gray-900">{ROLE_LABEL[role]}</span>
                <span className="block text-gray-600">{ROLE_HINT[role]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="mt-3 text-xs text-gray-500">
          Bản dùng thử này không cần đăng nhập: vai trò chọn theo từng máy, ai dùng máy này cũng đổi được. Bản chính
          thức có đăng nhập, mỗi người một tài khoản và quyền theo tài khoản.
        </p>
      </Card>

      <Card title="Thông tin sale">
        <p className="text-sm text-gray-700">Tự ghi vào mỗi đơn mới tạo trên máy này, và hiện trên đơn in / gửi đại lý.</p>
        <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="Tên sale">
            <Input
              autoComplete="off"
              value={settings.salesperson}
              onChange={(e) => updateSettings({ salesperson: e.target.value })}
              onBlur={(e) => {
                const trimmed = e.target.value.trim();
                if (trimmed !== e.target.value) updateSettings({ salesperson: trimmed });
              }}
            />
          </Field>
          <Field label="Số điện thoại sale">
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={settings.salespersonPhone}
              onChange={(e) => updateSettings({ salespersonPhone: e.target.value })}
              onBlur={(e) => {
                const trimmed = e.target.value.trim();
                if (trimmed !== e.target.value) updateSettings({ salespersonPhone: trimmed });
              }}
            />
          </Field>
        </div>
      </Card>

      {manager ? <ThresholdCard /> : null}
      <BackupCard />
      <ImportCard />

      {manager ? (
        <Card title="Khôi phục dữ liệu mẫu">
          <p className="text-sm text-gray-700">
            Xóa toàn bộ chương trình, đơn hàng và số liệu tồn kho hiện có, nạp lại dữ liệu mẫu ban đầu: 3 chương trình,
            các đơn hàng demo của 4 sale và số tồn kho demo. Nên xuất file sao lưu trước khi làm.
          </p>
          <Button variant="danger" className="mt-3" onClick={restoreSeed}>
            Khôi phục dữ liệu mẫu
          </Button>
        </Card>
      ) : null}
    </>
  );
}

export default function SettingsPage() {
  const { mode } = useStore();
  return (
    <>
      <PageHeader title="Cài đặt" />
      <div className="max-w-3xl space-y-4">{mode === "cloud" ? <CloudSettings /> : <LocalSettings />}</div>
    </>
  );
}
