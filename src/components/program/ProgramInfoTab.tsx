// Tab «Thông tin»: tên, hãng, thời gian áp dụng, ghi chú. Mọi ô ghi thẳng vào kho dữ liệu.
import type { Program } from "../../types";
import { formatPeriod } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Card, DateInput, Field, Input, Notice, Textarea } from "../../ui";
import { hintCls } from "./fields";
import type { UpdateProgram } from "./programEdits";

const BRAND_LIST_ID = "program-brand-options";

export default function ProgramInfoTab({ program, update }: { program: Program; update: UpdateProgram }) {
  const { programs } = useStore();
  const patch = (fields: Partial<Program>) => update((p) => ({ ...p, ...fields }));

  // Gợi ý các hãng đã dùng ở chương trình khác; hãng mới thì cứ gõ.
  const otherBrands = programs.filter((p) => p.id !== program.id).map((p) => p.brand.trim());
  const brandOptions = [...new Set(otherBrands)].filter(Boolean).sort((a, b) => a.localeCompare(b, "vi"));

  const endsBeforeStart = !!program.startDate && !!program.endDate && program.endDate < program.startDate;

  return (
    <Card>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Tên chương trình" className="col-span-2 md:col-span-4">
          <Input
            value={program.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="vd KM tháng 11/2026 — Mua vợt tặng vợt"
          />
        </Field>

        <Field label="Hãng" hint="Chọn trong gợi ý hoặc gõ tên hãng mới, vd Yonex." className="col-span-2">
          <Input
            list={BRAND_LIST_ID}
            value={program.brand}
            onChange={(e) => patch({ brand: e.target.value })}
            placeholder="vd Li-Ning"
          />
        </Field>
        <div className="col-span-2">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Từ ngày">
              <DateInput value={program.startDate} onChange={(value) => patch({ startDate: value })} />
            </Field>
            <Field label="Đến ngày">
              <DateInput value={program.endDate} onChange={(value) => patch({ endDate: value })} />
            </Field>
          </div>
          <p className={hintCls}>
            Thời gian áp dụng: {formatPeriod(program.startDate, program.endDate)}. Gõ theo ngày/tháng/năm hoặc bấm
            biểu tượng lịch; để trống ngày nào thì không giới hạn phía đó.
          </p>
        </div>

        {endsBeforeStart ? (
          <Notice tone="warning" className="col-span-2 md:col-span-4">
            «Đến ngày» đang trước «Từ ngày». Hãy kiểm tra lại hai ngày này.
          </Notice>
        ) : null}

        <Field
          label="Ghi chú"
          hint="Vd số thông báo, phạm vi áp dụng, điều kiện không cộng dồn với chương trình khác."
          className="col-span-2 md:col-span-4"
        >
          <Textarea rows={4} value={program.note} onChange={(e) => patch({ note: e.target.value })} />
        </Field>
      </div>

      <datalist id={BRAND_LIST_ID}>
        {brandOptions.map((brand) => (
          <option key={brand} value={brand} />
        ))}
      </datalist>
    </Card>
  );
}
