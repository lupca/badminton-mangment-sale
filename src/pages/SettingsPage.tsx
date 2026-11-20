// Trang "Dữ liệu": vai trò trên máy này, thông tin sale, ngưỡng cảnh báo tồn kho, sao lưu ra file, nhập từ file,
// khôi phục dữ liệu mẫu.
import { useId, useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import { todayISO } from "../lib/format";
import { ROLE_HINT, ROLE_LABEL, canManage } from "../lib/roles";
import { newerStock } from "../lib/stock";
import { mergeDeviceSettings, normalizeDB, useStore } from "../lib/store";
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

/** File hợp lệ đã chọn: cho biết trong file có gì và hai cách nhập. */
function ImportOptions({ file, onImport }: { file: BackupFile; onImport: (mode: ImportMode) => void }) {
  const { programs, orders, stock, settings } = useStore();
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
        . Chọn một trong hai cách nhập:
      </Notice>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-gray-200 p-3">
          <Button variant="primary" onClick={() => onImport("merge")}>
            Thêm vào dữ liệu hiện có
          </Button>
          <p className="mt-2 text-sm text-gray-600">
            Giữ nguyên dữ liệu đang có và thêm dữ liệu trong file. Chương trình hoặc đơn hàng nào đã có sẵn trên máy này
            sẽ bị ghi đè bằng bản trong file.
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
                Tồn kho trên máy này được cập nhật gần đây hơn nên giữ nguyên, không lấy tồn kho trong file.
              </p>
            )
          ) : null}
        </div>
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
      </div>
    </>
  );
}

export default function SettingsPage() {
  const { programs, orders, stock, settings, updateSettings, exportJSON, importJSON, resetToSeed } = useStore();
  const stockCount = Object.keys(stock.bySku).length;
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile | null>(null);

  const exportBackup = () => {
    const fileName = `khuyen-mai-${todayISO()}.json`;
    downloadFile(fileName, exportJSON());
    toast(`Đã xuất file ${fileName}`);
  };

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

  const runImport = (file: BackupFile, mode: ImportMode) => {
    if (mode === "replace") {
      const question =
        `Thay toàn bộ dữ liệu hiện có bằng dữ liệu trong file «${file.name}»?\n\n` +
        `${programs.length} chương trình và ${orders.length} đơn hàng` +
        (stockCount > 0 ? ` cùng số liệu tồn kho của ${stockCount} mã hàng` : "") +
        " đang có trên máy này sẽ bị xóa. " +
        "Không thể hoàn tác.";
      if (!window.confirm(question)) return;
    }
    try {
      // Nhập đè giữ nguyên vai trò và thông tin sale của máy này (kho dữ liệu lo việc đó).
      const result = importJSON(file.text, mode);
      toast(
        mode === "merge"
          ? `Đã thêm ${result.programs} chương trình và ${result.orders} đơn hàng vào dữ liệu hiện có`
          : `Đã thay toàn bộ dữ liệu: ${result.programs} chương trình, ${result.orders} đơn hàng`,
      );
      setPicked(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Không nhập được file.", "error");
    }
  };

  const restoreSeed = () => {
    if (!window.confirm("Xóa toàn bộ chương trình, đơn hàng và số liệu tồn kho hiện có rồi nạp lại dữ liệu mẫu?")) return;
    resetToSeed();
    toast("Đã nạp lại dữ liệu mẫu");
  };

  return (
    <>
      <PageHeader title="Dữ liệu" />
      <div className="max-w-3xl space-y-4">
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
            Hệ thống chưa có đăng nhập nên vai trò là thiết lập của từng máy: ai dùng máy này cũng đổi được. Muốn mỗi
            người một tài khoản, quyền gắn với tài khoản, thì cần thêm máy chủ (backend).
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

        {manager ? (
          <Card title="Cảnh báo tồn kho">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-800">
              <label htmlFor={`${roleName}-threshold`}>Báo «sắp hết hàng» khi tồn kho từ</label>
              <span className="inline-block w-20 shrink-0">
                <QtyInput
                  id={`${roleName}-threshold`}
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
        ) : null}

        <Card title="Sao lưu dữ liệu">
          <p className="text-sm text-gray-700">
            Toàn bộ chương trình, đơn hàng và số liệu tồn kho được lưu ngay trong trình duyệt này, trên máy này, nên
            hãy xuất file sao lưu thường xuyên để không mất dữ liệu khi hỏng máy hoặc xóa dữ liệu trình duyệt.
          </p>
          <p className="mt-2 text-sm text-gray-700">
            Muốn chuyển sang máy khác hoặc gửi cho đồng nghiệp: xuất file ở đây, rồi sang máy kia vào mục «Nhập dữ liệu
            từ file».
          </p>
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

        <Card title="Nhập dữ liệu từ file">
          <p className="text-sm text-gray-700">Chọn file sao lưu (đuôi .json) đã xuất từ máy này hoặc máy khác.</p>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={pickFile} />
          <Button className="mt-3" onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4" /> Chọn file…
          </Button>
          {picked && "error" in picked ? (
            <Notice tone="error" className="mt-3">
              Không nhập được file «{picked.name}»: {picked.error}
            </Notice>
          ) : null}
          {picked && "data" in picked ? (
            <ImportOptions file={picked} onImport={(mode) => runImport(picked, mode)} />
          ) : null}
        </Card>

        {manager ? (
          <Card title="Khôi phục dữ liệu mẫu">
            <p className="text-sm text-gray-700">
              Xóa toàn bộ chương trình, đơn hàng và số liệu tồn kho hiện có, nạp lại các chương trình mẫu ban đầu. Nên
              xuất file sao lưu trước khi làm.
            </p>
            <Button variant="danger" className="mt-3" onClick={restoreSeed}>
              Khôi phục dữ liệu mẫu
            </Button>
          </Card>
        ) : null}
      </div>
    </>
  );
}
